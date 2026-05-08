import React, { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Download, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { EditableCell } from './cells/EditableCell';
import { useChangeHighlights } from './useChangeHighlights';
import { useUndoStack } from './useUndoStack';
import { exportRowsToCsv } from './csv';
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

  const handleSave = async (row: TRow, col: ColumnDef<TRow>, newValue: unknown): Promise<SaveResult> => {
    const prevValue = col.getValue(row);
    const result = await onCellSave(row, col, newValue);
    if (result.success) {
      const rowId = getRowId(row);
      markChanged(rowId, col.key);
      if (!undoingRef.current) {
        undo.push({ rowId, colKey: col.key, prevValue });
      }
    }
    return result;
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
          <Button variant="outline" size="sm" onClick={handleUndo} disabled={undo.size === 0} className="h-7 text-xs gap-1">
            <Undo2 className="h-3.5 w-3.5" /> Undo last change ({undo.size})
          </Button>
          {csvFilename && (
            <Button variant="outline" size="sm" onClick={handleExport} className="h-7 text-xs gap-1">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
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
