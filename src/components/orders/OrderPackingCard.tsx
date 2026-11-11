import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Minus, Plus, Check, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatGramsLabel } from '@/components/GramPackagingBadge';
import { useAuthoritativeWip } from '@/hooks/useAuthoritativeInventory';
import { useWeightUnit } from '@/hooks/useWeightUnit';
import { addPacked } from '@/lib/orderPacking';

const ACTIVE = ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'];
const INVALIDATE = ['pack-line-allocations', 'order-pack-holds', 'packing-runs', 'authoritative-packing-runs', 'authoritative-wip-ledger', 'authoritative-fg-ledger', 'inventory-ledger-wip', 'inventory-ledger-fg', 'packing-runs-for-order'];

interface PackLine {
  id: string;
  product_id: string;
  quantity_units: number;
  needs_grind: boolean | null;
  grind_label: string | null;
  product: {
    product_name: string;
    bag_size_g: number | null;
    grams_per_unit: number | null;
    requires_production: boolean | null;
    roast_group: string | null;
    case_lot_units: number | null;
  } | null;
}

export function OrderPackingCard({ orderId, orderStatus }: { orderId: string; orderStatus: string }) {
  const qc = useQueryClient();
  const { data: wip } = useAuthoritativeWip();
  const { suffix, weightToDisplay } = useWeightUnit();
  const [busy, setBusy] = useState<string | null>(null);
  const active = ACTIVE.includes(orderStatus);

  const { data: lines = [] } = useQuery({
    queryKey: ['order-pack-lines', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select('id, product_id, quantity_units, needs_grind, grind_label, product:products(product_name, bag_size_g, grams_per_unit, requires_production, roast_group, case_lot_units)')
        .eq('order_id', orderId);
      if (error) throw error;
      return ((data ?? []) as unknown as PackLine[]).filter(l => l.product?.requires_production !== false);
    },
  });

  const { data: allocations = [] } = useQuery({
    queryKey: ['pack-line-allocations'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pack_line_allocations');
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10000,
    enabled: active,
  });
  const alloc = useMemo(() => new Map(allocations.map(a => [a.order_line_item_id, a])), [allocations]);

  const productIds = useMemo(() => [...new Set(lines.map(l => l.product_id))], [lines]);
  const { data: otherLines = [] } = useQuery({
    queryKey: ['order-pack-move-targets', orderId, productIds],
    enabled: active && productIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select('id, product_id, quantity_units, needs_grind, order:orders!inner(id, order_number, status)')
        .in('product_id', productIds)
        .neq('order_id', orderId)
        .in('order.status', ACTIVE);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; product_id: string; quantity_units: number; needs_grind: boolean | null; order: { order_number: string } }[];
    },
  });

  const refresh = () => Promise.all(INVALIDATE.map(k => qc.invalidateQueries({ queryKey: [k] })));

  const setPacked = async (lineId: string, units: number) => {
    const { error } = await supabase.rpc('update_pack_line_units', { p_line_ids: [lineId], p_new_units: units });
    if (error) { toast.error(error.message); throw error; }
  };

  const commit = async (lineId: string, units: number) => {
    setBusy(lineId);
    try { await setPacked(lineId, units); await refresh(); } catch { /* toasted */ } finally { setBusy(null); }
  };

  const move = async (fromId: string, toId: string, n: number) => {
    const from = alloc.get(fromId); const to = alloc.get(toId);
    const target = otherLines.find(l => l.id === toId);
    if (!from || !to || !target || n <= 0) return;
    const movable = Math.min(n, from.packed_units - from.picked_units, target.quantity_units - to.packed_units);
    if (movable <= 0) { toast.error('Nothing can be moved to that order'); return; }
    setBusy(fromId);
    try {
      await setPacked(fromId, from.packed_units - movable);
      await setPacked(toId, to.packed_units + movable);
      toast.success(`Moved ${movable} to ${target.order.order_number}`);
    } catch { /* toasted */ } finally { await refresh(); setBusy(null); }
  };

  if (!active || lines.length === 0) return null;

  const rows = lines.map(l => {
    const a = alloc.get(l.id);
    const packed = a?.packed_units ?? 0;
    const picked = a?.picked_units ?? 0;
    return { l, packed, picked, remaining: Math.max(0, l.quantity_units - packed), done: packed >= l.quantity_units };
  }).sort((x, y) => Number(x.done) - Number(y.done));
  const totalNeed = rows.reduce((s, r) => s + r.l.quantity_units, 0);
  const totalPacked = rows.reduce((s, r) => s + Math.min(r.packed, r.l.quantity_units), 0);

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-4">
          <span>Packing</span>
          <span className="text-sm font-normal text-muted-foreground">{totalPacked} of {totalNeed} packed</span>
        </CardTitle>
        <Progress value={totalNeed ? (totalPacked / totalNeed) * 100 : 0} className="h-2" />
        <p className="text-xs text-muted-foreground pt-1">Same counts as the Pack tab. Bags packed here are held for this order until picked.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(r => (
          <PackRow
            key={r.l.id}
            row={r}
            wipKg={r.l.product?.roast_group ? wip?.[r.l.product.roast_group]?.wip_available_kg ?? 0 : null}
            wipLabel={(kg) => `${weightToDisplay(kg).toFixed(1)} ${suffix}`}
            busy={busy === r.l.id}
            onCommit={(u) => commit(r.l.id, u)}
            moveTargets={otherLines.filter(o => o.product_id === r.l.product_id && !!o.needs_grind === !!r.l.needs_grind)}
            onMove={(to, n) => move(r.l.id, to, n)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function PackRow({ row, wipKg, wipLabel, busy, onCommit, moveTargets, onMove }: {
  row: { l: PackLine; packed: number; picked: number; remaining: number; done: boolean };
  wipKg: number | null;
  wipLabel: (kg: number) => string;
  busy: boolean;
  onCommit: (units: number) => void;
  moveTargets: { id: string; order: { order_number: string } }[];
  onMove: (toLineId: string, n: number) => void;
}) {
  const { l, packed, picked, remaining, done } = row;
  const [add, setAdd] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [moveN, setMoveN] = useState('');
  const p = l.product;
  const grams = p?.grams_per_unit ?? p?.bag_size_g ?? null;
  const caseUnits = p?.case_lot_units ?? null;
  const remainingKg = grams ? (remaining * grams) / 1000 : 0;
  const shortWip = wipKg !== null && remaining > 0 && wipKg + 1e-9 < remainingKg;
  const held = packed - picked;
  const set = (u: number) => onCommit(addPacked(0, u, picked, l.quantity_units));

  const submitAdd = () => {
    const n = parseInt(add, 10);
    if (!Number.isFinite(n) || n === 0) { setAdd(''); return; }
    onCommit(addPacked(packed, n, picked, l.quantity_units));
    setAdd('');
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${done ? 'opacity-50' : ''}`}>
      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {p?.product_name ?? 'Unknown'}
          {grams ? <Badge variant="outline" className="text-xs">{formatGramsLabel(grams)}</Badge> : null}
          {l.needs_grind ? <Badge variant="secondary" className="text-xs uppercase">Grind: {l.grind_label || 'Grind'}</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
          {caseUnits ? <span>{caseUnits} bags per case · {remaining * caseUnits} bags to go</span> : null}
          {held > 0 ? <span>{held} packed · held on shelf</span> : null}
          {picked > 0 ? <span>{picked} picked</span> : null}
          {wipKg !== null && !done ? (
            <span className={shortWip ? 'text-destructive flex items-center gap-1' : ''}>
              {shortWip && <AlertTriangle className="h-3 w-3" />}WIP {wipLabel(wipKg)} available · needs {wipLabel(remainingKg)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="text-right w-24">
        <div className="text-2xl font-bold leading-none">{done ? <Check className="h-6 w-6 inline text-primary" /> : remaining}</div>
        <div className="text-xs text-muted-foreground">{packed}/{l.quantity_units} {caseUnits ? 'cases' : 'packed'}</div>
      </div>

      <div className="flex items-center gap-1">
        <Button size="icon" variant="outline" className="h-8 w-8" disabled={busy || packed <= picked} onClick={() => onCommit(packed - 1)} aria-label="One less"><Minus className="h-4 w-4" /></Button>
        <Input
          className="h-8 w-20" inputMode="numeric" placeholder="+ add" value={add} disabled={busy || done}
          onChange={e => setAdd(e.target.value.replace(/[^0-9-]/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') setAdd(''); }}
          onBlur={submitAdd}
          aria-label="Add packed units"
        />
        <Button size="icon" variant="outline" className="h-8 w-8" disabled={busy || done} onClick={() => onCommit(packed + 1)} aria-label="One more"><Plus className="h-4 w-4" /></Button>
        <Button size="sm" variant="secondary" className="h-8" disabled={busy || done} onClick={() => set(l.quantity_units)}>All packed</Button>
        {held > 0 && moveTargets.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Move packed to another order"><ArrowRightLeft className="h-4 w-4" /></Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-2">
              <p className="text-sm font-medium">Move packed bags to another order</p>
              <Select value={moveTo} onValueChange={setMoveTo}>
                <SelectTrigger><SelectValue placeholder="Choose order" /></SelectTrigger>
                <SelectContent>
                  {moveTargets.map(t => <SelectItem key={t.id} value={t.id}>{t.order.order_number}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input inputMode="numeric" placeholder={`Up to ${held}`} value={moveN} onChange={e => setMoveN(e.target.value.replace(/\D/g, ''))} />
              <Button size="sm" className="w-full" disabled={!moveTo || !moveN || busy} onClick={() => { onMove(moveTo, parseInt(moveN, 10)); setMoveN(''); }}>Move</Button>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
