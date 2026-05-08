import { useCallback, useEffect, useState } from 'react';
import type { ChangeMap } from './types';

const STORAGE_KEY = 'jim_bulk_edit_changes';
const TTL_MS = 24 * 60 * 60 * 1000;

function readStorage(): ChangeMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ChangeMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(map: ChangeMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage full or unavailable — ignore
  }
}

function pruneExpired(map: ChangeMap): ChangeMap {
  const cutoff = Date.now() - TTL_MS;
  const out: ChangeMap = {};
  for (const [tableKey, rows] of Object.entries(map)) {
    const newRows: Record<string, Record<string, { ts: number }>> = {};
    for (const [rowId, cols] of Object.entries(rows)) {
      const newCols: Record<string, { ts: number }> = {};
      for (const [colKey, entry] of Object.entries(cols)) {
        if (entry.ts >= cutoff) newCols[colKey] = entry;
      }
      if (Object.keys(newCols).length > 0) newRows[rowId] = newCols;
    }
    if (Object.keys(newRows).length > 0) out[tableKey] = newRows;
  }
  return out;
}

export function useChangeHighlights(tableKey: string) {
  const [highlights, setHighlights] = useState<Record<string, Record<string, { ts: number }>>>(() => {
    const all = pruneExpired(readStorage());
    writeStorage(all);
    return all[tableKey] ?? {};
  });

  const persist = useCallback((next: Record<string, Record<string, { ts: number }>>) => {
    const all = pruneExpired(readStorage());
    if (Object.keys(next).length === 0) {
      delete all[tableKey];
    } else {
      all[tableKey] = next;
    }
    writeStorage(all);
    setHighlights(next);
  }, [tableKey]);

  const markChanged = useCallback((rowId: string, colKey: string) => {
    setHighlights((prev) => {
      const next = { ...prev };
      next[rowId] = { ...(prev[rowId] ?? {}), [colKey]: { ts: Date.now() } };
      const all = pruneExpired(readStorage());
      all[tableKey] = next;
      writeStorage(all);
      return next;
    });
  }, [tableKey]);

  const clearHighlight = useCallback((rowId: string, colKey: string) => {
    setHighlights((prev) => {
      const rowCols = prev[rowId];
      if (!rowCols || !(colKey in rowCols)) return prev;
      const newRowCols = { ...rowCols };
      delete newRowCols[colKey];
      const next = { ...prev };
      if (Object.keys(newRowCols).length === 0) delete next[rowId];
      else next[rowId] = newRowCols;
      const all = pruneExpired(readStorage());
      if (Object.keys(next).length === 0) delete all[tableKey];
      else all[tableKey] = next;
      writeStorage(all);
      return next;
    });
  }, [tableKey]);

  const clearAll = useCallback(() => {
    persist({});
  }, [persist]);

  const isHighlighted = useCallback((rowId: string, colKey: string) => {
    return Boolean(highlights[rowId]?.[colKey]);
  }, [highlights]);

  // TTL check on mount happens automatically via pruneExpired in initialiser

  return { isHighlighted, markChanged, clearHighlight, clearAll };
}

export function clearAllBulkEditHighlights() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useBulkEditLogoutCleanup(userId: string | undefined) {
  useEffect(() => {
    if (!userId) {
      clearAllBulkEditHighlights();
    }
  }, [userId]);
}
