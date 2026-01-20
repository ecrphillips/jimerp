import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export default function Orders() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, requested_ship_date, client:clients(name)')
        .order('status', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });

  // Sort so SUBMITTED appears first
  const sortedOrders = React.useMemo(() => {
    if (!data) return [];
    const statusOrder = ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED', 'DRAFT', 'CANCELLED'];
    return [...data].sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
  }, [data]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Orders</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>All Orders</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : sortedOrders.length === 0 ? (
            <p className="text-muted-foreground">No orders found.</p>
          ) : (
            <ul className="space-y-3">
              {sortedOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <span className="font-medium">{o.order_number}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {o.client?.name ?? 'Unknown client'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {o.requested_ship_date && (
                      <span className="text-muted-foreground">
                        Ship: {format(new Date(o.requested_ship_date), 'MMM d')}
                      </span>
                    )}
                    <span className={`font-medium ${o.status === 'SUBMITTED' ? 'text-amber-600' : ''}`}>
                      {o.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
