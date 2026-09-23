import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScheduleLayers, layerAtX, laneStyle, facilityAsBookingRows, type FacilityBookingRow } from './scheduleLayers';
import { checkOverlap } from './bookingUtils';

describe('schedule layer toggles', () => {
  beforeEach(() => localStorage.clear());

  it('shows every layer the first time someone opens the schedule', () => {
    const { result } = renderHook(() => useScheduleLayers('k'));
    expect(result.current.visible).toEqual(['LORING', 'CUPPING_LAB', 'SAMPLE_ROASTER']);
  });

  it("remembers a viewer's choice across visits", () => {
    const first = renderHook(() => useScheduleLayers('k'));
    act(() => first.result.current.toggle('CUPPING_LAB'));
    first.unmount();

    const second = renderHook(() => useScheduleLayers('k'));
    expect(second.result.current.visible).toEqual(['LORING', 'SAMPLE_ROASTER']);
  });

  it('never lets the last layer be switched off (an empty calendar looks like a bug)', () => {
    const { result } = renderHook(() => useScheduleLayers('k'));
    act(() => result.current.toggle('LORING'));
    act(() => result.current.toggle('CUPPING_LAB'));
    act(() => result.current.toggle('SAMPLE_ROASTER'));
    expect(result.current.visible).toEqual(['SAMPLE_ROASTER']);
  });

  it('keeps a stable lane order when a layer is switched back on', () => {
    const { result } = renderHook(() => useScheduleLayers('k'));
    act(() => result.current.toggle('LORING'));
    act(() => result.current.toggle('LORING'));
    expect(result.current.visible[0]).toBe('LORING');
  });

  it('falls back to all layers when stored data is junk', () => {
    localStorage.setItem('k', '{not json');
    const { result } = renderHook(() => useScheduleLayers('k'));
    expect(result.current.visible).toHaveLength(3);
  });
});

describe('lanes', () => {
  // Clicking a lane decides which resource the booking dialog opens for.
  it('maps a click to the resource whose lane it landed in', () => {
    const visible = ['LORING', 'CUPPING_LAB', 'SAMPLE_ROASTER'] as const;
    expect(layerAtX(10, 300, [...visible])).toBe('LORING');
    expect(layerAtX(150, 300, [...visible])).toBe('CUPPING_LAB');
    expect(layerAtX(299, 300, [...visible])).toBe('SAMPLE_ROASTER');
  });

  it('gives a lone visible layer the full column width', () => {
    expect(layerAtX(290, 300, ['CUPPING_LAB'])).toBe('CUPPING_LAB');
    expect(laneStyle('CUPPING_LAB', ['CUPPING_LAB']).width).toBe('calc(100% - 2px)');
  });
});

describe('facility conflicts are per resource', () => {
  const lab: FacilityBookingRow = {
    id: 'a', account_id: 'x', resource: 'CUPPING_LAB', booking_date: '2026-10-01',
    start_time: '10:00', end_time: '11:00', status: 'CONFIRMED', notes_member: null,
  };

  it('rejects an overlapping booking on the same resource', () => {
    expect(checkOverlap('2026-10-01', '10:30', '11:30', [], facilityAsBookingRows([lab]))).not.toBeNull();
  });

  it('allows back-to-back bookings', () => {
    expect(checkOverlap('2026-10-01', '11:00', '12:00', [], facilityAsBookingRows([lab]))).toBeNull();
  });

  it('frees the slot once a booking is cancelled', () => {
    expect(checkOverlap('2026-10-01', '10:00', '11:00', [], facilityAsBookingRows([{ ...lab, status: 'CANCELLED' }]))).toBeNull();
  });
});
