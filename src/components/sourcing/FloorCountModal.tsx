import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Printer, Copy } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { lotLeadLabel } from '@/components/quotes/lotLabel';

interface LotLike {
  id: string;
  lot_number: string;
  bag_size_kg: number;
  bags_released: number;
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

export function FloorCountModal({ open, onOpenChange, lots, purchaseLineByLotId, contractMap }: Props) {
  const today = format(new Date(), 'MMM d, yyyy');
  const rows = useMemo(() => {
    return lots
      .filter(l => l.status === 'RECEIVED')
      .sort((a, b) => a.lot_number.localeCompare(b.lot_number));
  }, [lots]);

  const [counts, setCounts] = useState<Record<string, { fullBags: string; openedKg: string }>>({});

  const setVal = (id: string, key: 'fullBags' | 'openedKg', value: string) => {
    setCounts(prev => ({ ...prev, [id]: { ...(prev[id] || { fullBags: '', openedKg: '' }), [key]: value } }));
  };

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto print-modal-content">
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            .print-modal-content, .print-modal-content * { visibility: visible !important; }
            .print-modal-content { position: fixed !important; inset: 0 !important; max-width: 100% !important; max-height: none !important; overflow: visible !important; box-shadow: none !important; border: none !important; transform: none !important; top: 0 !important; left: 0 !important; }
            .print-hide { display: none !important; }
            .print-as-text input { border: none !important; background: transparent !important; padding: 0 !important; height: auto !important; box-shadow: none !important; }
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
  );
}
