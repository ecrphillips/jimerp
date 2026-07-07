import type { PostgrestError } from '@supabase/supabase-js';

/**
 * PostgREST (and therefore Supabase) caps every response at a fixed number of
 * rows — 1000 by default — and returns a *truncated* result with NO error when a
 * query matches more. Any code that fetches an entire growing table and then sums
 * or filters it in the browser silently starts returning wrong answers the moment
 * the table crosses that cap. For the inventory ledger this is not just a display
 * bug: a truncated balance is written back into the ledger as a floor-count
 * "correction", permanently corrupting the books.
 *
 * `fetchAllRows` removes the cap by paging: it re-issues the query with an
 * advancing `.range()` window until a short page comes back, then concatenates
 * every page. Callers pass a factory that builds a FRESH query for each page
 * (a Supabase query builder is single-use and cannot be re-awaited), and MUST
 * apply a stable `.order()` inside it so page boundaries don't shift between
 * requests. Ordering by a unique column (e.g. the primary key) is safest.
 *
 * This bounds the fetch correctly but still transfers every row; where the table
 * is large and only an aggregate is needed, a server-side SUM/aggregate is the
 * better long-term shape. This helper is the correctness fix, not the perf fix.
 */

const DEFAULT_PAGE_SIZE = 1000;
// Backstop against an infinite loop if a page never shrinks (should never happen
// for a finite table, but protects against a misbuilt query).
const MAX_PAGES = 10_000;

type PageResult<T> = { data: T[] | null; error: PostgrestError | null };

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    // A page shorter than the requested window means we've reached the end.
    if (rows.length < pageSize) return all;
    from += pageSize;
  }

  return all;
}
