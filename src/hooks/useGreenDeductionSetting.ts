import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Green deduction switch: app_settings 'green_deduction' = {"enabled": bool}.
 * When on, marking a batch roasted takes its inbound green off the lots
 * (enforced in mark_batch_roasted, not just here). Missing row = off.
 */
const KEY = ['app_settings', 'green_deduction'] as const;

export function useGreenDeductionSettingQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value_json, updated_at, updated_by')
        .eq('key', 'green_deduction')
        .maybeSingle();
      if (error) throw error;
      const enabled = !!(data?.value_json as { enabled?: boolean } | null)?.enabled;
      return { enabled, updatedAt: data?.updated_at ?? null, updatedBy: data?.updated_by ?? null };
    },
    staleTime: 60_000,
  });
}

export function useGreenDeductionEnabled(): boolean {
  return useGreenDeductionSettingQuery().data?.enabled ?? false;
}

export function useSetGreenDeduction() {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase.from('app_settings').upsert({
        key: 'green_deduction',
        value_json: { enabled },
        updated_at: new Date().toISOString(),
        updated_by: authUser?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? 'Green deduction switched on' : 'Green deduction switched off');
      queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (err: unknown) => toast.error((err as { message?: string })?.message || 'Failed to save setting'),
  });
}
