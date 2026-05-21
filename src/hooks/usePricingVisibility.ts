import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';

/**
 * Returns whether dollar amounts should be hidden from the current user in
 * the client portal.
 *
 * Account owners always see pricing. Non-owners see pricing unless their
 * account has `hide_pricing_from_non_owners = true`.
 *
 * Internal users (ADMIN/OPS) are never affected — this hook should only be
 * used on client-portal surfaces.
 */
export function usePricingVisibility() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const accountId = previewAccountId ?? authUser?.accountId ?? null;
  const isOwner = !!authUser?.isOwner;

  const { data } = useQuery({
    queryKey: ['account-pricing-visibility', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      if (!accountId) return false;
      const { data, error } = await supabase
        .from('accounts')
        .select('hide_pricing_from_non_owners')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      return !!(data as { hide_pricing_from_non_owners?: boolean } | null)?.hide_pricing_from_non_owners;
    },
  });

  const hidePricing = !isOwner && !!data;
  return { hidePricing, isOwner, hideFlag: !!data };
}
