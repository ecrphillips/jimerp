import { describe, it, expect } from 'vitest';
import { PACKAGING_GRAMS, gramsForVariant } from './packagingWeights';
import { PACKAGING_OPTIONS } from '@/components/PackagingBadge';
import { findPackSpeedBand, type PackSpeedBand } from './pricingAssumptions';

// The bands as seeded by the pricing_assumptions migration.
const SEEDED_BANDS: PackSpeedBand[] = [
  { id: '1', label: 'Up to 454g (1 lb)', min_g: 0, max_g: 454, units_per_hour: 1, display_order: 1 },
  { id: '2', label: '455g - 1135g (2.5 lb)', min_g: 455, max_g: 1135, units_per_hour: 1, display_order: 2 },
  { id: '3', label: '1136g - 2270g (5 lb)', min_g: 1136, max_g: 2270, units_per_hour: 1, display_order: 3 },
  { id: '4', label: 'Over 2270g', min_g: 2271, max_g: null, units_per_hour: 1, display_order: 4 },
];

describe('packaging weights', () => {
  it('covers every variant the app offers', () => {
    for (const opt of PACKAGING_OPTIONS) {
      expect(PACKAGING_GRAMS[opt.value], opt.value).toBeGreaterThan(0);
    }
  });

  it('converts imperial variants from pounds rather than guessing', () => {
    expect(PACKAGING_GRAMS.BULK_2LB).toBe(907);
    expect(PACKAGING_GRAMS.BULK_5LB).toBe(2268);
    expect(PACKAGING_GRAMS.RETAIL_454G).toBe(454);
  });

  it('places every variant in exactly one seeded packing band', () => {
    for (const opt of PACKAGING_OPTIONS) {
      const grams = PACKAGING_GRAMS[opt.value];
      const matches = SEEDED_BANDS.filter(
        (b) => grams >= b.min_g && (b.max_g == null || grams <= b.max_g),
      );
      expect(matches, `${opt.value} (${grams}g) matched ${matches.length} bands`).toHaveLength(1);
    }
  });

  it('keeps the 5lb bulk bag inside the top bounded band', () => {
    // 2268g sits just under the 2270g boundary; a rounding slip would push it
    // into the open-ended band and change its packing cost.
    expect(findPackSpeedBand(SEEDED_BANDS, PACKAGING_GRAMS.BULK_5LB)?.label).toBe(
      '1136g - 2270g (5 lb)',
    );
  });

  it('returns null for an unset variant rather than a default weight', () => {
    expect(gramsForVariant(null)).toBeNull();
    expect(gramsForVariant(undefined)).toBeNull();
  });
});
