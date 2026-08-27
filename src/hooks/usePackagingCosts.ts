import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PackagingVariant } from '@/components/PackagingBadge';

export interface PackagingCostRow {
  id: string;
  packaging_variant: PackagingVariant;
  material_cost_per_unit: number;
  labour_cost_per_unit: number;
  notes: string | null;
}

/**
 * Packaging costs keyed by variant.
 *
 * Only material cost feeds the pricing sheet. Pack labour is derived from the
 * loaded labour rate and the weight band's packing speed, so the legacy
 * labour_cost_per_unit column on this table is deliberately not used for
 * pricing — two sources for one number is how they drift apart.
 */
export function usePackagingCosts() {
  return useQuery({
    queryKey: ['packaging_costs'],
    queryFn: async (): Promise<Record<string, PackagingCostRow>> => {
      const { data, error } = await supabase.from('packaging_costs').select('*');
      if (error) throw error;
      const out: Record<string, PackagingCostRow> = {};
      for (const row of (data ?? []) as unknown as PackagingCostRow[]) {
        out[row.packaging_variant] = row;
      }
      return out;
    },
  });
}
