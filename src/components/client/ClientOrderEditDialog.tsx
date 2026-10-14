import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { toast } from 'sonner';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { formatGramsLabel } from '@/components/GramPackagingBadge';
import { blockNonIntegerKeys } from '@/lib/numericInput';
import { CHANGE_REQUEST_STATUSES, stripSoonestPrefix, withSoonestPrefix } from '@/lib/clientOrderDisplay';
import {
  useClientOrderableProducts,
  type ClientOrderableProduct,
} from '@/hooks/useClientOrderableProducts';

/** Shape accepted by the client_edit_order RPC (and stored on change requests). */
export interface OrderChangePayload {
  line_items: { line_item_id: string | null; product_id: string; quantity_units: number }[];
  requested_ship_date: string | null;
  delivery_method: 'PICKUP' | 'DELIVERY';
  client_po: string | null;
  client_notes: string | null;
}

export interface EditableOrder {
  id: string;
  order_number: string;
  status: string;
  account_id: string | null;
  requested_ship_date: string | null;
  delivery_method: string;
  client_po: string | null;
  client_notes: string | null;
}

export interface EditableLineItem {
  id: string;
  product_id: string;
  quantity_units: number;
  product_name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: EditableOrder;
  lineItems: EditableLineItem[];
  /** A pending change request to start from instead of the live order. */
  pendingProposal?: OrderChangePayload | null;
}

interface Row {
  key: string;
  line_item_id: string | null;
  product_id: string;
  quantity: number;
}

function productLabel(p: ClientOrderableProduct): string {
  const grams = p.grams_per_unit ?? p.bag_size_g;
  const pack = p.packaging_types?.name;
  const size = grams ? formatGramsLabel(grams) : null;
  const detail = [pack, size].filter(Boolean).join(' · ');
  return detail ? `${p.product_name} — ${detail}` : p.product_name;
}

let rowSeq = 0;
const nextKey = () => `row_${++rowSeq}`;

