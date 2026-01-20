import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          requested_ship_date,
          client_notes,
          internal_ops_notes,
          client:clients(name)
        `)
        .eq('id', id!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: lineItems } = useQuery({
    queryKey: ['order-line-items', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          quantity_units,
          grind,
          unit_price_locked,
          line_notes,
          product:products(product_name)
        `)
        .eq('order_id', id!)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="page-container">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <p className="text-destructive">Failed to load order: {error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="page-container">
        <p className="text-muted-foreground">Order not found.</p>
        <Link to="/orders">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Orders
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header flex items-center gap-4">
        <Link to="/orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="page-title">{order.order_number}</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Order Info</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><strong>Client:</strong> {order.client?.name ?? 'Unknown'}</div>
            <div><strong>Status:</strong> {order.status}</div>
            <div>
              <strong>Requested Ship Date:</strong>{' '}
              {order.requested_ship_date
                ? format(new Date(order.requested_ship_date), 'MMM d, yyyy')
                : '—'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <strong>Client Notes:</strong>
              <p className="text-muted-foreground">{order.client_notes || '—'}</p>
            </div>
            <div>
              <strong>Internal Ops Notes:</strong>
              <p className="text-muted-foreground">{order.internal_ops_notes || '—'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Line Items</CardTitle></CardHeader>
        <CardContent>
          {!lineItems || lineItems.length === 0 ? (
            <p className="text-muted-foreground">No line items.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Qty</th>
                  <th className="pb-2">Grind</th>
                  <th className="pb-2">Unit Price</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li) => (
                  <tr key={li.id} className="border-b last:border-0">
                    <td className="py-2">{li.product?.product_name ?? 'Unknown'}</td>
                    <td className="py-2">{li.quantity_units}</td>
                    <td className="py-2">{li.grind ?? '—'}</td>
                    <td className="py-2">${li.unit_price_locked.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
