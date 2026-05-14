import { useCallback, useMemo, useState } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import type { PostgrestError } from '@supabase/supabase-js';

export interface PaginatedPage<T> {
  rows: T[];
  nextOffset: number | null;
  totalEstimate?: number | null;
}

export interface UsePaginatedQueryOptions<T> {
  queryKey: QueryKey;
  pageSize?: number;
  fetchPage: (params: { offset: number; limit: number }) => Promise<{
    rows: T[];
    count?: number | null;
  }>;
  enabled?: boolean;
}

export interface UsePaginatedQueryResult<T> {
  rows: T[];
  isLoading: boolean;
  isFetching: boolean;
  error: PostgrestError | Error | null;
  hasMore: boolean;
  loadMore: () => void;
  reset: () => void;
  total: number | null;
  pageSize: number;
  loadedCount: number;
  refetch: () => Promise<unknown>;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Offset-cursor pagination for Supabase list queries.
 *
 * The caller supplies `fetchPage({ offset, limit })`. The hook tracks `limit`
 * locally and grows it by `pageSize` on `loadMore`. We use a single growing
 * window (rather than a stack of pages) so the rendered list stays a simple
 * flat array and stable sort/filter logic in the page component does not need
 * to merge page boundaries.
 */
export function usePaginatedQuery<T>({
  queryKey,
  pageSize = DEFAULT_PAGE_SIZE,
  fetchPage,
  enabled = true,
}: UsePaginatedQueryOptions<T>): UsePaginatedQueryResult<T> {
  const [limit, setLimit] = useState(pageSize);

  const effectiveKey = useMemo(() => [...queryKey, { limit }], [queryKey, limit]);

  const query = useQuery({
    queryKey: effectiveKey,
    queryFn: () => fetchPage({ offset: 0, limit }),
    enabled,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? null;
  const loadedCount = rows.length;
  const hasMore =
    total !== null && total !== undefined
      ? loadedCount < total
      : loadedCount >= limit;

  const loadMore = useCallback(() => {
    setLimit((prev) => prev + pageSize);
  }, [pageSize]);

  const reset = useCallback(() => {
    setLimit(pageSize);
  }, [pageSize]);

  return {
    rows,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as PostgrestError | Error | null) ?? null,
    hasMore,
    loadMore,
    reset,
    total,
    pageSize,
    loadedCount,
    refetch: query.refetch,
  };
}
