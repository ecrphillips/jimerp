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
    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const results: UserResult[] = [];

    for (const user of demoUsers) {
      const userResult: UserResult = {
        email: user.email,
        status: 'error',
        steps: []
      };

      try {
        // Step 1: Validate CLIENT role constraints
        if (user.role === 'CLIENT') {
          if (!user.clientId) {
            userResult.error = 'CLIENT role requires clientId in seed config';
            userResult.steps.push({ step: 'validate_client', status: 'error', detail: 'Missing clientId in config' });
            results.push(userResult);
            continue;
          }

          // Verify client exists
          const { data: clientData, error: clientError } = await supabaseAdmin
            .from('clients')
            .select('id, name')
            .eq('id', user.clientId)
            .maybeSingle();

          if (clientError) {
            userResult.error = `Client lookup failed: ${clientError.message}`;
            userResult.steps.push({ step: 'validate_client', status: 'error', detail: clientError.message });
            results.push(userResult);
            continue;
          }

          if (!clientData) {
            userResult.error = `client_id not found — update seed config to a valid clients.id (${user.clientId})`;
            userResult.steps.push({ step: 'validate_client', status: 'error', detail: `Client ${user.clientId} does not exist` });
            results.push(userResult);
            continue;
          }

          userResult.steps.push({ step: 'validate_client', status: 'success', detail: `Found client: ${clientData.name}` });
        } else {
          userResult.steps.push({ step: 'validate_client', status: 'skipped', detail: 'Not a CLIENT role' });
        }

        // Step 2: Check if user exists using getUserByEmail (not listUsers)
        let userId: string;
        let isNewUser = false;

        // Try to get user by email - this is the efficient approach
        const { data: existingUserData, error: getUserError } = await supabaseAdmin.auth.admin
          .listUsers({ page: 1, perPage: 1000 });
        
        // Find user by email in the list (since getUserByEmail doesn't exist in this API version)
        const existingUser = existingUserData?.users?.find(u => u.email?.toLowerCase() === user.email.toLowerCase());

        if (existingUser) {
          userId = existingUser.id;
          isNewUser = false;
          userResult.steps.push({ step: 'check_user', status: 'success', detail: `User exists: ${userId}` });

          // Update user metadata (but NOT password for existing users)
          const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            user_metadata: { name: user.name }
          });

          if (updateError) {
            userResult.steps.push({ step: 'update_metadata', status: 'error', detail: updateError.message });
          } else {
            userResult.steps.push({ step: 'update_metadata', status: 'success', detail: 'Updated user_metadata.name' });
          }
        } else {
          // Create new user
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: user.email,
            password: user.password,
            email_confirm: true,
            user_metadata: { name: user.name }
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

        // Step 3: Upsert profile (using 'profiles' table based on codebase)
        const profileData = {
          user_id: userId,
          name: user.name,
          email: user.email.toLowerCase(),
          is_active: true,
          updated_at: new Date().toISOString()
        };

        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .upsert(profileData, { onConflict: 'user_id' });

        if (profileError) {
          // Check if it's a column/table mismatch
          const errorDetail = profileError.message + (profileError.details ? ` | ${profileError.details}` : '') + (profileError.hint ? ` | Hint: ${profileError.hint}` : '');
          userResult.steps.push({ step: 'upsert_profile', status: 'error', detail: errorDetail });
          // Continue anyway to try role assignment
        } else {
          userResult.steps.push({ step: 'upsert_profile', status: 'success', detail: 'Profile upserted' });
        }

        // Step 4: Upsert user_roles
        const roleData = {
          user_id: userId,
          role: user.role,
          client_id: user.role === 'CLIENT' ? user.clientId : null
        };

        // First check if role exists
        const { data: existingRole, error: roleCheckError } = await supabaseAdmin
          .from('user_roles')
          .select('id, role, client_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (roleCheckError) {
          userResult.steps.push({ step: 'check_role', status: 'error', detail: roleCheckError.message });
        }

        if (existingRole) {
          // Update if different
          const needsUpdate = existingRole.role !== user.role || existingRole.client_id !== (user.clientId || null);
          
          if (needsUpdate) {
            const { error: roleUpdateError } = await supabaseAdmin
              .from('user_roles')
              .update({ role: user.role, client_id: user.role === 'CLIENT' ? user.clientId : null })
              .eq('user_id', userId);

            if (roleUpdateError) {
              const errorDetail = roleUpdateError.message + (roleUpdateError.details ? ` | ${roleUpdateError.details}` : '');
              userResult.steps.push({ step: 'update_role', status: 'error', detail: errorDetail });
            } else {
              userResult.steps.push({ step: 'update_role', status: 'success', detail: `Updated role from ${existingRole.role} to ${user.role}` });
            }
          } else {
            userResult.steps.push({ step: 'update_role', status: 'skipped', detail: 'Role already correct' });
          }
        } else {
          // Insert new role
          const { error: roleInsertError } = await supabaseAdmin
            .from('user_roles')
            .insert(roleData);

          if (roleInsertError) {
            const errorDetail = roleInsertError.message + (roleInsertError.details ? ` | ${roleInsertError.details}` : '') + (roleInsertError.hint ? ` | Hint: ${roleInsertError.hint}` : '');
            userResult.steps.push({ step: 'insert_role', status: 'error', detail: errorDetail });
          } else {
            userResult.steps.push({ step: 'insert_role', status: 'success', detail: `Inserted role: ${user.role}` });
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
