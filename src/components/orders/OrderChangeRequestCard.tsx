import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Check, ChevronDown, GitPullRequest, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { parseDateOnly } from '@/lib/dateOnly';
import { clientDeliveryLabel, stripSoonestPrefix } from '@/lib/clientOrderDisplay';

interface ChangeLine {
  line_item_id: string | null;
  product_id: string;
  product_name?: string;
  quantity_units: number;
}

interface ChangeState {
  line_items: ChangeLine[];
  requested_ship_date: string | null;
  delivery_method: string;
  client_po: string | null;
  client_notes: string | null;
}

interface ChangeRequestRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'WITHDRAWN' | 'AUTO_APPLIED';
  order_status_at_request: string;
  proposed: Partial<ChangeState>;
  snapshot: ChangeState;
  client_message: string | null;
  requested_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

interface DiffRow {
  label: string;
  before: string;
  after: string;
  kind: 'added' | 'removed' | 'changed';
}

const STATUS_LABEL: Record<ChangeRequestRow['status'], string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
  AUTO_APPLIED: 'Edited before confirmation',
};

const fmtShip = (d: string | null | undefined) => (d ? format(parseDateOnly(d)!, 'MMM d, yyyy') : 'Soonest');

function diffRequest(req: ChangeRequestRow, productNames: Map<string, string>): DiffRow[] {
  const rows: DiffRow[] = [];
  const before = req.snapshot;
  const after = req.proposed;

  if (after.line_items) {
    const beforeById = new Map(before.line_items.map((l) => [l.line_item_id, l]));
    const keptIds = new Set<string>();
    for (const l of after.line_items) {
      const name = productNames.get(l.product_id) ?? beforeById.get(l.line_item_id)?.product_name ?? 'Unknown product';
      if (l.line_item_id && beforeById.has(l.line_item_id)) {
        keptIds.add(l.line_item_id);
        const prev = beforeById.get(l.line_item_id)!;
        if (prev.quantity_units !== l.quantity_units) {
          rows.push({ label: name, before: String(prev.quantity_units), after: String(l.quantity_units), kind: 'changed' });
        }
      } else {
        rows.push({ label: name, before: '—', after: String(l.quantity_units), kind: 'added' });
      }
    }
    for (const prev of before.line_items) {
      if (!keptIds.has(prev.line_item_id!)) {
        rows.push({ label: prev.product_name ?? 'Unknown product', before: String(prev.quantity_units), after: 'removed', kind: 'removed' });
      }
    }
  }

  if ('requested_ship_date' in after && (after.requested_ship_date ?? null) !== (before.requested_ship_date ?? null)) {
    rows.push({ label: 'Requested ship date', before: fmtShip(before.requested_ship_date), after: fmtShip(after.requested_ship_date), kind: 'changed' });
  }
  if (after.delivery_method && clientDeliveryLabel(after.delivery_method) !== clientDeliveryLabel(before.delivery_method)) {
    rows.push({ label: 'Delivery', before: clientDeliveryLabel(before.delivery_method), after: clientDeliveryLabel(after.delivery_method), kind: 'changed' });
  }
  if ('client_po' in after && (after.client_po ?? '') !== (before.client_po ?? '')) {
    rows.push({ label: 'Client PO', before: before.client_po || '—', after: after.client_po || '—', kind: 'changed' });
  }
  if ('client_notes' in after && stripSoonestPrefix(after.client_notes) !== stripSoonestPrefix(before.client_notes)) {
    rows.push({
      label: 'Notes',
      before: stripSoonestPrefix(before.client_notes) || '—',
      after: stripSoonestPrefix(after.client_notes) || '—',
      kind: 'changed',
    });
  }
  return rows;
}

