import { supabase } from '@/integrations/supabase/client';

/**
 * Make a roast group take green from a basket (no % set). Used by the roast
 * group creation flows. Already linked counts as success. Returns an error
 * message, or null when it worked.
 */
export async function linkRoastGroupToBasket(roastGroup: string, basketId: string): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from('roast_group_baskets').insert({
    roast_group: roastGroup,
    basket_id: basketId,
    pct: null,
    created_by: auth.user?.id ?? null,
  });
  if (!error || error.code === '23505') return null;
  return error.message;
}
