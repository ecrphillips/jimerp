import React, { useState, useMemo, useCallback } from 'react';
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
import { IncompleteFulfillmentModal } from '@/components/internal/IncompleteFulfillmentModal';
import { SortableShipCard } from './SortableShipCard';
import type { Database } from '@/integrations/supabase/types';

type ShipPriority = 'NORMAL' | 'TIME_SENSITIVE';
type OrderStatus = Database['public']['Enums']['order_status'];

interface ShipTabProps {
  dateFilter: string[];
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

export function ShipTab({ dateFilter, today }: ShipTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const [incompleteSteps, setIncompleteSteps] = useState<string[]>([]);
  const [pendingShipOrderId, setPendingShipOrderId] = useState<string | null>(null);
  const [showDecrementModal, setShowDecrementModal] = useState(false);
  const [pendingShipOrder, setPendingShipOrder] = useState<ShippableOrder | null>(null);

  // Fetch checkmarks for priority tracking
  const { data: checkmarks } = useQuery({
    queryKey: ['production-checkmarks', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checkmarks')
        .select('*')
        .in('target_date', dateFilter);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch order line items for demand
  const { data: orderLineItems } = useQuery({
    queryKey: ['ship-demand', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order:orders!inner(status, requested_ship_date),
          product:products(id, product_name, bag_size_g, packaging_variant)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .in('order.requested_ship_date', dateFilter);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch packing runs
  const { data: packingRuns } = useQuery({
    queryKey: ['packing-runs', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packing_runs')
        .select('*')
        .in('target_date', dateFilter);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch orders for shippable view (including ship_display_order)
  const { data: ordersForShipping } = useQuery({
    queryKey: ['shippable-orders', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
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
          client:clients(name),
          line_items:order_line_items(
            id,
            product_id,
            quantity_units,
            product:products(product_name, bag_size_g, packaging_variant)
          )
        `)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .in('requested_ship_date', dateFilter)
        .order('ship_display_order', { ascending: true, nullsFirst: false })
        .order('order_number', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
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

  // Handle drag end for reordering
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;
    
    const oldIndex = allOrdersWithMetrics.findIndex(o => o.id === active.id);
    const newIndex = allOrdersWithMetrics.findIndex(o => o.id === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;
    
    // Reorder and persist
    const reordered = [...allOrdersWithMetrics];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    
    // Update all items with new display_order
    reordered.forEach((order, index) => {
      updateDisplayOrderMutation.mutate({ orderId: order.id, newOrder: (index + 1) * 10 });
    });
  }, [allOrdersWithMetrics, updateDisplayOrderMutation]);

  const toggleOrderPriority = (order: ShippableOrder) => {
    const newPriority: ShipPriority = order.priority === 'NORMAL' ? 'TIME_SENSITIVE' : 'NORMAL';
    
    const updates = order.lineItems.map((li) => {
      const key = `${li.product_id}-${li.bag_size_g}`;
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

  const handleMarkOrderShipped = (order: ShippableOrder) => {
    const missing: string[] = [];
    if (!order.roasted) missing.push('Roasted');
    if (!order.packed) missing.push('Packed');
    if (!order.invoiced) missing.push('Invoiced');

    if (missing.length > 0) {
      setIncompleteSteps(missing);
      setPendingShipOrderId(order.id);
      setPendingShipOrder(order);
      setShowIncompleteModal(true);
    } else {
      // Show decrement modal
      setPendingShipOrder(order);
      setShowDecrementModal(true);
    }
  };

  const confirmShipOrder = () => {
    if (pendingShipOrderId && pendingShipOrder) {
      // After incomplete modal, show decrement modal
      setShowIncompleteModal(false);
      setShowDecrementModal(true);
    } else {
      setShowIncompleteModal(false);
    }
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
    setPendingShipOrderId(null);
  };

  const shipWithoutDecrement = async () => {
    if (!pendingShipOrder) return;
    
    await markOrderShippedMutation.mutateAsync(pendingShipOrder.id);
    
    setShowDecrementModal(false);
    setPendingShipOrder(null);
    setPendingShipOrderId(null);
  };

  return (
    <div className="space-y-4">
      <IncompleteFulfillmentModal
        open={showIncompleteModal}
        onOpenChange={setShowIncompleteModal}
        incompleteSteps={incompleteSteps}
        onConfirm={confirmShipOrder}
      />

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

      {/* Short List */}
      {shortList.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-5 w-5" />
              Short List
              <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700">
                {shortList.length} items
              </Badge>
            </CardTitle>
            <p className="text-sm text-amber-700">
              SKUs where packed units are less than demanded.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {shortList.map((item) => (
                <div key={item.product_id} className="flex items-center justify-between p-2 bg-white rounded border border-amber-200">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-amber-600" />
                    <span className="font-medium">{item.product_name}</span>
                    <PackagingBadge variant={item.packaging_variant} />
                    <span className="text-xs text-muted-foreground">{item.bag_size_g}g</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-amber-700 font-medium">Short: {item.shortage}</span>
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

      {/* All Orders - Unified List with Drag & Drop */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Orders
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({shippableOrders.length} ready • {notYetShippableOrders.length} pending)
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Drag to reorder. Green = ready to ship.
          </p>
        </CardHeader>
        <CardContent>
          {allOrdersWithMetrics.length === 0 ? (
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
                items={allOrdersWithMetrics.map(o => o.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {allOrdersWithMetrics.map((order) => (
                    <SortableShipCard
                      key={order.id}
                      order={order}
                      packingByProduct={packingByProduct}
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
    </div>
  );
}
