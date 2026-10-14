import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ProductNote {
  id: string;
  account_id: string;
  roast_group: string;
  note_text: string;
  created_by: string | null;
  author_name: string | null;
  author_is_staff: boolean;
  created_at: string;
}

/** All of an account's product notes, newest first. Shared cache for both portals. */
export function useAccountProductNotes(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['client-product-notes', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_product_notes')
        .select('id, account_id, roast_group, note_text, created_by, author_name, author_is_staff, created_at')
        .eq('account_id', accountId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProductNote[];
    },
  });
}
