import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ResendRequest {
  user_id: string;
  role?: 'ADMIN' | 'OPS' | 'CLIENT';
  client_id?: string;
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
    const { user_id, role, client_id } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[resend-invite] Resend requested for user_id:', user_id);

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
    const { data: existingRole, error: roleCheckError } = await adminClient
      .from('user_roles')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();

    if (!existingRole && role) {
      // User has no role but one was provided - create it
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

    // Send new invitation email using inviteUserByEmail
    // This will send a fresh magic link to the user
    console.log('[resend-invite] Sending invitation email to:', user.email);
    
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(user.email, {
      data: user.user_metadata
    });

    if (inviteError) {
      console.error('[resend-invite] Invite error:', inviteError.message);
      
      // Check for specific error cases
      if (inviteError.message.includes('already been registered')) {
        // User has already confirmed - they should use password reset instead
        console.log('[resend-invite] User already confirmed, generating password reset');
        
        const { error: resetError } = await adminClient.auth.admin.generateLink({
          type: 'recovery',
          email: user.email,
        });

        if (resetError) {
          console.error('[resend-invite] Password reset error:', resetError.message);
          return new Response(
            JSON.stringify({ error: `User is already active. Password reset failed: ${resetError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'User is already active. Password reset email sent instead.',
            email_sent: true,
            type: 'password_reset'
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

    console.log('[resend-invite] SUCCESS - Invitation email sent to:', user.email);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Invitation email sent to ${user.email}`,
        email_sent: true,
        type: 'invite'
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
