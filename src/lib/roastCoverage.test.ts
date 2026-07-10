import { describe, it, expect } from 'vitest';
import { computeRoastCoverage } from './roastCoverage';

describe('computeRoastCoverage', () => {
  it('reports the Colombia case as short (the bug this replaced)', () => {
    // netDemand 3.0 already subtracts on-hand WIP (3.8) + FG (0) from demand (6.8);
    // no PLANNED batches queued. Must read SHORT 3.0 — not "Covered" off lifetime roasted.
    const c = computeRoastCoverage({ netDemandKg: 3.0, plannedExpectedKg: 0 });
    expect(c.isCovered).toBe(false);
    expect(c.coverageDeltaKg).toBeCloseTo(-3.0);
    expect(c.remainingNeedKg).toBeCloseTo(3.0);
  });

  it('covers when planned output meets net demand', () => {
    const c = computeRoastCoverage({ netDemandKg: 3.0, plannedExpectedKg: 3.0 });
    expect(c.isCovered).toBe(true);
    expect(c.coverageDeltaKg).toBeCloseTo(0);
    expect(c.remainingNeedKg).toBe(0);
  });

  it('shows surplus when planned output exceeds net demand', () => {
    const c = computeRoastCoverage({ netDemandKg: 3.0, plannedExpectedKg: 5.0 });
    expect(c.isCovered).toBe(true);
    expect(c.coverageDeltaKg).toBeCloseTo(2.0);
    expect(c.remainingNeedKg).toBe(0);
  });

  it('zero net demand is covered with no remaining need', () => {
    const c = computeRoastCoverage({ netDemandKg: 0, plannedExpectedKg: 0 });
    expect(c.isCovered).toBe(true);
    expect(c.remainingNeedKg).toBe(0);
  });

  // Invariant A: a PLANNED batch flipping to ROASTED is coverage-neutral.
  // Roasting output X moves X out of plannedExpected and (via new WIP) X out of
  // netDemand simultaneously, so coverageDelta must not change.
  it('is invariant when a batch goes PLANNED -> ROASTED', () => {
    const X = 12; // batch output kg
    const before = computeRoastCoverage({ netDemandKg: 20, plannedExpectedKg: 15 });
    const after = computeRoastCoverage({ netDemandKg: 20 - X, plannedExpectedKg: 15 - X });
    expect(after.coverageDeltaKg).toBeCloseTo(before.coverageDeltaKg);
    expect(after.remainingNeedKg).toBeCloseTo(before.remainingNeedKg);
  });

  it('holds the invariant even when net demand floors at 0 after roasting', () => {
    // Over-supplied group: after roasting, net demand would go negative but is
    // clamped to 0 upstream. Feeding the clamped value keeps delta monotonic
    // (surplus grows, never flips back to short).
    const before = computeRoastCoverage({ netDemandKg: 5, plannedExpectedKg: 8 });
    const afterClamped = computeRoastCoverage({ netDemandKg: 0, plannedExpectedKg: 3 });
    expect(before.isCovered).toBe(true);
    expect(afterClamped.isCovered).toBe(true);
    expect(afterClamped.coverageDeltaKg).toBeGreaterThanOrEqual(0);
  });
});
