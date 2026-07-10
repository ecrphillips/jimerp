/**
 * Roast coverage — single source of truth for "does this roast group have enough
 * roasted output to cover its demand, and if not, how much more must be roasted?"
 *
 * The one rule this encodes: on-hand roasted coffee is ALREADY reflected in
 * `netDemandKg` (which is gross demand minus on-hand WIP minus FG). Coverage is
 * therefore about FUTURE output only — the yield-adjusted expected output of
 * PLANNED batches. Lifetime/cumulative roasted weight must NOT be added here; it
 * would double-count coffee already turned into WIP/FG and consumed.
 *
 * Because a batch's actual output enters WIP the instant it flips
 * PLANNED→ROASTED (atomic in the `mark_batch_roasted` RPC), that transition is
 * coverage-neutral: `plannedExpectedKg` drops by X and `netDemandKg` drops by X,
 * so `coverageDeltaKg` is unchanged. This invariant is what the accompanying
 * test guards.
 */
export interface RoastCoverageInput {
  /** Gross demand already net of on-hand WIP + FG (kg). Never negative. */
  netDemandKg: number;
  /** Future yield-adjusted output from PLANNED batches (kg). */
  plannedExpectedKg: number;
}

export interface RoastCoverage {
  /** plannedExpected − netDemand. ≥0 = covered (surplus); <0 = short. */
  coverageDeltaKg: number;
  /** kg still to plan/roast to reach coverage = max(0, −coverageDelta). */
  remainingNeedKg: number;
  /** True when planned output meets or exceeds net demand. */
  isCovered: boolean;
}

export function computeRoastCoverage({
  netDemandKg,
  plannedExpectedKg,
}: RoastCoverageInput): RoastCoverage {
  const coverageDeltaKg = plannedExpectedKg - netDemandKg;
  return {
    coverageDeltaKg,
    remainingNeedKg: Math.max(0, -coverageDeltaKg),
    isCovered: coverageDeltaKg >= 0,
  };
}
