import { describe, it, expect } from 'vitest';
import { isProductionDayToday } from './productionScheduling';

// Reference calendar: 2026-06-10 is a Wednesday (getDay()===3),
// 2026-06-11 Thursday (4), 2026-06-12 Friday (5).
// `fromTime` is treated as a Vancouver wall-clock Date.
describe('isProductionDayToday', () => {
  it('returns false when no production days configured', () => {
    expect(isProductionDayToday(null, new Date(2026, 5, 10, 9, 0))).toBe(false);
    expect(isProductionDayToday([], new Date(2026, 5, 10, 9, 0))).toBe(false);
  });

  it('is true when today is a production day (Wed in Mon/Wed/Fri)', () => {
    const wed = new Date(2026, 5, 10, 9, 0);
    expect(isProductionDayToday([1, 3, 5], wed)).toBe(true);
  });

  it('is false when today is not a production day (Thu in Mon/Wed/Fri)', () => {
    const thu = new Date(2026, 5, 11, 9, 0);
    expect(isProductionDayToday([1, 3, 5], thu)).toBe(false);
  });

  it('ignores out-of-range weekday values', () => {
    const wed = new Date(2026, 5, 10, 9, 0);
    expect(isProductionDayToday([9, 12], wed)).toBe(false);
  });
});
