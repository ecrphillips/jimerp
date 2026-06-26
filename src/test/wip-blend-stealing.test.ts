import { describe, it, expect } from 'vitest';
import {
  computeAuthoritativeWip,
  type WipLedgerTx,
  type BlendReservationBatch,
} from '@/hooks/useAuthoritativeInventory';

describe('blend WIP stealing', () => {
  const COMPONENT = 'ETHIOPIA';
  const BLEND = 'HOUSE_BLEND';

  it('roasting a component adds it to component WIP', () => {
    const ledger: WipLedgerTx[] = [
      { roast_group: COMPONENT, quantity_kg: 10, transaction_type: 'ROAST_OUTPUT' },
    ];
    const wip = computeAuthoritativeWip(ledger);
    expect(wip[COMPONENT].wip_available_kg).toBe(10);
  });

  it('executing a blend moves kg out of component WIP and into blend WIP (no double count)', () => {
    const ledger: WipLedgerTx[] = [
      { roast_group: COMPONENT, quantity_kg: 10, transaction_type: 'ROAST_OUTPUT' },
      { roast_group: BLEND, quantity_kg: 10, transaction_type: 'ADJUSTMENT' },
      { roast_group: COMPONENT, quantity_kg: -10, transaction_type: 'ADJUSTMENT' },
    ];
    const wip = computeAuthoritativeWip(ledger);
    expect(wip[COMPONENT].wip_available_kg).toBe(0);
    expect(wip[BLEND].wip_available_kg).toBe(10);
  });

  it('partial blend leaves the unblended remainder available to the component', () => {
    const ledger: WipLedgerTx[] = [
      { roast_group: COMPONENT, quantity_kg: 10, transaction_type: 'ROAST_OUTPUT' },
      { roast_group: BLEND, quantity_kg: 6, transaction_type: 'ADJUSTMENT' },
      { roast_group: COMPONENT, quantity_kg: -6, transaction_type: 'ADJUSTMENT' },
    ];
    const wip = computeAuthoritativeWip(ledger);
    expect(wip[COMPONENT].wip_available_kg).toBe(4);
    expect(wip[BLEND].wip_available_kg).toBe(6);
  });

  it('a ROASTED, blend-earmarked, not-yet-consumed batch is reserved out of component WIP', () => {
    const ledger: WipLedgerTx[] = [
      { roast_group: COMPONENT, quantity_kg: 10, transaction_type: 'ROAST_OUTPUT' },
    ];
    const batches: BlendReservationBatch[] = [
      {
        roast_group: COMPONENT,
        status: 'ROASTED',
        actual_output_kg: 10,
        planned_for_blend_roast_group: BLEND,
        consumed_by_blend_at: null,
      },
    ];
    const wip = computeAuthoritativeWip(ledger, batches);
    expect(wip[COMPONENT].reserved_for_blend_kg).toBe(10);
    expect(wip[COMPONENT].wip_available_kg).toBe(0);
  });

  it('reservation releases once the batch is consumed by the blend', () => {
    const ledger: WipLedgerTx[] = [
      { roast_group: COMPONENT, quantity_kg: 10, transaction_type: 'ROAST_OUTPUT' },
      { roast_group: BLEND, quantity_kg: 6, transaction_type: 'ADJUSTMENT' },
      { roast_group: COMPONENT, quantity_kg: -6, transaction_type: 'ADJUSTMENT' },
    ];
    const batches: BlendReservationBatch[] = [
      {
        roast_group: COMPONENT,
        status: 'ROASTED',
        actual_output_kg: 10,
        planned_for_blend_roast_group: BLEND,
        consumed_by_blend_at: '2026-06-17T12:00:00Z',
      },
    ];
    const wip = computeAuthoritativeWip(ledger, batches);
    expect(wip[COMPONENT].reserved_for_blend_kg).toBe(0);
    // 4 kg leftover from the partial blend is now available to the component
    expect(wip[COMPONENT].wip_available_kg).toBe(4);
  });
});
