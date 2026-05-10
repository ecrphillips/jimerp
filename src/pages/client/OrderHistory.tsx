import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { usePreview } from '@/contexts/PreviewContext';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { LocationCodeDisplay } from '@/components/orders/LocationSelect';

interface Order {
  id: string;
  order_number: string;
  status: string;
  requested_ship_date: string | null;
  work_deadline_at: string | null;
  delivery_method: string;
  client_po: string | null;
  client_notes: string | null;
  created_at: string;
  location_id: string | null;
}

interface LineItemSummary {
  order_id: string;
  quantity_units: number;
  product: { product_name: string } | null;
}

export default function OrderHistory() {
  const queryClient = useQueryClient();
  const { previewAccountId } = usePreview();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const { data: orders, isLoading, error } = useQuery({
    queryKey: ['client-orders', previewAccountId],
    queryFn: async () => {
      let q = supabase
        .from('orders')
        .select('id, order_number, status, requested_ship_date, work_deadline_at, delivery_method, client_po, client_notes, created_at, location_id');
      if (previewAccountId) q = q.eq('account_id', previewAccountId);
      const { data, error } = await q.order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as Order[];
    },
  });

  // Fetch line item summaries for all orders in the list view
  const { data: allLineItems } = useQuery({
    queryKey: ['client-orders-line-items', orders?.map(o => o.id)],
    queryFn: async () => {
      const orderIds = (orders ?? []).map(o => o.id);
      if (orderIds.length === 0) return [] as LineItemSummary[];
      const { data, error } = await supabase
        .from('order_line_items')
        .select('order_id, quantity_units, product:products(product_name)')
        .in('order_id', orderIds);
      if (error) throw error;
      return (data ?? []) as LineItemSummary[];
    },
    enabled: (orders ?? []).length > 0,
  });

  // Build map: orderId → summary strings
  const lineItemMap = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const li of allLineItems ?? []) {
      if (!map[li.order_id]) map[li.order_id] = [];
      const name = li.product?.product_name ?? 'Unknown';
      map[li.order_id].push(`${name} — ${li.quantity_units} units`);
    }
    return map;
  }, [allLineItems]);

  const { data: lineItems } = useQuery({
    queryKey: ['client-order-line-items', selectedOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select('id, quantity_units, grind, unit_price_locked, product:products(product_name)')
        .eq('order_id', selectedOrderId!)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data ?? []) as { id: string; quantity_units: number; grind: string | null; unit_price_locked: number; product: { product_name: string } | null }[];
    },
    enabled: !!selectedOrderId,
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase
        .from('orders')
        .update({ status: 'CANCELLED' })
        .eq('id', orderId)
        .eq('status', 'SUBMITTED')
        .select();

      if (error) {
        console.error('Cancel error:', error.code, error.message, error.details);
        throw new Error(`${error.code}: ${error.message}`);
      }

      if (!data || data.length === 0) {
        console.error('Cancel returned 0 rows - permission or status mismatch');
        throw new Error('No rows updated — order may already be processed or you lack permission');
      }

      return data;
    },
    onSuccess: () => {
      toast.success('Order cancelled');
      queryClient.invalidateQueries({ queryKey: ['client-orders'] });
      setSelectedOrderId(null);
    },
    onError: (err) => {
      console.error('Cancel mutation error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to cancel order');
    },
  });

  const selectedOrder = orders?.find((o) => o.id === selectedOrderId);
  const lineTotal = lineItems?.reduce((sum, li) => sum + li.quantity_units * li.unit_price_locked, 0) ?? 0;

  // Detail View
  if (selectedOrder) {
    return (
      <div className="page-container">
        <div className="page-header flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setSelectedOrderId(null)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="page-title">{selectedOrder.order_number}</h1>
          <span className={`rounded px-2 py-1 text-xs font-medium ${selectedOrder.status === 'SUBMITTED' ? 'bg-amber-100 text-amber-800' : selectedOrder.status === 'CANCELLED' ? 'bg-red-100 text-red-800' : 'bg-muted text-muted-foreground'}`}>
            {selectedOrder.status}
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Order Info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><strong>Status:</strong> {selectedOrder.status}</div>
              <div><strong>Delivery:</strong> {selectedOrder.delivery_method}</div>
              <div><strong>Client PO:</strong> {selectedOrder.client_po || '—'}</div>
              <div>
                <strong>Planned Roast Day:</strong>{' '}
                {selectedOrder.work_deadline_at
                  ? format(new Date(selectedOrder.work_deadline_at), 'MMM d, yyyy')
                  : '—'}
              </div>
              <div>
                <strong>Requested Ship Date:</strong>{' '}
                {selectedOrder.requested_ship_date
                  ? format(new Date(selectedOrder.requested_ship_date), 'MMM d, yyyy')
                  : '—'}
              </div>
              <div><strong>Created:</strong> {format(new Date(selectedOrder.created_at), 'MMM d, yyyy h:mm a')}</div>
              {selectedOrder.client_notes && (
                <div><strong>Notes:</strong> {selectedOrder.client_notes}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent>
              {selectedOrder.status === 'SUBMITTED' ? (
                <div>
                  <p className="mb-4 text-sm text-muted-foreground">
                    You can cancel this order while it's still being reviewed.
                  </p>
                  <Button
                    variant="destructive"
                    onClick={() => cancelMutation.mutate(selectedOrder.id)}
                    disabled={cancelMutation.isPending}
                  >
                    {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Order'}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No actions available. Order status: {selectedOrder.status}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader><CardTitle>Line Items</CardTitle></CardHeader>
          <CardContent>
            {!lineItems || lineItems.length === 0 ? (
              <p className="text-muted-foreground">Loading line items…</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2">Product</th>
                    <th className="pb-2">Qty</th>
                    <th className="pb-2">Grind</th>
                    <th className="pb-2">Unit Price</th>
                    <th className="pb-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li) => (
                    <tr key={li.id} className="border-b last:border-0">
                      <td className="py-2">{li.product?.product_name ?? 'Unknown'}</td>
                      <td className="py-2">{li.quantity_units}</td>
                      <td className="py-2">{li.grind ?? '—'}</td>
                      <td className="py-2">${li.unit_price_locked.toFixed(2)}</td>
                      <td className="py-2 text-right">${(li.quantity_units * li.unit_price_locked).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="pt-4 text-right font-medium">Total:</td>
                    <td className="pt-4 text-right font-medium">${lineTotal.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // List View
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">My Orders</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Your Orders</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : (orders ?? []).length === 0 ? (
            <p className="text-muted-foreground">No orders yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4">Order #</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Planned Roast Day</th>
                  <th className="pb-2 pr-4">Ship Date</th>
                  <th className="pb-2">Items</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {(orders ?? []).map((o) => {
                  const summaries = lineItemMap[o.id] ?? [];
                  const displaySummaries = summaries.slice(0, 2);
                  const overflow = summaries.length - displaySummaries.length;
                  return (
                    <tr
                      key={o.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedOrderId(o.id)}
                    >
                      <td className="py-3 pr-4">
                        <span className="font-medium">{o.order_number}</span>
                        <LocationCodeDisplay locationId={o.location_id} />
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                          o.status === 'SUBMITTED' ? 'bg-amber-100 text-amber-800'
                          : o.status === 'CONFIRMED' ? 'bg-blue-100 text-blue-800'
                          : o.status === 'IN_PRODUCTION' ? 'bg-orange-100 text-orange-800'
                          : o.status === 'READY' ? 'bg-green-100 text-green-800'
                          : o.status === 'SHIPPED' ? 'bg-green-100 text-green-800'
                          : o.status === 'CANCELLED' ? 'bg-red-100 text-red-800'
                          : 'bg-muted text-muted-foreground'
                        }`}>
                          {o.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {o.work_deadline_at
                          ? format(new Date(o.work_deadline_at), 'MMM d, yyyy')
                          : '—'}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {o.requested_ship_date
                          ? format(new Date(o.requested_ship_date), 'MMM d, yyyy')
                          : '—'}
                      </td>
                      <td className="py-3">
                        {displaySummaries.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            {displaySummaries.map((s, i) => (
                              <div key={i} className="text-xs text-muted-foreground">{s}</div>
                            ))}
                            {overflow > 0 && (
                              <div className="text-xs text-muted-foreground">+{overflow} more</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <Button size="sm" variant="ghost">View</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
