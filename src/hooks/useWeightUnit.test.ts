import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWeightUnit, WEIGHT_UNIT_KEY } from './useWeightUnit';
import { KG_PER_LB } from '@/lib/pricingAssumptions';

describe('the weight unit preference', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('defaults to kilograms, which stay canonical', () => {
    const { result } = renderHook(() => useWeightUnit());
    expect(result.current.unit).toBe('KG');
  });

  it('outlives the tab, unlike the sheet itself', () => {
    const first = renderHook(() => useWeightUnit());
    act(() => first.result.current.setUnit('LB'));
    first.unmount();
    expect(localStorage.getItem(WEIGHT_UNIT_KEY)).toBe(JSON.stringify('LB'));
    // and is not kept with the working state
    expect(sessionStorage.getItem(WEIGHT_UNIT_KEY)).toBeNull();

    const second = renderHook(() => useWeightUnit());
    expect(second.result.current.unit).toBe('LB');
  });
});

describe('rates convert the way money does', () => {
  beforeEach(() => localStorage.clear());

  it('leaves rates alone in kilograms', () => {
    const { result } = renderHook(() => useWeightUnit());
    expect(result.current.rateToDisplay(18)).toBe(18);
    expect(result.current.rateFromDisplay(18)).toBe(18);
  });

  it('makes a per-kilogram rate smaller per pound', () => {
    const { result } = renderHook(() => useWeightUnit());
    act(() => result.current.setUnit('LB'));
    // $18/kg is about $8.16/lb — a pound is less coffee, so it costs less.
    expect(result.current.rateToDisplay(18)).toBeCloseTo(18 * KG_PER_LB, 6);
  });

  it('round-trips a rate through both directions', () => {
    const { result } = renderHook(() => useWeightUnit());
    act(() => result.current.setUnit('LB'));
    const there = result.current.rateToDisplay(18);
    expect(result.current.rateFromDisplay(there)).toBeCloseTo(18, 9);
  });
});

describe('weights convert the opposite way to rates', () => {
  beforeEach(() => localStorage.clear());

  it('makes a kilogram figure larger in pounds', () => {
    const { result } = renderHook(() => useWeightUnit());
    act(() => result.current.setUnit('LB'));
    // 100 kg is about 220 lb — the same coffee, counted in smaller units.
    expect(result.current.weightToDisplay(100)).toBeCloseTo(100 / KG_PER_LB, 6);
  });

  it('round-trips a weight through both directions', () => {
    const { result } = renderHook(() => useWeightUnit());
    act(() => result.current.setUnit('LB'));
    const there = result.current.weightToDisplay(500);
    expect(result.current.weightFromDisplay(there)).toBeCloseTo(500, 9);
  });

  it('moves rates and weights in opposite directions', () => {
    // The classic way to get this wrong is to convert both the same way.
    const { result } = renderHook(() => useWeightUnit());
    act(() => result.current.setUnit('LB'));
    expect(result.current.rateToDisplay(10)).toBeLessThan(10);
    expect(result.current.weightToDisplay(10)).toBeGreaterThan(10);
  });
});

describe('labels follow the unit', () => {
  beforeEach(() => localStorage.clear());

  it('names the unit for use in labels', () => {
    const { result } = renderHook(() => useWeightUnit());
    expect(result.current.suffix).toBe('kg');
    expect(result.current.greenSuffix).toBe('green kg');
    act(() => result.current.setUnit('LB'));
    expect(result.current.suffix).toBe('lb');
    expect(result.current.greenSuffix).toBe('green lb');
  });
});
