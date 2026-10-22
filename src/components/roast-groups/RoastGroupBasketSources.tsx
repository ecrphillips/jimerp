import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Plus, ShoppingBasket, Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatPerKg } from '@/lib/formatMoney';
import { lotBookPerKg, lotMarketPerKg, sourcesPctIsOff, sourcesPctTotal } from '@/lib/greenSources';
import { useBasketData, useBasketMutations, useRoastGroupBasketsQuery } from '@/hooks/useBaskets';
import { useRoastGroupGreenValue } from '@/hooks/useRoastGroupGreenValue';
import { formatKg } from '@/components/baskets/BasketParts';

interface Props {
  roastGroupKey: string;
  /** pct_of_lot of each directly linked lot, for the combined % check. */
  linkPcts: (number | null)[];
}

/**
 * Baskets this roast group takes green from, plus the combined % check and the
 * open green-value sum across baskets and linked lots.
 */
export function RoastGroupBasketSources({ roastGroupKey, linkPcts }: Props) {
  const data = useBasketData();
  const { data: allRows = [], error: rowsError } = useRoastGroupBasketsQuery();
  const m = useBasketMutations();
  const value = useRoastGroupGreenValue(roastGroupKey);
  const [addBasketId, setAddBasketId] = useState('');

  const rows = useMemo(() => allRows.filter(r => r.roast_group === roastGroupKey), [allRows, roastGroupKey]);
  const used = new Set(rows.map(r => r.basket_id));
  const available = data.baskets.filter(b => b.is_active && !used.has(b.id));

  const allPcts = [...linkPcts, ...rows.map(r => r.pct)];
  const pctOff = sourcesPctIsOff(allPcts);
  const { total } = sourcesPctTotal(allPcts);

  // Before the Phase 2 migration is applied the table doesn't exist yet.
  if (rowsError) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Baskets</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No baskets. Add one to take green from a basket instead of (or as well as) specific lots.</p>
      ) : rows.map(r => {
        const view = data.viewById.get(r.basket_id);
        return (
          <div key={r.id} className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ShoppingBasket className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  <Link to={`/sourcing/baskets/${r.basket_id}`} className="text-sm font-medium hover:underline">
                    {view?.basket.name ?? 'Basket'}
                  </Link>
                  {view && !view.basket.is_active && <Badge variant="outline" className="text-[10px]">Inactive basket</Badge>}
                </div>
                {view && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatKg(view.volumes.kgInStore)} in store · {formatKg(view.volumes.kgContracted)} contracted
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Input
                  key={`${r.id}:${r.pct}`}
                  type="number"
                  className="w-20 h-8 text-xs"
                  placeholder="%"
                  aria-label="Percent of this roast group from the basket"
                  defaultValue={r.pct ?? ''}
                  min={0}
                  max={100}
                  step="any"
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const val = raw === '' ? null : Number(raw);
                    if (val != null && !Number.isFinite(val)) return;
                    if (val !== (r.pct == null ? null : Number(r.pct))) m.setRoastGroupBasketPct.mutate({ id: r.id, pct: val });
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Remove basket from this roast group"
                onClick={() => m.removeRoastGroupBasket.mutate(r.id)}
              >
                <Unlink className="h-4 w-4 text-destructive" />
              </Button>
            </div>

            {view && (
              <div className="pl-6 space-y-1">
                {view.active.length === 0 ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">No active lots in this basket — set one active on the basket page.</p>
                ) : view.active.map(v => {
                  const lot = data.lotsById.get(v.lot.id);
                  const mv = lot ? lotMarketPerKg(lot) : null;
                  return (
                    <div key={v.member.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium">{v.lot.lot_number}</span>
                      <span className="text-muted-foreground">{Number(v.member.active_pct)}% of basket</span>
                      <span className="text-muted-foreground">· {formatKg(Number(v.lot.kg_on_hand) || 0)} on hand</span>
                      <span className="text-muted-foreground">· {mv != null ? formatPerKg(mv) : 'no value yet'}</span>
                      {v.runningLow && (
                        <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> Running low
                        </span>
                      )}
                    </div>
                  );
                })}
                {view.nextUp && (
                  <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" /> Next up: {view.nextUp.lot.lot_number}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={addBasketId} onValueChange={setAddBasketId}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Choose a basket…" /></SelectTrigger>
            <SelectContent>
              {available.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!addBasketId || m.addRoastGroupBasket.isPending}
            onClick={() => m.addRoastGroupBasket.mutate(
              { roastGroup: roastGroupKey, basketId: addBasketId },
              { onSuccess: () => setAddBasketId('') },
            )}
          >
            <Plus className="h-4 w-4 mr-1" /> Use basket
          </Button>
        </div>
      )}

      {pctOff && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Green sources add up to {Math.round(total * 100) / 100}%, not 100%. Sources with no % count as 0. Saved as entered.</span>
        </div>
      )}

      <GreenValueSum value={value.data} />
    </div>
  );
}

/** The green value as an open sum: each source, its share, its $/kg. */
function GreenValueSum({ value }: { value: ReturnType<typeof useRoastGroupGreenValue>['data'] }) {
  if (!value || value.lines.length === 0) return null;
  return (
    <div className="rounded-md bg-muted/40 p-3 space-y-1 text-xs">
      <p className="font-medium">
        Green value for pricing: {value.marketValuePerKg != null ? formatPerKg(value.marketValuePerKg) : 'not available yet'}
        {value.bookValuePerKg != null && <span className="font-normal text-muted-foreground"> (book {formatPerKg(value.bookValuePerKg)})</span>}
      </p>
      {value.lines.map(l => (
        <div key={`${l.kind}:${l.id}`} className="space-y-0.5">
          <p className="text-muted-foreground">
            {(l.weight * 100).toFixed(1)}% × {l.kind === 'BASKET' ? `${l.label} basket` : `lot ${l.label}`} @{' '}
            {l.marketPerKg != null ? formatPerKg(l.marketPerKg) : 'no value — left out'}
          </p>
          {l.basketLines && l.basketLines.length > 0 && (
            <div className="pl-4">
              {l.basketLines.map(b => (
                <p key={b.lot.id} className="text-muted-foreground">
                  {(b.weight * 100).toFixed(1)}% × {b.lot.lot_number} @ {b.marketPerKg != null ? formatPerKg(b.marketPerKg) : 'no value — left out'}
                  {b.bookPerKg != null && b.marketPerKg != null && lotBookPerKg(b.lot) !== b.marketPerKg && (
                    <> (book {formatPerKg(b.bookPerKg)})</>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
