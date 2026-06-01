import { describe, it, expect } from 'vitest';
import {
  computeAuthoritativeWip,
  type WipLedgerTx,
} from '@/hooks/useAuthoritativeInventory';

/**
 * Regression guard for "post-roast blend WIP stealing".
 *
 * Mechanic: marking a component batch ROASTED writes a positive ROAST_OUTPUT to the
 * component's OWN roast group, so that kg counts as component WIP. Executing a blend
 * must write BOTH a positive ADJUSTMENT to the blend group AND a matching negative
 * ADJUSTMENT to each component group. Without the negative leg the kg is double-counted
 * and a sibling single-origin product in the component group can "steal" coffee that is
 * physically already in the blend.
 */
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
      // component roasted -> +10 to component
      { roast_group: COMPONENT, quantity_kg: 10, transaction_type: 'ROAST_OUTPUT' },
      // blend executed: +10 to blend group (output)
      { roast_group: BLEND, quantity_kg: 10, transaction_type: 'ADJUSTMENT' },
      // blend executed: -10 from component group (the fix — the previously-skipped leg)
      { roast_group: COMPONENT, quantity_kg: -10, transaction_type: 'ADJUSTMENT' },
    ];
    const wip = computeAuthoritativeWip(ledger);

    // Component WIP is now zero — a sibling product can no longer pack it.
    expect(wip[COMPONENT].wip_available_kg).toBe(0);
    // The kg lives in the blend instead.
    expect(wip[BLEND].wip_available_kg).toBe(10);
  });

  it('demonstrates the bug it prevents: skipping the component decrement double-counts kg', () => {
    const buggyLedger: WipLedgerTx[] = [
      { roast_group: COMPONENT, quantity_kg: 10, transaction_type: 'ROAST_OUTPUT' },
      { roast_group: BLEND, quantity_kg: 10, transaction_type: 'ADJUSTMENT' },
      // (missing the -10 component decrement)
    ];
    const wip = computeAuthoritativeWip(buggyLedger);

    // 10 kg appears in BOTH groups = 20 kg total from 10 kg of coffee. This is the steal.
    expect(wip[COMPONENT].wip_available_kg).toBe(10);
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
});
