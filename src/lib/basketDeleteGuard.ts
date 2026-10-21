/**
 * Basket delete guard.
 *
 * A basket may not be deleted while any roast group uses it as a component.
 * Deactivating is always allowed.
 *
 * PHASE 2: roast groups cannot use baskets yet, so this always returns [].
 * When roast groups gain basket components, query that link table here and
 * return the display names of every roast group that uses `basketId`. The
 * Baskets pages already block delete (and show these names) whenever this
 * returns anything.
 */
export async function findRoastGroupsUsingBasket(_basketId: string): Promise<string[]> {
  return [];
}
