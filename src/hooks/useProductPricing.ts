import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CostStackConfig, GreenBasis } from '@/lib/pricingEngine';

export interface ProductPricingRow {
  id: string;
  product_id: string;
  tier: string;
  included_lines: CostStackConfig;
  green_basis: GreenBasis;
  green_benchmark_per_kg: number | null;
  green_market_per_kg: number | null;
  green_used_per_kg: number | null;
  grams_per_unit: number | null;
  packaging_material_per_unit: number | null;
  services_per_unit: number | null;
  assumed_roast_throughput_green_kg_per_hr: number | null;
  assumed_machine_running_cost_per_hr: number | null;
  assumed_loaded_labour_rate_per_hr: number | null;
  assumed_yield_loss_pct: number | null;
  assumed_pack_units_per_hour: number | null;
  margin_per_green_kg: number | null;
  green_kg_per_unit: number | null;
  cost_floor_per_unit: number | null;
  price_per_unit: number | null;
  notes: string | null;
  updated_at: string;
  priced_by: string | null;
}

export type ProductPricingInput = Omit<
  ProductPricingRow,
  'id' | 'updated_at' | 'priced_by'
>;

export const PRODUCT_PRICING_KEY = ['product-pricing'];

/** Every priced product, keyed by product id. */
export function useProductPricing() {
  return useQuery({
    queryKey: PRODUCT_PRICING_KEY,
    queryFn: async (): Promise<Record<string, ProductPricingRow>> => {
      const { data, error } = await supabase.from('product_pricing').select('*');
      if (error) throw error;
      const out: Record<string, ProductPricingRow> = {};
      for (const row of (data ?? []) as unknown as ProductPricingRow[]) {
        out[row.product_id] = row;
      }
      return out;
    },
  });
}

/**
 * Save a product's price along with the full build behind it.
 *
 * One row per product, replaced on save. The assumption columns are a snapshot
 * of the rates in force at pricing time — that is what makes "which products
 * were priced on the old labour rate" answerable later.
 */
export function useSaveProductPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductPricingInput) => {
      const userResp = await supabase.auth.getUser();
      const { error } = await supabase
        .from('product_pricing')
        .upsert(
          {
            ...input,
            included_lines: input.included_lines as never,
            priced_by: userResp.data.user?.id ?? null,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'product_id' },
        );
      if (error) throw error;

      // The dashboard's "products needing pricing" count reads this flag, so a
      // saved price has to clear it — otherwise the two disagree and the flag
      // becomes the stale one.
      const { error: flagError } = await supabase
        .from('products')
        .update({ pricing_incomplete: false })
        .eq('id', input.product_id);
      if (flagError) throw flagError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRODUCT_PRICING_KEY });
      qc.invalidateQueries({ queryKey: ['all-products'] });
      qc.invalidateQueries({ queryKey: ['product-options-for-pricing'] });
    },
  });
}

export interface ProductOption {
  id: string;
  product_name: string;
  bag_size_g: number;
  packaging_variant: string | null;
  client_name: string | null;
}

/** Active products, for attaching a priced line to. */
export function useProductOptions() {
  return useQuery({
    queryKey: ['product-options-for-pricing'],
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, bag_size_g, packaging_variant, client:clients(name)')
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        product_name: p.product_name,
        bag_size_g: p.bag_size_g,
        packaging_variant: p.packaging_variant,
        client_name: (p.client as { name: string } | null)?.name ?? null,
      }));
    },
  });
}
