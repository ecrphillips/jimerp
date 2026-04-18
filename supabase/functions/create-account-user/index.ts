import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateAccountUserRequest {
  email: string;
  password: string;
  full_name: string;
  account_id: string;
  is_owner: boolean;
  can_place_orders: boolean;
  can_book_roaster: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller is ADMIN or OPS
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callingUser }, error: authError } = await adminClient.auth.getUser(token);

    if (authError || !callingUser) {
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

    if (!roleData || !['ADMIN', 'OPS'].includes(roleData.role)) {
      return new Response(
        JSON.stringify({ error: 'Only admins and ops can create account users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: CreateAccountUserRequest = await req.json();
    const {
      email, password, full_name, account_id,
      is_owner, can_place_orders, can_book_roaster,
    } = body;

    if (!email || !password || !full_name || !account_id) {
      return new Response(
        JSON.stringify({ error: 'Email, password, full name, and account are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify account exists
    const { data: account, error: accountError } = await adminClient
      .from('accounts')
      .select('id, account_name')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Reject if email already exists
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (existingUser) {
      return new Response(
        JSON.stringify({ error: 'A user with this email already exists' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find or create a legacy `clients` row mirroring this account (CLIENT role requires client_id)
    const findOrCreateClientId = async (): Promise<string | null> => {
      const { data: existingClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('name', account.account_name)
        .maybeSingle();
      if (existingClient) return existingClient.id;

      const baseCode = account.account_name
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .slice(0, 3)
        .padEnd(3, 'X') || 'CLT';
      let code = baseCode;
      for (let i = 0; i < 100; i++) {
        const { data: existing } = await adminClient
          .from('clients')
          .select('id')
          .eq('client_code', code)
          .maybeSingle();
        if (!existing) break;
        code = baseCode.slice(0, 2) + i.toString(36).toUpperCase().slice(-1);
      }

      const { data: newClient, error: clientErr } = await adminClient
        .from('clients')
        .insert({ name: account.account_name, client_code: code, is_active: true })
        .select('id')
        .single();
      if (clientErr) {
        console.error('[create-account-user] Failed to create mirror client:', clientErr.message);
        return null;
      }
      return newClient.id;
    };

    // Create the auth user with the temporary password (auto-confirm so they can log in immediately)
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: full_name },
    });

    if (createError || !createData.user) {
      console.error('[create-account-user] createUser failed:', createError?.message);
      return new Response(
        JSON.stringify({ error: `Failed to create user: ${createError?.message || 'Unknown error'}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = createData.user.id;

    // Create user_roles record
    const mirrorClientId = await findOrCreateClientId();
    const { error: roleInsertError } = await adminClient.from('user_roles').insert({
      user_id: userId,
      role: 'CLIENT',
      client_id: mirrorClientId,
    });

    if (roleInsertError) {
      console.error('[create-account-user] Role insert error:', roleInsertError.message);
      await adminClient.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ error: `Failed to assign role: ${roleInsertError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create profile
    const { error: profileError } = await adminClient.from('profiles').insert({
      user_id: userId,
      email: email.toLowerCase(),
      name: full_name,
      is_active: true,
    });

    if (profileError) {
      console.error('[create-account-user] Profile insert error:', profileError.message);
    }

    // Create account_users record
    const { data: accountUser, error: auError } = await adminClient
      .from('account_users')
      .insert({
        user_id: userId,
        account_id,
        is_owner,
        can_place_orders,
        can_book_roaster,
        can_manage_locations: false,
        can_invite_users: false,
        location_access: 'ALL',
      })
      .select('id')
      .single();

    if (auError) {
      console.error('[create-account-user] account_users insert error:', auError.message);
      return new Response(
        JSON.stringify({ error: `Failed to link user to account: ${auError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        account_user_id: accountUser?.id,
        name: full_name,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[create-account-user] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
