import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DemoUser {
  email: string;
  password: string;
  name: string;
  role: 'ADMIN' | 'OPS' | 'CLIENT';
  clientId?: string;
}

interface StepResult {
  step: string;
  status: 'success' | 'skipped' | 'error';
  detail?: string;
}

interface UserResult {
  email: string;
  status: 'created' | 'updated' | 'error';
  userId?: string;
  steps: StepResult[];
  error?: string;
}

const demoUsers: DemoUser[] = [
  // Internal users
  { email: 'admin@demo.liteerp.com', password: 'demo1234', name: 'Admin User', role: 'ADMIN' },
  { email: 'ops@demo.liteerp.com', password: 'demo1234', name: 'Ops User', role: 'OPS' },
  // Test client user - tied to real "Mah" client
  { email: 'mah@test.liteerp.com', password: 'testmah123', name: 'Test User (Mah)', role: 'CLIENT', clientId: 'aaaaaaaa-0001-0001-0001-000000000001' },
];

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create admin client for auth operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ========== AUTHENTICATION ==========
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[seed-demo-users] Missing authorization header');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      console.error('[seed-demo-users] Invalid token:', authError?.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== AUTHORIZATION: ADMIN ONLY ==========
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (roleError || !roleData) {
      console.error('[seed-demo-users] No role found for user:', user.id);
      return new Response(
        JSON.stringify({ success: false, error: 'No role assigned' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (roleData.role !== 'ADMIN') {
      console.error('[seed-demo-users] Non-ADMIN user attempted access:', user.id, roleData.role);
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden - ADMIN role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[seed-demo-users] Authorized ADMIN user:', user.id);

    // ========== SEED DEMO USERS ==========
    const results: UserResult[] = [];

    for (const demoUser of demoUsers) {
      const userResult: UserResult = {
        email: demoUser.email,
        status: 'error',
        steps: []
      };

      try {
        // Step 1: Validate CLIENT role constraints
        if (demoUser.role === 'CLIENT') {
          if (!demoUser.clientId) {
            userResult.error = 'CLIENT role requires clientId in seed config';
            userResult.steps.push({ step: 'validate_client', status: 'error', detail: 'Missing clientId in config' });
            results.push(userResult);
            continue;
          }

          // Verify client exists
          const { data: clientData, error: clientError } = await supabaseAdmin
            .from('clients')
            .select('id, name')
            .eq('id', demoUser.clientId)
            .maybeSingle();

          if (clientError) {
            userResult.error = `Client lookup failed: ${clientError.message}`;
            userResult.steps.push({ step: 'validate_client', status: 'error', detail: clientError.message });
            results.push(userResult);
            continue;
          }

          if (!clientData) {
            userResult.error = `client_id not found — update seed config to a valid clients.id (${demoUser.clientId})`;
            userResult.steps.push({ step: 'validate_client', status: 'error', detail: `Client ${demoUser.clientId} does not exist` });
            results.push(userResult);
            continue;
          }

          userResult.steps.push({ step: 'validate_client', status: 'success', detail: `Found client: ${clientData.name}` });
        } else {
          userResult.steps.push({ step: 'validate_client', status: 'skipped', detail: 'Not a CLIENT role' });
        }

        // Step 2: Check if user exists
        let userId: string;
        let isNewUser = false;

        const { data: existingUserData } = await supabaseAdmin.auth.admin
          .listUsers({ page: 1, perPage: 1000 });
        
        const existingUser = existingUserData?.users?.find(u => u.email?.toLowerCase() === demoUser.email.toLowerCase());

        if (existingUser) {
          userId = existingUser.id;
          isNewUser = false;
          userResult.steps.push({ step: 'check_user', status: 'success', detail: `User exists: ${userId}` });

          // Update user metadata (but NOT password for existing users)
          const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            user_metadata: { name: demoUser.name }
          });

          if (updateError) {
            userResult.steps.push({ step: 'update_metadata', status: 'error', detail: updateError.message });
          } else {
            userResult.steps.push({ step: 'update_metadata', status: 'success', detail: 'Updated user_metadata.name' });
          }
        } else {
          // Create new user
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: demoUser.email,
            password: demoUser.password,
            email_confirm: true,
            user_metadata: { name: demoUser.name }
          });

          if (authError) {
            userResult.error = `Auth user creation failed: ${authError.message}`;
            userResult.steps.push({ step: 'create_user', status: 'error', detail: authError.message });
            results.push(userResult);
            continue;
          }

          userId = authData.user.id;
          isNewUser = true;
          userResult.steps.push({ step: 'create_user', status: 'success', detail: `Created auth user: ${userId}` });
        }

        userResult.userId = userId;

        // Step 3: Upsert profile
        const profileData = {
          user_id: userId,
          name: demoUser.name,
          email: demoUser.email.toLowerCase(),
          is_active: true,
          updated_at: new Date().toISOString()
        };

        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .upsert(profileData, { onConflict: 'user_id' });

        if (profileError) {
          const errorDetail = profileError.message + (profileError.details ? ` | ${profileError.details}` : '') + (profileError.hint ? ` | Hint: ${profileError.hint}` : '');
          userResult.steps.push({ step: 'upsert_profile', status: 'error', detail: errorDetail });
        } else {
          userResult.steps.push({ step: 'upsert_profile', status: 'success', detail: 'Profile upserted' });
        }

        // Step 4: Upsert user_roles
        const roleDataToInsert = {
          user_id: userId,
          role: demoUser.role,
          client_id: demoUser.role === 'CLIENT' ? demoUser.clientId : null
        };

        const { data: existingRole, error: roleCheckError } = await supabaseAdmin
          .from('user_roles')
          .select('id, role, client_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (roleCheckError) {
          userResult.steps.push({ step: 'check_role', status: 'error', detail: roleCheckError.message });
        }

        if (existingRole) {
          const needsUpdate = existingRole.role !== demoUser.role || existingRole.client_id !== (demoUser.clientId || null);
          
          if (needsUpdate) {
            const { error: roleUpdateError } = await supabaseAdmin
              .from('user_roles')
              .update({ role: demoUser.role, client_id: demoUser.role === 'CLIENT' ? demoUser.clientId : null })
              .eq('user_id', userId);

            if (roleUpdateError) {
              const errorDetail = roleUpdateError.message + (roleUpdateError.details ? ` | ${roleUpdateError.details}` : '');
              userResult.steps.push({ step: 'update_role', status: 'error', detail: errorDetail });
            } else {
              userResult.steps.push({ step: 'update_role', status: 'success', detail: `Updated role from ${existingRole.role} to ${demoUser.role}` });
            }
          } else {
            userResult.steps.push({ step: 'update_role', status: 'skipped', detail: 'Role already correct' });
          }
        } else {
          const { error: roleInsertError } = await supabaseAdmin
            .from('user_roles')
            .insert(roleDataToInsert);

          if (roleInsertError) {
            const errorDetail = roleInsertError.message + (roleInsertError.details ? ` | ${roleInsertError.details}` : '') + (roleInsertError.hint ? ` | Hint: ${roleInsertError.hint}` : '');
            userResult.steps.push({ step: 'insert_role', status: 'error', detail: errorDetail });
          } else {
            userResult.steps.push({ step: 'insert_role', status: 'success', detail: `Inserted role: ${demoUser.role}` });
          }
        }

        // Determine overall status
        const hasErrors = userResult.steps.some(s => s.status === 'error');
        if (hasErrors) {
          userResult.status = 'error';
          userResult.error = 'One or more steps failed - see steps for details';
        } else {
          userResult.status = isNewUser ? 'created' : 'updated';
        }

      } catch (err) {
        userResult.error = String(err);
        userResult.steps.push({ step: 'unexpected', status: 'error', detail: String(err) });
      }

      results.push(userResult);
    }

    // Summary
    const summary = {
      total: results.length,
      created: results.filter(r => r.status === 'created').length,
      updated: results.filter(r => r.status === 'updated').length,
      errors: results.filter(r => r.status === 'error').length
    };

    return new Response(
      JSON.stringify({ 
        success: summary.errors === 0, 
        summary,
        results,
        loginInfo: demoUsers.map(u => ({
          email: u.email,
          password: u.password,
          role: u.role,
          clientId: u.clientId || null
        }))
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error seeding demo users:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: String(error),
        hint: 'Check edge function logs for stack trace'
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
