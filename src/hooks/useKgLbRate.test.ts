import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKgLbRate } from './useKgLbRate';
import { KG_PER_LB } from '@/lib/pricingAssumptions';

/**
 * Regression test for "the per-lb box only accepts one digit".
 *
 * Root cause: the lb field's value was derived from the kg state and
 * re-formatted with toFixed(2) on every render. Typing "5" converted to kg,
 * stored it, and re-rendered the lb box as "5.00" — cursor stranded, decimals
 * unreachable, leaving the arrow keys as the only way to change it.
 *
 * The fix is that each field holds its own text and only ever writes the other.
 */
describe('typing is never interrupted by the other unit', () => {
  it('keeps exactly what was typed in the pound box', () => {
    const { result } = renderHook(() => useKgLbRate());

    // Character by character, as someone typing "5.25" would produce.
    for (const partial of ['5', '5.', '5.2', '5.25']) {
      act(() => result.current.setLb(partial));
      expect(result.current.lbText).toBe(partial);
    }
  });

  it('does not reformat a whole number into decimals mid-type', () => {
    const { result } = renderHook(() => useKgLbRate());
    act(() => result.current.setLb('5'));
    // Pre-fix this became "5.00" and the next keystroke could not land.
    expect(result.current.lbText).toBe('5');
  });

  it('keeps exactly what was typed in the kilogram box', () => {
    const { result } = renderHook(() => useKgLbRate());
    for (const partial of ['1', '11', '11.', '11.5']) {
      act(() => result.current.setKg(partial));
      expect(result.current.kgText).toBe(partial);
    }
  });

  it('tolerates a lone decimal point without wiping the field', () => {
    const { result } = renderHook(() => useKgLbRate());
    act(() => result.current.setLb('.'));
    expect(result.current.lbText).toBe('.');
    expect(result.current.perKg).toBeNull();
  });
});

describe('the two units stay in step', () => {
  it('fills kilograms when pounds are typed', () => {
    const { result } = renderHook(() => useKgLbRate());
    act(() => result.current.setLb('5.25'));
    expect(result.current.perKg).toBeCloseTo(5.25 / KG_PER_LB, 4);
  });

  it('fills pounds when kilograms are typed', () => {
    const { result } = renderHook(() => useKgLbRate());
    act(() => result.current.setKg('18'));
    expect(Number(result.current.lbText)).toBeCloseTo(18 * KG_PER_LB, 4);
  });

  it('round-trips a pound figure back to itself', () => {
    const { result } = renderHook(() => useKgLbRate());
    act(() => result.current.setLb('5.25'));
    const kg = result.current.kgText;
    act(() => result.current.setKg(kg));
    expect(Number(result.current.lbText)).toBeCloseTo(5.25, 4);
  });

  it('clears the other box when one is emptied', () => {
    const { result } = renderHook(() => useKgLbRate());
    act(() => result.current.setLb('5.25'));
    act(() => result.current.setLb(''));
    expect(result.current.kgText).toBe('');
    expect(result.current.perKg).toBeNull();
  });

  it('seeds both boxes from an initial rate', () => {
    const { result } = renderHook(() => useKgLbRate('18'));
    expect(result.current.kgText).toBe('18');
    expect(Number(result.current.lbText)).toBeCloseTo(18 * KG_PER_LB, 4);
  });

  it('reports no rate until something parses', () => {
    const { result } = renderHook(() => useKgLbRate());
    expect(result.current.perKg).toBeNull();
    act(() => result.current.setKg('abc'));
    expect(result.current.perKg).toBeNull();
  });
});
