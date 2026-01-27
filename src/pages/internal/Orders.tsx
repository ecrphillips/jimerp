import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  UserPlus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CalendarClock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LocationCodeDisplay } from '@/components/orders/LocationSelect';
import { SetDeadlineModal } from '@/components/orders/SetDeadlineModal';

type SortDirection = 'asc' | 'desc';

export default function Orders() {
  const navigate = useNavigate();
  const [deadlineSortDir, setDeadlineSortDir] = useState<SortDirection>('asc');
  const [deadlineModal, setDeadlineModal] = useState<{
    open: boolean;
    orderId: string;
    orderNumber: string;
    status: string;
  }>({ open: false, orderId: '', orderNumber: '', status: '' });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, 
          order_number, 
          status, 
          requested_ship_date, 
          work_deadline,
          internal_ops_notes,
          roasted,
          packed,
          shipped_or_ready,
          invoiced,
          created_by_admin,
          location_id,
          client:clients(name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });

  // Sort with SUBMITTED + no deadline pinned at top
  const sortedOrders = useMemo(() => {
    if (!data) return [];
    
    return [...data].sort((a, b) => {
      // Group 1: SUBMITTED with no deadline - always at top
      const aIsSubmittedNoDeadline = a.status === 'SUBMITTED' && !a.work_deadline;
      const bIsSubmittedNoDeadline = b.status === 'SUBMITTED' && !b.work_deadline;
      
      if (aIsSubmittedNoDeadline && !bIsSubmittedNoDeadline) return -1;
      if (!aIsSubmittedNoDeadline && bIsSubmittedNoDeadline) return 1;
      if (aIsSubmittedNoDeadline && bIsSubmittedNoDeadline) {
        // Within this group, sort by order_number
        return a.order_number.localeCompare(b.order_number);
      }
      
      // Group 2: Everything else - sort by work_deadline
      const aDeadline = a.work_deadline ? new Date(a.work_deadline).getTime() : null;
      const bDeadline = b.work_deadline ? new Date(b.work_deadline).getTime() : null;
      
      // Handle nulls (push to end)
      if (aDeadline === null && bDeadline !== null) return 1;
      if (aDeadline !== null && bDeadline === null) return -1;
      if (aDeadline === null && bDeadline === null) {
        // Both null - sort by requested_ship_date then order_number
        const aShip = a.requested_ship_date ? new Date(a.requested_ship_date).getTime() : Infinity;
        const bShip = b.requested_ship_date ? new Date(b.requested_ship_date).getTime() : Infinity;
        if (aShip !== bShip) return aShip - bShip;
        return a.order_number.localeCompare(b.order_number);
      }
      
      // Both have deadlines - sort by direction
      const comparison = aDeadline! - bDeadline!;
      const directedComparison = deadlineSortDir === 'asc' ? comparison : -comparison;
      
      if (directedComparison !== 0) return directedComparison;
      
      // Tie-breaker: requested_ship_date then order_number
      const aShip = a.requested_ship_date ? new Date(a.requested_ship_date).getTime() : Infinity;
      const bShip = b.requested_ship_date ? new Date(b.requested_ship_date).getTime() : Infinity;
      if (aShip !== bShip) return aShip - bShip;
      return a.order_number.localeCompare(b.order_number);
    });
  }, [data, deadlineSortDir]);

  const toggleDeadlineSort = () => {
    setDeadlineSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
  };

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
        checked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground/40"
      )}
      title={label}
    >
      {checked ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
    </div>
  );

  const isTerminalStatus = (status: string) => 
    status === 'SHIPPED' || status === 'CANCELLED';

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
        <CardHeader>
          <CardTitle>All Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : sortedOrders.length === 0 ? (
            <p className="text-muted-foreground">No orders found.</p>
          ) : (
            <div className="space-y-1">
              {/* Header row */}
              <div className="flex items-center gap-4 px-2 py-2 text-xs font-medium text-muted-foreground border-b">
                <div className="flex-1">Order / Client</div>
                <div 
                  className="w-28 flex items-center gap-1 cursor-pointer hover:text-foreground"
                  onClick={toggleDeadlineSort}
                >
                  Work Deadline
                  {deadlineSortDir === 'asc' ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                </div>
                <div className="w-24">Ship Date</div>
                <div className="w-24">Checklist</div>
                <div className="w-28 text-right">Status</div>
              </div>

              {/* Order rows */}
              {sortedOrders.map((o) => {
                const isSubmittedNoDeadline = o.status === 'SUBMITTED' && !o.work_deadline;
                const isTerminal = isTerminalStatus(o.status);
                
                return (
                  <div
                    key={o.id}
                    className={cn(
                      "flex items-center gap-4 px-2 py-2 rounded cursor-pointer hover:bg-muted/50 border-b last:border-0",
                      isTerminal && 'opacity-50',
                      isSubmittedNoDeadline && 'bg-warning/5'
                    )}
                  >
                    {/* Order / Client */}
                    <div 
                      className="flex-1 flex items-center gap-2 min-w-0"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <span className="font-medium">{o.order_number}</span>
                      {o.created_by_admin && (
                        <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary" title="Created by Admin">
                          <UserPlus className="h-3 w-3" />
                        </span>
                      )}
                      {o.internal_ops_notes && (
                        <span className="inline-flex items-center rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning" title="Has ops notes">
                          <MessageSquare className="h-3 w-3" />
                        </span>
                      )}
                      {isSubmittedNoDeadline && (
                        <Badge variant="outline" className="text-warning border-warning/30 text-xs">
                          Needs deadline
                        </Badge>
                      )}
                      <span className="text-sm text-muted-foreground truncate">
                        {o.client?.name ?? 'Unknown'}
                      </span>
                      <LocationCodeDisplay locationId={o.location_id} />
                    </div>

                    {/* Work Deadline */}
                    <div className="w-28 text-sm">
                      {o.work_deadline ? (
                        <span>{format(new Date(o.work_deadline), 'MMM d')}</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeadlineModal({
                              open: true,
                              orderId: o.id,
                              orderNumber: o.order_number,
                              status: o.status,
                            });
                          }}
                        >
                          <CalendarClock className="h-3 w-3 mr-1" />
                          Set
                        </Button>
                      )}
                    </div>

                    {/* Ship Date */}
                    <div 
                      className="w-24 text-sm text-muted-foreground"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      {o.requested_ship_date
                        ? format(new Date(o.requested_ship_date), 'MMM d')
                        : '—'}
                    </div>

                    {/* Checklist */}
                    <div 
                      className="w-24 flex items-center gap-1"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <ChecklistIcon checked={o.roasted} Icon={Flame} label="Roasted" />
                      <ChecklistIcon checked={o.packed} Icon={Package} label="Packed" />
                      <ChecklistIcon checked={o.shipped_or_ready} Icon={Truck} label="Shipped/Ready" />
                      <ChecklistIcon checked={o.invoiced} Icon={FileText} label="Invoiced" />
                    </div>

                    {/* Status */}
                    <div 
                      className="w-28 text-right"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <span className={cn(
                        "text-sm font-medium",
                        o.status === 'SUBMITTED' && 'text-warning',
                        o.status === 'SHIPPED' && 'text-muted-foreground',
                        o.status === 'CANCELLED' && 'text-destructive'
                      )}>
                        {o.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <SetDeadlineModal
        open={deadlineModal.open}
        onOpenChange={(open) => setDeadlineModal(prev => ({ ...prev, open }))}
        orderId={deadlineModal.orderId}
        orderNumber={deadlineModal.orderNumber}
        currentStatus={deadlineModal.status}
        onSuccess={() => refetch()}
      />
    </div>
  );
}