export function ClientOrderEditDialog({ open, onOpenChange, order, lineItems, pendingProposal }: Props) {
  const queryClient = useQueryClient();
  const { data: products = [] } = useClientOrderableProducts(order.account_id);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const existingNameById = useMemo(
    () => new Map(lineItems.map((li) => [li.product_id, li.product_name])),
    [lineItems],
  );

  const isRequest = CHANGE_REQUEST_STATUSES.includes(order.status);
  const inProduction = order.status === 'IN_PRODUCTION' || order.status === 'READY';

  const [rows, setRows] = useState<Row[]>([]);
  const [shipPreference, setShipPreference] = useState<'SOONEST' | 'SPECIFIC'>('SOONEST');
  const [shipDate, setShipDate] = useState<string>('');
  const [deliveryMethod, setDeliveryMethod] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [clientPo, setClientPo] = useState('');
  const [clientNotes, setClientNotes] = useState('');
  const [message, setMessage] = useState('');
  const [addProductId, setAddProductId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset the form from the live order (or the pending proposal) on open.
  useEffect(() => {
    if (!open) return;
    const source: OrderChangePayload = pendingProposal ?? {
      line_items: lineItems.map((li) => ({
        line_item_id: li.id,
        product_id: li.product_id,
        quantity_units: li.quantity_units,
      })),
      requested_ship_date: order.requested_ship_date,
      delivery_method: order.delivery_method === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
      client_po: order.client_po,
      client_notes: order.client_notes,
    };
    setRows(
      source.line_items.map((li) => ({
        key: nextKey(),
        line_item_id: li.line_item_id,
        product_id: li.product_id,
        quantity: li.quantity_units,
      })),
    );
    setShipPreference(source.requested_ship_date ? 'SPECIFIC' : 'SOONEST');
    setShipDate(source.requested_ship_date ?? '');
    setDeliveryMethod(source.delivery_method === 'PICKUP' ? 'PICKUP' : 'DELIVERY');
    setClientPo(source.client_po ?? '');
    setClientNotes(stripSoonestPrefix(source.client_notes));
    setMessage('');
    setAddProductId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const minSpecificDate = useMemo(() => addDays(new Date(), 3), []);

  const nameFor = (productId: string) => {
    const p = productById.get(productId);
    return p ? productLabel(p) : existingNameById.get(productId) ?? 'Unknown product';
  };

  const addRow = () => {
    if (!addProductId) return;
    // Bump an existing new line for the same product instead of duplicating it.
    const existing = rows.find((r) => r.product_id === addProductId && !r.line_item_id);
    if (existing) {
      setRows(rows.map((r) => (r.key === existing.key ? { ...r, quantity: r.quantity + 1 } : r)));
    } else {
      setRows([...rows, { key: nextKey(), line_item_id: null, product_id: addProductId, quantity: 1 }]);
    }
    setAddProductId('');
  };

  const buildPayload = (): OrderChangePayload => ({
    line_items: rows.map((r) => ({
      line_item_id: r.line_item_id,
      product_id: r.product_id,
      quantity_units: r.quantity,
    })),
    requested_ship_date: shipPreference === 'SPECIFIC' && shipDate ? shipDate : null,
    delivery_method: deliveryMethod,
    client_po: clientPo.trim() || null,
    client_notes:
      shipPreference === 'SOONEST' ? withSoonestPrefix(clientNotes) : clientNotes.trim() || null,
  });

  const handleSubmit = async () => {
    if (!order.account_id) return;
    if (rows.length === 0) {
      toast.error('An order needs at least one item. To drop the whole order, cancel it instead.');
      return;
    }
    if (rows.some((r) => !Number.isInteger(r.quantity) || r.quantity <= 0)) {
      toast.error('Quantities must be whole numbers greater than zero.');
      return;
    }
    if (shipPreference === 'SPECIFIC' && !shipDate) {
      toast.error('Pick a ship date, or choose "Soonest possible".');
      return;
    }

    setSubmitting(true);
    try {
      const payload = buildPayload();

      const { data: validation, error: validationError } = await supabase.functions.invoke(
        'validate-order-constraints',
        {
          body: {
            account_id: order.account_id,
            line_items: payload.line_items.map((li) => ({
              product_id: li.product_id,
              quantity_units: li.quantity_units,
            })),
          },
        },
      );
      if (validationError) throw new Error('Failed to validate order');
      if (validation && !validation.valid) {
        for (const err of validation.errors ?? []) toast.error(err);
        return;
      }

      const { data, error } = await supabase.rpc('client_edit_order', {
        p_order_id: order.id,
        p_changes: payload as unknown as Json,
        p_message: message.trim() || undefined,
      });
      if (error) throw new Error(error.message);

      const result = (data ?? {}) as { mode?: 'APPLIED' | 'REQUESTED'; request_id?: string };
      const requested = result.mode === 'REQUESTED';

      supabase.functions
        .invoke('notify-order-event', {
          body: {
            order_id: order.id,
            event_type: 'ORDER_CLIENT_EDITED',
            idempotency_suffix: result.request_id,
            details: [
              requested
                ? 'Change REQUESTED on a confirmed order — review and approve or decline it on the order page. The order is unchanged until then.'
                : 'Client edited the order before confirmation (changes already applied).',
              message.trim() ? `Client message: ${message.trim()}` : null,
            ]
              .filter(Boolean)
              .join(' '),
          },
        })
        .catch((e) => console.warn('[notify-order-event] edit notify failed:', e));

      toast.success(
        requested
          ? 'Change requested — Home Island will review and re-confirm.'
          : `Order ${order.order_number} updated.`,
      );
      queryClient.invalidateQueries({ queryKey: ['client-orders'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['client-orders-line-items'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['client-order-line-items', order.id] });
      queryClient.invalidateQueries({ queryKey: ['client-order-change-requests'], exact: false });
      onOpenChange(false);
    } catch (err) {
      console.error('Order edit error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSubmitting(false);
    }
  };

  const addableProducts = products.filter(
    (p) => !rows.some((r) => r.product_id === p.id && !r.line_item_id),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isRequest ? 'Request a change' : 'Edit order'} — {order.order_number}
          </DialogTitle>
          <DialogDescription>
            {isRequest
              ? 'Your order is already confirmed, so changes go to Home Island for review. Nothing changes until we re-confirm it.'
              : "We haven't confirmed this order yet, so your changes apply right away."}
          </DialogDescription>
        </DialogHeader>

        {inProduction && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              We're already roasting or packing this order. We'll do our best, but we may not be able to
              make every change. If you're adding items, we may ship them as a separate order with its own
              ship date.
            </AlertDescription>
          </Alert>
        )}
        {pendingProposal && (
          <p className="text-sm text-muted-foreground">
            Starting from your pending request. Sending this replaces it.
          </p>
        )}

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Items</Label>
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No items. Add at least one.</p>
            )}
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <div className="flex-1 text-sm">
                  {nameFor(r.product_id)}
                  {!r.line_item_id && <span className="ml-2 text-xs text-primary">new</span>}
                </div>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  className="w-24"
                  value={r.quantity || ''}
                  onKeyDown={blockNonIntegerKeys}
                  onChange={(e) => {
                    const q = parseInt(e.target.value, 10);
                    setRows(rows.map((x) => (x.key === r.key ? { ...x, quantity: Number.isNaN(q) ? 0 : q } : x)));
                  }}
                  aria-label={`Quantity for ${nameFor(r.product_id)}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                  aria-label="Remove item"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <Select value={addProductId} onValueChange={setAddProductId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Add a product…" />
                </SelectTrigger>
                <SelectContent>
                  {addableProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {productLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={addRow} disabled={!addProductId}>
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>When do you need this order?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1"
                variant={shipPreference === 'SOONEST' ? 'default' : 'outline'}
                onClick={() => setShipPreference('SOONEST')}
              >
                Soonest possible
              </Button>
              <Button
                type="button"
                className="flex-1"
                variant={shipPreference === 'SPECIFIC' ? 'default' : 'outline'}
                onClick={() => setShipPreference('SPECIFIC')}
              >
                Specific date
              </Button>
            </div>
            {shipPreference === 'SPECIFIC' && (
              <DatePicker
                value={shipDate || null}
                onChange={(v) => setShipDate(v ?? '')}
                minDate={minSpecificDate}
              />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-delivery">Delivery method</Label>
              <Select value={deliveryMethod} onValueChange={(v) => setDeliveryMethod(v as 'PICKUP' | 'DELIVERY')}>
                <SelectTrigger id="edit-delivery">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PICKUP">Pickup</SelectItem>
                  <SelectItem value="DELIVERY">Delivered</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-po">PO number</Label>
              <Input id="edit-po" value={clientPo} onChange={(e) => setClientPo(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-notes">Order notes</Label>
            <Textarea id="edit-notes" rows={2} value={clientNotes} onChange={(e) => setClientNotes(e.target.value)} />
          </div>

          {isRequest && (
            <div className="space-y-1">
              <Label htmlFor="edit-message">Message to Home Island (optional)</Label>
              <Textarea
                id="edit-message"
                rows={2}
                placeholder="e.g. Sorry — meant 6 bags, not 60."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : isRequest ? 'Send change request' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
