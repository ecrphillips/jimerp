import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Truck, AlertTriangle, Package } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { SortableShipCard } from './SortableShipCard';
import { format, addDays, parseISO } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';
import type { DateFilterConfig } from './types';
// Use AUTHORITATIVE inventory hooks - computed from source-of-truth tables
import { useAuthoritativeFg, useAuthoritativeShortList } from '@/hooks/useAuthoritativeInventory';
import { AuthoritativeSummaryPanel } from './AuthoritativeTotals';
import { filterOrderByWorkStart } from '@/lib/productionScheduling';

type ShipPriority = 'NORMAL' | 'TIME_SENSITIVE';
type OrderStatus = Database['public']['Enums']['order_status'];

interface ShipTabProps {
  dateFilterConfig: DateFilterConfig;
  today: string;
}

interface Checkmark {
  product_id: string;
  bag_size_g: number;
  ship_priority: ShipPriority;
  roast_complete: boolean;
  pack_complete: boolean;
  ship_complete: boolean;
}

interface LineItem {
  id: string;
  product_name: string;
  quantity_units: number;
  bag_size_g: number;
  packaging_variant: PackagingVariant | null;
  product_id: string;
  roast_group: string | null;
}

interface ShippableOrder {
  id: string;
  order_number: string;
  client_name: string;
  requested_ship_date: string | null;
  work_deadline: string | null;
  delivery_method: string;
  client_notes: string | null;
  internal_ops_notes: string | null;
  roasted: boolean;
  packed: boolean;
  invoiced: boolean;
  lineItems: LineItem[];
  allLineItemsPacked: boolean;
  priority: ShipPriority;
  hasContention: boolean;
  skuCount: number;
  totalUnits: number;
  missingSkuCount: number;
  missingUnitsTotal: number;
  ship_display_order: number | null;
  manually_deprioritized?: boolean;
}

// ShortListItem type now comes from useAuthoritativeShortList hook

