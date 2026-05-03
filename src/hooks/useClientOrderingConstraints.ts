import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ClientOrderingConstraints {
  caseOnly: boolean;
  caseSize: number | null;
  allowedProductIds: string[] | null; // null means all products allowed
}

/**
 * Fetches client-level ordering constraints (case_only, case_size, allowed products)
 * @param clientId - The client ID to fetch constraints for
 * @returns Constraints object with loading/error states
 */
export function useClientOrderingConstraints(clientId: string | null | undefined) {
  // Fetch client-level constraints (case_only, case_size).
  // TODO: case_only/case_size are on clients table (legacy). CLIENT RLS on clients is denied
  // after Step 4 migration; this query returns null and defaults to no constraints.
  // Migrate case_only/case_size to the accounts table to fully fix.
  const { data: clientData, isLoading: clientLoading } = useQuery({
    queryKey: ['client-ordering-constraints', clientId],
    queryFn: async () => {
      if (!clientId) return null;

      const { data } = await supabase
        .from('clients')
        .select('case_only, case_size')
        .eq('id', clientId)
        .maybeSingle();

      return data;
    },
    enabled: !!clientId,
  });

  // Fetch allowed products for this client (if any)
  const { data: allowedProducts, isLoading: productsLoading } = useQuery({
    queryKey: ['client-allowed-products', clientId],
    queryFn: async () => {
      if (!clientId) return null;
      
      const { data, error } = await supabase
        .from('client_allowed_products')
        .select('product_id')
        .eq('account_id', clientId);

      if (error) throw error;
      
      // If no rows, client can order all products (null means unrestricted)
      if (!data || data.length === 0) return null;
      
      return data.map(row => row.product_id);
    },
    enabled: !!clientId,
  });

  const constraints: ClientOrderingConstraints = {
    caseOnly: clientData?.case_only ?? false,
    caseSize: clientData?.case_size ?? null,
    allowedProductIds: allowedProducts ?? null,
  };

  return {
    constraints,
    isLoading: clientLoading || productsLoading,
    hasConstraints: constraints.caseOnly || constraints.allowedProductIds !== null,
  };
}

/**
 * Validates a quantity against case-only constraints
 * @returns null if valid, or error message if invalid
 */
export function validateCaseQuantity(
  quantity: number,
  caseOnly: boolean,
  caseSize: number | null
): string | null {
  if (!caseOnly || !caseSize) return null;
  
  if (quantity % caseSize !== 0) {
    return `Quantity must be a multiple of ${caseSize} (case size)`;
  }
  
  return null;
}

/**
 * Rounds a quantity to the nearest valid case quantity
 */
export function roundToCaseQuantity(
  quantity: number,
  caseSize: number,
  direction: 'up' | 'down' | 'nearest' = 'nearest'
): number {
  if (caseSize <= 0) return quantity;
  
  switch (direction) {
    case 'up':
      return Math.ceil(quantity / caseSize) * caseSize;
    case 'down':
      return Math.max(0, Math.floor(quantity / caseSize) * caseSize);
    case 'nearest':
    default:
      return Math.round(quantity / caseSize) * caseSize;
  }
}
