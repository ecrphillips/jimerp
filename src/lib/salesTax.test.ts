import { describe, it, expect } from 'vitest';
import { computeTaxBreakdown, provinceFromAddress, suggestTaxCode } from './salesTax';

describe('suggestTaxCode', () => {
  it.each(['BC', 'AB', 'MB', 'SK', 'QC', 'NT', 'NU', 'YT'])('%s → 5% GST', (p) => expect(suggestTaxCode(p).code).toBe('GST5'));
  it('ON → 13% HST', () => expect(suggestTaxCode('ON').code).toBe('HST13'));
  it('NS → 14% HST', () => expect(suggestTaxCode('NS').code).toBe('HST14'));
  it.each(['NB', 'NL', 'PE'])('%s → 15% HST', (p) => expect(suggestTaxCode(p).code).toBe('HST15'));
  it('international → no tax', () => expect(suggestTaxCode(null, 'USA')).toMatchObject({ code: 'NONE', international: true }));
  it('unknown → 5% GST default', () => expect(suggestTaxCode(null).code).toBe('GST5'));
});

describe('provinceFromAddress', () => {
  it('reads code', () => expect(provinceFromAddress('123 Main St, Kamloops, BC V2C 1A1')).toBe('BC'));
  it('reads name', () => expect(provinceFromAddress('Halifax, Nova Scotia')).toBe('NS'));
});

describe('computeTaxBreakdown', () => {
  it('taxes only taxed lines', () => {
    const b = computeTaxBreakdown([{ amount: 100, taxCode: 'NONE' }, { amount: 12.34, taxCode: 'GST5' }]);
    expect(b.taxes).toEqual([{ code: 'GST5', label: '5% GST', amount: 0.62 }]);
    expect(b.total).toBe(112.96);
  });
});
