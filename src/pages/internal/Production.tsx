import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, addDays, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { ChevronDown, ChevronRight, Clock, Printer, MessageSquare, Truck, Package } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { IncompleteFulfillmentModal } from '@/components/internal/IncompleteFulfillmentModal';
import type { Database } from '@/integrations/supabase/types';

type ShipPriority = 'NORMAL' | 'TIME_SENSITIVE';
type OrderStatus = Database['public']['Enums']['order_status'];
type ViewMode = 'product-summary' | 'shippable-by-order';

// Helper: get YYYY-MM-DD in America/Vancouver timezone
function getVancouverDate(daysOffset = 0): string {
  const nowUtc = new Date();
  const vancouverNow = toZonedTime(nowUtc, 'America/Vancouver');
  const target = addDays(vancouverNow, daysOffset);
  return format(target, 'yyyy-MM-dd');
}

interface OrderLineItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity_units: number;
  order: {
    id: string;
    order_number: string;
    requested_ship_date: string | null;
    status: string;
    client: { name: string } | null;
  } | null;
  product: {
    id: string;
    product_name: string;
    sku: string | null;
    bag_size_g: number;
    packaging_variant: PackagingVariant | null;
  } | null;
}

interface ExternalDemand {
  id: string;
  source: string;
  target_date: string;
  product_id: string;
  quantity_units: number;
  product: {
    id: string;
    product_name: string;
    sku: string | null;
    bag_size_g: number;
    packaging_variant: PackagingVariant | null;
  } | null;
}

interface Checkmark {
  id: string;
  target_date: string;
  product_id: string;
  bag_size_g: number;
  roast_complete: boolean;
  pack_complete: boolean;
  ship_complete: boolean;
  ship_priority: ShipPriority;
}

interface AggregatedRow {
  key: string;
  productId: string;
  productName: string;
  sku: string | null;
  bagSize: number;
  packagingVariant: PackagingVariant | null;
  totalUnits: number;
  totalGrams: number;
  orders: { clientName: string; orderNumber: string; units: number }[];
  externalDemand: { source: string; units: number }[];
  checkmark: Checkmark | null;
}

// Interface for the order-centric shippable view
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
  }[];
  // Computed from production_checkmarks: all line items have pack_complete
  allLineItemsPacked: boolean;
  // Priority from the first line item's checkmark (or NORMAL)
  priority: ShipPriority;
}

