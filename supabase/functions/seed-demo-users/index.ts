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

    const results: { email: string; status: string; error?: string }[] = [];

    for (const user of demoUsers) {
      try {
        // Check if user already exists
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(u => u.email === user.email);

        let userId: string;

        if (existingUser) {
          userId = existingUser.id;
          results.push({ email: user.email, status: 'already_exists' });
        } else {
          // Create auth user
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: user.email,
            password: user.password,
            email_confirm: true,
            user_metadata: { name: user.name }
          });

          if (authError) {
            results.push({ email: user.email, status: 'error', error: authError.message });
            continue;
          }

          userId = authData.user.id;
          results.push({ email: user.email, status: 'created' });
        }

        // Check if profile exists
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();

        if (!existingProfile) {
          // Create profile
          await supabaseAdmin.from('profiles').insert({
            user_id: userId,
            name: user.name,
            email: user.email,
            is_active: true
          });
        }

        // Check if role exists
        const { data: existingRole } = await supabaseAdmin
          .from('user_roles')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();

        if (!existingRole) {
          // Assign role
          await supabaseAdmin.from('user_roles').insert({
            user_id: userId,
            role: user.role,
            client_id: user.clientId || null
          });
        }

      } catch (err) {
        results.push({ email: user.email, status: 'error', error: String(err) });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Demo users seeded',
        results,
        loginInfo: demoUsers.map(u => ({
          email: u.email,
          password: u.password,
          role: u.role,
          client: u.clientId ? `Client ${u.clientId.charAt(0).toUpperCase()}` : 'Internal'
        }))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error seeding demo users:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
