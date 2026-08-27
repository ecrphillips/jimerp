/**
 * Detecting products priced on superseded assumptions.
 *
 * This is the operator's stated workflow made mechanical: "if the assumption is
 * set at $50/hr and we bump it to $52, we can query the database for products
 * with <$52 in the labour part of the price build and decide what to do."
 *
 * It works because each product stores the rates it was priced with rather than
 * only its price. Comparing those snapshots against the current assumptions
 * turns "which products are out of date" from something you have to remember
 * into something the system reports.
 */
import { deriveLoadedLabourRate, type PricingAssumptions } from './pricingAssumptions';

/** Rates differing by less than this are the same rate, not a change. */
export const RATE_EPSILON = 0.005;

export interface PricedSnapshot {
  assumed_loaded_labour_rate_per_hr: number | null;
  assumed_yield_loss_pct: number | null;
  assumed_roast_throughput_green_kg_per_hr: number | null;
  assumed_machine_running_cost_per_hr: number | null;
}

export type StaleField = 'labour' | 'yield' | 'throughput' | 'machine';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Whether a snapshotted rate has drifted from the current one.
 *
 * A null on either side is not staleness — an unpriced or unset rate is a
 * different problem, and reporting it here would bury the real drift in noise.
 */
export function isRateStale(used: number | null, current: number | null): boolean {
  if (!isNum(used) || !isNum(current)) return false;
  return Math.abs(used - current) > RATE_EPSILON;
}

/** Which assumptions this product was priced on that have since moved. */
export function staleFields(
  snapshot: PricedSnapshot,
  assumptions: PricingAssumptions,
): StaleField[] {
  const currentLabour = deriveLoadedLabourRate(assumptions)?.value ?? null;
  const out: StaleField[] = [];

  if (isRateStale(snapshot.assumed_loaded_labour_rate_per_hr, currentLabour)) out.push('labour');
  if (isRateStale(snapshot.assumed_yield_loss_pct, assumptions.standard_yield_loss_pct))
    out.push('yield');
  if (
    isRateStale(
      snapshot.assumed_roast_throughput_green_kg_per_hr,
      assumptions.roast_throughput_green_kg_per_hr,
    )
  )
    out.push('throughput');
  if (
    isRateStale(
      snapshot.assumed_machine_running_cost_per_hr,
      assumptions.machine_running_cost_per_hr,
    )
  )
    out.push('machine');

  return out;
}

export function isStale(snapshot: PricedSnapshot, assumptions: PricingAssumptions): boolean {
  return staleFields(snapshot, assumptions).length > 0;
}
