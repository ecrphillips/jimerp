import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProductAccessSetting } from '@/lib/customerProductAccess';

export function useAccountProductAccess(accountId: string | null | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['account-product-access', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase.from('account_product_access').select('product_id, visible, orderable, case_only').eq('account_id', accountId);
      if (error) throw error;
      return data;
    },
  });
  const save = useMutation({
    mutationFn: async (setting: ProductAccessSetting) => {
      if (!accountId) throw new Error('No account selected');
      const { data, error } = await supabase.from('account_product_access').upsert({ ...setting, account_id: accountId, orderable: setting.visible && setting.orderable }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-product-access', accountId] }),
        queryClient.invalidateQueries({ queryKey: ['client-orderable-products', accountId] }),
        queryClient.invalidateQueries({ queryKey: ['client-products', accountId] }),
      ]);
      toast.success('Customer product settings saved');
    },
    onError: (error) => toast.error(error.message),
  });
  return { ...query, save };
}