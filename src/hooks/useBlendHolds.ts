import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface BlendHoldBatch {
  id: string;
  roast_group: string;
  planned_for_blend_roast_group: string;
  actual_output_kg: number;
  roasted_at: string | null;
}

/**
 * Roasted batches still held for a post-roast blend (earmarked, not consumed).
 * These are the batches computeAuthoritativeWip subtracts from available WIP.
 */
export function useBlendHolds() {
  return useQuery({
    queryKey: ['blend-holds'],
    queryFn: async (): Promise<BlendHoldBatch[]> => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('id, roast_group, planned_for_blend_roast_group, actual_output_kg, roasted_at')
        .eq('status', 'ROASTED')
        .not('planned_for_blend_roast_group', 'is', null)
        .is('consumed_by_blend_at', null)
        .order('roasted_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((b) => ({ ...b, actual_output_kg: Number(b.actual_output_kg ?? 0) })) as BlendHoldBatch[];
    },
  });
}

/** Total held kg per component roast group. */
export function heldKgByGroup(holds: BlendHoldBatch[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of holds ?? []) out[h.roast_group] = (out[h.roast_group] ?? 0) + h.actual_output_kg;
  return out;
}

/** Release batches from their blend hold so other products can pack them. No ledger rows. */
export function useReleaseBlendHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchIds: string[]) => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .update({ planned_for_blend_roast_group: null })
        .in('id', batchIds)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Nothing was released');
      return data.length;
    },
    onSuccess: (n) => {
      toast.success(`Released ${n} batch${n === 1 ? '' : 'es'} to coffee stock`);
      for (const key of [
        'blend-holds', 'authoritative-roasted-batches', 'authoritative-wip', 'roasted-batches',
        'roasted-batches-for-blending', 'roasted-component-batches-for-blending', 'component-batches-for-blend',
      ]) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to release'),
  });
}
