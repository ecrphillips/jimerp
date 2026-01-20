import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export default function OrderHistory() {
  const { data: orders, isLoading, error } = useQuery({
    queryKey: ['client-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, requested_ship_date, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Order History</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Your Orders</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : orders.length === 0 ? (
            <p className="text-muted-foreground">No orders yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Order #</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Ship Date</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{o.order_number}</td>
                    <td className="py-2">{format(new Date(o.created_at), 'MMM d, yyyy')}</td>
                    <td className="py-2">{o.requested_ship_date ? format(new Date(o.requested_ship_date), 'MMM d') : '—'}</td>
                    <td className="py-2">{o.status}</td>
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
