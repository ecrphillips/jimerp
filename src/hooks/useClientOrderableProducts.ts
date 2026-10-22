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
  is_perennial: boolean;
  packaging_type_id: string | null;
  case_lot_product_id: string | null;
  case_lot_units: number | null;
  customer_orderable: boolean;
  packaging_types: { name: string } | null;
}

/**
 * Products an account can order. If the account has client_allowed_products
 * rows it is restricted to those; otherwise it can order all of its own active
 * products (same convention as useClientOrderingConstraints and the
 * client_edit_order RPC).
 */
export function useClientOrderableProducts(accountId: string | null | undefined, catalog = false) {
  return useQuery({
    queryKey: ['client-orderable-products', accountId, catalog],
    enabled: !!accountId,
    queryFn: async (): Promise<ClientOrderableProduct[]> => {
      if (!accountId) return [];
      const { data, error } = await supabase.rpc('get_customer_products', { p_account_id: accountId, p_catalog: catalog });
      if (error) throw error;
      return (data ?? []) as unknown as ClientOrderableProduct[];
    },
  });
}
