import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ClientOrderableProduct {
  id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  grams_per_unit: number | null;
  format: string | null;
  packaging_variant: string | null;
  roast_group: string | null;
  is_active: boolean;
  packaging_types: { name: string } | null;
}

const PRODUCT_COLUMNS =
  'id, product_name, sku, bag_size_g, grams_per_unit, format, packaging_variant, roast_group, is_active, packaging_types(name)';

/**
 * Products an account can order. If the account has client_allowed_products
 * rows it is restricted to those; otherwise it can order all of its own active
 * products (same convention as useClientOrderingConstraints and the
 * client_edit_order RPC).
 */
export function useClientOrderableProducts(accountId: string | null | undefined) {
  return useQuery({
    queryKey: ['client-orderable-products', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<ClientOrderableProduct[]> => {
      const { data: allowed, error: allowedErr } = await supabase
        .from('client_allowed_products')
        .select(`product_id, products(${PRODUCT_COLUMNS})`)
        .eq('account_id', accountId!);
      if (allowedErr) throw allowedErr;

      if (allowed && allowed.length > 0) {
        return (allowed as unknown as { products: ClientOrderableProduct | null }[])
          .map((row) => row.products)
          .filter((p): p is ClientOrderableProduct => !!p && p.is_active)
          .sort((a, b) => a.product_name.localeCompare(b.product_name));
      }

      const { data: all, error: allErr } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS)
        .eq('account_id', accountId!)
        .eq('is_active', true)
        .order('product_name', { ascending: true });
      if (allErr) throw allErr;
      return (all ?? []) as unknown as ClientOrderableProduct[];
    },
  });
}
