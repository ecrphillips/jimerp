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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Truck, AlertTriangle, Package } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { SortableShipCard } from './SortableShipCard';
import { format, addDays, parseISO } from 'date-fns';
import type { Database } from '@/integrations/supabase/types';
import type { DateFilterConfig } from './types';

type ShipPriority = 'NORMAL' | 'TIME_SENSITIVE';
type OrderStatus = Database['public']['Enums']['order_status'];

interface ShipTabProps {
  dateFilterConfig: DateFilterConfig;
  today: string;
}

interface PackingRun {
  product_id: string;
  target_date: string;
  units_packed: number;
}

interface Checkmark {
  product_id: string;
  bag_size_g: number;
  ship_priority: ShipPriority;
  roast_complete: boolean;
  pack_complete: boolean;
  ship_complete: boolean;
}

interface ShippableOrder {
  id: string;
  order_number: string;
  client_name: string;
  requested_ship_date: string | null;
  delivery_method: string;
  client_notes: string | null;
  internal_ops_notes: string | null;
  roasted: boolean;
  packed: boolean;
  invoiced: boolean;
  lineItems: {
    id: string;
    product_name: string;
    quantity_units: number;
    bag_size_g: number;
    packaging_variant: PackagingVariant | null;
    product_id: string;
  }[];
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

interface ShortListItem {
  product_id: string;
  product_name: string;
  bag_size_g: number;
  packaging_variant: PackagingVariant | null;
  demanded_units: number;
  packed_units: number;
  shortage: number;
}

export function ShipTab({ dateFilterConfig, today }: ShipTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Local order state for optimistic DnD updates
  const [localOrders, setLocalOrders] = useState<ShippableOrder[]>([]);
  const hasUserReorderedRef = useRef(false);
  
  const [showDecrementModal, setShowDecrementModal] = useState(false);
  const [pendingShipOrder, setPendingShipOrder] = useState<ShippableOrder | null>(null);

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

  // Fetch order line items for demand based on dateFilterConfig
  const { data: orderLineItems } = useQuery({
    queryKey: ['ship-demand', dateFilterConfig],
    queryFn: async () => {
      let query = supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order:orders!inner(status, requested_ship_date, manually_deprioritized),
          product:products(id, product_name, bag_size_g, packaging_variant)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);
      
      // Apply date filter based on mode
      if (dateFilterConfig.mode === 'today') {
        // TODAY: requested_ship_date <= maxDate
        query = query.lte('order.requested_ship_date', dateFilterConfig.maxDate);
      } else if (dateFilterConfig.mode === 'tomorrow') {
        // TOMORROW: requested_ship_date == exactDate OR manually_deprioritized = true
        // This requires OR logic which Supabase supports via .or()
        query = query.or(`requested_ship_date.eq.${dateFilterConfig.exactDate},manually_deprioritized.eq.true`, { referencedTable: 'orders' });
      }
      // ALL mode: no date filter
      
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch packing runs - for "All" mode don't filter by date
  const { data: packingRuns } = useQuery({
    queryKey: ['packing-runs', dateFilterConfig],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packing_runs')
        .select('*');
      
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch orders for shippable view (including ship_display_order)
  const { data: ordersForShipping } = useQuery({
    queryKey: ['shippable-orders', dateFilterConfig],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select(`
          id,
          order_number,
          requested_ship_date,
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
          line_items:order_line_items(
            id,
            product_id,
            quantity_units,
            product:products(product_name, bag_size_g, packaging_variant)
          )
        `)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .order('ship_display_order', { ascending: true, nullsFirst: false })
        .order('order_number', { ascending: true });
      
      // Apply date filter based on mode
      if (dateFilterConfig.mode === 'today') {
        query = query.lte('requested_ship_date', dateFilterConfig.maxDate);
      } else if (dateFilterConfig.mode === 'tomorrow') {
        query = query.or(`requested_ship_date.eq.${dateFilterConfig.exactDate},manually_deprioritized.eq.true`);
      }
      // ALL mode: no date filter
      
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30000, // 30 seconds stale time to prevent refetches overriding user changes
    refetchOnWindowFocus: false,
  });

  // Map packing runs by product_id (aggregate units_packed per product across all dates in window)
  const packingByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pr of packingRuns ?? []) {
      map[pr.product_id] = (map[pr.product_id] ?? 0) + pr.units_packed;
    }
    return map;
  }, [packingRuns]);

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
      const lineItems = (order.line_items ?? []).map((li: { id: string; product_id: string; quantity_units: number; product: { product_name: string; bag_size_g: number; packaging_variant: PackagingVariant | null } | null }) => ({
        id: li.id,
        product_name: li.product?.product_name ?? 'Unknown',
        quantity_units: li.quantity_units,
        bag_size_g: li.product?.bag_size_g ?? 0,
        packaging_variant: li.product?.packaging_variant ?? null,
        product_id: li.product_id,
      }));

      // Complexity metrics
      const skuCount = lineItems.length;
      const totalUnits = lineItems.reduce((sum, li) => sum + li.quantity_units, 0);
      
      // Calculate missing SKUs and units
      let missingSkuCount = 0;
      let missingUnitsTotal = 0;
      for (const li of lineItems) {
        const packed = packingByProduct[li.product_id] ?? 0;
        if (packed < li.quantity_units) {
          missingSkuCount++;
          missingUnitsTotal += Math.max(0, li.quantity_units - packed);
        }
      }

      // Order is shippable if ALL its line items have sufficient packed units
      const allLineItemsPacked = lineItems.length > 0 && missingSkuCount === 0;

      // Check for contention: any SKU in this order where packed < total demand
      const hasContention = lineItems.some((li: { product_id: string }) => {
        const totalDemanded = demandByProduct[li.product_id] ?? 0;
        const totalPacked = packingByProduct[li.product_id] ?? 0;
        return totalPacked < totalDemanded;
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
        client_name: order.client?.name ?? 'Unknown',
        requested_ship_date: order.requested_ship_date,
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
        ship_display_order: (order as any).ship_display_order ?? null,
        manually_deprioritized: (order as any).manually_deprioritized ?? false,
      });
    }

    // Sort ONLY by ship_display_order (manual ordering) - NO automatic sorting
    return orders.sort((a, b) => {
      const orderA = a.ship_display_order ?? 999999;
      const orderB = b.ship_display_order ?? 999999;
      
      if (orderA !== orderB) return orderA - orderB;
      return a.order_number.localeCompare(b.order_number);
    });
  }, [ordersForShipping, checkmarks, packingByProduct, demandByProduct]);

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

  // Short list calculation now uses the same packingByProduct and demandByProduct
  const shortList = useMemo((): ShortListItem[] => {
    const demandMap: Record<string, { product_name: string; bag_size_g: number; packaging_variant: PackagingVariant | null; demanded: number }> = {};
    
    for (const li of orderLineItems ?? []) {
      if (!li.product) continue;
      const key = li.product_id;
      if (!demandMap[key]) {
        demandMap[key] = {
          product_name: li.product.product_name,
          bag_size_g: li.product.bag_size_g,
          packaging_variant: li.product.packaging_variant as PackagingVariant | null,
          demanded: 0,
        };
      }
      demandMap[key].demanded += li.quantity_units;
    }

    const shortItems: ShortListItem[] = [];
    for (const [productId, data] of Object.entries(demandMap)) {
      const packed = packingByProduct[productId] ?? 0;
      if (packed < data.demanded) {
        shortItems.push({
          product_id: productId,
          product_name: data.product_name,
          bag_size_g: data.bag_size_g,
          packaging_variant: data.packaging_variant,
          demanded_units: data.demanded,
          packed_units: packed,
          shortage: data.demanded - packed,
        });
      }
    }

    return shortItems.sort((a, b) => b.shortage - a.shortage);
  }, [orderLineItems, packingByProduct]);

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
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['packing-runs'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark order as shipped');
    },
  });

  // Mutation to decrement packing runs when shipping
  const decrementPackingMutation = useMutation({
    mutationFn: async ({ order }: { order: ShippableOrder }) => {
      const clampedSkus: string[] = [];
      
      for (const li of order.lineItems) {
        // Find existing packing run for this product + today
        const existingRun = packingRuns?.find(
          (pr) => pr.product_id === li.product_id
        );
        
        if (existingRun) {
          const currentPacked = existingRun.units_packed;
          const newPacked = Math.max(currentPacked - li.quantity_units, 0);
          
          if (currentPacked < li.quantity_units) {
            clampedSkus.push(li.product_name);
          }
          
          const { error } = await supabase
            .from('packing_runs')
            .update({ units_packed: newPacked, updated_by: user?.id })
            .eq('id', existingRun.id);
          if (error) throw error;
        }
      }
      
      return clampedSkus;
    },
    onSuccess: (clampedSkus) => {
      if (clampedSkus.length > 0) {
        toast.warning(`Packed units for ${clampedSkus.join(', ')} was less than shipped quantity; clamped to 0.`);
      }
      queryClient.invalidateQueries({ queryKey: ['packing-runs'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to decrement packed inventory');
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

  // "Do this later" - increment ship date by 1 day and set manually_deprioritized = true
  const doThisLaterMutation = useMutation({
    mutationFn: async (order: ShippableOrder) => {
      const currentDate = order.requested_ship_date ? parseISO(order.requested_ship_date) : new Date();
      const newDate = format(addDays(currentDate, 1), 'yyyy-MM-dd');
      
      const { error } = await supabase
        .from('orders')
        .update({ 
          requested_ship_date: newDate,
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

  // "Do this today" - set ship date to today+1 and clear manually_deprioritized
  const doThisTodayMutation = useMutation({
    mutationFn: async (order: ShippableOrder) => {
      const { error } = await supabase
        .from('orders')
        .update({ 
          requested_ship_date: todayPlusOne,
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

  // Directly show decrement modal - no incomplete steps check
  const handleMarkOrderShipped = (order: ShippableOrder) => {
    setPendingShipOrder(order);
    setShowDecrementModal(true);
  };

  const shipWithDecrement = async () => {
    if (!pendingShipOrder) return;
    
    try {
      await decrementPackingMutation.mutateAsync({ order: pendingShipOrder });
      await markOrderShippedMutation.mutateAsync(pendingShipOrder.id);
    } catch (err) {
      // Errors handled in mutation callbacks
    }
    
    setShowDecrementModal(false);
    setPendingShipOrder(null);
  };

  const shipWithoutDecrement = async () => {
    if (!pendingShipOrder) return;
    
    await markOrderShippedMutation.mutateAsync(pendingShipOrder.id);
    
    setShowDecrementModal(false);
    setPendingShipOrder(null);
  };

  // Use localOrders for rendering to prevent snapping
  const displayOrders = localOrders.length > 0 ? localOrders : allOrdersWithMetrics;

  // Update counts based on display orders
  const displayShippableCount = displayOrders.filter(o => o.allLineItemsPacked).length;
  const displayPendingCount = displayOrders.filter(o => !o.allLineItemsPacked).length;

  return (
    <div className="space-y-4">
      {/* Decrement Inventory Modal */}
      <Dialog open={showDecrementModal} onOpenChange={setShowDecrementModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decrement Packed Inventory?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Do you want to decrement packed inventory for this order's items?
            </p>
            {pendingShipOrder && (
              <div className="border rounded p-3 bg-muted/30 text-sm space-y-1">
                <p className="font-medium">{pendingShipOrder.order_number} - {pendingShipOrder.client_name}</p>
                {pendingShipOrder.lineItems.map((li) => (
                  <p key={li.id} className="text-muted-foreground">
                    {li.product_name}: {li.quantity_units} units
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button 
                variant="outline" 
                onClick={shipWithoutDecrement}
                disabled={decrementPackingMutation.isPending || markOrderShippedMutation.isPending}
              >
                Ship without decrement
              </Button>
              <Button 
                onClick={shipWithDecrement}
                disabled={decrementPackingMutation.isPending || markOrderShippedMutation.isPending}
              >
                {decrementPackingMutation.isPending ? 'Processing...' : 'Yes, decrement'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
            <p className="text-muted-foreground py-8 text-center">
              No orders for the selected date window.
            </p>
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
                      packingByProduct={packingByProduct}
                      onTogglePriority={toggleOrderPriority}
                      onMarkShipped={handleMarkOrderShipped}
                      isShipping={markOrderShippedMutation.isPending}
                      onDoThisLater={handleDoThisLater}
                      onDoThisToday={handleDoThisToday}
                      todayPlusOne={todayPlusOne}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* Short List - at bottom */}
      {shortList.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="h-5 w-5" />
              Short List
              <Badge variant="outline" className="ml-2 border-warning/50 text-warning">
                {shortList.length} items
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              SKUs where packed units are less than demanded.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {shortList.map((item) => (
                <div key={item.product_id} className="flex items-center justify-between p-2 bg-background rounded border border-warning/30">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-warning" />
                    <span className="font-medium">{item.product_name}</span>
                    <PackagingBadge variant={item.packaging_variant} />
                    <span className="text-xs text-muted-foreground">{item.bag_size_g}g</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-warning font-medium">Short: {item.shortage}</span>
                    <span className="text-muted-foreground ml-2">
                      ({item.packed_units}/{item.demanded_units} packed)
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
