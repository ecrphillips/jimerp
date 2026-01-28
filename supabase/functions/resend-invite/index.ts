import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Canonical app URL - use environment variable with fallback to published URL
// IMPORTANT: Set SITE_URL environment variable in production
const SITE_URL = Deno.env.get('SITE_URL') || 'https://jimerp.lovable.app';

interface ResendRequest {
  user_id: string;
  role?: 'ADMIN' | 'OPS' | 'CLIENT';
  client_id?: string;
  generate_link_only?: boolean; // DEV: return link instead of sending email
  debug_mode?: boolean; // DEV: return full debug info about URLs
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Verify caller is ADMIN
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[resend-invite] Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callingUser }, error: authError } = await adminClient.auth.getUser(token);
    
    if (authError || !callingUser) {
      console.error('[resend-invite] Invalid token');
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: roleData } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', callingUser.id)
      .single();

    if (roleData?.role !== 'ADMIN') {
      console.error('[resend-invite] Not admin');
      return new Response(
        JSON.stringify({ error: 'Only admins can resend invites' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ResendRequest = await req.json();
    const { user_id, role, client_id, generate_link_only = false, debug_mode = false } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[resend-invite] Resend requested for user_id:', user_id, 'generate_link_only:', generate_link_only, 'debug_mode:', debug_mode);

    // The redirect URL - ALWAYS point to JIM app's auth callback
    const redirectTo = `${SITE_URL}/auth/callback`;
    console.log('[resend-invite] SITE_URL:', SITE_URL);
    console.log('[resend-invite] redirectTo:', redirectTo);
    console.log('[resend-invite] supabaseUrl:', supabaseUrl);

    // Get user email from auth
    const { data: { user }, error: getUserError } = await adminClient.auth.admin.getUserById(user_id);
    
    if (getUserError || !user?.email) {
      console.error('[resend-invite] User not found:', getUserError?.message);
      return new Response(
        JSON.stringify({ error: 'User not found in auth system' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user has a role, if not and role provided, create it
    const { data: existingRole } = await adminClient
      .from('user_roles')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();

    if (!existingRole && role) {
      console.log('[resend-invite] Creating missing role for user:', user_id, 'role:', role);
      
      if (role === 'CLIENT' && !client_id) {
        return new Response(
          JSON.stringify({ error: 'CLIENT role requires a client_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error: roleInsertError } = await adminClient
        .from('user_roles')
        .insert({
          user_id: user_id,
          role: role,
          client_id: role === 'CLIENT' ? client_id : null
        });

      if (roleInsertError) {
        console.error('[resend-invite] Role insert error:', roleInsertError.message);
        return new Response(
          JSON.stringify({ error: `Failed to assign role: ${roleInsertError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Ensure profile exists
    const { error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        user_id: user_id,
        email: user.email.toLowerCase(),
        name: user.user_metadata?.name || user.email.split('@')[0],
        is_active: true
      }, { onConflict: 'user_id' });

    if (profileError) {
      console.error('[resend-invite] Profile upsert error (non-fatal):', profileError.message);
    }

    // Try to send invitation first
    console.log('[resend-invite] Attempting to send invitation email to:', user.email);
    
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(user.email, {
      data: user.user_metadata,
      redirectTo
    });

    if (inviteError) {
      console.error('[resend-invite] Invite error:', inviteError.message);
      
      // User has already confirmed - need to use password reset instead
      if (inviteError.message.includes('already been registered')) {
        console.log('[resend-invite] User already confirmed, using password reset flow');
        
        if (generate_link_only) {
          // Generate link without sending email
          const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
            type: 'recovery',
            email: user.email,
            options: { redirectTo }
          });

          if (linkError) {
            console.error('[resend-invite] Failed to generate recovery link:', linkError.message);
            return new Response(
              JSON.stringify({ error: `Failed to generate link: ${linkError.message}` }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const generatedLink = linkData.properties?.action_link || '';
          console.log('[resend-invite] Generated recovery link (not emailed):', generatedLink);
          
          // Log analysis of the generated link
          const linkUrl = new URL(generatedLink);
          console.log('[resend-invite] Link host:', linkUrl.host);
          console.log('[resend-invite] Link redirect_to param:', linkUrl.searchParams.get('redirect_to'));
          
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: 'Password reset link generated (not emailed)',
              link: generatedLink,
              email_sent: false,
              type: 'password_reset',
              debug: debug_mode ? {
                site_url: SITE_URL,
                redirect_to_requested: redirectTo,
                supabase_url: supabaseUrl,
                link_host: linkUrl.host,
                link_redirect_to: linkUrl.searchParams.get('redirect_to'),
                full_link: generatedLink
              } : undefined
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Send password reset email
        const { error: resetError } = await adminClient.auth.resetPasswordForEmail(user.email, {
          redirectTo
        });

        if (resetError) {
          console.error('[resend-invite] Password reset email FAILED:', resetError.message);
          return new Response(
            JSON.stringify({ 
              error: `User is already active. Password reset email failed: ${resetError.message}`,
              email_sent: false
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('[resend-invite] Password reset email SENT to:', user.email);
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'User is already active. Password reset email sent.',
            email_sent: true,
            type: 'password_reset',
            redirect_to: redirectTo
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (inviteError.message.includes('rate limit')) {
        return new Response(
          JSON.stringify({ error: 'Email rate limit exceeded. Please wait before sending more invites.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: `Failed to send invitation email: ${inviteError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If generate_link_only was requested but invite succeeded, we still sent email
    // This is fine since inviteUserByEmail doesn't have a no-email option
    
    console.log('[resend-invite] SUCCESS - Invitation email sent to:', user.email);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Invitation email sent to ${user.email}`,
        email_sent: true,
        type: 'invite',
        redirect_to: redirectTo
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[resend-invite] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
