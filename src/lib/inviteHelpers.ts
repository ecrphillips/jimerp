import { supabase } from '@/integrations/supabase/client';

/**
 * Find a `clients` row by name, or create one with a 3-char unique client_code.
 * The deployed `invite-user` edge function requires `role: 'CLIENT'` + a valid
 * `client_id` (FK to `clients`) because `user_roles` enforces it via check
 * constraint. Accounts that don't have a mirror clients row need one created
 * before inviting a member-portal user.
 *
 * Throws on insert failure. Returns the clients.id on success.
 */
export async function findOrCreateMirrorClient(accountName: string): Promise<string> {
  const name = accountName.trim();
  if (!name) throw new Error('account name required to mirror client row');

  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  if (existing) return existing.id;

  const baseCode = (name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3) || 'CLT').padEnd(3, 'X');
  let code = baseCode;
  for (let i = 0; i < 20; i++) {
    const { data: clash } = await supabase
      .from('clients')
      .select('id')
      .eq('client_code', code)
      .maybeSingle();
    if (!clash) break;
    code = baseCode.slice(0, 2) + i.toString(36).toUpperCase().slice(-1);
  }

  const { data: created, error } = await supabase
    .from('clients')
    .insert({ name, client_code: code, is_active: true })
    .select('id')
    .single();
  if (error || !created) throw new Error(`mirror client insert: ${error?.message ?? 'unknown'}`);
  return created.id;
}
