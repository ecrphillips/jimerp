import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AccountTeamMember {
  id: string;
  user_id: string;
  account_id: string;
  is_owner: boolean;
  is_active: boolean;
  can_place_orders: boolean;
  can_book_roaster: boolean;
  can_manage_locations: boolean;
  can_invite_users: boolean;
  location_access: string;
  created_at: string;
  updated_at: string;
  profile: {
    name: string | null;
    email: string | null;
    is_active: boolean | null;
  } | null;
  assigned_location_ids: string[];
}

export function useAccountTeam(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['account-team', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountTeamMember[]> => {
      if (!accountId) return [];

      const { data: rows, error } = await supabase
        .from('account_users')
        .select('id, user_id, account_id, is_owner, is_active, can_place_orders, can_book_roaster, can_manage_locations, can_invite_users, location_access, created_at, updated_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (!rows || rows.length === 0) return [];

      const userIds = rows.map((r) => r.user_id);

      // Fetch profiles separately (no FK relationship in generated types)
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('user_id, name, email, is_active')
        .in('user_id', userIds);

      if (profErr) throw profErr;

      const profileMap = new Map(
        (profiles ?? []).map((p) => [p.user_id, p])
      );

      const accountUserIds = rows.map((r) => r.id);
      const { data: locRows, error: locErr } = await supabase
        .from('account_user_locations')
        .select('account_user_id, location_id')
        .in('account_user_id', accountUserIds);

      if (locErr) throw locErr;

      const locMap = new Map<string, string[]>();
      (locRows ?? []).forEach((row) => {
        const arr = locMap.get(row.account_user_id) ?? [];
        arr.push(row.location_id);
        locMap.set(row.account_user_id, arr);
      });

      return rows.map((r) => ({
        ...r,
        profile: profileMap.get(r.user_id)
          ? {
              name: profileMap.get(r.user_id)!.name,
              email: profileMap.get(r.user_id)!.email,
              is_active: profileMap.get(r.user_id)!.is_active,
            }
          : null,
        assigned_location_ids: locMap.get(r.id) ?? [],
      }));
    },
  });
}
