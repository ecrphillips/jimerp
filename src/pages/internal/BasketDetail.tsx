import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';
import { useBasketData, useBasketMutations, useBasketUsedBy } from '@/hooks/useBaskets';
import { defaultPromotePct, normalizeBasketName, type BasketMemberView } from '@/lib/baskets';
import {
  BasketFormDialog,
  BasketLotSummary,
  DeleteBasketDialog,
  formatKg,
  groupLinedUp,
  lineUpGroupLabel,
  LowStockPrompt,
  PctWarning,
} from '@/components/baskets/BasketParts';
import { AddLotsDialog } from '@/components/baskets/AddLotsDialog';

export default function BasketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const data = useBasketData();
  const usedByMap = useBasketUsedBy();
  const m = useBasketMutations();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const view = id ? data.viewById.get(id) : undefined;
  const basket = view?.basket ?? null;

  const basketNamesByLot = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const r of data.members) {
      const name = data.basketsById.get(r.basket_id)?.name;
      if (!name) continue;
      out.set(r.lot_id, [...(out.get(r.lot_id) ?? []), name]);
    }
    return out;
  }, [data.members, data.basketsById]);

  const memberLotIds = useMemo(
    () => new Set(view ? [...view.active, ...view.linedUp].map(v => v.lot.id) : []),
    [view],
  );

  const label = (v: BasketMemberView) => {
    const l = data.lotsById.get(v.lot.id);
    return l ? data.lotLabel(l) : null;
  };

  const promote = (v: BasketMemberView) => {
    if (!view) return;
    m.setActivePct.mutate({ memberId: v.member.id, activePct: defaultPromotePct(view.active.map(a => a.member)) });
  };

  if (data.isLoading) {
    return <div className="p-6 max-w-5xl mx-auto"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }

  if (!view || !basket) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/sourcing/baskets')}>
          <ArrowLeft className="h-4 w-4" /> Back to Baskets
        </Button>
        <p className="text-sm text-muted-foreground">
          {data.error ? `Couldn't load baskets: ${(data.error as Error | null)?.message || 'unknown error'}` : 'Basket not found.'}
        </p>
      </div>
    );
  }

  const groups = groupLinedUp(view.linedUp);

  return (
    <>
      <GreenCoffeeAlerts />
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/sourcing/baskets')}>
          <ArrowLeft className="h-4 w-4" /> Back to Baskets
        </Button>

        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{basket.name}</h1>
              {!basket.is_active && <Badge variant="outline">Inactive</Badge>}
            </div>
            <p className="text-sm">
              <span className="font-medium">{formatKg(view.volumes.kgInStore)}</span> in store ·{' '}
              <span className="font-medium">{formatKg(view.volumes.kgContracted)}</span> contracted, not received
            </p>
            <p className="text-sm text-muted-foreground">
              {(usedByMap.get(basket.id) ?? []).length === 0 ? 'Not used by any roast group yet.' : (
                <>Used by{' '}
                  {(usedByMap.get(basket.id) ?? []).map((u, i) => (
                    <React.Fragment key={u.roastGroup}>
                      {i > 0 && ', '}
                      <Link to={`/roast-groups/${encodeURIComponent(u.roastGroup)}`} className="underline hover:text-foreground">{u.name}</Link>
                    </React.Fragment>
                  ))}
                </>
              )}
            </p>
            {basket.notes && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{basket.notes}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Rename / notes
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => m.updateBasket.mutate({ id: basket.id, is_active: !basket.is_active })}
            >
              <Power className="h-3.5 w-3.5" /> {basket.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>

        <LowStockPrompt view={view} onPromote={promote} busy={m.setActivePct.isPending} />

        {/* Active */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Active lots</CardTitle>
              {view.active.length > 0 && (
                <span className={`text-sm tabular-nums ${view.pctOff ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}>
                  Total {Math.round(view.pctTotal * 100) / 100}%
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <PctWarning view={view} />
            {view.active.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active lots. Promote a lined-up lot below.</p>
            ) : view.active.map(v => (
              <div key={v.member.id} className="flex items-start gap-3 rounded-md border p-3">
                <BasketLotSummary v={v} label={label(v)} />
                <div className="flex items-center gap-1 shrink-0">
                  <Input
                    key={`${v.member.id}:${v.member.active_pct}`}
                    type="number"
                    className="w-20 h-8 text-xs"
                    aria-label={`Percent for ${v.lot.lot_number}`}
                    defaultValue={v.member.active_pct ?? ''}
                    min={0}
                    max={100}
                    step="any"
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      // Blank keeps the lot active at 0% — use "Move to lined up" to deactivate it.
                      const val = raw === '' ? 0 : Number(raw);
                      if (!Number.isFinite(val)) return;
                      if (val !== Number(v.member.active_pct)) {
                        m.setActivePct.mutate({ memberId: v.member.id, activePct: val });
                      }
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => m.setActivePct.mutate({ memberId: v.member.id, activePct: null })}
                  >
                    <ArrowDownCircle className="h-3.5 w-3.5" /> Move to lined up
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => m.removeMember.mutate(v.member.id)}>
                    <X className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Lined up */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Lined up</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Sorted automatically: in store (oldest first), then contracted, then planned.</p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add lots
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing lined up yet.</p>
            ) : groups.map(g => (
              <div key={g.group} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{lineUpGroupLabel(g.group)}</p>
                {g.items.map(v => (
                  <div key={v.member.id} className="flex items-start gap-3 rounded-md border p-3">
                    <BasketLotSummary v={v} label={label(v)} />
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={m.setActivePct.isPending} onClick={() => promote(v)}>
                        <ArrowUpCircle className="h-3.5 w-3.5" /> Promote to active
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => m.removeMember.mutate(v.member.id)}>
                        <X className="h-3.5 w-3.5" /> Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <BasketFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        basket={basket}
        existingNames={data.baskets.filter(b => b.id !== basket.id).map(b => normalizeBasketName(b.name))}
        busy={m.updateBasket.isPending}
        onSubmit={({ name, notes }) => m.updateBasket.mutate({ id: basket.id, name, notes }, { onSuccess: () => setEditOpen(false) })}
      />

      <DeleteBasketDialog
        basket={deleteOpen ? basket : null}
        onOpenChange={(o) => { if (!o) setDeleteOpen(false); }}
        busy={m.deleteBasket.isPending || m.updateBasket.isPending}
        onConfirm={(b) => m.deleteBasket.mutate(b.id, { onSuccess: () => { setDeleteOpen(false); navigate('/sourcing/baskets'); } })}
        onDeactivate={(b) => m.updateBasket.mutate({ id: b.id, is_active: false }, { onSuccess: () => setDeleteOpen(false) })}
      />

      <AddLotsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        basketName={basket.name}
        lots={data.lots}
        excludeLotIds={memberLotIds}
        basketNamesByLot={basketNamesByLot}
        lotLabel={data.lotLabel}
        busy={m.addLots.isPending || m.addFromSample.isPending}
        onAddLots={(lotIds) => m.addLots.mutate({ basketId: basket.id, lotIds }, { onSuccess: () => setAddOpen(false) })}
        onAddFromSample={({ sample, bags, bagSizeKg }) =>
          m.addFromSample.mutate({ basketId: basket.id, sample, bags, bagSizeKg }, { onSuccess: () => setAddOpen(false) })
        }
      />
    </>
  );
}