export function ShipTab({ dateFilterConfig, today }: ShipTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Local order state for optimistic DnD updates
  const [localOrders, setLocalOrders] = useState<ShippableOrder[]>([]);
  const hasUserReorderedRef = useRef(false);

  // Fetch checkmarks for priority tracking
  const { data: checkmarks } = useQuery({
    queryKey: ['production-checkmarks', dateFilterConfig],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checkmarks')
        .select('*');
      
      // Note: checkmarks don't need the same date filter - we use them for priority info
      const { data: result, error: err } = await supabase
        .from('production_checkmarks')
        .select('*');
      if (err) throw err;
      return result ?? [];
    },
  });

  // Fetch ALL order line items for demand
  // Filtering by work_start_at happens client-side for accurate production window logic
  // IMPORTANT: Uses work_deadline_at (timestamptz), NOT work_deadline (legacy text field)
  const { data: allOrderLineItems } = useQuery({
    queryKey: ['ship-demand-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order:orders!inner(status, work_deadline_at, manually_deprioritized),
          product:products(id, product_name, bag_size_g, packaging_variant)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);
      
      if (error) throw error;
      return data ?? [];
    },
  });
  
  // Client-side filter using work_start_at calculation
  // Uses work_deadline_at field for accurate timestamptz-based scheduling
  const orderLineItems = useMemo(() => {
    if (!allOrderLineItems) return [];
    if (dateFilterConfig.mode === 'all') return allOrderLineItems;
    
    return allOrderLineItems.filter(li => {
      const workDeadlineAt = li.order?.work_deadline_at ?? null;
      const manuallyDeprioritized = li.order?.manually_deprioritized ?? false;
      return filterOrderByWorkStart(workDeadlineAt, manuallyDeprioritized, dateFilterConfig.mode);
    });
  }, [allOrderLineItems, dateFilterConfig.mode]);

  // ========== AUTHORITATIVE FG INVENTORY (from source-of-truth tables) ==========
  // FG = sum(packing_runs.units_packed) - sum(ship_picks.units_picked for open orders)
  const { data: authFg } = useAuthoritativeFg();
  const { data: authShortList } = useAuthoritativeShortList();
  
  // FG inventory as a record for easy lookup (use authoritative fg_available_units)
  const fgInventoryMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [pid, data] of Object.entries(authFg ?? {})) {
      map[pid] = data.fg_available_units;
    }
    return map;
  }, [authFg]);

  // Fetch orders for shippable view (including ship_display_order)
  // Fetch ALL orders for shippable view - filtering happens client-side
  // IMPORTANT: Uses work_deadline_at (timestamptz), NOT work_deadline (legacy text field)
  const { data: allOrdersForShipping } = useQuery({
    queryKey: ['shippable-orders-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          requested_ship_date,
          work_deadline_at,
          delivery_method,
          client_notes,
          internal_ops_notes,
          roasted,
          packed,
          invoiced,
          status,
          ship_display_order,
          manually_deprioritized,
          client:clients(name),
          account:accounts(account_name),
          line_items:order_line_items(
            id,
            product_id,
            quantity_units,
            product:products(product_name, bag_size_g, packaging_variant, roast_group)
          )
        `)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .order('ship_display_order', { ascending: true, nullsFirst: false })
        .order('order_number', { ascending: true });
      
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30000, // 30 seconds stale time to prevent refetches overriding user changes
    refetchOnWindowFocus: false,
  });
  
  // Client-side filter using work_start_at calculation
  // Uses work_deadline_at field for accurate timestamptz-based scheduling
  const ordersForShipping = useMemo(() => {
    if (!allOrdersForShipping) return [];
    if (dateFilterConfig.mode === 'all') return allOrdersForShipping;
    
    return allOrdersForShipping.filter(order => {
      const workDeadlineAt = order.work_deadline_at ?? null;
      const manuallyDeprioritized = order.manually_deprioritized ?? false;
      return filterOrderByWorkStart(workDeadlineAt, manuallyDeprioritized, dateFilterConfig.mode);
    });
  }, [allOrdersForShipping, dateFilterConfig.mode]);

  // Fetch shipped orders awaiting invoice
  const { data: shippedAwaitingInvoice } = useQuery({
    queryKey: ['shipped-awaiting-invoice'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          requested_ship_date,
          work_deadline,
          delivery_method,
          client_notes,
          internal_ops_notes,
          roasted,
          packed,
          invoiced,
          status,
          ship_display_order,
          manually_deprioritized,
          client:clients(name),
          account:accounts(account_name),
          line_items:order_line_items(
            id,
            product_id,
            quantity_units,
            product:products(product_name, bag_size_g, packaging_variant, roast_group)
          )
        `)
        .eq('status', 'SHIPPED')
        .eq('invoiced', false)
        .order('order_number', { ascending: true });
      
      if (error) throw error;
      return data ?? [];
    },
  });

  // Aggregate demand by product (total units demanded per product across orders)
  const demandByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const li of orderLineItems ?? []) {
      map[li.product_id] = (map[li.product_id] ?? 0) + li.quantity_units;
    }
    return map;
  }, [orderLineItems]);

  // Compute ALL orders with complexity metrics (shippable and not-yet-shippable)
  const allOrdersWithMetrics = useMemo((): ShippableOrder[] => {
    if (!ordersForShipping) return [];

    const orders: ShippableOrder[] = [];
    
    for (const order of ordersForShipping) {
      const lineItems: LineItem[] = (order.line_items ?? []).map((li: { id: string; product_id: string; quantity_units: number; product: { product_name: string; bag_size_g: number; packaging_variant: PackagingVariant | null; roast_group: string | null } | null }) => ({
        id: li.id,
        product_name: li.product?.product_name ?? 'Unknown',
        quantity_units: li.quantity_units,
        bag_size_g: li.product?.bag_size_g ?? 0,
        packaging_variant: li.product?.packaging_variant ?? null,
        product_id: li.product_id,
        roast_group: li.product?.roast_group ?? null,
      }));

      // Complexity metrics
      const skuCount = lineItems.length;
      const totalUnits = lineItems.reduce((sum, li) => sum + li.quantity_units, 0);
      
      // Calculate missing SKUs and units based on FG inventory
      let missingSkuCount = 0;
      let missingUnitsTotal = 0;
      for (const li of lineItems) {
        const fgAvailable = fgInventoryMap[li.product_id] ?? 0;
        if (fgAvailable < li.quantity_units) {
          missingSkuCount++;
          missingUnitsTotal += Math.max(0, li.quantity_units - fgAvailable);
        }
      }

      // Order is shippable if ALL its line items have sufficient FG inventory
      const allLineItemsPacked = lineItems.length > 0 && missingSkuCount === 0;

      // Check for contention: any SKU in this order where FG < total demand
      const hasContention = lineItems.some((li: { product_id: string }) => {
        const totalDemanded = demandByProduct[li.product_id] ?? 0;
        const totalFg = fgInventoryMap[li.product_id] ?? 0;
        return totalFg < totalDemanded;
      });

      // Priority from checkmarks
      let priority: ShipPriority = 'NORMAL';
      for (const li of lineItems) {
        const cm = checkmarks?.find(
          (c) => c.product_id === li.product_id && c.bag_size_g === li.bag_size_g
        );
        if (cm?.ship_priority === 'TIME_SENSITIVE') {
          priority = 'TIME_SENSITIVE';
          break;
        }
      }

      orders.push({
        id: order.id,
        order_number: order.order_number,
        client_name: (order as any).account?.account_name ?? order.client?.name ?? 'Unknown',
        requested_ship_date: order.requested_ship_date,
        work_deadline: order.work_deadline_at ?? null, // Map work_deadline_at to work_deadline for display
        delivery_method: order.delivery_method,
        client_notes: order.client_notes,
        internal_ops_notes: order.internal_ops_notes,
        roasted: order.roasted,
        packed: order.packed,
        invoiced: order.invoiced,
        lineItems,
        allLineItemsPacked,
        priority,
        hasContention,
        skuCount,
        totalUnits,
        missingSkuCount,
        missingUnitsTotal,
        ship_display_order: order.ship_display_order ?? null,
        manually_deprioritized: order.manually_deprioritized ?? false,
      });
    }

    // Sort ONLY by ship_display_order (manual ordering) - NO automatic sorting
    return orders.sort((a, b) => {
      const orderA = a.ship_display_order ?? 999999;
      const orderB = b.ship_display_order ?? 999999;
      
      if (orderA !== orderB) return orderA - orderB;
      return a.order_number.localeCompare(b.order_number);
    });
  }, [ordersForShipping, checkmarks, fgInventoryMap, demandByProduct]);

  // Sync local state from server data, but only when not actively reordering
  useEffect(() => {
    if (!hasUserReorderedRef.current && allOrdersWithMetrics.length > 0) {
      setLocalOrders(allOrdersWithMetrics);
    }
  }, [allOrdersWithMetrics]);

  // Reset the reorder flag after a delay to allow server sync
  useEffect(() => {
    if (hasUserReorderedRef.current) {
      const timeout = setTimeout(() => {
        hasUserReorderedRef.current = false;
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [localOrders]);

  // Separate shippable and not-yet-shippable for display counts
  const shippableOrders = useMemo(() => allOrdersWithMetrics.filter(o => o.allLineItemsPacked), [allOrdersWithMetrics]);
  const notYetShippableOrders = useMemo(() => allOrdersWithMetrics.filter(o => !o.allLineItemsPacked), [allOrdersWithMetrics]);

  // Fetch all ship_picks for short list calculation
  const { data: allShipPicks } = useQuery({
    queryKey: ['all-ship-picks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ship_picks')
        .select('order_line_item_id, units_picked, order_id');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Map ship_picks by order_line_item_id
  const pickedByLineItem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pick of allShipPicks ?? []) {
      map[pick.order_line_item_id] = pick.units_picked;
    }
    return map;
  }, [allShipPicks]);

  // Short list now uses authoritative hook (authShortList)
  // The old shortList calculation is removed - we use useAuthoritativeShortList instead

  const priorityMutation = useMutation({
    mutationFn: async ({ productId, bagSize, priority, existingCheckmark }: { productId: string; bagSize: number; priority: ShipPriority; existingCheckmark: Checkmark | null }) => {
      const { error } = await supabase
        .from('production_checkmarks')
        .upsert({
          target_date: today,
          product_id: productId,
          bag_size_g: bagSize,
          ship_priority: priority,
          roast_complete: existingCheckmark?.roast_complete ?? false,
          pack_complete: existingCheckmark?.pack_complete ?? false,
          ship_complete: existingCheckmark?.ship_complete ?? false,
          updated_by: user?.id,
        }, {
          onConflict: 'target_date,product_id,bag_size_g',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-checkmarks'] });
      queryClient.invalidateQueries({ queryKey: ['shippable-orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update priority');
    },
  });

  const markOrderShippedMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'SHIPPED' as OrderStatus, shipped_or_ready: true })
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order marked as shipped');
      queryClient.invalidateQueries({ queryKey: ['shippable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-awaiting-invoice'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark order as shipped');
    },
  });

  // Mutation to mark order as invoiced
  const markOrderInvoicedMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase
        .from('orders')
        .update({ invoiced: true })
        .eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order marked as invoiced');
      queryClient.invalidateQueries({ queryKey: ['shipped-awaiting-invoice'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark order as invoiced');
    },
  });

  // Mutation to update ship_display_order
  const updateDisplayOrderMutation = useMutation({
    mutationFn: async ({ orderId, newOrder }: { orderId: string; newOrder: number }) => {
      const { error } = await supabase
        .from('orders')
        .update({ ship_display_order: newOrder })
        .eq('id', orderId);
      if (error) throw error;
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update order');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shippable-orders'] });
    },
  });

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end for reordering - use local state for optimistic updates
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;
    
    const oldIndex = localOrders.findIndex(o => o.id === active.id);
    const newIndex = localOrders.findIndex(o => o.id === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;
    
    // Mark that user has reordered to prevent server sync from overriding
    hasUserReorderedRef.current = true;
    
    // Optimistically update local state immediately
    const reordered = arrayMove(localOrders, oldIndex, newIndex);
    setLocalOrders(reordered);
    
    // Persist new order to DB
    reordered.forEach((order, index) => {
      updateDisplayOrderMutation.mutate({ orderId: order.id, newOrder: (index + 1) * 10 });
    });
  }, [localOrders, updateDisplayOrderMutation]);

  const toggleOrderPriority = (order: ShippableOrder) => {
    const newPriority: ShipPriority = order.priority === 'NORMAL' ? 'TIME_SENSITIVE' : 'NORMAL';
    
    const updates = order.lineItems.map((li) => {
      const existingCheckmark = checkmarks?.find(
        (cm) => cm.product_id === li.product_id && cm.bag_size_g === li.bag_size_g
      ) ?? null;
      
      return priorityMutation.mutateAsync({
        productId: li.product_id,
        bagSize: li.bag_size_g,
        priority: newPriority,
        existingCheckmark,
      });
    });
    
    Promise.all(updates);
  };

  // Calculate today + 1 for "Do this today" action
  const todayPlusOne = useMemo(() => {
    const todayDate = parseISO(today + 'T12:00:00');
    return format(addDays(todayDate, 1), 'yyyy-MM-dd');
  }, [today]);

  // "Do this later" - increment work_deadline by 1 day and set manually_deprioritized = true
  const doThisLaterMutation = useMutation({
    mutationFn: async (order: ShippableOrder) => {
      const currentDate = order.work_deadline ? parseISO(order.work_deadline) : new Date();
      const newDate = format(addDays(currentDate, 1), 'yyyy-MM-dd');
      
      const { error } = await supabase
        .from('orders')
        .update({ 
          work_deadline: newDate,
          manually_deprioritized: true,
        })
        .eq('id', order.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order moved to tomorrow');
      queryClient.invalidateQueries({ queryKey: ['shippable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['ship-demand'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update order');
    },
  });

  // "Do this today" - set work_deadline to today+1 and clear manually_deprioritized
  const doThisTodayMutation = useMutation({
    mutationFn: async (order: ShippableOrder) => {
      const { error } = await supabase
        .from('orders')
        .update({ 
          work_deadline: todayPlusOne,
          manually_deprioritized: false,
        })
        .eq('id', order.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order moved to today');
      queryClient.invalidateQueries({ queryKey: ['shippable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['ship-demand'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update order');
    },
  });

  const handleDoThisLater = useCallback((order: ShippableOrder) => {
    doThisLaterMutation.mutate(order);
  }, [doThisLaterMutation]);

  const handleDoThisToday = useCallback((order: ShippableOrder) => {
    doThisTodayMutation.mutate(order);
  }, [doThisTodayMutation]);

  // Mark shipped directly - no decrement modal needed (picking already deducted FG)
  const handleMarkOrderShipped = useCallback((order: ShippableOrder) => {
    markOrderShippedMutation.mutate(order.id);
  }, [markOrderShippedMutation]);

  // Mark invoiced handler
  const handleMarkInvoiced = useCallback((orderId: string) => {
    markOrderInvoicedMutation.mutate(orderId);
  }, [markOrderInvoicedMutation]);

  // Use localOrders for rendering to prevent snapping
  const displayOrders = localOrders.length > 0 ? localOrders : allOrdersWithMetrics;

  // Update counts based on display orders
  const displayShippableCount = displayOrders.filter(o => o.allLineItemsPacked).length;
  const displayPendingCount = displayOrders.filter(o => !o.allLineItemsPacked).length;

  // Shipped Awaiting Invoice count
  const shippedAwaitingInvoiceCount = shippedAwaitingInvoice?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Authoritative Totals Summary */}
      <AuthoritativeSummaryPanel tab="ship" />
      
      {/* All Orders - Unified List with Drag & Drop */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Orders
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({displayShippableCount} ready • {displayPendingCount} pending)
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Drag to reorder. Green = ready to ship.
          </p>
        </CardHeader>
        <CardContent>
          {displayOrders.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-4xl mb-3">🚚</div>
              <p className="text-lg font-medium text-foreground mb-1">No shipping work right now</p>
              <p className="text-muted-foreground text-sm">
                {dateFilterConfig.mode === 'today' 
                  ? "Check 'Tomorrow' or 'All' for future orders, or enjoy being caught up!"
                  : dateFilterConfig.mode === 'tomorrow'
                    ? "Check 'All' for future orders, or enjoy being caught up!"
                    : "No orders to ship across all dates — enjoy being caught up!"}
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displayOrders.map(o => o.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                {displayOrders.map((order) => (
                    <SortableShipCard
                      key={order.id}
                      order={order}
                      fgInventory={fgInventoryMap}
                      onTogglePriority={toggleOrderPriority}
                      onMarkShipped={handleMarkOrderShipped}
                      isShipping={markOrderShippedMutation.isPending}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* Shipped, Awaiting Invoice */}
      {shippedAwaitingInvoiceCount > 0 && (
        <Card className="border-blue-300 bg-blue-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-700">
              <Truck className="h-5 w-5" />
              Shipped, Awaiting Invoice
              <Badge variant="outline" className="ml-2 border-blue-300 text-blue-700">
                {shippedAwaitingInvoiceCount} order{shippedAwaitingInvoiceCount !== 1 ? 's' : ''}
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Orders that have been shipped but not yet invoiced.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {shippedAwaitingInvoice?.map((order) => (
                <div 
                  key={order.id} 
                  className="flex items-center justify-between p-3 bg-background rounded border border-blue-200"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{order.order_number}</span>
                    <span className="text-muted-foreground">•</span>
                    <span>{(order as any).account?.account_name ?? order.client?.name ?? 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">
                      ({(order.line_items ?? []).length} item{(order.line_items ?? []).length !== 1 ? 's' : ''})
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleMarkInvoiced(order.id)}
                    disabled={markOrderInvoicedMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Mark Invoiced
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Short List - at bottom (uses AUTHORITATIVE shortList from hooks) */}
      {authShortList && authShortList.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="h-5 w-5" />
              Short List
              <Badge variant="outline" className="ml-2 border-warning/50 text-warning">
                {authShortList.length} items
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              SKUs where total FG (packed) is less than total demanded.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {authShortList.map((item) => (
                <div key={item.product_id} className="flex items-center justify-between p-2 bg-background rounded border border-warning/30">
                  <div className="flex items-start gap-2">
                    <Package className="h-4 w-4 text-warning mt-0.5" />
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{item.product_name}</span>
                      <PackagingBadge variant={(item as { packaging_variant?: PackagingVariant | null }).packaging_variant ?? null} />
                    </div>
                  </div>
                  <div className="text-sm font-mono">
                    <span className="text-warning font-medium">Short: {item.shortage}</span>
                    <span className="text-muted-foreground ml-3">
                      Demand: {item.demanded_units} | Packed: {item.fg_available_units} | Picked: {item.picked_units}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
