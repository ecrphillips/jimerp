import { describe, expect, it } from 'vitest';
import { formatInvoiceWeight, invoiceOrderWeightKg } from './invoiceTotals';
import { perKgToPerLb, KG_PER_LB } from './pricingAssumptions';

const line = (quantity_units: number, bag_size_g: number | null) => ({
  quantity_units,
  product: bag_size_g === null ? null : { bag_size_g },
});

describe('invoiceOrderWeightKg', () => {
  it('sums bags into kilograms', () => {
    expect(invoiceOrderWeightKg([line(3, 250), line(1, 1000)])).toBe(1.75);
  });

  it('counts every unit of a line', () => {
    expect(invoiceOrderWeightKg([line(12, 340)])).toBe(4.08);
  });

  it('ignores lines whose product has no bag size', () => {
    expect(invoiceOrderWeightKg([line(4, null), line(2, 250)])).toBe(0.5);
  });

  it('ignores an unweighable order entirely', () => {
    expect(invoiceOrderWeightKg([])).toBe(0);
    expect(invoiceOrderWeightKg([line(5, null)])).toBe(0);
  });

  it('stays exact on a many-line order', () => {
    const lines = Array.from({ length: 20 }, () => line(1, 100));
    expect(invoiceOrderWeightKg(lines)).toBe(2);
  });
});

describe('formatInvoiceWeight', () => {
  it('shows kilograms when the reader works in kg', () => {
    expect(formatInvoiceWeight(1.75, (kg) => kg, 'kg')).toBe('1.75 kg');
  });

  it('shows pounds when the reader works in lb', () => {
    expect(formatInvoiceWeight(1.75, perKgToPerLb, 'lb')).toBe('3.86 lb');
  });

  it('omits the figure when nothing could be weighed', () => {
    expect(formatInvoiceWeight(0, (kg) => kg, 'kg')).toBeNull();
  });

  it('converts with the canonical pound', () => {
    expect(formatInvoiceWeight(1, perKgToPerLb, 'lb')).toBe(`${(1 / KG_PER_LB).toFixed(2)} lb`);
  });
});
