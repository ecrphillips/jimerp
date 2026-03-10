import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateRequest {
  user_id: string;
  role?: 'ADMIN' | 'OPS' | 'CLIENT';
  client_id?: string | null;
  coroast_member_id?: string | null;
  is_active?: boolean;
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

    if (roleData?.role !== 'ADMIN') {
      return new Response(
        JSON.stringify({ error: 'Only admins can update users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: UpdateRequest = await req.json();
    const { user_id, role, client_id, coroast_member_id, is_active, name } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate role change
    if (role && role === 'CLIENT' && !client_id) {
      return new Response(
        JSON.stringify({ error: 'CLIENT role requires a client_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update role if provided
    if (role !== undefined) {
      const updateData: any = { role };
      if (role === 'CLIENT') {
        updateData.client_id = client_id;
      } else {
        updateData.client_id = null;
      }

      const { error: roleUpdateError } = await adminClient
        .from('user_roles')
        .update(updateData)
        .eq('user_id', user_id);

      if (roleUpdateError) {
        console.error('Role update error:', roleUpdateError);
        return new Response(
          JSON.stringify({ error: `Failed to update role: ${roleUpdateError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Link/unlink coroast member if provided
    if (role === 'CLIENT' && coroast_member_id !== undefined) {
      // First, clear any existing link from other members pointing to this client
      if (client_id) {
        await adminClient
          .from('coroast_members')
          .update({ client_id: null })
          .eq('client_id', client_id);
      }

      // Set the new link
      if (coroast_member_id) {
        const { error: memberError } = await adminClient
          .from('coroast_members')
          .update({ client_id: client_id })
          .eq('id', coroast_member_id);

        if (memberError) {
          console.error('Co-roast member link error:', memberError);
          // Non-fatal, continue
        }
      }
    } else if (role && role !== 'CLIENT') {
      // If changing away from CLIENT, clear any coroast member links for the old client_id
      const { data: oldRole } = await adminClient
        .from('user_roles')
        .select('client_id')
        .eq('user_id', user_id)
        .single();

      if (oldRole?.client_id) {
        await adminClient
          .from('coroast_members')
          .update({ client_id: null })
          .eq('client_id', oldRole.client_id);
      }
    }

    // Update profile if is_active or name provided
    if (is_active !== undefined || name !== undefined) {
      const profileUpdate: any = { updated_at: new Date().toISOString() };
      if (is_active !== undefined) profileUpdate.is_active = is_active;
      if (name !== undefined) profileUpdate.name = name;

      const { error: profileError } = await adminClient
        .from('profiles')
        .update(profileUpdate)
        .eq('user_id', user_id);

      if (profileError) {
        console.error('Profile update error:', profileError);
        // Non-fatal, continue
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'User updated successfully' }),
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
