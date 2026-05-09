// Edge function: owner-invite-user
//
// Allows an account owner (or member with can_invite_users=true) to invite
// a new user into their own account. Mirrors the behavior of invite-account-user
// but with caller-side authorization based on account_users membership rather
// than ADMIN/OPS role. Never grants is_owner via this path — owner promotion
// is done separately via the owner_update_user_permissions RPC after the user
// exists.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SITE_URL = Deno.env.get('SITE_URL') || 'https://homeislandcoffeepartners.lovable.app';

interface OwnerInviteRequest {
  email: string;
  account_id: string;
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

    // ---- Authentication ----
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

    // ---- Parse and validate body ----
    const body: OwnerInviteRequest = await req.json();
    const {
      email,
      account_id,
      can_place_orders,
      can_book_roaster,
      can_manage_locations,
      can_invite_users,
      location_access,
      assigned_locations = [],
    } = body;

    if (!email || !account_id) {
      return new Response(
        JSON.stringify({ error: 'Email and account_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ---- Authorization: caller must be active owner OR have can_invite_users on this account ----
    const { data: callerMembership, error: membershipError } = await adminClient
      .from('account_users')
      .select('is_owner, can_invite_users, is_active')
      .eq('user_id', callingUser.id)
      .eq('account_id', account_id)
      .eq('is_active', true)
      .maybeSingle();

    if (membershipError) {
      console.error('[owner-invite-user] membership lookup failed:', membershipError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to verify caller membership' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!callerMembership || !(callerMembership.is_owner || callerMembership.can_invite_users)) {
      return new Response(
        JSON.stringify({ error: 'Not authorized to invite users to this account' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ---- Verify account + fetch programs for permission filtering ----
    const { data: account, error: accountError } = await adminClient
      .from('accounts')
      .select('id, account_name, programs')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const programs: string[] = (account.programs as string[] | null) ?? [];
    const effectiveCanPlaceOrders = programs.includes('MANUFACTURING') ? !!can_place_orders : false;
    const effectiveCanBookRoaster = programs.includes('COROASTING') ? !!can_book_roaster : false;

    if (location_access !== 'ALL' && location_access !== 'ASSIGNED') {
      return new Response(
        JSON.stringify({ error: 'location_access must be ALL or ASSIGNED' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate assigned location IDs all belong to this account
    if (location_access === 'ASSIGNED' && assigned_locations.length > 0) {
      const { data: validLocs, error: locValError } = await adminClient
        .from('account_locations')
        .select('id')
        .eq('account_id', account_id)
        .in('id', assigned_locations);

      if (locValError) {
        return new Response(
          JSON.stringify({ error: `Failed to validate locations: ${locValError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if ((validLocs?.length ?? 0) !== assigned_locations.length) {
        return new Response(
          JSON.stringify({ error: 'One or more locations do not belong to this account' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const redirectTo = `${SITE_URL}/auth/callback`;
    const normalizedEmail = email.toLowerCase().trim();

    // ---- Find or create a legacy `clients` row mirroring this account ----
    // user_roles requires CLIENT roles to have a client_id.
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
        console.error('[owner-invite-user] mirror client create failed:', clientErr.message);
        return null;
      }
      return newClient.id;
    };

    // ---- Find or create the user ----
    const { data: existingProfile } = await adminClient
      .from('profiles')
      .select('user_id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    let userId: string;
    let isNewUser = false;

    if (existingProfile) {
      userId = existingProfile.user_id;

      // Already linked to this account?
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

      // Ensure CLIENT role exists
      const { data: existingRole } = await adminClient
        .from('user_roles')
        .select('id, role')
        .eq('user_id', userId)
        .maybeSingle();

      if (!existingRole) {
        const mirrorClientId = await findOrCreateClientId();
        const { error: roleErr } = await adminClient.from('user_roles').insert({
          user_id: userId,
          role: 'CLIENT',
          client_id: mirrorClientId,
        });
        if (roleErr) {
          return new Response(
            JSON.stringify({ error: `Failed to assign role: ${roleErr.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else if (existingRole.role !== 'CLIENT') {
        // Don't add ADMIN/OPS users into client accounts via this path
        return new Response(
          JSON.stringify({ error: 'Cannot link an internal (ADMIN/OPS) user to a client account from the portal' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // New user — invite via Supabase Auth
      isNewUser = true;
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: { name: normalizedEmail.split('@')[0] },
        redirectTo,
      });

      if (inviteError || !inviteData.user) {
        console.error('[owner-invite-user] invite failed:', inviteError?.message);
        return new Response(
          JSON.stringify({ error: `Failed to invite user: ${inviteError?.message || 'Unknown error'}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      userId = inviteData.user.id;

      const mirrorClientId = await findOrCreateClientId();
      const { error: roleInsertError } = await adminClient.from('user_roles').insert({
        user_id: userId,
        role: 'CLIENT',
        client_id: mirrorClientId,
      });

      if (roleInsertError) {
        console.error('[owner-invite-user] role insert failed:', roleInsertError.message);
        await adminClient.auth.admin.deleteUser(userId);
        return new Response(
          JSON.stringify({ error: `Failed to assign role: ${roleInsertError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await adminClient.from('profiles').insert({
        user_id: userId,
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0],
        is_active: true,
      });
    }

    // ---- Create account_users record (is_owner ALWAYS false here) ----
    const { data: accountUser, error: auError } = await adminClient
      .from('account_users')
      .insert({
        user_id: userId,
        account_id,
        is_owner: false,
        can_place_orders: effectiveCanPlaceOrders,
        can_book_roaster: effectiveCanBookRoaster,
        can_manage_locations: !!can_manage_locations,
        can_invite_users: !!can_invite_users,
        location_access,
      })
      .select('id')
      .single();

    if (auError) {
      console.error('[owner-invite-user] account_users insert failed:', auError.message);
      return new Response(
        JSON.stringify({ error: `Failed to add user to account: ${auError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (location_access === 'ASSIGNED' && assigned_locations.length > 0 && accountUser) {
      const { error: locError } = await adminClient
        .from('account_user_locations')
        .insert(assigned_locations.map((lid) => ({
          account_user_id: accountUser.id,
          location_id: lid,
        })));

      if (locError) {
        console.error('[owner-invite-user] location assignment failed:', locError.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        account_user_id: accountUser?.id,
        message: isNewUser
          ? `Invitation sent to ${normalizedEmail}`
          : `User added to ${account.account_name}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[owner-invite-user] unexpected error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
