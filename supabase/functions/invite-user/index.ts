import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InviteRequest {
  email: string;
  role: 'ADMIN' | 'OPS' | 'CLIENT';
  client_id?: string;
  name?: string;
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
    const { email, role, client_id, name } = body;

    console.log('[invite-user] Invite requested for:', email, 'role:', role);

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
        // User exists AND has a role - do NOT silently assign
        // Return specific error requiring explicit resend action
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

      // User exists in auth but has no role - this is a broken state
      // Still require explicit action rather than silent fix
      console.log('[invite-user] User exists in auth but has no role - broken state:', existingUser.id);
      return new Response(
        JSON.stringify({ 
          error: 'USER_EXISTS_NO_ROLE',
          message: 'User exists in auth but has no role. Use "Resend Invite" to complete their setup.',
          user_id: existingUser.id
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // NEW USER - send invitation email
    console.log('[invite-user] Sending invitation email to:', email);
    
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { name: name || email.split('@')[0] }
    });

    if (inviteError) {
      console.error('[invite-user] Supabase invite error:', inviteError.message);
      
      // Check for common email delivery issues
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

    if (!inviteData.user) {
      console.error('[invite-user] Invite succeeded but no user returned');
      return new Response(
        JSON.stringify({ error: 'Invitation failed - no user created. Check email provider configuration.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[invite-user] Invitation email sent, user created:', inviteData.user.id);

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
      // Clean up the invited user since we couldn't complete setup
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

    console.log('[invite-user] SUCCESS - User invited:', inviteData.user.id, 'Email sent to:', email);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Invitation email sent to ${email}`,
        user_id: inviteData.user.id,
        email_sent: true
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
