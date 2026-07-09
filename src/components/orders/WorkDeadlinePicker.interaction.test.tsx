import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { WorkDeadlinePicker } from './WorkDeadlinePicker';

/**
 * Regression test for the "date picker needs two clicks" bug.
 *
 * Root cause: the prop->state sync effect used to depend on `hasInteracted`.
 * On the FIRST interaction, flipping hasInteracted false->true re-ran the sync
 * effect while the `value` prop still held the OLD value, so it overwrote the
 * date the user had just clicked. The first click was effectively "eaten".
 *
 * This test renders with a STATIC `value` prop (parent ignores onChange). That
 * is the purest reproduction: post-fix the sync effect no longer re-runs on
 * interaction, so a single click sticks. Pre-fix it would revert to the value
 * derived from the unchanged prop.
 */
describe('WorkDeadlinePicker single-click selection', () => {
  beforeEach(() => {
    // Freeze "today" to a Monday so past-date/weekend disabling is deterministic
    // and day 15 (a Wednesday) and day 20 (a Monday) are enabled future weekdays.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 13, 9, 0, 0)); // 2026-07-13 Mon, local
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function openCalendar() {
    // The date trigger button label is `format(selectedDate, 'MMM d')`
    // or the placeholder 'Date' when nothing is selected.
    const trigger = screen.getByRole('button', { name: /Jul|Date/ });
    fireEvent.click(trigger);
  }

  it('registers a new date on the first click (edit mode, static value)', () => {
    // Initial value: Mon 2026-07-13 noon Pacific — an enabled weekday.
    const initialIso = '2026-07-13T19:00:00.000Z';
    const onChange = vi.fn();

    render(
      <WorkDeadlinePicker
        value={initialIso}
        onChange={onChange}
        showSaveButton={false}
      />,
    );

    openCalendar();

    // Click day 15 (Wed 2026-07-15) — a single click.
    const grid = screen.getByRole('grid');
    const day15 = within(grid).getByRole('gridcell', { name: '15' });
    fireEvent.click(day15);

    // onChange fired with a NEW value on the first click...
    expect(onChange).toHaveBeenCalled();
    const emitted = onChange.mock.calls.at(-1)?.[0] as string;
    expect(emitted).not.toBe(initialIso);

    // ...and the displayed readout reflects the clicked day (Jul 15), not the
    // old Jul 13. Pre-fix this reverted to Jul 13 (the "eaten first click").
    expect(screen.getByText(/Deadline: .*Jul 15/)).toBeTruthy();
    expect(screen.queryByText(/Deadline: .*Jul 13/)).toBeNull();
  });
});
