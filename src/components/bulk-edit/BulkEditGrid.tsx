import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, Undo2, Upload, X } from 'lucide-react';

import { toast } from 'sonner';
import { EditableCell } from './cells/EditableCell';
import { useChangeHighlights } from './useChangeHighlights';
import { useUndoStack } from './useUndoStack';
import { exportRowsToCsv } from './csv';
import { parseCsv } from '@/lib/csvParse';
import type { ColumnDef, SaveResult } from './types';

interface GroupConfig<TRow> {
  getGroupKey: (row: TRow) => string;
  getGroupLabel: (key: string, rows: TRow[]) => string;
}

interface Props<TRow> {
  tableKey: string;
  title: string;
  columns: ColumnDef<TRow>[];
  rows: TRow[];
  isLoading?: boolean;
  getRowId: (row: TRow) => string;
  onCellSave: (row: TRow, column: ColumnDef<TRow>, newValue: unknown) => Promise<SaveResult>;
  onClose: () => void;
  group?: GroupConfig<TRow>;
  csvFilename?: string;
}

export function BulkEditGrid<TRow>({
  tableKey,
  title,
  columns,
  rows,
  isLoading,
  getRowId,
  onCellSave,
  onClose,
  group,
  csvFilename,
}: Props<TRow>) {
  const { isHighlighted, markChanged, clearHighlight } = useChangeHighlights(tableKey);
  const undo = useUndoStack();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const initializedCollapseRef = useRef(false);
  const undoingRef = useRef(false);

  const grouped = useMemo(() => {
    if (!group) return [{ key: '__all__', label: '', rows }];
    const map = new Map<string, TRow[]>();
    for (const row of rows) {
      const k = group.getGroupKey(row);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(row);
    }
    return [...map.entries()]
      .map(([key, groupRows]) => ({ key, label: group.getGroupLabel(key, groupRows), rows: groupRows }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, group]);

  // Default to all groups collapsed once data first loads.
  useEffect(() => {
    if (!group) return;
    if (initializedCollapseRef.current) return;
    if (grouped.length === 0) return;
    setCollapsedGroups(new Set(grouped.map((g) => g.key)));
    initializedCollapseRef.current = true;
  }, [group, grouped]);

  const allCollapsed = group ? grouped.length > 0 && grouped.every((g) => collapsedGroups.has(g.key)) : false;
  const toggleAllGroups = () => {
    if (allCollapsed) setCollapsedGroups(new Set());
    else setCollapsedGroups(new Set(grouped.map((g) => g.key)));
  };


  const [savedCount, setSavedCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savingCount, setSavingCount] = useState(0);

  const handleSave = async (row: TRow, col: ColumnDef<TRow>, newValue: unknown): Promise<SaveResult> => {
    const prevValue = col.getValue(row);
    setSavingCount((c) => c + 1);
    try {
      const result = await onCellSave(row, col, newValue);
      if (result.success) {
        const rowId = getRowId(row);
        markChanged(rowId, col.key);
        if (!undoingRef.current) {
          undo.push({ rowId, colKey: col.key, prevValue });
        }
        setSavedCount((c) => c + 1);
        setLastSavedAt(new Date());
      }
      return result;
    } finally {
      setSavingCount((c) => Math.max(0, c - 1));
    }
  };


  const handleUndo = async () => {
    const last = undo.pop();
    if (!last) return;
    const targetRow = rows.find((r) => getRowId(r) === last.rowId);
    const targetCol = columns.find((c) => c.key === last.colKey);
    if (!targetRow || !targetCol) {
      toast.error('Could not locate row/column to undo');
      return;
    }
    undoingRef.current = true;
    try {
      const result = await onCellSave(targetRow, targetCol, last.prevValue);
      if (result.success) {
        clearHighlight(last.rowId, last.colKey);
        toast.success('Undone');
      } else {
        toast.error(result.errorMessage ?? 'Undo failed');
        undo.push(last);
      }
    } finally {
      undoingRef.current = false;
    }
  };

  const handleExport = () => {
    if (!csvFilename) return;
    exportRowsToCsv(rows, columns, getRowId, csvFilename);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const normalize = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    const s = String(v).trim();
    // Treat boolean-like strings case-insensitively so Excel's TRUE/FALSE
    // doesn't get treated as a change against our exported "true"/"false".
    if (/^(true|false)$/i.test(s)) return s.toLowerCase();
    return s;
  };


  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { header, rows: csvRows } = parseCsv(text);
      if (!header.length || header[0] !== '__row_id') {
        toast.error('CSV must include the __row_id column from Export CSV.');
        return;
      }
      const colByKey = new Map(columns.map((c) => [c.key, c]));
      const rowById = new Map(rows.map((r) => [getRowId(r), r]));
      const headerColIdx: { key: string; idx: number }[] = [];
      for (let i = 1; i < header.length; i++) {
        const col = colByKey.get(header[i]);
        if (col && !col.readOnly) headerColIdx.push({ key: header[i], idx: i });
      }

      let changed = 0;
      let succeeded = 0;
      let failed = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const csvRow of csvRows) {
        const rowId = csvRow[0];
        const row = rowById.get(rowId);
        if (!row) { skipped++; continue; }
        for (const { key, idx } of headerColIdx) {
          const col = colByKey.get(key)!;
          const newRaw = csvRow[idx] ?? '';
          const currentNorm = normalize(col.getValue(row));
          const newNorm = normalize(newRaw);
          if (currentNorm === newNorm) continue;
          if (newNorm === '' && !col.allowEmpty) { skipped++; continue; }
          changed++;
          const newValue: unknown = newNorm === '' ? null : newRaw;
          const result = await handleSave(row, col, newValue);
          if (result.success) succeeded++;
          else {
            failed++;
            if (errors.length < 5) errors.push(`${rowId.slice(0, 8)}/${key}: ${result.errorMessage ?? 'failed'}`);
          }
        }
      }

      if (changed === 0) {
        toast.info('No changes detected in CSV.');
      } else if (failed === 0) {
        toast.success(`Imported ${succeeded} change${succeeded !== 1 ? 's' : ''}.`);
      } else {
        toast.error(`Imported ${succeeded}; ${failed} failed. ${errors.join('; ')}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const totalCols = columns.length;

  return (
    <div className="border rounded-md bg-background">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">{title}</h3>
          <span className="text-xs text-muted-foreground">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {group && grouped.length > 0 && (
            <Button variant="outline" size="sm" onClick={toggleAllGroups} className="h-7 text-xs gap-1">
              {allCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleUndo} disabled={undo.size === 0} className="h-7 text-xs gap-1">
            <Undo2 className="h-3.5 w-3.5" /> Undo last change ({undo.size})
          </Button>

          {csvFilename && (
            <>
              <Button variant="outline" size="sm" onClick={handleExport} className="h-7 text-xs gap-1">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportClick} disabled={importing} className="h-7 text-xs gap-1">
                <Upload className="h-3.5 w-3.5" /> {importing ? 'Importing…' : 'Import CSV'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleImportFile}
              />
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs gap-1">
            <X className="h-3.5 w-3.5" /> Close
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-background z-10">
            <tr className="border-b">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-2 py-1.5 text-left font-medium text-muted-foreground border-r last:border-r-0 whitespace-nowrap"
                  style={{ width: col.width }}
                >
                  {col.header}
                  {col.readOnly && <span className="ml-1 text-[10px] opacity-60">(read-only)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={totalCols} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={totalCols} className="p-4 text-center text-muted-foreground">No rows.</td></tr>
            ) : (
              grouped.map((g) => {
                const collapsed = collapsedGroups.has(g.key);
                return (
                  <React.Fragment key={g.key}>
                    {group && (
                      <tr
                        className="bg-muted/50 border-b cursor-pointer hover:bg-muted"
                        onClick={() => toggleGroup(g.key)}
                      >
                        <td colSpan={totalCols} className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            <span className="font-semibold">{g.label}</span>
                            <span className="text-muted-foreground">({g.rows.length})</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {!collapsed &&
                      g.rows.map((row) => {
                        const rowId = getRowId(row);
                        return (
                          <tr key={rowId} className="border-b hover:bg-accent/20">
                            {columns.map((col) => (
                              <EditableCell
                                key={col.key}
                                row={row}
                                column={col}
                                isHighlighted={isHighlighted(rowId, col.key)}
                                onSave={(v) => handleSave(row, col, v)}
                              />
                            ))}
                          </tr>
                        );
                      })}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
