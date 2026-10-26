/** Floor counts balance the signed ledger, never the clamped display value. */
export function fgFloorCountDelta(countedUnits: number, signedBalance: number): number {
  if (!Number.isSafeInteger(countedUnits) || countedUnits < 0) {
    throw new Error('Enter a non-negative whole-number count.');
  }
  if (!Number.isFinite(signedBalance)) throw new Error('Invalid inventory balance.');
  return countedUnits - signedBalance;
}