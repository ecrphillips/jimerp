import { describe, it, expect } from 'vitest';
import { caseLotChoices, caseLotGrams, type CaseLotVariant } from './caseLots';

const variant: CaseLotVariant = { id: 'retail', product_name: 'Coffee', account_id: 'account', client_id: null, roast_group: 'roast', is_active: true, grams_per_unit: 250, bag_size_g: 250, packaging_type: { name: 'Retail Bag' } };

describe('phase-one case lots', () => {
  it('contains one selected variant multiplied by the quantity', () => {
    expect(caseLotGrams(250, 12)).toBe(3000);
  });
  it('requires a positive whole-number quantity', () => {
    expect(caseLotGrams(250, 0)).toBe(0);
    expect(caseLotGrams(250, -1)).toBe(0);
    expect(caseLotGrams(250, 1.5)).toBe(0);
  });
  it('only offers active ordinary variants from the same account and product family', () => {
    const others = [variant, { ...variant, id: 'bulk', bag_size_g: 1000, grams_per_unit: 1000 },
      { ...variant, id: 'different-product', product_name: 'Other Coffee' },
      { ...variant, id: 'other-account', account_id: 'other' },
      { ...variant, id: 'inactive', is_active: false },
      { ...variant, id: 'case', packaging_type: { name: 'Case Lot' } },
      { ...variant, id: 'nested', case_lot_product_id: 'retail' }];
    expect(caseLotChoices(variant, others).map(p => p.id)).toEqual(['retail', 'bulk']);
  });
});