/**
 * Roast-group ordering for the Pack tab.
 *
 * Default ("wip") order groups by readiness so the packer works top-down:
 *   1. all WIP available   (every product with remaining demand is fully covered)
 *   2. some WIP available   (at least one product covered or partially covered)
 *   3. no WIP available
 * Within tier 3, groups keep the same sequence they appear in on the Roast tab
 * (roastTabIndex, which mirrors roast_groups.display_order). The other tiers also
 * fall back to roastTabIndex for a stable, predictable order.
 *
 * The user can override the default with a standard sort control (newest / oldest /
 * alpha), and can manually drag-reorder groups — a manual order takes precedence over
 * everything until it is cleared or the set of groups changes.
 */

export type PackSortMode = 'wip' | 'newest' | 'oldest' | 'alpha';
export type WipTier = 'full' | 'partial' | 'none';

export interface PackGroupMeta {
  /** roast_group key; use '' for the Unassigned bucket. */
  roastGroup: string;
  displayName: string;
  /** Rolled-up readiness across the group's products with remaining demand. */
  tier: WipTier;
  /** Position in the Roast tab ordering (roast_groups.display_order). */
  roastTabIndex: number;
  /** Earliest ship date across the group's products, or null. Used by newest/oldest. */
  earliestShipDate: string | null;
}

const TIER_RANK: Record<WipTier, number> = { full: 0, partial: 1, none: 2 };

/**
 * Roll a group's readiness up from its products' WIP statuses.
 * Only products that still have remaining demand count — a fully-packed product
 * (wipStatus 'none' because there is no work left) must not drag a group down.
 */
export function rollUpGroupTier(
  products: { wipStatus: WipTier; remainingUnits: number }[],
): WipTier {
  const relevant = products.filter((p) => p.remainingUnits > 0);
  if (relevant.length === 0) return 'none'; // nothing left to pack
  if (relevant.every((p) => p.wipStatus === 'full')) return 'full';
  if (relevant.some((p) => p.wipStatus === 'full' || p.wipStatus === 'partial')) return 'partial';
  return 'none';
}

/**
 * Produce the ordered list of group keys for the given sort mode.
 *
 * @param groups      group metadata (one per roast group present on the tab)
 * @param mode        active sort control
 * @param manualOrder optional manual drag order (array of group keys). When present
 *                    AND it still covers exactly the current group set, it wins.
 */
export function orderPackGroups(
  groups: PackGroupMeta[],
  mode: PackSortMode,
  manualOrder: string[] | null = null,
): string[] {
  const keys = groups.map((g) => g.roastGroup);

  // Manual order wins, but only while it matches the current set of groups exactly.
  if (manualOrder && sameSet(manualOrder, keys)) {
    return [...manualOrder];
  }

  const byKey = new Map(groups.map((g) => [g.roastGroup, g]));
  const sorted = [...keys].sort((a, b) => {
    const ga = byKey.get(a)!;
    const gb = byKey.get(b)!;
    switch (mode) {
      case 'alpha':
        return ga.displayName.localeCompare(gb.displayName);
      case 'oldest':
        return cmpDate(ga.earliestShipDate, gb.earliestShipDate, 'asc') || ga.roastTabIndex - gb.roastTabIndex;
      case 'newest':
        return cmpDate(ga.earliestShipDate, gb.earliestShipDate, 'desc') || ga.roastTabIndex - gb.roastTabIndex;
      case 'wip':
      default: {
        const tierDiff = TIER_RANK[ga.tier] - TIER_RANK[gb.tier];
        if (tierDiff !== 0) return tierDiff;
        return ga.roastTabIndex - gb.roastTabIndex;
      }
    }
  });
  return sorted;
}

/** Compare two nullable ISO date strings; nulls sort last in both directions. */
function cmpDate(a: string | null, b: string | null, dir: 'asc' | 'desc'): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const diff = a < b ? -1 : 1;
  return dir === 'asc' ? diff : -diff;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}
