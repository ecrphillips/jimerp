import { describe, it, expect, vi } from 'vitest';
import { fetchAllRows } from './fetchAllRows';

/** Build a fake paged source of `total` rows that honours the [from,to] window. */
function pagedSource(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, to + 1),
    error: null,
  }));
}

describe('fetchAllRows', () => {
  it('returns every row across multiple pages', async () => {
    const src = pagedSource(2500);
    const all = await fetchAllRows(src, 1000);
    expect(all).toHaveLength(2500);
    expect(all[0]).toEqual({ id: 0 });
    expect(all[2499]).toEqual({ id: 2499 });
    // 1000, 1000, 500 -> the short third page ends the loop.
    expect(src).toHaveBeenCalledTimes(3);
  });

  it('stops after one page when the first page is short', async () => {
    const src = pagedSource(42);
    const all = await fetchAllRows(src, 1000);
    expect(all).toHaveLength(42);
    expect(src).toHaveBeenCalledTimes(1);
  });

  it('makes a second (empty) request when the total is an exact multiple of the page size', async () => {
    const src = pagedSource(2000);
    const all = await fetchAllRows(src, 1000);
    expect(all).toHaveLength(2000);
    // 1000, 1000, then a 0-length page to learn there are no more.
    expect(src).toHaveBeenCalledTimes(3);
  });

  it('returns an empty array when there are no rows', async () => {
    const src = pagedSource(0);
    const all = await fetchAllRows(src, 1000);
    expect(all).toEqual([]);
    expect(src).toHaveBeenCalledTimes(1);
  });

  it('throws when a page returns an error', async () => {
    const src = vi.fn(async () => ({ data: null, error: { message: 'boom' } as any }));
    await expect(fetchAllRows(src, 1000)).rejects.toEqual({ message: 'boom' });
  });

  it('treats a null data page as empty and stops', async () => {
    const src = vi.fn(async () => ({ data: null, error: null }));
    const all = await fetchAllRows(src, 1000);
    expect(all).toEqual([]);
    expect(src).toHaveBeenCalledTimes(1);
  });
});
