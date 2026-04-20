import React, { useMemo } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Printer, Copy } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { formatMoney, formatPerKg } from '@/lib/formatMoney';

interface LotLike {
  id: string;
  lot_number: string;
  bag_size_kg: number;
  bags_released: number;
  kg_on_hand: number;
  status: 'EN_ROUTE' | 'RECEIVED';
  costing_status: 'INCOMPLETE' | 'COMPLETE';
  lot_identifier: string | null;
  vendor_invoice_number: string | null;
  book_value_per_kg: number | null;
}
interface PurchaseLineLike {
  origin_country: string | null;
  lot_identifier: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lots: LotLike[];
  purchaseLineByLotId: Record<string, PurchaseLineLike>;
}

export function BookValueReportModal({ open, onOpenChange, lots, purchaseLineByLotId }: Props) {
  const today = format(new Date(), 'MMM d, yyyy');

  const rows = useMemo(() => {
    return lots
      .filter(l => l.status === 'RECEIVED' || (l.status === 'EN_ROUTE' && !!l.vendor_invoice_number))
      .sort((a, b) => a.lot_number.localeCompare(b.lot_number));
  }, [lots]);

  const description = (lot: LotLike) => {
    const pl = purchaseLineByLotId[lot.id];
    return lot.lot_identifier || pl?.lot_identifier || pl?.origin_country || '—';
  };

  const totals = useMemo(() => {
    let receivedCosted = 0;
    let enRouteCosted = 0;
    let incompleteCount = 0;
    for (const r of rows) {
      const hasBook = r.costing_status === 'COMPLETE' && r.book_value_per_kg != null;
      if (!hasBook) {
        incompleteCount += 1;
        continue;
      }
      const total = (r.book_value_per_kg as number) * r.kg_on_hand;
      if (r.status === 'RECEIVED') receivedCosted += total;
      else enRouteCosted += total;
    }
    return { receivedCosted, enRouteCosted, incompleteCount, grand: receivedCosted + enRouteCosted };
  }, [rows]);

  const handleCopy = async () => {
    const header = ['Lot #', 'Invoice #', 'Description', 'Status', 'Costing', 'kg on hand', 'Book $/kg', 'Total book value CAD'].join('\t');
    const lines = rows.map(r => {
      const hasBook = r.costing_status === 'COMPLETE' && r.book_value_per_kg != null;
      const total = hasBook ? ((r.book_value_per_kg as number) * r.kg_on_hand) : null;
      return [
        r.lot_number,
        r.vendor_invoice_number || '—',
        description(r),
        r.status === 'RECEIVED' ? 'Received' : 'En Route',
        r.costing_status === 'COMPLETE' ? 'Complete' : 'Incomplete',
        r.kg_on_hand,
        hasBook ? (r.book_value_per_kg as number).toFixed(4) : '—',
        total != null ? total.toFixed(2) : '—',
      ].join('\t');
    });
    const text = [header, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto print-modal-content">
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            .print-modal-content, .print-modal-content * { visibility: visible !important; }
            .print-modal-content { position: fixed !important; inset: 0 !important; max-width: 100% !important; max-height: none !important; overflow: visible !important; box-shadow: none !important; border: none !important; transform: none !important; top: 0 !important; left: 0 !important; }
            .print-hide { display: none !important; }
          }
        `}</style>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Green Coffee — Capitalized Inventory</h2>
            <p className="text-sm text-muted-foreground">All invoiced lots (received and en route). Generated {today}.</p>
          </div>
          <div className="flex gap-2 print-hide">
            <Button variant="outline" size="sm" onClick={handleCopy}><Copy className="h-4 w-4" /> Copy Report</Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lot #</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Costing</TableHead>
                <TableHead className="text-right">kg on hand</TableHead>
                <TableHead className="text-right">Book $/kg</TableHead>
                <TableHead className="text-right">Total book value CAD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No lots to report.</TableCell></TableRow>
              ) : rows.map(r => {
                const hasBook = r.costing_status === 'COMPLETE' && r.book_value_per_kg != null;
                const total = hasBook ? ((r.book_value_per_kg as number) * r.kg_on_hand) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.lot_number}</TableCell>
                    <TableCell>{r.vendor_invoice_number || '—'}</TableCell>
                    <TableCell>{description(r)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={r.status === 'EN_ROUTE' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-0' : 'bg-muted text-muted-foreground border-0'}>
                        {r.status === 'EN_ROUTE' ? 'En Route' : 'Received'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={r.costing_status === 'COMPLETE' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0' : 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border-0'}>
                        {r.costing_status === 'COMPLETE' ? 'Complete' : 'Incomplete'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{r.kg_on_hand.toLocaleString()} kg</TableCell>
                    <TableCell className="text-right">{hasBook ? formatPerKg(r.book_value_per_kg as number) : '—'}</TableCell>
                    <TableCell className="text-right">{total != null ? formatMoney(total) : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="border rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span>Subtotal — Received & costed</span><span className="font-mono">{formatMoney(totals.receivedCosted)}</span></div>
          <div className="flex justify-between"><span>Subtotal — En Route & invoiced (costed)</span><span className="font-mono">{formatMoney(totals.enRouteCosted)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Lots with incomplete costing</span><span className="font-mono">{totals.incompleteCount} <span className="text-xs">(excluded from totals)</span></span></div>
          <div className="flex justify-between font-semibold pt-2 border-t mt-2"><span>Grand total capitalized</span><span className="font-mono">{formatMoney(totals.grand)}</span></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
