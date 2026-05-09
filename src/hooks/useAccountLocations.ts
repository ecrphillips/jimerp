import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AccountLocation {
  id: string;
  account_id: string;
  location_name: string;
  location_code: string;
  address: string | null;
  qbo_billing_entity: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useAccountLocations(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['account-locations', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountLocation[]> => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from('account_locations')
        .select('*')
        .eq('account_id', accountId)
        .order('location_code', { ascending: true });
      if (error) throw error;
      return (data ?? []) as AccountLocation[];
    },
  });
}
