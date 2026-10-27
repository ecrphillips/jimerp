import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Lock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useAuthoritativeWip, useAuthoritativeFg } from '@/hooks/useAuthoritativeInventory';
import { useBlendHolds } from '@/hooks/useBlendHolds';
import {
  useDayClose, useCloseDay, useReopenDay, useRecentRoastTimes, summarizeRoasterDay,
  vancouverDate, vancouverTime, type DayCloseKind,
} from '@/hooks/useDayClose';

const NEG_EPS = 0.05;

interface Props {
  kind: DayCloseKind;
  today: string;
  /** Roast: planned batches still needed for today, by roast group label. */
  remainingNeeded?: { label: string; count: number }[];
}

function Section({ title, blocking, count, ack, onAck, children }: {
  title: string; blocking?: boolean; count: number; ack?: boolean; onAck?: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-sm">
          {count === 0 ? <CheckCircle2 className="h-4 w-4 text-primary" /> : blocking ? <AlertTriangle className="h-4 w-4 text-destructive" /> : null}
          {title}
          {count > 0 && <Badge variant={blocking ? 'destructive' : 'secondary'}>{count}</Badge>}
        </div>
        {blocking && count > 0 && onAck && (
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={!!ack} onCheckedChange={(v) => onAck(v === true)} />
            Checked
          </label>
        )}
      </div>
      {count > 0 ? <div className="text-sm space-y-1">{children}</div> : <p className="text-xs text-muted-foreground">All clear.</p>}
    </div>
  );
}