function DiffTable({ rows }: { rows: DiffRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No effective changes.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="pb-1 pr-3 font-medium">Item</th>
          <th className="pb-1 pr-3 font-medium">Now</th>
          <th className="pb-1 font-medium">Requested</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            <td className="py-1.5 pr-3">{r.label}</td>
            <td className="py-1.5 pr-3 text-muted-foreground">{r.before}</td>
            <td
              className={
                r.kind === 'added'
                  ? 'py-1.5 font-medium text-green-700'
                  : r.kind === 'removed'
                    ? 'py-1.5 font-medium text-destructive'
                    : 'py-1.5 font-medium'
              }
            >
              {r.kind === 'added' ? `+ ${r.after}` : r.after}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Props {
  orderId: string;
  orderStatus: string;
}

/**
 * Client change requests for an order: the pending one (with approve/decline)
 * and a collapsible history including edits made before confirmation.
 */
export function OrderChangeRequestCard({ orderId, orderStatus }: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const { data: requests = [] } = useQuery({
    queryKey: ['order-change-requests', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_change_requests')
        .select('id, status, order_status_at_request, proposed, snapshot, client_message, requested_at, resolved_at, resolution_note')
        .eq('order_id', orderId)
        .order('requested_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChangeRequestRow[];
    },
  });

  const productIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of requests) for (const l of r.proposed.line_items ?? []) ids.add(l.product_id);
    return [...ids];
  }, [requests]);

  const { data: productNames = new Map<string, string>() } = useQuery({
    queryKey: ['order-change-request-products', productIds],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, bag_size_g')
        .in('id', productIds);
      if (error) throw error;
      return new Map((data ?? []).map((p) => [p.id, p.product_name]));
    },
  });

  const pending = requests.find((r) => r.status === 'PENDING') ?? null;
  const history = requests.filter((r) => r.status !== 'PENDING');

  const resolveMutation = useMutation({
    mutationFn: async ({ approve }: { approve: boolean }) => {
      const { error } = await supabase.rpc('resolve_order_change_request', {
        p_request_id: pending!.id,
        p_approve: approve,
        p_note: note.trim() || undefined,
      });
      if (error) throw new Error(error.message);
      return approve;
    },
    onSuccess: (approve) => {
      const requestId = pending!.id;
      if (approve) {
        // Re-confirm to the client with the updated order.
        supabase.functions
          .invoke('confirm-order-email', { body: { order_id: orderId, revision: requestId } })
          .catch((e) => console.warn('[confirm-order-email] re-confirm failed:', e));
        toast.success('Change applied — updated confirmation sent to the client');
      } else {
        supabase.functions
          .invoke('notify-order-event', {
            body: {
              order_id: orderId,
              event_type: 'ORDER_CHANGE_DECLINED',
              details: note.trim() || undefined,
              idempotency_suffix: requestId,
            },
          })
          .catch((e) => console.warn('[notify-order-event] decline notify failed:', e));
        toast.success('Change declined — client notified');
      }
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['order-change-requests'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order-line-items', orderId] });
      queryClient.invalidateQueries({ queryKey: ['order-shipments', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to resolve request'),
  });

  if (requests.length === 0) return null;

  const canApprove = pending && !['SHIPPED', 'CANCELLED'].includes(orderStatus);

  return (
    <Card className={pending ? 'mt-6 border-amber-400' : 'mt-6'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitPullRequest className="h-5 w-5" />
          {pending ? 'Client change request' : 'Client edits'}
          {pending && <Badge className="bg-amber-500 hover:bg-amber-500">Needs review</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Requested {format(new Date(pending.requested_at), 'MMM d, h:mm a')} while the order was{' '}
              {pending.order_status_at_request.replace('_', ' ').toLowerCase()}. Nothing has changed yet.
            </p>
            {pending.client_message && (
              <blockquote className="border-l-2 pl-3 text-sm italic">{pending.client_message}</blockquote>
            )}
            <DiffTable rows={diffRequest(pending, productNames)} />
            <Textarea
              rows={2}
              placeholder="Note to the client (optional) — e.g. 'Too late to add; we've opened order #… for the extras.'"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => resolveMutation.mutate({ approve: true })}
                disabled={!canApprove || resolveMutation.isPending}
              >
                <Check className="mr-1 h-4 w-4" /> Approve & re-confirm
              </Button>
              <Button
                variant="outline"
                onClick={() => resolveMutation.mutate({ approve: false })}
                disabled={resolveMutation.isPending}
              >
                <X className="mr-1 h-4 w-4" /> Decline
              </Button>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-4 w-4" /> History ({history.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4">
              {history.map((r) => (
                <div key={r.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{STATUS_LABEL[r.status]}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.requested_at), 'MMM d, h:mm a')}
                    </span>
                  </div>
                  {r.client_message && <p className="text-sm italic">{r.client_message}</p>}
                  <DiffTable rows={diffRequest(r, productNames)} />
                  {r.resolution_note && (
                    <p className="text-xs text-muted-foreground">Note to client: {r.resolution_note}</p>
                  )}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
