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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Create admin client for user management
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Create regular client for auth verification
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the calling user is an admin
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callingUser }, error: authError } = await adminClient.auth.getUser(token);
    
    if (authError || !callingUser) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if calling user is ADMIN
    const { data: roleData, error: roleError } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', callingUser.id)
      .single();

    if (roleError || roleData?.role !== 'ADMIN') {
      console.error('Role check failed:', roleError, roleData);
      return new Response(
        JSON.stringify({ error: 'Only admins can invite users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: InviteRequest = await req.json();
    const { email, role, client_id, name } = body;

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

    // Check if client exists (if CLIENT role)
    if (role === 'CLIENT' && client_id) {
      const { data: clientData, error: clientError } = await adminClient
        .from('clients')
        .select('id, name')
        .eq('id', client_id)
        .single();

      if (clientError || !clientData) {
        return new Response(
          JSON.stringify({ error: 'Client not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Check if email already exists in auth
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (existingUser) {
      // User exists - check if they have a role already
      const { data: existingRole } = await adminClient
        .from('user_roles')
        .select('*')
        .eq('user_id', existingUser.id)
        .single();

      if (existingRole) {
        return new Response(
          JSON.stringify({ error: 'User already exists with a role assigned' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // User exists but has no role - assign role
      const { error: roleInsertError } = await adminClient
        .from('user_roles')
        .insert({
          user_id: existingUser.id,
          role: role,
          client_id: role === 'CLIENT' ? client_id : null
        });

      if (roleInsertError) {
        console.error('Role insert error:', roleInsertError);
        return new Response(
          JSON.stringify({ error: `Failed to assign role: ${roleInsertError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create/update profile
      const { error: profileError } = await adminClient
        .from('profiles')
        .upsert({
          user_id: existingUser.id,
          email: email.toLowerCase(),
          name: name || email.split('@')[0],
          is_active: true
        }, { onConflict: 'user_id' });

      if (profileError) {
        console.error('Profile upsert error:', profileError);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Role assigned to existing user',
          user_id: existingUser.id 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Invite new user via Supabase Auth
    console.log('Inviting new user:', email, 'with role:', role);
    
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { name: name || email.split('@')[0] }
    });

    if (inviteError) {
      console.error('Invite error:', inviteError);
      return new Response(
        JSON.stringify({ error: `Failed to invite user: ${inviteError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!inviteData.user) {
      return new Response(
        JSON.stringify({ error: 'Invite succeeded but no user returned' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      console.error('Role insert error:', roleInsertError);
      // Try to clean up the invited user
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
      console.error('Profile insert error (non-fatal):', profileError);
    }

    console.log('User invited successfully:', inviteData.user.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'User invited successfully',
        user_id: inviteData.user.id 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
