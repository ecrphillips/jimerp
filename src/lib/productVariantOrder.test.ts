import { describe, expect, it } from 'vitest';
import { sortVariantsByVolume, variantTotalVolumeGrams } from './productVariantOrder';

const row = (
  product_name: string,
  grams: number | null,
  bagSize: number,
  packagingType?: string,
) => ({
  product_name,
  grams_per_unit: grams,
  bag_size_g: bagSize,
  packaging_type: packagingType ? { name: packagingType } : null,
});

describe('variantTotalVolumeGrams', () => {
  it('reads the stored bag weight', () => {
    expect(variantTotalVolumeGrams(row('Habitual 300g', 300, 300))).toBe(300);
  });

  it('falls back to bag_size_g when grams_per_unit is blank', () => {
    expect(variantTotalVolumeGrams(row('Habitual', null, 340))).toBe(340);
  });

  it('treats blank and negative weights as zero so they sort first', () => {
    expect(variantTotalVolumeGrams(row('Unknown', null, 0))).toBe(0);
    expect(variantTotalVolumeGrams(row('Unknown', -5, -5))).toBe(0);
  });
});

describe('sortVariantsByVolume', () => {
  it('orders variants smallest to largest by total volume', () => {
    const sorted = sortVariantsByVolume([
      row('Habitual 1kg', 1000, 1000, 'Retail Bag'),
      row('Habitual 300g', 300, 300, 'Retail Bag'),
      row('Habitual 2kg', 2000, 2000, 'Retail Bag'),
      row('Habitual 250g', 250, 250, 'Retail Bag'),
    ]);
    expect(sorted.map((v) => v.product_name)).toEqual([
      'Habitual 250g',
      'Habitual 300g',
      'Habitual 1kg',
      'Habitual 2kg',
    ]);
  });

  it('places a case lot after its component by whole-case weight', () => {
    const sorted = sortVariantsByVolume([
      row('Am I Wrong Case', 3000, 3000, 'Case Lot'),
      row('Am I Wrong 250g', 250, 250, 'Retail Bag'),
    ]);
    expect(sorted.map((v) => v.product_name)).toEqual(['Am I Wrong 250g', 'Am I Wrong Case']);
  });

  it('breaks weight ties by packaging type then name', () => {
    const sorted = sortVariantsByVolume([
      row('Habitual 300g Tin', 300, 300, 'Tin'),
      row('Habitual 300g Retail', 300, 300, 'Retail Bag'),
    ]);
    expect(sorted.map((v) => v.product_name)).toEqual(['Habitual 300g Retail', 'Habitual 300g Tin']);
  });

  it('does not mutate the input array', () => {
    const input = [row('B 1kg', 1000, 1000), row('A 250g', 250, 250)];
    const sorted = sortVariantsByVolume(input);
    expect(input.map((v) => v.product_name)).toEqual(['B 1kg', 'A 250g']);
    expect(sorted.map((v) => v.product_name)).toEqual(['A 250g', 'B 1kg']);
  });
});
