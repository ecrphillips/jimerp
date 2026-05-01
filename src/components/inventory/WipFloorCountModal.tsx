import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Printer, Copy, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  saveWipAdjustment,
  WIP_ADJUSTMENT_QUERY_KEYS,
  type WipAdjustmentReason,
} from '@/lib/wipAdjustments';

export interface WipFloorRow {
  roast_group: string;
  display_name: string;
  current_kg: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rows: WipFloorRow[];
}

const REASON_OPTIONS: { value: WipAdjustmentReason; label: string }[] = [
  { value: 'RECOUNT', label: 'Recount' },
  { value: 'COUNT_ADJUSTMENT', label: 'Count adjustment' },
  { value: 'OPENING_BALANCE', label: 'Opening balance' },
  { value: 'LOSS', label: 'Loss' },
  { value: 'CONTAMINATION', label: 'Contamination' },
  { value: 'OTHER', label: 'Other' },
];

const round4 = (n: number) => Math.round(n * 10000) / 10000;

interface RowState {
  counted: string;
  reason: WipAdjustmentReason;
}

export function WipFloorCountModal({ open, onOpenChange, rows }: Props) {
  const today = format(new Date(), 'MMM d, yyyy');
  const dateStrIso = format(new Date(), 'yyyy-MM-dd');
  const queryClient = useQueryClient();
  const { authUser } = useAuth();

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [rows],
  );

  const [state, setState] = useState<Record<string, RowState>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  // Reset state on open/close
  useEffect(() => {
    if (open) setState({});
  }, [open]);

  const setCounted = (rg: string, value: string) => {
    setState((prev) => ({
      ...prev,
      [rg]: { counted: value, reason: prev[rg]?.reason ?? 'RECOUNT' },
    }));
  };
  const setReason = (rg: string, reason: WipAdjustmentReason) => {
    setState((prev) => ({
      ...prev,
      [rg]: { counted: prev[rg]?.counted ?? '', reason },
    }));
  };

  // Build deltas
  const changes = useMemo(() => {
    const out: Array<{
      row: WipFloorRow;
      previousKg: number;
      countedKg: number;
      delta: number;
      reason: WipAdjustmentReason;
    }> = [];
    for (const r of sortedRows) {
      const s = state[r.roast_group];
      if (!s) continue;
      const trimmed = (s.counted ?? '').trim();
      if (trimmed === '') continue;
      const counted = parseFloat(trimmed);
      if (!Number.isFinite(counted)) continue;
      const previousKg = round4(r.current_kg);
      const countedKg = round4(counted);
      const delta = round4(countedKg - previousKg);
      if (delta === 0) continue;
      out.push({
        row: r,
        previousKg,
        countedKg,
        delta,
        reason: s.reason ?? 'RECOUNT',
      });
    }
    return out;
  }, [sortedRows, state]);

  const hasAnyInput = useMemo(
    () => Object.values(state).some((s) => (s.counted ?? '').trim() !== ''),
    [state],
  );

  const handleCopy = async () => {
    const header = ['Roast Group', 'Current kg', 'Counted kg', 'Delta'].join('\t');
    const lines = sortedRows.map((r) => {
      const s = state[r.roast_group];
      const countedStr = s?.counted?.trim() ?? '';
      const counted = countedStr === '' ? null : parseFloat(countedStr);
      const deltaStr =
        counted !== null && Number.isFinite(counted)
          ? (round4(counted - r.current_kg)).toFixed(2)
          : '';
      return [r.display_name, r.current_kg.toFixed(2), countedStr, deltaStr].join('\t');
    });
    const text = [header, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (changes.length === 0) throw new Error('No changes to apply.');
      const applied: string[] = [];
      for (const ch of changes) {
        const notes = `Floor count ${dateStrIso}: ${ch.previousKg.toFixed(2)} kg → ${ch.countedKg.toFixed(2)} kg`;
        try {
          await saveWipAdjustment({
            roastGroup: ch.row.roast_group,
            kgDelta: ch.delta,
            reason: ch.reason,
            notes,
            createdBy: authUser?.id ?? null,
          });
          applied.push(ch.row.display_name);
        } catch (e: any) {
          throw new Error(
            `Failed updating ${ch.row.display_name}: ${e?.message || 'Unknown error'}. ${applied.length} roast group(s) already applied before this error.`,
          );
        }
      }
      return applied.length;
    },
    onSuccess: (n) => {
      toast.success(`WIP floor count applied to ${n} roast group${n === 1 ? '' : 's'}.`);
      for (const key of WIP_ADJUSTMENT_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      setConfirmOpen(false);
      setState({});
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to apply WIP floor count');
    },
  });

  const saveDisabled = !hasAnyInput || saveMutation.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto print-modal-content">
          <style>{`
            @media print {
              @page { margin: 12mm; }
              body > *:not([data-radix-portal]) { display: none !important; }
              [data-radix-portal] [data-radix-dialog-overlay] { display: none !important; }
              html, body {
                height: auto !important;
                overflow: visible !important;
                margin: 0 !important;
                padding: 0 !important;
                background: white !important;
              }
              body > div[data-radix-portal],
              body > div[id^="radix-"] {
                position: static !important;
                display: block !important;
              }
              [data-radix-popper-content-wrapper] {
                position: static !important;
                transform: none !important;
              }
              .print-modal-content {
                position: static !important;
                inset: auto !important;
                transform: none !important;
                max-width: 100% !important;
                width: 100% !important;
                max-height: none !important;
                overflow: visible !important;
                box-shadow: none !important;
                border: none !important;
                margin: 0 !important;
                padding: 0 !important;
                display: block !important;
              }
              .print-hide,
              [data-radix-dialog-close],
              button[aria-label="Close"] { display: none !important; }
              .print-modal-content table {
                width: 100% !important;
                border-collapse: collapse !important;
                page-break-inside: auto !important;
              }
              .print-modal-content thead { display: table-header-group !important; }
              .print-modal-content tbody { display: table-row-group !important; }
              .print-modal-content tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              .print-modal-content,
              .print-modal-content table,
              .print-modal-content th,
              .print-modal-content td { font-size: 10pt !important; }
              .print-modal-content th,
              .print-modal-content td { padding: 4px 6px !important; }
              .print-modal-content table { table-layout: fixed !important; }
              .print-modal-content th:nth-child(1),
              .print-modal-content td:nth-child(1) { width: 32% !important; }
              .print-modal-content th:nth-child(2),
              .print-modal-content td:nth-child(2) { width: 16% !important; text-align: right !important; }
              .print-modal-content th:nth-child(3),
              .print-modal-content td:nth-child(3) { width: 16% !important; text-align: right !important; }
              .print-modal-content th:nth-child(4),
              .print-modal-content td:nth-child(4) { width: 14% !important; text-align: right !important; }
              .print-modal-content th:nth-child(5),
              .print-modal-content td:nth-child(5) { width: 22% !important; }
              .print-as-text input,
              .print-as-text [role="combobox"] {
                border: none !important;
                background: transparent !important;
                padding: 0 !important;
                height: auto !important;
                box-shadow: none !important;
              }
            }
          `}</style>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">WIP Floor Count — {today}</h2>
              <p className="text-sm text-muted-foreground">
                Enter the actual on-hand WIP per roast group. Saving will write adjustments for any rows that differ from the current balance.
              </p>
            </div>
            <div className="flex gap-2 print-hide">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4" /> Copy Results
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={saveDisabled}>
                        <Save className="h-4 w-4" /> Save count
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!hasAnyInput && <TooltipContent>Enter counts to save.</TooltipContent>}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden print-as-text">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Roast Group</TableHead>
                  <TableHead className="text-right">Current WIP (kg)</TableHead>
                  <TableHead className="text-right">Counted WIP (kg)</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No active roast groups.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedRows.map((r) => {
                    const s = state[r.roast_group];
                    const countedStr = s?.counted ?? '';
                    const reason = s?.reason ?? 'RECOUNT';
                    const trimmed = countedStr.trim();
                    let deltaCell: React.ReactNode = <span className="text-muted-foreground">—</span>;
                    if (trimmed !== '') {
                      const counted = parseFloat(trimmed);
                      if (Number.isFinite(counted)) {
                        const delta = round4(counted - r.current_kg);
                        const cls =
                          delta > 0
                            ? 'text-green-600 dark:text-green-400'
                            : delta < 0
                              ? 'text-destructive'
                              : 'text-muted-foreground';
                        deltaCell = (
                          <span className={`font-mono ${cls}`}>
                            {delta > 0 ? '+' : ''}
                            {delta.toFixed(2)}
                          </span>
                        );
                      }
                    }
                    return (
                      <TableRow key={r.roast_group}>
                        <TableCell className="font-medium">{r.display_name}</TableCell>
                        <TableCell className="text-right font-mono">{r.current_kg.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            className="h-8 w-28 ml-auto text-right"
                            value={countedStr}
                            placeholder="—"
                            onChange={(e) => setCounted(r.roast_group, e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="text-right">{deltaCell}</TableCell>
                        <TableCell>
                          <Select
                            value={reason}
                            onValueChange={(v) => setReason(r.roast_group, v as WipAdjustmentReason)}
                          >
                            <SelectTrigger className="h-8 w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {REASON_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply WIP count?</AlertDialogTitle>
            <AlertDialogDescription>
              This will update WIP for {changes.length} roast group{changes.length === 1 ? '' : 's'} and log each change as a wip_adjustment. Roast groups with no counted value or no change will be skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              onClick={() => setShowDetails((s) => !s)}
            >
              {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
            {showDetails && (
              <div className="border rounded-md max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Roast group</TableHead>
                      <TableHead className="text-right">Current kg</TableHead>
                      <TableHead className="text-right">Counted kg</TableHead>
                      <TableHead className="text-right">Delta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          No changes.
                        </TableCell>
                      </TableRow>
                    ) : (
                      changes.map((ch) => (
                        <TableRow key={ch.row.roast_group}>
                          <TableCell className="text-sm">{ch.row.display_name}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {ch.previousKg.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {ch.countedKg.toFixed(2)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono text-sm ${ch.delta >= 0 ? 'text-green-600' : 'text-destructive'}`}
                          >
                            {ch.delta >= 0 ? '+' : ''}
                            {ch.delta.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={saveMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                saveMutation.mutate();
              }}
              disabled={changes.length === 0 || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Applying…' : 'Apply count'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
