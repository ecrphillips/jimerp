/**
 * Work-ahead classification for planned roast batches.
 *
 * Walk planned batches in display order, subtracting each batch's expected
 * output from the demand still uncovered. A batch is "work ahead" when the
 * demand left before it is already covered (≤ 0): its whole output is
 * surplus to the period's requirement.
 */
export interface WorkAheadBatch {
  id: string;
  expectedOutputKg: number;
}

const EPS = 0.001;

export function classifyWorkAhead(batches: WorkAheadBatch[], netDemandKg: number): Set<string> {
  const ahead = new Set<string>();
  let remaining = Math.max(0, netDemandKg);
  for (const b of batches) {
    if (remaining <= EPS) {
      ahead.add(b.id);
    } else {
      remaining -= Math.max(0, b.expectedOutputKg);
    }
  }
  return ahead;
}

/** Expected roasted output from inbound green kg. */
export function expectedOutputKg(inboundGreenKg: number | null | undefined, yieldLossPct: number): number {
  return (inboundGreenKg ?? 0) * (1 - yieldLossPct / 100);
}
