import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PricingAssumptions, PackSpeedBand } from '@/lib/pricingAssumptions';

export interface PricingAssumptionsRow extends PricingAssumptions {
  id: string;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const PRICING_ASSUMPTIONS_KEY = ['pricing-assumptions'];
export const PACK_SPEED_BANDS_KEY = ['pricing-pack-speed-bands'];

export function usePricingAssumptions() {
  return useQuery({
    queryKey: PRICING_ASSUMPTIONS_KEY,
    queryFn: async (): Promise<PricingAssumptionsRow | null> => {
      const { data, error } = await supabase
        .from('pricing_assumptions')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PricingAssumptionsRow | null;
    },
  });
}

export function usePackSpeedBands() {
  return useQuery({
    queryKey: PACK_SPEED_BANDS_KEY,
    queryFn: async (): Promise<PackSpeedBand[]> => {
      const { data, error } = await supabase
        .from('pricing_pack_speed_bands')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return (data ?? []) as PackSpeedBand[];
    },
  });
}

export function useSaveAssumptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PricingAssumptions> & { id: string; notes?: string | null }) => {
      const { id, ...fields } = patch;
      const userResp = await supabase.auth.getUser();
      const { error } = await supabase
        .from('pricing_assumptions')
        .update({ ...fields, updated_by: userResp.data.user?.id ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRICING_ASSUMPTIONS_KEY });
    },
  });
}

export function useSaveBandSpeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, units_per_hour }: { id: string; units_per_hour: number | null }) => {
      const userResp = await supabase.auth.getUser();
      const { error } = await supabase
        .from('pricing_pack_speed_bands')
        .update({ units_per_hour, updated_by: userResp.data.user?.id ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PACK_SPEED_BANDS_KEY });
    },
  });
}
