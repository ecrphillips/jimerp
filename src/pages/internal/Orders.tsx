import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, startOfDay } from 'date-fns';
import { 
  MessageSquare, 
  Plus,
  UserPlus,
  ArrowUp,
  ArrowDown,
  CalendarClock,
  ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LocationCodeDisplay } from '@/components/orders/LocationSelect';
import { SetDeadlineModal } from '@/components/orders/SetDeadlineModal';
import { OrderProgressBar, DeadlineStatus } from '@/components/orders/OrderProgressBar';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';

type SortDirection = 'asc' | 'desc';

const DEFAULT_HISTORY_DAYS = 3;
const HISTORY_INCREMENT = 7;

export default function Orders() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Get history days from URL or default
  const historyDays = parseInt(searchParams.get('historyDays') ?? String(DEFAULT_HISTORY_DAYS), 10);
  
  const [deadlineSortDir, setDeadlineSortDir] = useState<SortDirection>('asc');
  const [deadlineModal, setDeadlineModal] = useState<{
    open: boolean;
    orderId: string;
    orderNumber: string;
    status: string;
  }>({ open: false, orderId: '', orderNumber: '', status: '' });

  // Update URL when history days changes
  const loadMoreHistory = () => {
    const newDays = historyDays + HISTORY_INCREMENT;
    setSearchParams({ historyDays: String(newDays) });
  };

  // Fetch orders with line items for progress calculation
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
          work_deadline_at,
          internal_ops_notes,
          roasted,
          packed,
          shipped_or_ready,
          invoiced,
          created_by_admin,
          location_id,
          created_at,
          client:clients(name),
          order_line_items(id, product_id, quantity_units)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });

  // Helper to get the "age reference" date for an order
  const getAgeReference = (order: NonNullable<typeof data>[0]) => {
    if (order.work_deadline_at) return new Date(order.work_deadline_at);
    if (order.requested_ship_date) return new Date(order.requested_ship_date);
    return new Date(order.created_at);
  };

  // Check if order is in a terminal/inactive state (shipped or cancelled)
  // These orders sink to the bottom of the list
  const isTerminalOrder = (order: NonNullable<typeof data>[0]) => 
    order.status === 'SHIPPED' || order.status === 'CANCELLED' || order.shipped_or_ready;

  // Fetch packing runs for pack completion calculation
  const { data: packingRuns } = useQuery({
    queryKey: ['packing-runs-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packing_runs')
        .select('product_id, target_date, units_packed');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Map packing runs by product_id for quick lookup
  const packingByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pr of packingRuns ?? []) {
      map[pr.product_id] = (map[pr.product_id] ?? 0) + pr.units_packed;
    }
    return map;
  }, [packingRuns]);

  // "Needs invoicing" filter state
  const [needsInvoicingFilter, setNeedsInvoicingFilter] = useState(false);

  // Filter and sort orders with grouping:
  // 1. Unshipped always visible (never filtered by age)
  // 2. Shipped only visible within historyDays window
  // 3. Within each group: needs-deadline first, then by work_deadline_at
  const { visibleOrders, hasMoreHistory, terminalCount, activeCount, totalOrderCount, needsInvoicingCount } = useMemo(() => {
    if (!data) return { visibleOrders: [], hasMoreHistory: false, terminalCount: 0, activeCount: 0, totalOrderCount: 0, needsInvoicingCount: 0 };
    
    const now = new Date();
    const cutoffDate = startOfDay(subDays(now, historyDays));
    
    // Count orders needing invoicing (shipped but not invoiced)
    const invoicingBacklog = data.filter(o => o.shipped_or_ready && !o.invoiced);
    
    // If "needs invoicing" filter is active, show only those orders
    if (needsInvoicingFilter) {
      const sorted = [...invoicingBacklog].sort((a, b) => {
        const aRef = getAgeReference(a).getTime();
        const bRef = getAgeReference(b).getTime();
        return bRef - aRef; // Newest first
      });
      return {
        visibleOrders: sorted,
        hasMoreHistory: false,
        terminalCount: sorted.length,
        activeCount: 0,
        totalOrderCount: data.length,
        needsInvoicingCount: invoicingBacklog.length,
      };
    }
    
    // Separate active and terminal (shipped/cancelled)
    const active: typeof data = [];
    const terminal: typeof data = [];
    let hiddenTerminalCount = 0;
    
    for (const order of data) {
      if (isTerminalOrder(order)) {
        const ageRef = getAgeReference(order);
        if (ageRef >= cutoffDate) {
          terminal.push(order);
        } else {
          hiddenTerminalCount++;
        }
      } else {
        // Always include active orders regardless of age
        active.push(order);
      }
    }
    
    // Sort active: needs-deadline at top, then by work_deadline_at asc
    const sortedActive = [...active].sort((a, b) => {
      // Group 1: SUBMITTED with no deadline - always at top
      const aIsSubmittedNoDeadline = a.status === 'SUBMITTED' && !a.work_deadline_at;
      const bIsSubmittedNoDeadline = b.status === 'SUBMITTED' && !b.work_deadline_at;
      
      if (aIsSubmittedNoDeadline && !bIsSubmittedNoDeadline) return -1;
      if (!aIsSubmittedNoDeadline && bIsSubmittedNoDeadline) return 1;
      if (aIsSubmittedNoDeadline && bIsSubmittedNoDeadline) {
        return a.order_number.localeCompare(b.order_number);
      }
      
      // Sort by work_deadline_at
      const aDeadline = a.work_deadline_at ? new Date(a.work_deadline_at).getTime() : null;
      const bDeadline = b.work_deadline_at ? new Date(b.work_deadline_at).getTime() : null;
      
      if (aDeadline === null && bDeadline !== null) return 1;
      if (aDeadline !== null && bDeadline === null) return -1;
      if (aDeadline === null && bDeadline === null) {
        const aShip = a.requested_ship_date ? new Date(a.requested_ship_date).getTime() : Infinity;
        const bShip = b.requested_ship_date ? new Date(b.requested_ship_date).getTime() : Infinity;
        if (aShip !== bShip) return aShip - bShip;
        return a.order_number.localeCompare(b.order_number);
      }
      
      const comparison = aDeadline! - bDeadline!;
      const directedComparison = deadlineSortDir === 'asc' ? comparison : -comparison;
      if (directedComparison !== 0) return directedComparison;
      
      const aShip = a.requested_ship_date ? new Date(a.requested_ship_date).getTime() : Infinity;
      const bShip = b.requested_ship_date ? new Date(b.requested_ship_date).getTime() : Infinity;
      if (aShip !== bShip) return aShip - bShip;
      return a.order_number.localeCompare(b.order_number);
    });
    
    // Sort terminal (shipped/cancelled): newest first (by age reference desc)
    const sortedTerminal = [...terminal].sort((a, b) => {
      const aRef = getAgeReference(a).getTime();
      const bRef = getAgeReference(b).getTime();
      return bRef - aRef; // Newest first
    });
    
    return {
      visibleOrders: [...sortedActive, ...sortedTerminal],
      hasMoreHistory: hiddenTerminalCount > 0,
      terminalCount: terminal.length,
      activeCount: active.length,
      totalOrderCount: data.length,
      needsInvoicingCount: invoicingBacklog.length,
    };
  }, [data, historyDays, deadlineSortDir, needsInvoicingFilter]);

  const toggleDeadlineSort = () => {
    setDeadlineSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  // Calculate pack completion for an order
  const getPackedComplete = (order: typeof visibleOrders[0]) => {
    const lineItems = order.order_line_items ?? [];
    if (lineItems.length === 0) return false;
    
    return lineItems.every((li) => {
      const packed = packingByProduct[li.product_id] ?? 0;
      return packed >= li.quantity_units;
    });
  };

  const isTerminalStatus = (status: string) => 
    status === 'SHIPPED' || status === 'CANCELLED';

  // Visibility label
  const visibilityLabel = `Showing ${activeCount} active + ${terminalCount} shipped/cancelled from the last ${historyDays} days`;

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
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>Orders</CardTitle>
            {/* Needs invoicing filter chip */}
            {needsInvoicingCount > 0 && (
              <Button
                variant={needsInvoicingFilter ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setNeedsInvoicingFilter(!needsInvoicingFilter)}
              >
                Needs invoicing ({needsInvoicingCount})
              </Button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{visibilityLabel}</span>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : visibleOrders.length === 0 ? (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                {needsInvoicingFilter 
                  ? "No orders awaiting invoicing."
                  : `No orders in the last ${historyDays} days.`}
              </p>
              {/* Always show load more when there may be older orders */}
              {!needsInvoicingFilter && totalOrderCount > 0 && historyDays < 90 && (
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={loadMoreHistory}
                  >
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Load 7 more days to view older orders
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {/* Header row */}
              <div className="flex items-center gap-4 px-2 py-2 text-xs font-medium text-muted-foreground border-b">
                <div className="flex-1">Order / Client</div>
                <div 
                  className="w-32 flex items-center gap-1 cursor-pointer hover:text-foreground"
                  onClick={toggleDeadlineSort}
                >
                  Deadline
                  {deadlineSortDir === 'asc' ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                </div>
                <div className="w-28">Progress</div>
                <div className="w-20">Status</div>
                <div className="w-16 text-center">Health</div>
              </div>

              {/* Order rows */}
              {visibleOrders.map((o) => {
                const isSubmittedNoDeadline = o.status === 'SUBMITTED' && !o.work_deadline_at;
                const isTerminal = isTerminalStatus(o.status);
                const packedComplete = getPackedComplete(o);
                
                // Check if order needs invoicing (shipped but not invoiced) - highlight in blue
                const needsInvoicing = o.shipped_or_ready && !o.invoiced;
                
                // Build progress data
                const isConfirmed = !!o.work_deadline_at && ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED'].includes(o.status);
                
                return (
                  <div
                    key={o.id}
                    className={cn(
                      "flex items-center gap-4 px-2 py-2 rounded cursor-pointer hover:bg-muted/50 border-b last:border-0",
                      // Blue highlight for needs invoicing (shipped but not invoiced) - NOT grayed out
                      needsInvoicing && 'bg-blue-50 border-l-2 border-l-blue-400',
                      // Gray out only cancelled orders, NOT shipped awaiting invoice
                      o.status === 'CANCELLED' && 'opacity-50',
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

                    {/* Deadline column - show date/time or set button */}
                    <div className="w-32 text-sm">
                      {o.work_deadline_at ? (
                        <span 
                          className="text-xs"
                          title={format(new Date(o.work_deadline_at), 'PPP HH:mm')}
                          onClick={() => navigate(`/orders/${o.id}`)}
                        >
                          {format(new Date(o.work_deadline_at), 'MMM d, HH:mm')}
                        </span>
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

                    {/* Progress bar */}
                    <div 
                      className="w-28"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <OrderProgressBar
                        data={{
                          status: o.status,
                          workDeadlineAt: o.work_deadline_at,
                          invoiced: o.invoiced,
                          roastedCoverage: isConfirmed ? 1 : 0, // Simplified - needs roast data for full accuracy
                          packedComplete,
                          hasPickingData: false, // Picking not fully integrated in list view
                        }}
                        compact
                        showNextAction={false}
                      />
                    </div>

                    {/* Status */}
                    <div 
                      className="w-20"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <span className={cn(
                        "text-xs font-medium",
                        o.status === 'SUBMITTED' && 'text-warning',
                        o.status === 'SHIPPED' && 'text-muted-foreground',
                        o.status === 'CANCELLED' && 'text-destructive'
                      )}>
                        {o.status}
                      </span>
                    </div>

                    {/* Deadline health indicator */}
                    <div 
                      className="w-16 flex justify-center"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <DeadlineStatus
                        workDeadlineAt={o.work_deadline_at}
                        status={o.status}
                        packedComplete={packedComplete}
                        compact
                      />
                    </div>
                  </div>
                );
              })}

              {/* Load more history control - show if there are hidden orders OR if we might have more */}
              {!needsInvoicingFilter && historyDays < 90 && (hasMoreHistory || totalOrderCount > visibleOrders.length) && (
                <div className="pt-4 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-foreground opacity-70 hover:opacity-100"
                    onClick={loadMoreHistory}
                  >
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Load 7 more days
                  </Button>
                </div>
              )}
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