export default function Production() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Use America/Vancouver timezone for today/tomorrow
  const today = getVancouverDate(0);
  const tomorrow = getVancouverDate(1);

  const [dateFilter, setDateFilter] = useState<string[]>([today, tomorrow]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showShippableOnly, setShowShippableOnly] = useState(false);
  const [printWithBreakdown, setPrintWithBreakdown] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('product-summary');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  
  // State for incomplete fulfillment modal when marking shipped from order view
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  const [incompleteSteps, setIncompleteSteps] = useState<string[]>([]);
  const [pendingShipOrderId, setPendingShipOrderId] = useState<string | null>(null);

  const handlePrint = () => {
    window.print();
  };

  // Fetch order line items for orders with relevant statuses and ship dates
  const { data: orderLineItems, isLoading: ordersLoading } = useQuery({
    queryKey: ['production-orders', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          order_id,
          product_id,
          quantity_units,
          order:orders!inner(
            id,
            order_number,
            requested_ship_date,
            status,
            client:clients(name)
          ),
          product:products(id, product_name, sku, bag_size_g, packaging_variant)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .in('order.requested_ship_date', dateFilter);

      if (error) throw error;
      return (data ?? []) as OrderLineItem[];
    },
  });

  // Fetch external demand for selected dates
  const { data: externalDemand } = useQuery({
    queryKey: ['external-demand', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_demand')
        .select('id, source, target_date, product_id, quantity_units, product:products(id, product_name, sku, bag_size_g, packaging_variant)')
        .in('target_date', dateFilter)
        .gt('quantity_units', 0);

      if (error) throw error;
      return (data ?? []) as ExternalDemand[];
    },
  });

  // Fetch existing checkmarks
  const { data: checkmarks } = useQuery({
    queryKey: ['production-checkmarks', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checkmarks')
        .select('*')
        .in('target_date', dateFilter);

      if (error) throw error;
      return (data ?? []) as Checkmark[];
    },
  });

  // Fetch orders for the "Shippable by Order" view
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

  // Compute shippable orders: all line items must have pack_complete in checkmarks
  const shippableOrders = useMemo((): ShippableOrder[] => {
    if (!ordersForShipping || !checkmarks) return [];

    const checkmarkMap = new Map<string, Checkmark>();
    for (const cm of checkmarks) {
      const key = `${cm.product_id}-${cm.bag_size_g}`;
      checkmarkMap.set(key, cm);
    }

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

      // Check if ALL line items have pack_complete
      const allLineItemsPacked = lineItems.length > 0 && lineItems.every((li: { product_id: string; bag_size_g: number }) => {
        const key = `${li.product_id}-${li.bag_size_g}`;
        const cm = checkmarkMap.get(key);
        return cm?.pack_complete === true;
      });

      // Get highest priority from any line item's checkmark
      let priority: ShipPriority = 'NORMAL';
      for (const li of lineItems) {
        const key = `${li.product_id}-${li.bag_size_g}`;
        const cm = checkmarkMap.get(key);
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
        lineItems: lineItems.map((li: { id: string; product_name: string; quantity_units: number; bag_size_g: number; packaging_variant: PackagingVariant | null }) => ({
          id: li.id,
          product_name: li.product_name,
          quantity_units: li.quantity_units,
          bag_size_g: li.bag_size_g,
          packaging_variant: li.packaging_variant,
        })),
        allLineItemsPacked,
        priority,
      });
    }

    // Filter to only shippable (all items packed) and sort
    return orders
      .filter((o) => o.allLineItemsPacked)
      .sort((a, b) => {
        // TIME_SENSITIVE first
        if (a.priority === 'TIME_SENSITIVE' && b.priority !== 'TIME_SENSITIVE') return -1;
        if (b.priority === 'TIME_SENSITIVE' && a.priority !== 'TIME_SENSITIVE') return 1;
        // Then by requested_ship_date (oldest first)
        const dateA = a.requested_ship_date ? new Date(a.requested_ship_date).getTime() : Infinity;
        const dateB = b.requested_ship_date ? new Date(b.requested_ship_date).getTime() : Infinity;
        if (dateA !== dateB) return dateA - dateB;
        // Then by order_number
        return a.order_number.localeCompare(b.order_number);
      });
  }, [ordersForShipping, checkmarks]);

  // Aggregate data by product × bag size
  const aggregatedRows = useMemo(() => {
    const rowMap: Record<string, AggregatedRow> = {};

    // Process order line items
    for (const li of orderLineItems ?? []) {
      if (!li.product) continue;
      const key = `${li.product_id}-${li.product.bag_size_g}`;
      
      if (!rowMap[key]) {
        rowMap[key] = {
          key,
          productId: li.product_id,
          productName: li.product.product_name,
          sku: li.product.sku,
          bagSize: li.product.bag_size_g,
          packagingVariant: li.product.packaging_variant ?? null,
          totalUnits: 0,
          totalGrams: 0,
          orders: [],
          externalDemand: [],
          checkmark: null,
        };
      }

      rowMap[key].totalUnits += li.quantity_units;
      rowMap[key].totalGrams += li.quantity_units * li.product.bag_size_g;
      rowMap[key].orders.push({
        clientName: li.order?.client?.name ?? 'Unknown',
        orderNumber: li.order?.order_number ?? 'Unknown',
        units: li.quantity_units,
      });
    }

    // Process external demand
    for (const ed of externalDemand ?? []) {
      if (!ed.product) continue;
      const key = `${ed.product_id}-${ed.product.bag_size_g}`;

      if (!rowMap[key]) {
        rowMap[key] = {
          key,
          productId: ed.product_id,
          productName: ed.product.product_name,
          sku: ed.product.sku,
          bagSize: ed.product.bag_size_g,
          packagingVariant: ed.product.packaging_variant ?? null,
          totalUnits: 0,
          totalGrams: 0,
          orders: [],
          externalDemand: [],
          checkmark: null,
        };
      }

      rowMap[key].totalUnits += ed.quantity_units;
      rowMap[key].totalGrams += ed.quantity_units * ed.product.bag_size_g;
      rowMap[key].externalDemand.push({
        source: ed.source,
        units: ed.quantity_units,
      });
    }

    // Attach checkmarks
    for (const cm of checkmarks ?? []) {
      const key = `${cm.product_id}-${cm.bag_size_g}`;
      if (rowMap[key]) {
        rowMap[key].checkmark = cm;
      }
    }

    // Sort: TIME_SENSITIVE first, then alphabetically by product name
    return Object.values(rowMap).sort((a, b) => {
      const aPriority = a.checkmark?.ship_priority ?? 'NORMAL';
      const bPriority = b.checkmark?.ship_priority ?? 'NORMAL';
      
      // TIME_SENSITIVE sorts before NORMAL
      if (aPriority === 'TIME_SENSITIVE' && bPriority !== 'TIME_SENSITIVE') return -1;
      if (bPriority === 'TIME_SENSITIVE' && aPriority !== 'TIME_SENSITIVE') return 1;
      
      return a.productName.localeCompare(b.productName);
    });
  }, [orderLineItems, externalDemand, checkmarks]);

  // Filter for "Shippable Now": pack_complete = true AND ship_complete = false
  const displayedRows = useMemo(() => {
    if (!showShippableOnly) return aggregatedRows;
    
    return aggregatedRows.filter((row) => {
      const packComplete = row.checkmark?.pack_complete ?? false;
      const shipComplete = row.checkmark?.ship_complete ?? false;
      return packComplete && !shipComplete;
    });
  }, [aggregatedRows, showShippableOnly]);

  const checkmarkMutation = useMutation({
    mutationFn: async ({ productId, bagSize, field, value }: { productId: string; bagSize: number; field: 'roast_complete' | 'pack_complete' | 'ship_complete'; value: boolean }) => {
      const targetDate = today;
      
      const { error } = await supabase
        .from('production_checkmarks')
        .upsert({
          target_date: targetDate,
          product_id: productId,
          bag_size_g: bagSize,
          [field]: value,
          updated_by: user?.id,
        }, {
          onConflict: 'target_date,product_id,bag_size_g',
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-checkmarks'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update checkmark');
    },
  });

  const priorityMutation = useMutation({
    mutationFn: async ({ productId, bagSize, priority, existingCheckmark }: { productId: string; bagSize: number; priority: ShipPriority; existingCheckmark: Checkmark | null }) => {
      const targetDate = today;
      
      const { error } = await supabase
        .from('production_checkmarks')
        .upsert({
          target_date: targetDate,
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
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update priority');
    },
  });

  // Mutation to mark an order as shipped
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
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark order as shipped');
    },
  });

  const toggleExpand = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

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

  const toggleDateFilter = (date: string) => {
    setDateFilter((prev) => {
      if (prev.includes(date)) {
        return prev.filter((d) => d !== date);
      }
      return [...prev, date].sort();
    });
  };

  const togglePriority = (row: AggregatedRow) => {
    const currentPriority = row.checkmark?.ship_priority ?? 'NORMAL';
    const newPriority: ShipPriority = currentPriority === 'NORMAL' ? 'TIME_SENSITIVE' : 'NORMAL';
    priorityMutation.mutate({ productId: row.productId, bagSize: row.bagSize, priority: newPriority, existingCheckmark: row.checkmark });
  };

  // Toggle priority for an order (updates all line items' checkmarks)
  const toggleOrderPriority = (order: ShippableOrder) => {
    const newPriority: ShipPriority = order.priority === 'NORMAL' ? 'TIME_SENSITIVE' : 'NORMAL';
    
    // Update all line items' checkmarks
    const updates = order.lineItems.map((li) => {
      const key = `${li.id}`;
      // Find existing checkmark for this product/bag
      const existingCheckmark = checkmarks?.find(
        (cm) => cm.product_id === (orderLineItems?.find((oli) => oli.id === li.id)?.product_id) && cm.bag_size_g === li.bag_size_g
      ) ?? null;
      
      // Get product_id from original line items
      const lineItem = ordersForShipping?.find((o) => o.id === order.id)?.line_items?.find((l: { id: string }) => l.id === li.id);
      const productId = lineItem?.product_id;
      
      if (productId) {
        return priorityMutation.mutateAsync({
          productId,
          bagSize: li.bag_size_g,
          priority: newPriority,
          existingCheckmark,
        });
      }
      return Promise.resolve();
    });
    
    Promise.all(updates).then(() => {
      queryClient.invalidateQueries({ queryKey: ['shippable-orders'] });
    });
  };

  // Handle mark as shipped with safety check
  const handleMarkOrderShipped = (order: ShippableOrder) => {
    const missing: string[] = [];
    if (!order.roasted) missing.push('Roasted');
    if (!order.packed) missing.push('Packed');
    if (!order.invoiced) missing.push('Invoiced');

    if (missing.length > 0) {
      setIncompleteSteps(missing);
      setPendingShipOrderId(order.id);
      setShowIncompleteModal(true);
    } else {
      markOrderShippedMutation.mutate(order.id);
    }
  };

  const confirmShipOrder = () => {
    if (pendingShipOrderId) {
      markOrderShippedMutation.mutate(pendingShipOrderId);
      setPendingShipOrderId(null);
    }
    setShowIncompleteModal(false);
  };

  return (
    <div className={`page-container ${printWithBreakdown ? 'print-with-breakdown' : ''}`}>
      {/* Incomplete Fulfillment Modal */}
      <IncompleteFulfillmentModal
        open={showIncompleteModal}
        onOpenChange={setShowIncompleteModal}
        incompleteSteps={incompleteSteps}
        onConfirm={confirmShipOrder}
      />

      {/* Print-only header */}
      <div className="hidden print:block print:mb-4">
        <h1 className="text-xl font-bold">Production Run Sheet</h1>
        <p className="text-sm">
          {dateFilter.map((d) => format(parseISO(d), 'EEEE, MMMM d, yyyy')).join(' – ')}
        </p>
      </div>

      <div className="page-header print:hidden">
        <div>
          <h1 className="page-title">Production Run Sheet</h1>
          <p className="text-sm text-muted-foreground">
            Viewing: {dateFilter.map((d) => format(parseISO(d), 'MMM d')).join(', ')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {viewMode === 'product-summary' && (
            <>
              <div className="flex items-center gap-2">
                <Switch
                  id="breakdown-toggle"
                  checked={printWithBreakdown}
                  onCheckedChange={setPrintWithBreakdown}
                />
                <Label htmlFor="breakdown-toggle" className="text-sm font-medium cursor-pointer">
                  Print with breakdown
                </Label>
              </div>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <div className="flex items-center gap-2">
                <Switch
                  id="shippable-filter"
                  checked={showShippableOnly}
                  onCheckedChange={setShowShippableOnly}
                />
                <Label htmlFor="shippable-filter" className="text-sm font-medium cursor-pointer">
                  Shippable Now
                </Label>
              </div>
            </>
          )}
          <div className="flex gap-2">
            <Button
              variant={dateFilter.includes(today) ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleDateFilter(today)}
            >
              Today
            </Button>
            <Button
              variant={dateFilter.includes(tomorrow) ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleDateFilter(tomorrow)}
            >
              Tomorrow
            </Button>
          </div>
        </div>
      </div>

      {/* View Toggle Tabs */}
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="print:hidden mb-4">
        <TabsList>
          <TabsTrigger value="product-summary" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Product Summary
          </TabsTrigger>
          <TabsTrigger value="shippable-by-order" className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Shippable by Order
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* View A: Product Summary (existing) */}
      {viewMode === 'product-summary' && (
        <Card className="print:shadow-none print:border-none">
          <CardHeader className="print:hidden">
            <CardTitle>
              {showShippableOnly ? 'Shippable Now' : 'Aggregated Production'}
              <span className="ml-4 text-xs font-normal text-muted-foreground">
                ({displayedRows.length} rows)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="print:p-0">
            {ordersLoading ? (
              <p className="text-muted-foreground print:hidden">Loading…</p>
            ) : displayedRows.length === 0 ? (
              <p className="text-muted-foreground print:hidden">
                {showShippableOnly 
                  ? 'No items ready to ship. Items appear here when Pack ✓ is checked but Ship ✓ is not.'
                  : 'No production items for selected dates.'}
              </p>
            ) : (
              <table className="w-full text-sm print:text-xs">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 w-8 print:hidden"></th>
                    <th className="pb-2 print:py-1">Product</th>
                    <th className="pb-2 print:py-1 print:hidden">SKU</th>
                    <th className="pb-2 print:py-1">Bag Size</th>
                    <th className="pb-2 text-right print:py-1">Units</th>
                    <th className="pb-2 text-right print:py-1">Total KG</th>
                    <th className="pb-2 text-center print:py-1">Priority</th>
                    <th className="pb-2 text-center print:py-1">Roast</th>
                    <th className="pb-2 text-center print:py-1">Pack</th>
                    <th className="pb-2 text-center print:py-1">Ship</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((row) => {
                    const isTimeSensitive = (row.checkmark?.ship_priority ?? 'NORMAL') === 'TIME_SENSITIVE';
                    
                    return (
                      <React.Fragment key={row.key}>
                        <tr className={`border-b last:border-0 hover:bg-muted/50 print:hover:bg-transparent ${isTimeSensitive ? 'bg-destructive/5 print:bg-transparent' : ''}`}>
                          <td className="py-2 print:hidden">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => toggleExpand(row.key)}
                            >
                              {expandedRows.has(row.key) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </td>
                          <td className="py-2 font-medium print:py-1">
                            <span className="flex items-center gap-2 flex-wrap">
                              <span>{row.productName}</span>
                              <PackagingBadge variant={row.packagingVariant} />
                              {isTimeSensitive && (
                                <>
                                  <Badge variant="destructive" className="text-xs print:hidden">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Urgent
                                  </Badge>
                                  <span className="hidden print:inline font-bold">*</span>
                                </>
                              )}
                            </span>
                          </td>
                          <td className="py-2 print:hidden">{row.sku || '—'}</td>
                          <td className="py-2 print:py-1">{row.bagSize}g</td>
                          <td className="py-2 text-right font-medium print:py-1">{row.totalUnits}</td>
                          <td className="py-2 text-right print:py-1">{(row.totalGrams / 1000).toFixed(2)}</td>
                          <td className="py-2 text-center print:py-1">
                            <Button
                              variant={isTimeSensitive ? 'destructive' : 'outline'}
                              size="sm"
                              className="h-7 text-xs print:hidden"
                              onClick={() => togglePriority(row)}
                            >
                              {isTimeSensitive ? 'Urgent' : 'Normal'}
                            </Button>
                            <span className="hidden print:inline">{isTimeSensitive ? 'URGENT' : '—'}</span>
                          </td>
                          <td className="py-2 text-center print:py-1">
                            <span className="print:hidden">
                              <Checkbox
                                checked={row.checkmark?.roast_complete ?? false}
                                onCheckedChange={(checked) =>
                                  checkmarkMutation.mutate({
                                    productId: row.productId,
                                    bagSize: row.bagSize,
                                    field: 'roast_complete',
                                    value: !!checked,
                                  })
                                }
                              />
                            </span>
                            <span className="hidden print:inline">{row.checkmark?.roast_complete ? '☑' : '☐'}</span>
                          </td>
                          <td className="py-2 text-center print:py-1">
                            <span className="print:hidden">
                              <Checkbox
                                checked={row.checkmark?.pack_complete ?? false}
                                onCheckedChange={(checked) =>
                                  checkmarkMutation.mutate({
                                    productId: row.productId,
                                    bagSize: row.bagSize,
                                    field: 'pack_complete',
                                    value: !!checked,
                                  })
                                }
                              />
                            </span>
                            <span className="hidden print:inline">{row.checkmark?.pack_complete ? '☑' : '☐'}</span>
                          </td>
                          <td className="py-2 text-center print:py-1">
                            <span className="print:hidden">
                              <Checkbox
                                checked={row.checkmark?.ship_complete ?? false}
                                onCheckedChange={(checked) =>
                                  checkmarkMutation.mutate({
                                    productId: row.productId,
                                    bagSize: row.bagSize,
                                    field: 'ship_complete',
                                    value: !!checked,
                                  })
                                }
                              />
                            </span>
                            <span className="hidden print:inline">{row.checkmark?.ship_complete ? '☑' : '☐'}</span>
                          </td>
                        </tr>
                        {/* Breakdown row - shown on screen when expanded, or in print when toggle is on */}
                        {(expandedRows.has(row.key) || (row.orders.length > 0 || row.externalDemand.length > 0)) && (
                          <tr className={`${expandedRows.has(row.key) ? '' : 'hidden'} print:${printWithBreakdown ? 'table-row' : 'hidden'}`}>
                            <td colSpan={10} className="bg-muted/30 px-8 py-2 print:bg-transparent print:py-1 print:pl-4 print:border-l-2 print:border-border">
                              <div className="space-y-1 text-xs">
                                {row.orders.map((o, i) => (
                                  <div key={i} className="flex justify-between">
                                    <span>{o.clientName} — {o.orderNumber}</span>
                                    <span>{o.units} units</span>
                                  </div>
                                ))}
                                {row.externalDemand.map((ed, i) => (
                                  <div key={`ext-${i}`} className="flex justify-between text-info print:text-inherit">
                                    <span>{ed.source} (External)</span>
                                    <span>{ed.units} units</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* View B: Shippable by Order */}
      {viewMode === 'shippable-by-order' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Shippable Orders
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({shippableOrders.length} orders ready)
              </span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Orders where ALL line items are packed and ready to ship.
            </p>
          </CardHeader>
          <CardContent>
            {shippableOrders.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center">
                No orders ready to ship. Orders appear here when all line items have Pack ✓ checked in the Product Summary view.
              </p>
            ) : (
              <div className="space-y-4">
                {shippableOrders.map((order) => {
                  const isTimeSensitive = order.priority === 'TIME_SENSITIVE';
                  const hasNotes = order.client_notes || order.internal_ops_notes;
                  
                  return (
                    <div
                      key={order.id}
                      className={`border rounded-lg p-4 ${isTimeSensitive ? 'border-destructive bg-destructive/5' : ''}`}
                    >
                      {/* Order Header */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-semibold text-lg">{order.order_number}</span>
                            <span className="text-muted-foreground">•</span>
                            <span className="font-medium">{order.client_name}</span>
                            {isTimeSensitive && (
                              <Badge variant="destructive" className="text-xs">
                                <Clock className="h-3 w-3 mr-1" />
                                Urgent
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                            <span>
                              Ship: {order.requested_ship_date 
                                ? format(parseISO(order.requested_ship_date), 'MMM d, yyyy')
                                : 'Not set'}
                            </span>
                            <span>•</span>
                            <span className="capitalize">{order.delivery_method.toLowerCase().replace('_', ' ')}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant={isTimeSensitive ? 'destructive' : 'outline'}
                            size="sm"
                            onClick={() => toggleOrderPriority(order)}
                          >
                            {isTimeSensitive ? 'Urgent' : 'Normal'}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleMarkOrderShipped(order)}
                            disabled={markOrderShippedMutation.isPending}
                          >
                            <Truck className="h-4 w-4 mr-2" />
                            Mark Shipped
                          </Button>
                        </div>
                      </div>

                      {/* Notes (collapsible) */}
                      {hasNotes && (
                        <Collapsible className="mt-3">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                              <MessageSquare className="h-3 w-3 mr-1" />
                              Notes
                              <ChevronDown className="h-3 w-3 ml-1" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-2 space-y-2">
                            {order.client_notes && (
                              <div className="text-sm bg-muted/50 rounded p-2">
                                <span className="font-medium text-xs text-muted-foreground">Client:</span>
                                <p className="mt-1">{order.client_notes}</p>
                              </div>
                            )}
                            {order.internal_ops_notes && (
                              <div className="text-sm bg-primary/5 rounded p-2">
                                <span className="font-medium text-xs text-muted-foreground">Internal:</span>
                                <p className="mt-1">{order.internal_ops_notes}</p>
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      )}

                      {/* Line Items */}
                      <div className="mt-3 pt-3 border-t">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            {order.lineItems.length} item{order.lineItems.length !== 1 ? 's' : ''}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => toggleOrderExpand(order.id)}
                          >
                            {expandedOrders.has(order.id) ? 'Hide' : 'Show'} details
                            {expandedOrders.has(order.id) ? (
                              <ChevronDown className="h-3 w-3 ml-1" />
                            ) : (
                              <ChevronRight className="h-3 w-3 ml-1" />
                            )}
                          </Button>
                        </div>
                        
                        {expandedOrders.has(order.id) && (
                          <div className="space-y-1">
                            {order.lineItems.map((li) => (
                              <div
                                key={li.id}
                                className="flex items-center justify-between text-sm py-1 px-2 bg-muted/30 rounded"
                              >
                                <div className="flex items-center gap-2">
                                  <span>{li.product_name}</span>
                                  <PackagingBadge variant={li.packaging_variant} />
                                </div>
                                <span className="font-medium">{li.quantity_units} units</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Summary when collapsed */}
                        {!expandedOrders.has(order.id) && (
                          <div className="flex flex-wrap gap-2">
                            {order.lineItems.slice(0, 3).map((li) => (
                              <Badge key={li.id} variant="secondary" className="text-xs">
                                {li.product_name} × {li.quantity_units}
                              </Badge>
                            ))}
                            {order.lineItems.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{order.lineItems.length - 3} more
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
