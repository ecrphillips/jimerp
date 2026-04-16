import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SITE_URL = Deno.env.get('SITE_URL') || 'https://jimerp.lovable.app';

interface InviteAccountUserRequest {
  email: string;
  account_id: string;
  is_owner: boolean;
  can_place_orders: boolean;
  can_book_roaster: boolean;
  can_manage_locations: boolean;
  can_invite_users: boolean;
  location_access: string;
  assigned_locations?: string[];
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
        JSON.stringify({ error: 'Only admins and ops can invite account users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: InviteAccountUserRequest = await req.json();
    const {
      email, account_id, is_owner, can_place_orders, can_book_roaster,
      can_manage_locations, can_invite_users, location_access,
      assigned_locations = [],
    } = body;

    if (!email || !account_id) {
      return new Response(
        JSON.stringify({ error: 'Email and account_id are required' }),
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

    const redirectTo = `${SITE_URL}/auth/callback`;

    // Find or create a legacy `clients` row mirroring this account.
    // The user_roles table has a check constraint requiring CLIENT roles to have a client_id.
    const findOrCreateClientId = async (): Promise<string | null> => {
      const { data: existingClient } = await adminClient
        .from('clients')
        .select('id')
        .eq('name', account.account_name)
        .maybeSingle();
      if (existingClient) return existingClient.id;

      // Generate a 3-char client_code from account name
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
        console.error('[invite-account-user] Failed to create mirror client:', clientErr.message);
        return null;
      }
      return newClient.id;
    };

    // Check if user already exists
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;

      // Check if they already have an account_users record for this account
      const { data: existingAu } = await adminClient
        .from('account_users')
        .select('id')
        .eq('user_id', userId)
        .eq('account_id', account_id)
        .maybeSingle();

      if (existingAu) {
        return new Response(
          JSON.stringify({ error: 'This user is already linked to this account' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Ensure they have a CLIENT role (or add one)
      const { data: existingRole } = await adminClient
        .from('user_roles')
        .select('id, role')
        .eq('user_id', userId)
        .maybeSingle();

      if (!existingRole) {
        const mirrorClientId = await findOrCreateClientId();
        await adminClient.from('user_roles').insert({
          user_id: userId,
          role: 'CLIENT',
          client_id: mirrorClientId,
        });
      }

      // Ensure profile exists
      const { data: existingProfile } = await adminClient
        .from('profiles')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!existingProfile) {
        await adminClient.from('profiles').insert({
          user_id: userId,
          email: email.toLowerCase(),
          name: email.split('@')[0],
          is_active: true,
        });
      }
    } else {
      // New user — send invite
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { name: email.split('@')[0] },
        redirectTo,
      });

      if (inviteError || !inviteData.user) {
        console.error('[invite-account-user] Invite failed:', inviteError?.message);
        return new Response(
          JSON.stringify({ error: `Failed to invite user: ${inviteError?.message || 'Unknown error'}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      userId = inviteData.user.id;

      // Create user_roles record (with mirror client_id to satisfy check constraint)
      const mirrorClientId = await findOrCreateClientId();
      const { error: roleInsertError } = await adminClient.from('user_roles').insert({
        user_id: userId,
        role: 'CLIENT',
        client_id: mirrorClientId,
      });

      if (roleInsertError) {
        console.error('[invite-account-user] Role insert error:', roleInsertError.message);
        await adminClient.auth.admin.deleteUser(userId);
        return new Response(
          JSON.stringify({ error: `Failed to assign role: ${roleInsertError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create profile
      await adminClient.from('profiles').insert({
        user_id: userId,
        email: email.toLowerCase(),
        name: email.split('@')[0],
        is_active: true,
      });
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
        can_manage_locations,
        can_invite_users,
        location_access,
      })
      .select('id')
      .single();

    if (auError) {
      console.error('[invite-account-user] account_users insert error:', auError.message);
      return new Response(
        JSON.stringify({ error: `Failed to create account user: ${auError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create location assignments if needed
    if (location_access === 'ASSIGNED' && assigned_locations.length > 0 && accountUser) {
      const { error: locError } = await adminClient
        .from('account_user_locations')
        .insert(assigned_locations.map((lid) => ({
          account_user_id: accountUser.id,
          location_id: lid,
        })));

      if (locError) {
        console.error('[invite-account-user] Location assignment error:', locError.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        account_user_id: accountUser?.id,
        message: existingUser
          ? `User linked to ${account.account_name}`
          : `Invitation sent to ${email}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[invite-account-user] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
