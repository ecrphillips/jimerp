import { describe, expect, it } from 'vitest';
import { productAccessState } from './customerProductAccess';

describe('customer product access', () => {
  it('hidden products are never orderable', () => {
    expect(productAccessState('bag', [{ product_id: 'bag', visible: false, orderable: true, case_only: false }], []).orderable).toBe(false);
  });
  it('visible products can be non-orderable', () => {
    expect(productAccessState('bag', [{ product_id: 'bag', visible: true, orderable: false, case_only: false }], [])).toMatchObject({ visible: true, orderable: false });
  });
  it('case-only restricts the contained bag, not the case or another variant', () => {
    const settings = [{ product_id: 'case', visible: true, orderable: true, case_only: true }];
    const cases = [{ id: 'case', case_lot_product_id: 'bag', is_active: true }];
    expect(productAccessState('bag', settings, cases)).toMatchObject({ orderable: false, heldForCase: true });
    expect(productAccessState('case', settings, cases).orderable).toBe(true);
    expect(productAccessState('other-bag', settings, cases).orderable).toBe(true);
  });
  it('removing case-only restores the bag unless explicitly disabled', () => {
    expect(productAccessState('bag', [], [{ id: 'case', case_lot_product_id: 'bag', is_active: true }]).orderable).toBe(true);
  });
  it('settings are account-specific', () => {
    expect(productAccessState('bag', [], []).orderable).toBe(true);
    expect(productAccessState('bag', [{ product_id: 'bag', visible: true, orderable: false, case_only: false }], []).orderable).toBe(false);
  });
});