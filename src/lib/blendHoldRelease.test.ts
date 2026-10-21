import { describe, it, expect } from 'vitest';
import { computeAuthoritativeWip } from '@/hooks/useAuthoritativeInventory';

const tx = [{ roast_group: 'ETHIO', quantity_kg: 25.8, transaction_type: 'ROAST_OUTPUT' }] as any;
const batch = (planned: string | null) => ({
  roast_group: 'ETHIO', status: 'ROASTED', actual_output_kg: 13.4,
  planned_for_blend_roast_group: planned, consumed_by_blend_at: null,
}) as any;

describe('blend hold release', () => {
  it('a batch held for a blend reduces available WIP but not on-hand', () => {
    const w = computeAuthoritativeWip(tx, [batch('TECH')]).ETHIO;
    expect(w.wip_net_kg).toBeCloseTo(25.8);
    expect(w.wip_available_kg).toBeCloseTo(12.4);
  });
  it('a released batch no longer reduces available WIP', () => {
    expect(computeAuthoritativeWip(tx, [batch(null)]).ETHIO.wip_available_kg).toBeCloseTo(25.8);
  });
});
