import { describe, it, expect } from 'vitest';
import { parseDateOnly } from './dateOnly';

describe('parseDateOnly', () => {
  it('parses YYYY-MM-DD as local midnight', () => {
    const d = parseDateOnly('2026-05-13')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(13);
    expect(d.getHours()).toBe(0);
  });

  it('accepts YYYY-MM-DDT... and ignores time', () => {
    const d = parseDateOnly('2026-05-13T23:59:59Z')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(13);
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
    expect(parseDateOnly('')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseDateOnly('not-a-date')).toBeNull();
  });
});