export function CloseDayPanel({ kind, today, remainingNeeded = [] }: Props) {
  const { user, role } = useAuth();
  const isAdmin = role === 'ADMIN';
  const { data: closed } = useDayClose(today, kind);
  const closeDay = useCloseDay();
  const reopen = useReopenDay();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [acks, setAcks] = useState<Record<string, boolean>>({});

  const { data: wip } = useAuthoritativeWip();
  const { data: fg } = useAuthoritativeFg();
  const { data: holds } = useBlendHolds();
  const { data: roastTimes } = useRecentRoastTimes(1);

  const negWip = useMemo(() => Object.values(wip ?? {}).filter((w) => w.wip_net_kg < -NEG_EPS), [wip]);
  const negFg = useMemo(() => Object.values(fg ?? {}).filter((f) => f.fg_available_units < 0), [fg]);
  const leftoverHolds = useMemo(() => (holds ?? []).filter((h) => h.roasted_at && vancouverDate(h.roasted_at) <= today), [holds, today]);
  const roasterDay = useMemo(() => summarizeRoasterDay(roastTimes ?? [], today), [roastTimes, today]);

  const { data: shipData } = useQuery({
    queryKey: ['close-day-ship', today],
    enabled: kind === 'SHIP' && open,
    queryFn: async () => {
      const [due, shipped] = await Promise.all([
        supabase.from('orders').select('id, order_number, status, work_deadline')
          .lte('work_deadline', today).not('status', 'in', '(SHIPPED,CANCELLED,DRAFT)'),
        supabase.from('orders').select('id, order_number, shipping_cost_cad, shipped_at')
          .eq('status', 'SHIPPED').gte('shipped_at', new Date(Date.now() - 2 * 86400000).toISOString()),
      ]);
      if (due.error) throw due.error;
      if (shipped.error) throw shipped.error;
      return {
        unshipped: due.data ?? [],
        noShipCost: (shipped.data ?? []).filter((o) => o.shipped_at && vancouverDate(o.shipped_at) === today && o.shipping_cost_cad == null),
      };
    },
  });

  const remainingCount = kind === 'ROAST'
    ? remainingNeeded.reduce((s, r) => s + r.count, 0)
    : (shipData?.unshipped.length ?? 0);
  const ready = kind === 'ROAST' ? remainingCount === 0 : true;
  const forced = remainingCount > 0;

  const blockers: { key: string; count: number }[] = [
    { key: 'negWip', count: negWip.length },
    { key: 'negFg', count: negFg.length },
    ...(kind === 'ROAST' ? [{ key: 'holds', count: leftoverHolds.length }] : [{ key: 'unshipped', count: shipData?.unshipped.length ?? 0 }]),
  ];
  const allAcked = blockers.every((b) => b.count === 0 || acks[b.key]);
  const canSubmit = allAcked && (!forced || (isAdmin && notes.trim().length > 0));

  const submit = async () => {
    if (!user) return;
    try {
      await closeDay.mutateAsync({
        workDate: today, kind, userId: user.id, forced, notes: notes.trim() || null,
        snapshot: {
          negative_wip: negWip.map((w) => ({ roast_group: w.roast_group, kg: w.wip_net_kg })),
          negative_fg: negFg.map((f) => ({ product: f.product_name, units: f.fg_available_units })),
          ...(kind === 'ROAST'
            ? { remaining_needed: remainingNeeded, blend_holds: leftoverHolds.length, roasters: roasterDay }
            : { unshipped: shipData?.unshipped ?? [], missing_shipping_cost: shipData?.noShipCost ?? [] }),
        },
      });
      toast.success(kind === 'ROAST' ? 'Roasting closed for today' : 'Shipping closed for today');
      setOpen(false); setNotes(''); setAcks({});
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const label = kind === 'ROAST' ? 'Close today' : 'Close shipping';

  if (closed) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Lock className="h-3 w-3" />
          {kind === 'ROAST' ? 'Today closed' : 'Shipping closed'} · {vancouverTime(closed.closed_at)}
        </Badge>
        <Button size="sm" variant="ghost" className="h-7 text-xs"
          onClick={() => user && reopen.mutate({ id: closed.id, userId: user.id })}>
          Reopen
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" variant={ready ? 'default' : 'outline'} disabled={!ready && !isAdmin}
        onClick={() => setOpen(true)}
        title={!ready ? `${remainingCount} batch${remainingCount === 1 ? '' : 'es'} still needed today` : undefined}>
        <Lock className="h-4 w-4 mr-1" />
        {label}
        {kind === 'ROAST' && remainingCount > 0 && <span className="ml-1 text-xs">({remainingCount} left)</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{label} · {today}</DialogTitle>
            <DialogDescription>Check off each item before closing. Nothing here changes inventory.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {kind === 'ROAST' && (
              <Section title="Batches still needed today" count={remainingCount}>
                {remainingNeeded.map((r) => <div key={r.label}>{r.label} · {r.count} planned</div>)}
              </Section>
            )}
            {kind === 'SHIP' && (
              <Section title="Orders due today not shipped" blocking count={shipData?.unshipped.length ?? 0}
                ack={acks.unshipped} onAck={(v) => setAcks((a) => ({ ...a, unshipped: v }))}>
                {shipData?.unshipped.map((o) => (
                  <div key={o.id}><Link className="underline" to={`/orders/${o.id}`}>{o.order_number}</Link> · {o.status} · due {o.work_deadline}</div>
                ))}
              </Section>
            )}
            <Section title="Negative WIP (roast groups)" blocking count={negWip.length}
              ack={acks.negWip} onAck={(v) => setAcks((a) => ({ ...a, negWip: v }))}>
              {negWip.map((w) => <div key={w.roast_group}>{w.roast_group.replace(/_/g, ' ')} · {w.wip_net_kg.toFixed(1)} kg</div>)}
              <Link to="/inventory" className="text-xs underline">Fix on Inventory</Link>
            </Section>
            <Section title="Negative finished stock (products)" blocking count={negFg.length}
              ack={acks.negFg} onAck={(v) => setAcks((a) => ({ ...a, negFg: v }))}>
              {negFg.map((f) => <div key={f.product_id}>{f.product_name} · {f.fg_available_units} units</div>)}
              <Link to="/products?tab=fg-inventory" className="text-xs underline">Fix floor counts</Link>
            </Section>
            {kind === 'ROAST' && (
              <Section title="Blend holds not yet blended" blocking count={leftoverHolds.length}
                ack={acks.holds} onAck={(v) => setAcks((a) => ({ ...a, holds: v }))}>
                {leftoverHolds.map((h) => <div key={h.id}>{h.roast_group.replace(/_/g, ' ')} → {h.planned_for_blend_roast_group.replace(/_/g, ' ')} · {h.actual_output_kg.toFixed(1)} kg</div>)}
                <p className="text-xs text-muted-foreground">Blend now, or release on the Inventory page.</p>
              </Section>
            )}
            {kind === 'SHIP' && (
              <Section title="Shipped today with no shipping cost" count={shipData?.noShipCost.length ?? 0}>
                {shipData?.noShipCost.map((o) => <div key={o.id}><Link className="underline" to={`/orders/${o.id}`}>{o.order_number}</Link></div>)}
              </Section>
            )}
            {kind === 'ROAST' && (
              <div className="rounded-md border p-3 text-sm space-y-1">
                <div className="font-medium">Roasted today</div>
                {roasterDay.length === 0 ? <p className="text-xs text-muted-foreground">No batches roasted today.</p> :
                  roasterDay.map((r) => (
                    <div key={r.roaster}>{r.roaster} · {r.batches} batches · {r.kg.toFixed(1)} kg · {vancouverTime(r.first)}–{vancouverTime(r.last)}</div>
                  ))}
              </div>
            )}
            <Textarea placeholder={forced ? 'Reason for closing early (required)' : 'Notes (optional)'} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!canSubmit || closeDay.isPending}>{forced ? 'Force close' : label}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
