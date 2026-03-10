import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Canonical app URL - use environment variable with fallback to published URL
// IMPORTANT: Set SITE_URL environment variable in production
const SITE_URL = Deno.env.get('SITE_URL') || 'https://jimerp.lovable.app';

interface InviteRequest {
  email: string;
  role: 'ADMIN' | 'OPS' | 'CLIENT';
  client_id?: string;
  coroast_member_id?: string;
  name?: string;
  generate_link_only?: boolean; // DEV: return link instead of sending email
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
      console.error('[invite-user] Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callingUser }, error: authError } = await adminClient.auth.getUser(token);
    
    if (authError || !callingUser) {
      console.error('[invite-user] Invalid token:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: roleData, error: roleError } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', callingUser.id)
      .single();

    if (roleError || roleData?.role !== 'ADMIN') {
      console.error('[invite-user] Not admin:', roleError?.message, roleData);
      return new Response(
        JSON.stringify({ error: 'Only admins can invite users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const body: InviteRequest = await req.json();
    const { email, role, client_id, coroast_member_id, name, generate_link_only = false } = body;

    console.log('[invite-user] Invite requested for:', email, 'role:', role, 'generate_link_only:', generate_link_only);

    // Validate input
    if (!email || !role) {
      return new Response(
        JSON.stringify({ error: 'Email and role are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['ADMIN', 'OPS', 'CLIENT'].includes(role)) {
      return new Response(
        JSON.stringify({ error: 'Invalid role. Must be ADMIN, OPS, or CLIENT' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (role === 'CLIENT' && !client_id) {
      return new Response(
        JSON.stringify({ error: 'CLIENT role requires a client_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate client exists if CLIENT role
    if (role === 'CLIENT' && client_id) {
      const { data: clientData, error: clientError } = await adminClient
        .from('clients')
        .select('id, name')
        .eq('id', client_id)
        .single();

      if (clientError || !clientData) {
        console.error('[invite-user] Client not found:', client_id);
        return new Response(
          JSON.stringify({ error: 'Client not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // The redirect URL - ALWAYS point to JIM app's auth callback
    const redirectTo = `${SITE_URL}/auth/callback`;
    console.log('[invite-user] Using redirect URL:', redirectTo);

    // Check if user already exists in auth
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (existingUser) {
      // User exists in auth - check if they have a role
      const { data: existingRole } = await adminClient
        .from('user_roles')
        .select('*')
        .eq('user_id', existingUser.id)
        .single();

      if (existingRole) {
        // User exists AND has a role - require explicit resend action
        console.log('[invite-user] User already exists with role:', existingUser.id);
        return new Response(
          JSON.stringify({ 
            error: 'USER_EXISTS_WITH_ROLE',
            message: 'User already exists with a role assigned. Use "Resend Invite" to send a new invitation email.',
            user_id: existingUser.id
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // User exists in auth but has no role - fix this broken state
      console.log('[invite-user] User exists in auth but has no role - fixing:', existingUser.id);
      
      // Create the missing role
      const { error: roleInsertError } = await adminClient
        .from('user_roles')
        .insert({
          user_id: existingUser.id,
          role: role,
          client_id: role === 'CLIENT' ? client_id : null
        });

      if (roleInsertError) {
        console.error('[invite-user] Failed to create role for existing user:', roleInsertError.message);
        return new Response(
          JSON.stringify({ error: `Failed to assign role: ${roleInsertError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create profile if missing
      const { data: existingProfile } = await adminClient
        .from('profiles')
        .select('id')
        .eq('user_id', existingUser.id)
        .maybeSingle();

      if (!existingProfile) {
        await adminClient.from('profiles').insert({
          user_id: existingUser.id,
          email: email.toLowerCase(),
          name: name || email.split('@')[0],
          is_active: true
        });
      }

      // Generate or send password recovery
      if (generate_link_only) {
        const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
          type: 'recovery',
          email: email,
          options: { redirectTo }
        });

        if (linkError) {
          console.error('[invite-user] Failed to generate recovery link:', linkError.message);
          return new Response(
            JSON.stringify({ error: `Failed to generate link: ${linkError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('[invite-user] Generated recovery link for existing user');
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Recovery link generated (not emailed)',
            user_id: existingUser.id,
            link: linkData.properties?.action_link,
            email_sent: false
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Send password recovery email
      const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo
      });

      if (resetError) {
        console.error('[invite-user] Failed to send recovery email:', resetError.message);
      }

      console.log('[invite-user] Fixed broken state for user:', existingUser.id);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `User setup completed. Password reset email sent to ${email}.`,
          user_id: existingUser.id,
          email_sent: !resetError
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // NEW USER
    if (generate_link_only) {
      // Generate invite link without sending email (DEV debugging)
      console.log('[invite-user] Generating invite link (not sending email)');
      
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: 'invite',
        email: email,
        options: { 
          data: { name: name || email.split('@')[0] },
          redirectTo 
        }
      });

      if (linkError) {
        console.error('[invite-user] Failed to generate invite link:', linkError.message);
        return new Response(
          JSON.stringify({ error: `Failed to generate link: ${linkError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!linkData.user) {
        return new Response(
          JSON.stringify({ error: 'Failed to create user for link generation' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create user role
      const { error: roleInsertError } = await adminClient
        .from('user_roles')
        .insert({
          user_id: linkData.user.id,
          role: role,
          client_id: role === 'CLIENT' ? client_id : null
        });

      if (roleInsertError) {
        console.error('[invite-user] Role insert error:', roleInsertError.message);
        await adminClient.auth.admin.deleteUser(linkData.user.id);
        return new Response(
          JSON.stringify({ error: `Failed to assign role: ${roleInsertError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create profile
      await adminClient.from('profiles').insert({
        user_id: linkData.user.id,
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        is_active: true
      });

      console.log('[invite-user] Generated invite link for new user:', linkData.user.id);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Invite link generated (not emailed)',
          user_id: linkData.user.id,
          link: linkData.properties?.action_link,
          email_sent: false
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send invitation email normally
    console.log('[invite-user] Sending invitation email to:', email);
    
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { name: name || email.split('@')[0] },
      redirectTo
    });

    if (inviteError) {
      console.error('[invite-user] Supabase invite FAILED:', {
        message: inviteError.message,
        status: inviteError.status,
        code: (inviteError as any).code,
        name: inviteError.name
      });
      
      if (inviteError.message.includes('rate limit')) {
        return new Response(
          JSON.stringify({ 
            error: 'Email rate limit exceeded. Please wait before sending more invites.',
            email_sent: false 
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (inviteError.message.includes('SMTP') || inviteError.message.includes('email')) {
        console.error('[invite-user] Possible email provider issue');
        return new Response(
          JSON.stringify({ 
            error: `Email delivery failed: ${inviteError.message}. Check email provider configuration.`,
            email_sent: false,
            debug: { error_type: 'email_provider' }
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          error: `Failed to send invitation email: ${inviteError.message}`,
          email_sent: false 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!inviteData.user) {
      console.error('[invite-user] Invite API returned success but no user object');
      return new Response(
        JSON.stringify({ 
          error: 'Invitation failed - no user created. Email was NOT sent.',
          email_sent: false
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('[invite-user] Invite API success - user created:', inviteData.user.id);
    
    const emailWasSent = !!inviteData.user.confirmation_sent_at;
    if (!emailWasSent) {
      console.warn('[invite-user] WARNING: confirmation_sent_at is null - email may not have been sent!');
    }

    // Create user role
    const { error: roleInsertError } = await adminClient
      .from('user_roles')
      .insert({
        user_id: inviteData.user.id,
        role: role,
        client_id: role === 'CLIENT' ? client_id : null
      });

    if (roleInsertError) {
      console.error('[invite-user] Role insert error:', roleInsertError.message);
      await adminClient.auth.admin.deleteUser(inviteData.user.id);
      return new Response(
        JSON.stringify({ error: `Failed to assign role: ${roleInsertError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create profile
    const { error: profileError } = await adminClient
      .from('profiles')
      .insert({
        user_id: inviteData.user.id,
        email: email.toLowerCase(),
        name: name || email.split('@')[0],
        is_active: true
      });

    if (profileError) {
      console.error('[invite-user] Profile insert error (non-fatal):', profileError.message);
    }

    // Link coroast member if specified
    if (role === 'CLIENT' && coroast_member_id && client_id) {
      const { error: memberLinkError } = await adminClient
        .from('coroast_members')
        .update({ client_id: client_id })
        .eq('id', coroast_member_id);

      if (memberLinkError) {
        console.error('[invite-user] Co-roast member link error (non-fatal):', memberLinkError.message);
      }
    }

    console.log('[invite-user] SUCCESS - User invited:', inviteData.user.id, 'email_sent:', emailWasSent);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: emailWasSent 
          ? `Invitation email sent to ${email}` 
          : `User created but email delivery uncertain. Check ${email}'s inbox or resend invite.`,
        user_id: inviteData.user.id,
        email_sent: emailWasSent,
        redirect_to: redirectTo,
        debug: {
          confirmation_sent_at: inviteData.user.confirmation_sent_at,
          email_confirmed_at: inviteData.user.email_confirmed_at
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[invite-user] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
