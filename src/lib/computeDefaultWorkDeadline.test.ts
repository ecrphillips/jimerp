import { describe, it, expect } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { computeDefaultWorkDeadline, TIMEZONE } from './productionScheduling';

// Helper: format an ISO-UTC result back to Vancouver wall-clock for assertions.
const vct = (iso: string | null) =>
  iso ? formatInTimeZone(new Date(iso), TIMEZONE, 'yyyy-MM-dd HH:mm') : null;

// Reference calendar (verified): 2026-06-08 Mon, 06-09 Tue, 06-10 Wed,
// 06-11 Thu, 06-12 Fri, 06-15 Mon. `fromTime` is treated as a Vancouver
// wall-clock Date by the function.
describe('computeDefaultWorkDeadline', () => {
  it('returns null when no production days configured', () => {
    expect(computeDefaultWorkDeadline(null)).toBeNull();
    expect(computeDefaultWorkDeadline([])).toBeNull();
  });

  // FUNK: produces Mon (1) + Thu (4), noon cutoff.
  it('rolls a Wednesday order forward to Thursday noon', () => {
    const wed = new Date(2026, 5, 10, 9, 0); // Wed 09:00
    expect(vct(computeDefaultWorkDeadline([1, 4], 12, wed))).toBe('2026-06-11 12:00');
  });

  it('keeps a Thursday order before noon on that Thursday', () => {
    const thuAm = new Date(2026, 5, 11, 9, 0); // Thu 09:00 (a production day)
    expect(vct(computeDefaultWorkDeadline([1, 4], 12, thuAm))).toBe('2026-06-11 12:00');
  });

  it('rolls a Thursday order at/after noon to the next production day (Mon)', () => {
    const thuPm = new Date(2026, 5, 11, 13, 0); // Thu 13:00, past cutoff
    expect(vct(computeDefaultWorkDeadline([1, 4], 12, thuPm))).toBe('2026-06-15 12:00');
  });

  it('rolls a Friday order to the next Monday', () => {
    const fri = new Date(2026, 5, 12, 10, 0); // Fri 10:00
    expect(vct(computeDefaultWorkDeadline([1, 4], 12, fri))).toBe('2026-06-15 12:00');
  });

  // Oldhand: single standard day, Tuesday (2).
  it('keeps a same-day Tuesday order before cutoff', () => {
    const tueAm = new Date(2026, 5, 9, 8, 30); // Tue 08:30
    expect(vct(computeDefaultWorkDeadline([2], 12, tueAm))).toBe('2026-06-09 12:00');
  });

  it('rolls a Tuesday order past cutoff to the following Tuesday', () => {
    const tuePm = new Date(2026, 5, 9, 12, 0); // Tue 12:00 — at cutoff counts as past
    expect(vct(computeDefaultWorkDeadline([2], 12, tuePm))).toBe('2026-06-16 12:00');
  });

  it('honors a non-default cutoff hour', () => {
    const tueAm = new Date(2026, 5, 9, 8, 30);
    expect(vct(computeDefaultWorkDeadline([2], 14, tueAm))).toBe('2026-06-09 14:00');
  });
});
