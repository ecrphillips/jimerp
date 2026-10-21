import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpCircle, Layers, ShoppingBasket, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { parseDateOnly } from '@/lib/dateOnly';
import { findRoastGroupsUsingBasket } from '@/lib/basketDeleteGuard';
import {
  lotExpectedKg,
  normalizeBasketName,
  SUPPLY_GROUP_LABEL,
  SUPPLY_GROUP_ORDER,
  type BasketMemberView,
  type BasketRow,
  type BasketView,
  type LotSupplyGroup,
} from '@/lib/baskets';

// ─── Small display helpers ───────────────────────────────────────────────

export function formatKg(kg: number): string {
  return `${Math.round(kg).toLocaleString()} kg`;
}

function fmtDate(d: string | null): string | null {
  const p = parseDateOnly(d);
  return p ? format(p, 'MMM d, yyyy') : null;
}

const GROUP_BADGE: Record<LotSupplyGroup, { label: string; cls: string }> = {
  IN_STORE: { label: 'In store', cls: 'bg-muted text-muted-foreground' },
  CONTRACTED: { label: 'En route', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  PLANNED: { label: 'Planned', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200' },
};

export function SupplyGroupBadge({ group }: { group: LotSupplyGroup }) {
  const g = GROUP_BADGE[group];
  return <Badge variant="outline" className={`${g.cls} border-0 text-xs`}>{g.label}</Badge>;
}

/** "Shared with Brazil, Natural" — shown wherever a shared lot appears. */
export function SharedWith({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300">
      <Layers className="h-3 w-3 shrink-0" />
      Shared with {names.join(', ')}
    </span>
  );
}

/** One-line facts about a lot: kg and the relevant date. */
export function lotFacts(v: BasketMemberView): string {
  const { lot, group } = v;
  if (group === 'IN_STORE') {
    const rec = fmtDate(lot.received_date);
    return `${formatKg(Number(lot.kg_on_hand) || 0)} on hand${rec ? ` · received ${rec}` : ''}`;
  }
  const exp = fmtDate(lot.expected_delivery_date);
  const kg = lotExpectedKg(lot);
  if (group === 'CONTRACTED') return `${kg > 0 ? formatKg(kg) : '— kg'} coming${exp ? ` · expected ${exp}` : ''}`;
  return kg > 0 ? `${formatKg(kg)} planned` : 'Quantity not set';
}

/** Lot identity + flags. Used in list and detail views. */
export function BasketLotSummary({ v, label }: { v: BasketMemberView; label: string | null }) {
  return (
    <div className="min-w-0 flex-1 space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">{v.lot.lot_number}</span>
        <SupplyGroupBadge group={v.group} />
        {v.useFirst && (
          <Badge variant="outline" className="border-0 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs gap-1">
            <Star className="h-3 w-3" /> Use first
          </Badge>
        )}
        {v.runningLow && (
          <Badge variant="outline" className="border-0 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs gap-1">
            <AlertTriangle className="h-3 w-3" /> Running low
          </Badge>
        )}
      </div>
      {label && <p className="text-xs text-muted-foreground truncate">{label}</p>}
      <p className="text-xs text-muted-foreground">{lotFacts(v)}</p>
      <SharedWith names={v.sharedWith} />
    </div>
  );
}

/** Lined-up lots split into the three automatic groups. */
export function groupLinedUp(linedUp: BasketMemberView[]): { group: LotSupplyGroup; items: BasketMemberView[] }[] {
  return SUPPLY_GROUP_ORDER
    .map(group => ({ group, items: linedUp.filter(v => v.group === group) }))
    .filter(g => g.items.length > 0);
}

export function lineUpGroupLabel(group: LotSupplyGroup): string {
  return SUPPLY_GROUP_LABEL[group];
}

// ─── Warnings / prompts ──────────────────────────────────────────────────

export function PctWarning({ view }: { view: BasketView }) {
  if (!view.pctOff) return null;
  const total = Math.round(view.pctTotal * 100) / 100;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>Active lots add up to {total}%, not 100%. This is saved as entered — adjust when ready.</span>
    </div>
  );
}

/**
 * Shown when an active lot is running low. Offers to promote the top
 * lined-up lot; the person still chooses.
 */
export function LowStockPrompt({
  view,
  onPromote,
  busy,
}: {
  view: BasketView;
  onPromote: (v: BasketMemberView) => void;
  busy?: boolean;
}) {
  if (view.lowActive.length === 0) return null;
  const lowNames = view.lowActive.map(v => v.lot.lot_number).join(', ');
  const next = view.nextUp;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 min-w-0">
        {lowNames} {view.lowActive.length === 1 ? 'is' : 'are'} running low.
        {next ? ` Next up: ${next.lot.lot_number}.` : ' No lot is lined up.'}
      </span>
      {next && (
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => onPromote(next)}>
          <ArrowUpCircle className="h-3.5 w-3.5" /> Promote {next.lot.lot_number}
        </Button>
      )}
    </div>
  );
}

