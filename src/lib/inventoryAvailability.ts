/** Smallest kg shown as non-zero at one decimal place. */
export const MIN_VISIBLE_KG = 0.05;

/** Available WIP after blend holds; tiny ledger rounding remainders count as none. */
export function availableWipKg(netKg: number, heldKg = 0): number {
  const available = netKg - heldKg;
  return available >= MIN_VISIBLE_KG ? available : 0;
}
export type AvailabilityMode = 'available' | 'negative' | 'all';

/** True when a signed balance is below zero beyond display rounding. */
export function isNegativeBalance(net: number, tolerance = MIN_VISIBLE_KG): boolean {
  return net <= -tolerance;
}
