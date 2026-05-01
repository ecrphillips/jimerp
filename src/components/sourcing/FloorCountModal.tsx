import React, { useMemo, useState } from 'react';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Printer, Copy, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { lotLeadLabel } from '@/components/quotes/lotLabel';

interface LotLike {
  id: string;
  lot_number: string;
  bag_size_kg: number;
  bags_released: number;
  kg_on_hand: number;
  status: 'EN_ROUTE' | 'RECEIVED';
  lot_identifier: string | null;
  contract_id: string;
}
interface PurchaseLineLike {
  origin_country: string | null;
  lot_identifier: string | null;
  producer: string | null;
}
interface ContractLike {
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lots: LotLike[];
  purchaseLineByLotId: Record<string, PurchaseLineLike>;
  contractMap: Record<string, ContractLike>;
}

function getFloorCountName(lot: LotLike, _c: ContractLike | undefined, pl: PurchaseLineLike | undefined): string {
  return lotLeadLabel({
    id: lot.id,
    lot_number: lot.lot_number,
    book_value_per_kg: null,
    lot_identifier: lot.lot_identifier ?? pl?.lot_identifier ?? null,
    origin_country: pl?.origin_country ?? null,
    producer: pl?.producer ?? null,
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function FloorCountModal({ open, onOpenChange, lots, purchaseLineByLotId, contractMap }: Props) {
  const today = format(new Date(), 'MMM d, yyyy');
  const queryClient = useQueryClient();
  const rows = useMemo(() => {
    return lots
      .filter(l => l.status === 'RECEIVED')
      .sort((a, b) => a.lot_number.localeCompare(b.lot_number));
  }, [lots]);

  const [counts, setCounts] = useState<Record<string, { fullBags: string; openedKg: string }>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  const setVal = (id: string, key: 'fullBags' | 'openedKg', value: string) => {
    setCounts(prev => ({ ...prev, [id]: { ...(prev[id] || { fullBags: '', openedKg: '' }), [key]: value } }));
  };

  // Compute per-row counted kg & deltas. Only rows with at least one non-empty input count.
  const changes = useMemo(() => {
    const out: Array<{
      lot: LotLike;
      previousKg: number;
      countedKg: number;
      delta: number;
      label: string;
    }> = [];
    for (const r of rows) {
      const c = counts[r.id];
      if (!c) continue;
      const fbStr = c.fullBags.trim();
      const okStr = c.openedKg.trim();
      if (fbStr === '' && okStr === '') continue;
      const fb = parseFloat(fbStr) || 0;
      const ok = parseFloat(okStr) || 0;
      const countedKg = round2(fb * r.bag_size_kg + ok);
      const previousKg = round2(r.kg_on_hand);
      const delta = round2(countedKg - previousKg);
      if (delta === 0) continue;
      out.push({
        lot: r,
        previousKg,
        countedKg,
        delta,
        label: getFloorCountName(r, contractMap[r.contract_id], purchaseLineByLotId[r.id]),
      });
    }
    return out;
  }, [rows, counts, contractMap, purchaseLineByLotId]);

  const hasAnyInput = useMemo(() => {
    return Object.values(counts).some(c => (c.fullBags ?? '').trim() !== '' || (c.openedKg ?? '').trim() !== '');
  }, [counts]);

  const totals = useMemo(() => {
    let expected = 0;
    let counted = 0;
    let anyInput = false;
    for (const r of rows) {
      expected += r.bags_released * r.bag_size_kg;
      const c = counts[r.id];
      if (c && (c.fullBags !== '' || c.openedKg !== '')) {
        anyInput = true;
        const fb = parseFloat(c.fullBags) || 0;
        const ok = parseFloat(c.openedKg) || 0;
        counted += fb * r.bag_size_kg + ok;
      }
    }
    return { expected, counted, anyInput, variance: counted - expected };
  }, [rows, counts]);

  const description = (lot: LotLike) => getFloorCountName(lot, contractMap[lot.contract_id], purchaseLineByLotId[lot.id]);

  const handleCopy = async () => {
    const header = ['Lot #', 'Description', 'Bag size', 'Expected bags', 'Full bags on floor', 'Opened bag weight kg'].join('\t');
    const lines = rows.map(r => {
      const c = counts[r.id] || { fullBags: '', openedKg: '' };
      return [r.lot_number, description(r), `${r.bag_size_kg}kg`, r.bags_released, c.fullBags, c.openedKg].join('\t');
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
      if (changes.length === 0) throw new Error('No changes to apply');
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? null;
      const dateStr = format(new Date(), 'yyyy-MM-dd');

      // Sequential with abort-on-error. We update kg_on_hand first then insert the txn.
      // If any fails, surface the error and stop. Already-applied rows remain (we cannot
      // wrap in a single transaction from the client). Surface this clearly via the error.
      const applied: string[] = [];
      for (const ch of changes) {
        const { error: upErr } = await supabase
          .from('green_lots')
          .update({ kg_on_hand: ch.countedKg })
          .eq('id', ch.lot.id);
        if (upErr) {
          throw new Error(
            `Failed updating ${ch.lot.lot_number}: ${upErr.message}. ${applied.length} lot(s) already applied before this error.`,
          );
        }
        const sign = ch.delta >= 0 ? '+' : '';
        const { error: txErr } = await supabase.from('inventory_transactions').insert({
          transaction_type: 'GREEN_FLOOR_COUNT_ADJUSTMENT' as never,
          lot_id: ch.lot.id,
          quantity_kg: ch.delta,
          notes: `Floor count ${dateStr}: ${ch.previousKg} kg → ${ch.countedKg} kg (delta ${sign}${ch.delta})`,
          created_by: userId,
          is_system_generated: false,
        } as never);
        if (txErr) {
          throw new Error(
            `Updated kg on ${ch.lot.lot_number} but failed to log audit: ${txErr.message}. Stopping.`,
          );
        }
        applied.push(ch.lot.lot_number);
      }
      return applied.length;
    },
    onSuccess: (n) => {
      toast.success(`Floor count applied to ${n} lot${n === 1 ? '' : 's'}.`);
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      queryClient.invalidateQueries({ queryKey: ['sourcing-lots'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      setConfirmOpen(false);
      setCounts({});
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to apply floor count');
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

              /* Hide all top-level page chrome — anything that isn't the modal portal */
              body > *:not([data-radix-portal]) { display: none !important; }

              /* Inside the Radix portal stack, hide overlay layers and any siblings that aren't our modal */
              [data-radix-portal] [data-radix-dialog-overlay] { display: none !important; }

              /* Reset html/body so the modal flows from the top of the printed page */
              html, body {
                height: auto !important;
                overflow: visible !important;
                margin: 0 !important;
                padding: 0 !important;
                background: white !important;
              }

              /* Belt-and-braces: neutralize Radix portal/wrapper layout */
              body > div[data-radix-portal],
              body > div[id^="radix-"] {
                position: static !important;
                display: block !important;
              }
              [data-radix-popper-content-wrapper] {
                position: static !important;
                transform: none !important;
              }

              /* The modal content prints as a normal block element */
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

              /* Hide the Radix close X and any UI we explicitly tagged */
              .print-hide,
              [data-radix-dialog-close],
              button[aria-label="Close"] { display: none !important; }

              /* Table — repeat headers, never split rows */
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

              /* Keep Count summary together on its own block */
              .print-summary {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                page-break-before: auto !important;
                margin-top: 12mm !important;
              }

              /* Inputs render as plain text */
              .print-as-text input {
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
              <h2 className="text-xl font-semibold">Floor Count — {today}</h2>
              <p className="text-sm text-muted-foreground">Received lots only. Expected bags based on bags entered at receiving.</p>
            </div>
            <div className="flex gap-2 print-hide">
              <Button variant="outline" size="sm" onClick={handleCopy}><Copy className="h-4 w-4" /> Copy Results</Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="sm"
                        onClick={() => setConfirmOpen(true)}
                        disabled={saveDisabled}
                      >
                        <Save className="h-4 w-4" /> Save count
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!hasAnyInput && (
                    <TooltipContent>Enter counts to save.</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden print-as-text">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Bag size</TableHead>
                  <TableHead className="text-right">Expected bags</TableHead>
                  <TableHead className="text-right">Full bags on floor</TableHead>
                  <TableHead className="text-right">Opened bag weight kg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No received lots.</TableCell></TableRow>
                ) : rows.map(r => {
                  const c = counts[r.id] || { fullBags: '', openedKg: '' };
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.lot_number}</TableCell>
                      <TableCell>{description(r)}</TableCell>
                      <TableCell className="text-right">{r.bag_size_kg}kg</TableCell>
                      <TableCell className="text-right">{r.bags_released}</TableCell>
                      <TableCell className="text-right">
                        <Input type="number" inputMode="decimal" className="h-8 w-24 ml-auto text-right" value={c.fullBags} onChange={e => setVal(r.id, 'fullBags', e.target.value)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input type="number" inputMode="decimal" className="h-8 w-24 ml-auto text-right" value={c.openedKg} placeholder="0.0" onChange={e => setVal(r.id, 'openedKg', e.target.value)} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="border rounded-lg p-4 space-y-1 text-sm">
            <p className="font-semibold mb-2">Count summary</p>
            <div className="flex justify-between"><span>Total expected kg</span><span className="font-mono">{totals.expected.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg</span></div>
            <div className="flex justify-between"><span>Total counted kg</span><span className="font-mono">{totals.anyInput ? `${totals.counted.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg` : '—'}</span></div>
            <div className="flex justify-between font-medium">
              <span>Variance</span>
              <span className={`font-mono ${totals.anyInput ? (totals.variance >= 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                {totals.anyInput ? `${totals.variance >= 0 ? '+' : ''}${totals.variance.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg` : '—'}
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply count to lots?</AlertDialogTitle>
            <AlertDialogDescription>
              This will update kg_on_hand on {changes.length} lot{changes.length === 1 ? '' : 's'} and log each change as an inventory adjustment. Lots with no counted value will be skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              onClick={() => setShowDetails(s => !s)}
            >
              {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
            {showDetails && (
              <div className="border rounded-md max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lot</TableHead>
                      <TableHead className="text-right">Current kg</TableHead>
                      <TableHead className="text-right">Counted kg</TableHead>
                      <TableHead className="text-right">Delta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changes.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No changes.</TableCell></TableRow>
                    ) : changes.map(ch => (
                      <TableRow key={ch.lot.id}>
                        <TableCell className="text-sm">{ch.label}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{ch.previousKg.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{ch.countedKg.toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${ch.delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {ch.delta >= 0 ? '+' : ''}{ch.delta.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
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
