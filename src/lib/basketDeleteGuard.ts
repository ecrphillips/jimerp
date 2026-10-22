import { supabase } from '@/integrations/supabase/client';

/**
 * Basket delete guard.
 *
 * A basket may not be deleted while any roast group uses it as a green source
 * (roast_group_baskets). Deactivating is always allowed. The database backs
 * this up: roast_group_baskets.basket_id is ON DELETE RESTRICT.
 *
 * Returns the display names of every roast group that uses `basketId`.
 */
export async function findRoastGroupsUsingBasket(basketId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('roast_group_baskets')
    .select('roast_group, roast_groups(display_name)')
    .eq('basket_id', basketId);
  if (error) throw error;
  return (data ?? [])
    .map(r => (r.roast_groups as { display_name: string | null } | null)?.display_name || r.roast_group)
    .sort((a, b) => a.localeCompare(b));
}
