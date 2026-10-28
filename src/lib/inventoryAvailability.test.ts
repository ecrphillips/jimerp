import { describe, expect, it } from 'vitest';
import { availableWipKg } from './inventoryAvailability';

describe('availableWipKg', () => {
  it('treats a rounding remainder shown as 0.0 kg as unavailable', () => {
    expect(availableWipKg(0.0000001)).toBe(0);
    expect(availableWipKg(0.04)).toBe(0);
  });
  it('keeps stock shown as at least 0.1 kg', () => {
    expect(availableWipKg(0.05)).toBe(0.05);
  });
  it('subtracts stock held for blending', () => {
    expect(availableWipKg(10, 10)).toBe(0);
    expect(availableWipKg(10, 4)).toBe(6);
  });
});
import { isNegativeBalance } from './inventoryAvailability';
import { describe as d2, it as i2, expect as e2 } from 'vitest';
d2('isNegativeBalance', () => {
  i2('flags real negatives, ignores rounding residue', () => {
    e2(isNegativeBalance(-8.4)).toBe(true);
    e2(isNegativeBalance(-0.0000001)).toBe(false);
    e2(isNegativeBalance(0)).toBe(false);
    e2(isNegativeBalance(-1, 1)).toBe(true);
  });
});
