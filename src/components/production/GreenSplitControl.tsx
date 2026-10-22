import React, { useEffect, useState } from 'react';
import { Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { splitKg, type LotSplit } from '@/lib/greenUse';

export interface GreenLotOption {
  lot_id: string;
  lot_number: string;
  kg_on_hand: number;
  via_basket?: string | null;
}

interface Props {
  /** Split that will be used (auto or edited). */
  splits: LotSplit[];
  /** True when the roaster has edited it for this batch. */
  isCustom: boolean;
  /** Every lot this roast group can take green from. */
  options: GreenLotOption[];
  /** Inbound green kg for the batch, to show kg per lot. */
  inboundKg: number;
  /** Whether green deduction is switched on (Admin Tools). */
  deductionOn: boolean;
  onChange: (splits: LotSplit[] | null) => void;
  disabled?: boolean;
}

/**
 * "Green" control on a batch row: which lots this batch's green comes off, by %.
 * Defaults to the roast group's sources; can be edited per batch.
 */
export function GreenSplitControl({ splits, isCustom, options, inboundKg, deductionOn, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const d: Record<string, string> = {};
    for (const o of options) {
      const s = splits.find(x => x.lot_id === o.lot_id);
      d[o.lot_id] = s ? String(Math.round(s.pct * 10) / 10) : '';
    }
    setDraft(d);
  }, [open, options, splits]);

  const label = splits.length === 0
    ? 'Green: none'
    : splits.length === 1
      ? `Green: ${splits[0].lot_number}`
      : `Green: ${splits.length} lots`;

  const draftTotal = Object.values(draft).reduce((a, v) => a + (parseFloat(v) || 0), 0);
  const kgByLot = splitKg(splits, inboundKg);

  const apply = () => {
    const next: LotSplit[] = options
      .map(o => ({ lot_id: o.lot_id, lot_number: o.lot_number, pct: Math.max(0, parseFloat(draft[o.lot_id]) || 0), via_basket: o.via_basket ?? null }))
      .filter(s => s.pct > 0);
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn('h-7 px-2 text-xs gap-1', isCustom && 'border-primary text-primary', splits.length === 0 && 'text-muted-foreground')}
          title="Which green lots this batch uses"
        >
          <Leaf className="h-3 w-3" /> {label}{isCustom ? ' (edited)' : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          <p className="text-sm font-medium">Green for this batch</p>
          <p className="text-xs text-muted-foreground">
            {inboundKg > 0 ? `${inboundKg.toFixed(1)} kg green in, split by %.` : 'Split by %. Set inbound kg to see kg per lot.'}
          </p>
          {!deductionOn && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Green deduction is switched off (Admin Tools), so nothing comes off stock yet.
            </p>
          )}
        </div>
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">No lots linked to this roast group or its baskets.</p>
        ) : (
          <div className="space-y-1.5">
            {options.map(o => {
              return (
                <div key={o.lot_id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{o.lot_number}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {o.via_basket ? `${o.via_basket} basket · ` : ''}{Number(o.kg_on_hand).toFixed(0)} kg on hand
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="w-16 h-7 text-xs"
                    value={draft[o.lot_id] ?? ''}
                    placeholder="0"
                    onChange={(e) => setDraft(d => ({ ...d, [o.lot_id]: e.target.value }))}
                    aria-label={`Percent from ${o.lot_number}`}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              );
            })}
            <p className={cn('text-xs', Math.abs(draftTotal - 100) > 0.01 && draftTotal > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
              Total {Math.round(draftTotal * 10) / 10}%{Math.abs(draftTotal - 100) > 0.01 && draftTotal > 0 ? ' — shares are scaled to cover the whole batch' : ''}
            </p>
          </div>
        )}
        {splits.length > 0 && inboundKg > 0 && (
          <div className="rounded bg-muted/40 p-2 text-[11px] text-muted-foreground space-y-0.5">
            {splits.map(s => (
              <p key={s.lot_id}>{s.lot_number}: {(kgByLot.get(s.lot_id) ?? 0).toFixed(1)} kg</p>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!isCustom} onClick={() => { onChange(null); setOpen(false); }}>
            Reset to auto
          </Button>
          <Button size="sm" className="h-7 text-xs" disabled={options.length === 0} onClick={apply}>Use this split</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
