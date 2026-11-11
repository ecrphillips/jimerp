/** Pure helpers for the Order Detail packing card and Ship-tab hold warnings. */

export interface PackHold {
  order_line_item_id: string;
  order_id: string;
  order_number: string;
  product_id: string;
  held_units: number;
}

/** Packed-but-unpicked bags of a product held for OTHER order lines. */
export function heldForOthers(holds: PackHold[], productId: string, lineId: string): PackHold[] {
  return holds.filter(h => h.product_id === productId && h.order_line_item_id !== lineId && h.held_units > 0);
}

/**
 * How many of `requestedIncrease` extra picks would come out of bags held for
 * other orders. `fgOnHand` is current FG stock (already excludes picked bags);
 * `heldByOthers` is the sum held for other lines.
 */
export function picksIntoHeldStock(requestedIncrease: number, fgOnHand: number, heldByOthers: number): number {
  if (requestedIncrease <= 0) return 0;
  const free = Math.max(0, fgOnHand - heldByOthers);
  return Math.max(0, requestedIncrease - free);
}

/** New packed total after an additive entry, clamped to [picked, needed]. */
export function addPacked(current: number, add: number, picked: number, needed: number): number {
  return Math.max(picked, Math.min(needed, current + add));
}
