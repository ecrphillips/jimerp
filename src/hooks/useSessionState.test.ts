import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionState } from './useSessionState';

describe('state that survives navigation', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts from the initial value when nothing is stored', () => {
    const { result } = renderHook(() => useSessionState('k', { a: 1 }));
    expect(result.current[0]).toEqual({ a: 1 });
  });

  it('restores what a previous mount left behind', () => {
    const first = renderHook(() => useSessionState('k', 0));
    act(() => first.result.current[1](42));
    first.unmount();

    // A fresh mount is what a route change back to the page produces.
    const second = renderHook(() => useSessionState('k', 0));
    expect(second.result.current[0]).toBe(42);
  });

  it('does not overwrite stored state on the first render', () => {
    sessionStorage.setItem('k', JSON.stringify('stored'));
    const { result } = renderHook(() => useSessionState('k', 'initial'));
    expect(result.current[0]).toBe('stored');
    expect(sessionStorage.getItem('k')).toBe(JSON.stringify('stored'));
  });

  it('keeps separate keys apart', () => {
    const a = renderHook(() => useSessionState('a', 'x'));
    act(() => a.result.current[1]('changed'));
    const b = renderHook(() => useSessionState('b', 'y'));
    expect(b.result.current[0]).toBe('y');
  });

  it('handles nested structures, not just scalars', () => {
    const rows = [{ id: '1', label: 'Line 1' }];
    const first = renderHook(() => useSessionState<typeof rows>('rows', []));
    act(() => first.result.current[1](rows));
    first.unmount();
    const second = renderHook(() => useSessionState<typeof rows>('rows', []));
    expect(second.result.current[0]).toEqual(rows);
  });

  it('accepts an updater function like useState does', () => {
    const { result } = renderHook(() => useSessionState('k', 1));
    act(() => result.current[1]((n) => n + 1));
    expect(result.current[0]).toBe(2);
  });
});

describe('clearing', () => {
  beforeEach(() => sessionStorage.clear());

  it('resets to the initial value and forgets the stored one', () => {
    const first = renderHook(() => useSessionState('k', 'start'));
    act(() => first.result.current[1]('edited'));
    act(() => first.result.current[2]());

    expect(first.result.current[0]).toBe('start');
    expect(sessionStorage.getItem('k')).toBeNull();
  });

  it('stays cleared across a remount', () => {
    const first = renderHook(() => useSessionState('k', 'start'));
    act(() => first.result.current[1]('edited'));
    act(() => first.result.current[2]());
    first.unmount();

    const second = renderHook(() => useSessionState('k', 'start'));
    expect(second.result.current[0]).toBe('start');
  });
});

describe('storage that misbehaves never takes the page down', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('falls back to the initial value on unparseable stored data', () => {
    sessionStorage.setItem('k', '{not json');
    const { result } = renderHook(() => useSessionState('k', 'safe'));
    expect(result.current[0]).toBe('safe');
  });

  it('survives a getItem that throws, as private browsing can', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useSessionState('k', 'safe'));
    expect(result.current[0]).toBe('safe');
  });

  it('keeps working when setItem throws on quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useSessionState('k', 0));
    act(() => result.current[1](7));
    // Persistence is lost; the value is still usable for this mount.
    expect(result.current[0]).toBe(7);
  });
});
