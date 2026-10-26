import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FGCountInput } from './FGCountInput';

afterEach(cleanup);

describe('FG count entry', () => {
  it('saves the complete count once, not each typed digit', () => {
    const onCount = vi.fn();
    render(<FGCountInput units={0} productName="Coffee" disabled={false} onCount={onCount} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '23' } });
    expect(onCount).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCount).toHaveBeenCalledExactlyOnceWith(23);
    fireEvent.blur(input);
    expect(onCount).toHaveBeenCalledTimes(1);
  });

  it('does not turn a cleared field into an unintended zero count', () => {
    const onCount = vi.fn();
    render(<FGCountInput units={12} productName="Coffee" disabled={false} onCount={onCount} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCount).not.toHaveBeenCalled();
    expect(input).toHaveValue('12');
  });
});