// ─── Create / rename dialog ──────────────────────────────────────────────

export function BasketFormDialog({
  open,
  onOpenChange,
  basket,
  existingNames,
  onSubmit,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit this basket; omit to create. */
  basket?: BasketRow | null;
  /** Normalised names of other baskets, for the duplicate check. */
  existingNames: string[];
  onSubmit: (values: { name: string; notes: string }) => void;
  busy?: boolean;
}) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setName(basket?.name ?? '');
      setNotes(basket?.notes ?? '');
    }
  }, [open, basket]);

  const trimmed = name.trim();
  const duplicate = trimmed !== '' && existingNames.includes(normalizeBasketName(trimmed));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{basket ? 'Edit basket' : 'New basket'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed || duplicate) return;
            onSubmit({ name: trimmed, notes });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="basket-name">Name</Label>
            <Input id="basket-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Washed Ethiopia" autoFocus />
            {duplicate && <p className="text-xs text-destructive">A basket with that name already exists.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="basket-notes">Notes</Label>
            <Textarea id="basket-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!trimmed || duplicate || busy}>{basket ? 'Save' : 'Create basket'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete dialog (guarded) ─────────────────────────────────────────────

export function DeleteBasketDialog({
  basket,
  onOpenChange,
  onConfirm,
  onDeactivate,
  busy,
}: {
  basket: BasketRow | null;
  onOpenChange: (o: boolean) => void;
  onConfirm: (b: BasketRow) => void;
  onDeactivate: (b: BasketRow) => void;
  busy?: boolean;
}) {
  const [usedBy, setUsedBy] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUsedBy(null);
    if (basket) {
      findRoastGroupsUsingBasket(basket.id)
        .then(names => { if (!cancelled) setUsedBy(names); })
        .catch(() => { if (!cancelled) setUsedBy([]); });
    }
    return () => { cancelled = true; };
  }, [basket]);

  const blocked = !!usedBy && usedBy.length > 0;

  return (
    <AlertDialog open={!!basket} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete basket "{basket?.name}"?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            {usedBy === null ? (
              <span className="block">Checking whether any roast group uses this basket…</span>
            ) : blocked ? (
              <span className="block text-destructive">
                This basket can't be deleted because it is used by: {usedBy.join(', ')}. You can deactivate it instead.
              </span>
            ) : (
              <>
                <span className="block">This removes the basket and its list of lots. The green lots themselves are not touched.</span>
                <span className="block">To keep it for later, deactivate it instead.</span>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {basket?.is_active && (
            <Button variant="outline" onClick={() => basket && onDeactivate(basket)} disabled={busy}>Deactivate</Button>
          )}
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={usedBy === null || blocked || busy}
            onClick={(e) => { e.preventDefault(); if (basket) onConfirm(basket); }}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Basket tags (green inventory) ───────────────────────────────────────

/**
 * Basket name tags for a lot on the green inventory page. Informational only:
 * being in a basket never stops a lot being used anywhere else.
 */
export function BasketTags({
  tags,
}: {
  tags: { id: string; name: string; is_active: boolean; active: boolean }[] | undefined;
}) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tags.map(t => (
        <Link key={t.id} to={`/sourcing/baskets/${t.id}`} onClick={(e) => e.stopPropagation()}>
          <Badge
            variant="outline"
            className={`text-[10px] gap-1 border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950 ${t.is_active ? '' : 'opacity-60'}`}
            title={`${t.active ? 'Active' : 'Lined up'} in basket ${t.name}${t.is_active ? '' : ' (inactive basket)'}${tags.length > 1 ? ' — shared lot' : ''}`}
          >
            <ShoppingBasket className="h-3 w-3" /> {t.name}
          </Badge>
        </Link>
      ))}
    </span>
  );
}
