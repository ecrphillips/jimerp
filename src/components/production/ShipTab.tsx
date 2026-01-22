import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { Truck, Clock, ChevronDown, ChevronRight, MessageSquare, AlertTriangle, ExternalLink, Package, CheckCircle2, Layers } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { IncompleteFulfillmentModal } from '@/components/internal/IncompleteFulfillmentModal';
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
  hasContention: boolean; // True if any SKU in the order is short overall
  // Complexity metrics
  skuCount: number;
  totalUnits: number;
  missingSkuCount: number;
  missingUnitsTotal: number;
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
  const navigate = useNavigate();
  
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
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

  // Fetch orders for shippable view
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
          client:clients(name),
          line_items:order_line_items(
            id,
            product_id,
            quantity_units,
            product:products(product_name, bag_size_g, packaging_variant)
          )
        `)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .in('requested_ship_date', dateFilter);
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
      });
    }

    // Sort: Shippable first, then not-yet-shippable
    return orders.sort((a, b) => {
      // Shippable orders come first
      if (a.allLineItemsPacked !== b.allLineItemsPacked) {
        return a.allLineItemsPacked ? -1 : 1;
      }

      if (a.allLineItemsPacked && b.allLineItemsPacked) {
        // Both shippable: TIME_SENSITIVE first, then fewer SKUs, then fewer units, then order number
        if (a.priority !== b.priority) {
          return a.priority === 'TIME_SENSITIVE' ? -1 : 1;
        }
        if (a.skuCount !== b.skuCount) return a.skuCount - b.skuCount;
        if (a.totalUnits !== b.totalUnits) return a.totalUnits - b.totalUnits;
        return a.order_number.localeCompare(b.order_number);
      } else {
        // Both not-yet-shippable: sort by closeness
        // TIME_SENSITIVE first
        if (a.priority !== b.priority) {
          return a.priority === 'TIME_SENSITIVE' ? -1 : 1;
        }
        // Fewer missing SKUs first
        if (a.missingSkuCount !== b.missingSkuCount) return a.missingSkuCount - b.missingSkuCount;
        // Fewer missing units first
        if (a.missingUnitsTotal !== b.missingUnitsTotal) return a.missingUnitsTotal - b.missingUnitsTotal;
        // Fewer total SKUs first
        if (a.skuCount !== b.skuCount) return a.skuCount - b.skuCount;
        // Earlier ship date first
        const dateA = a.requested_ship_date ? new Date(a.requested_ship_date).getTime() : Infinity;
        const dateB = b.requested_ship_date ? new Date(b.requested_ship_date).getTime() : Infinity;
        if (dateA !== dateB) return dateA - dateB;
        return a.order_number.localeCompare(b.order_number);
      }
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

  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

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

      {/* All Orders - Unified List */}
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
            Sorted by shippability, then by complexity (easy wins first).
          </p>
        </CardHeader>
        <CardContent>
          {allOrdersWithMetrics.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No orders for the selected date window.
            </p>
          ) : (
            <div className="space-y-3">
              {allOrdersWithMetrics.map((order) => {
                const isTimeSensitive = order.priority === 'TIME_SENSITIVE';
                const hasNotes = order.client_notes || order.internal_ops_notes;
                const hasOpsNotes = !!order.internal_ops_notes;
                const isShippable = order.allLineItemsPacked;
                
                return (
                  <div
                    key={order.id}
                    className={`border rounded-lg p-4 transition-colors ${
                      isShippable 
                        ? 'border-green-400 bg-green-50/50' 
                        : isTimeSensitive 
                          ? 'border-destructive/30 bg-destructive/5' 
                          : 'border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-semibold text-lg">{order.order_number}</span>
                          <span className="text-muted-foreground">•</span>
                          <span className="font-medium">{order.client_name}</span>
                          
                          {/* Shippable badge */}
                          {isShippable && (
                            <Badge className="text-xs bg-green-600 hover:bg-green-700">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Ready
                            </Badge>
                          )}
                          
                          {isTimeSensitive && (
                            <Badge variant="destructive" className="text-xs">
                              <Clock className="h-3 w-3 mr-1" />
                              Urgent
                            </Badge>
                          )}
                          
                          {order.hasContention && (
                            <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 bg-amber-50">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Shared SKU short
                            </Badge>
                          )}
                          
                          {/* Notes indicators */}
                          {hasOpsNotes && (
                            <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 border-orange-300">
                              <MessageSquare className="h-3 w-3 mr-1" />
                              Ops note
                            </Badge>
                          )}
                          {hasNotes && !hasOpsNotes && (
                            <Badge variant="outline" className="text-xs">
                              <MessageSquare className="h-3 w-3 mr-1" />
                              Notes
                            </Badge>
                          )}
                        </div>
                        
                        {/* Metrics row */}
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                          <span>
                            Ship: {order.requested_ship_date 
                              ? format(parseISO(order.requested_ship_date), 'MMM d, yyyy')
                              : 'Not set'}
                          </span>
                          <span>•</span>
                          <span>{order.delivery_method}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {order.skuCount} SKU{order.skuCount !== 1 ? 's' : ''}, {order.totalUnits} units
                          </span>
                          
                          {/* Missing metrics for non-shippable orders */}
                          {!isShippable && (
                            <>
                              <span>•</span>
                              <span className="text-amber-600 font-medium">
                                Missing: {order.missingSkuCount} SKU{order.missingSkuCount !== 1 ? 's' : ''}, {order.missingUnitsTotal} unit{order.missingUnitsTotal !== 1 ? 's' : ''}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/orders/${order.id}`)}
                        >
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Open Order
                        </Button>
                        <Button
                          size="sm"
                          variant={isTimeSensitive ? 'destructive' : 'outline'}
                          onClick={() => toggleOrderPriority(order)}
                        >
                          <Clock className="h-4 w-4 mr-1" />
                          {isTimeSensitive ? 'Urgent' : 'Normal'}
                        </Button>
                        {isShippable && (
                          <Button
                            size="sm"
                            onClick={() => handleMarkOrderShipped(order)}
                            disabled={markOrderShippedMutation.isPending}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Truck className="h-4 w-4 mr-1" />
                            Mark Shipped
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Notes - always show if present */}
                    {hasNotes && (
                      <Collapsible defaultOpen={hasOpsNotes}>
                        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground mt-2 hover:text-foreground">
                          <MessageSquare className="h-3 w-3" />
                          {hasOpsNotes ? 'View notes (has ops note)' : 'View notes'}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 p-2 bg-muted/50 rounded text-sm">
                          {order.internal_ops_notes && (
                            <p className="mb-1"><strong className="text-orange-700">Ops:</strong> {order.internal_ops_notes}</p>
                          )}
                          {order.client_notes && (
                            <p><strong>Client:</strong> {order.client_notes}</p>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Line Items */}
                    <Collapsible open={expandedOrders.has(order.id)} onOpenChange={() => toggleOrderExpand(order.id)}>
                      <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground mt-3 hover:text-foreground">
                        {expandedOrders.has(order.id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        {order.lineItems.length} line item{order.lineItems.length !== 1 ? 's' : ''}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="space-y-1">
                          {order.lineItems.map((li) => {
                            const packed = packingByProduct[li.product_id] ?? 0;
                            const isMissing = packed < li.quantity_units;
                            
                            return (
                              <div 
                                key={li.id} 
                                className={`flex items-center gap-2 text-sm p-2 rounded ${
                                  isMissing ? 'bg-amber-50 border border-amber-200' : 'bg-muted/30'
                                }`}
                              >
                                <span className="font-medium">{li.product_name}</span>
                                <PackagingBadge variant={li.packaging_variant} />
                                <span className="text-muted-foreground">{li.bag_size_g}g</span>
                                <span className="ml-auto font-medium">× {li.quantity_units}</span>
                                {isMissing && (
                                  <span className="text-amber-600 text-xs">
                                    (packed: {packed})
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
