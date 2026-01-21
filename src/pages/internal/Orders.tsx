import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { 
  MessageSquare, 
  Flame, 
  Package, 
  Truck, 
  FileText, 
  Plus,
  Check,
  UserPlus
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Orders() {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, 
          order_number, 
          status, 
          requested_ship_date, 
          internal_ops_notes,
          roasted,
          packed,
          shipped_or_ready,
          invoiced,
          created_by_admin,
          client:clients(name)
        `)
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

  const ChecklistIcon = ({ 
    checked, 
    Icon, 
    label 
  }: { 
    checked: boolean; 
    Icon: React.ElementType; 
    label: string; 
  }) => (
    <div 
      className={cn(
        "h-5 w-5 rounded flex items-center justify-center",
        checked ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground/40"
      )}
      title={label}
    >
      {checked ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
    </div>
  );

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Orders</h1>
        <Button onClick={() => navigate('/orders/new')}>
          <Plus className="mr-2 h-4 w-4" />
          Create Order
        </Button>
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
                <li
                  key={o.id}
                  onClick={() => navigate(`/orders/${o.id}`)}
                  className="flex cursor-pointer items-center justify-between rounded border-b pb-2 last:border-0 hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{o.order_number}</span>
                    {o.created_by_admin && (
                      <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700" title="Created by Admin">
                        <UserPlus className="h-3 w-3" />
                      </span>
                    )}
                    {o.internal_ops_notes && (
                      <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700" title="Has ops notes">
                        <MessageSquare className="h-3 w-3" />
                      </span>
                    )}
                    <span className="text-sm text-muted-foreground">
                      {o.client?.name ?? 'Unknown client'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {/* Fulfillment Checklist Icons */}
                    <div className="flex items-center gap-1">
                      <ChecklistIcon checked={o.roasted} Icon={Flame} label="Roasted" />
                      <ChecklistIcon checked={o.packed} Icon={Package} label="Packed" />
                      <ChecklistIcon checked={o.shipped_or_ready} Icon={Truck} label="Shipped/Ready" />
                      <ChecklistIcon checked={o.invoiced} Icon={FileText} label="Invoiced" />
                    </div>
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
