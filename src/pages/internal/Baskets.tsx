import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Pencil, Plus, Power, Star, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';
import { useBasketData, useBasketMutations } from '@/hooks/useBaskets';
import {
  computeVolumes,
  defaultPromotePct,
  normalizeBasketName,
  type BasketMemberView,
  type BasketRow,
  type BasketView,
} from '@/lib/baskets';
import {
  BasketFormDialog,
  DeleteBasketDialog,
  formatKg,
  groupLinedUp,
  lineUpGroupLabel,
  LowStockPrompt,
  PctWarning,
  SharedWith,
  SupplyGroupBadge,
} from '@/components/baskets/BasketParts';

type Filter = 'ACTIVE' | 'INACTIVE' | 'ALL';

export default function Baskets() {
  const navigate = useNavigate();
  const data = useBasketData();
  const m = useBasketMutations();
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BasketRow | null>(null);
  const [deleting, setDeleting] = useState<BasketRow | null>(null);

  const shown = useMemo(
    () => data.views.filter(v => filter === 'ALL' || (filter === 'ACTIVE' ? v.basket.is_active : !v.basket.is_active)),
    [data.views, filter],
  );

  // Combined total across the baskets shown — each lot counted once even if shared.
  const combined = useMemo(
    () => computeVolumes(shown.flatMap(v => [...v.active, ...v.linedUp].map(x => x.lot))),
    [shown],
  );

  const otherNames = (exceptId?: string) =>
    data.baskets.filter(b => b.id !== exceptId).map(b => normalizeBasketName(b.name));

  const promote = (view: BasketView, v: BasketMemberView) => {
    m.setActivePct.mutate({ memberId: v.member.id, activePct: defaultPromotePct(view.active.map(a => a.member)) });
  };

  return (
    <>
      <GreenCoffeeAlerts />
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Baskets</h1>
            <p className="text-sm text-muted-foreground">Green coffee profiles we keep in stock year-round</p>
          </div>
          <Button className="gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" /> New Basket
          </Button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-md border border-input overflow-hidden">
            {(['ACTIVE', 'INACTIVE', 'ALL'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === f ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                )}
              >
                {f === 'ALL' ? 'All' : f === 'ACTIVE' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>
          {shown.length > 1 && (
            <p className="text-sm text-muted-foreground">
              Combined: <span className="font-medium text-foreground">{formatKg(combined.kgInStore)}</span> in store ·{' '}
              <span className="font-medium text-foreground">{formatKg(combined.kgContracted)}</span> contracted, not received
              <span className="text-xs"> (shared lots counted once)</span>
            </p>
          )}
        </div>

        {data.error ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Couldn't load baskets: {(data.error as Error | null)?.message || 'unknown error'}
            </CardContent>
          </Card>
        ) : data.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : shown.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {data.baskets.length === 0 ? 'No baskets yet. Click "New Basket" to create one.' : 'No baskets match this filter.'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map(view => (
              <BasketCard
                key={view.basket.id}
                view={view}
                lotLabel={(id) => { const l = data.lotsById.get(id); return l ? data.lotLabel(l) : null; }}
                onOpen={() => navigate(`/sourcing/baskets/${view.basket.id}`)}
                onEdit={() => { setEditing(view.basket); setFormOpen(true); }}
                onToggleActive={() => m.updateBasket.mutate({ id: view.basket.id, is_active: !view.basket.is_active })}
                onDelete={() => setDeleting(view.basket)}
                onPromote={(v) => promote(view, v)}
                busy={m.setActivePct.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <BasketFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        basket={editing}
        existingNames={otherNames(editing?.id)}
        busy={m.createBasket.isPending || m.updateBasket.isPending}
        onSubmit={({ name, notes }) => {
          if (editing) {
            m.updateBasket.mutate({ id: editing.id, name, notes }, { onSuccess: () => setFormOpen(false) });
          } else {
            m.createBasket.mutate({ name, notes }, { onSuccess: (id) => { setFormOpen(false); navigate(`/sourcing/baskets/${id}`); } });
          }
        }}
      />

      <DeleteBasketDialog
        basket={deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        busy={m.deleteBasket.isPending || m.updateBasket.isPending}
        onConfirm={(b) => m.deleteBasket.mutate(b.id, { onSuccess: () => setDeleting(null) })}
        onDeactivate={(b) => m.updateBasket.mutate({ id: b.id, is_active: false }, { onSuccess: () => setDeleting(null) })}
      />
    </>
  );
}

function BasketCard({
  view, lotLabel, onOpen, onEdit, onToggleActive, onDelete, onPromote, busy,
}: {
  view: BasketView;
  lotLabel: (lotId: string) => string | null;
  onOpen: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onPromote: (v: BasketMemberView) => void;
  busy?: boolean;
}) {
  const { basket } = view;
  const groups = groupLinedUp(view.linedUp);
  return (
    <Card className={cn(!basket.is_active && 'opacity-70')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <button type="button" className="text-left min-w-0" onClick={onOpen}>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-base leading-tight hover:underline">{basket.name}</p>
              {!basket.is_active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
            </div>
            <p className="text-sm mt-1">
              {formatKg(view.volumes.kgInStore)} in store · {formatKg(view.volumes.kgContracted)} contracted, not received
            </p>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Basket actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-2" /> Rename / notes</DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleActive}>
                <Power className="h-3.5 w-3.5 mr-2" /> {basket.is_active ? 'Deactivate' : 'Reactivate'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <LowStockPrompt view={view} onPromote={onPromote} busy={busy} />
        <PctWarning view={view} />

        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active</p>
          {view.active.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active lots.</p>
          ) : view.active.map(v => (
            <div key={v.member.id} className="flex items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{v.lot.lot_number}</span>
                  {v.runningLow && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label="Running low" />}
                </div>
                {lotLabel(v.lot.id) && <p className="text-xs text-muted-foreground truncate">{lotLabel(v.lot.id)}</p>}
                <SharedWith names={v.sharedWith} />
              </div>
              <span className="font-medium tabular-nums shrink-0">{Number(v.member.active_pct)}%</span>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lined up</p>
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing lined up.</p>
          ) : groups.map(g => (
            <div key={g.group} className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{lineUpGroupLabel(g.group)}</p>
              {g.items.map(v => (
                <div key={v.member.id} className="flex flex-wrap items-center gap-1.5 text-sm pl-2">
                  <span>{v.lot.lot_number}</span>
                  <SupplyGroupBadge group={v.group} />
                  {v.useFirst && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-green-700 dark:text-green-400">
                      <Star className="h-3 w-3" /> Use first
                    </span>
                  )}
                  <SharedWith names={v.sharedWith} />
                </div>
              ))}
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={onOpen}>Manage lots</Button>
      </CardContent>
    </Card>
  );
}
