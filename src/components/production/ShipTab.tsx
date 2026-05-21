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
  shipment_id: string | null;
}

// One card per shipment. `orderAllPicked` is true iff every line item across
// every shipment of the parent order is fully picked — needed to enable
// "Mark Shipped" (still an order-level state transition for now).
interface ShippableShipment {
  cardId: string;            // composite `${order_id}:${shipment_id}` for DnD
  order_id: string;
  shipment_id: string;
  shipment_number: number;
  shipmentCountForOrder: number;
  isFirstShipmentInOrder: boolean;
  shipToLabel: string;       // location code + name, or city, or fallback
  order_number: string;
  client_name: string;
  requested_ship_date: string | null;
  work_deadline: string | null;
  delivery_method: string;   // shipment's delivery method
  client_notes: string | null;
  internal_ops_notes: string | null;
  roasted: boolean;
  packed: boolean;
  invoiced: boolean;
  lineItems: LineItem[];     // only lines where shipment_id === this.shipment_id
  allLineItemsPacked: boolean;
  orderAllPicked: boolean;   // populated after picks are loaded (in card)
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
  
  // Local order state for optimistic DnD updates (one entry per shipment)
  const [localOrders, setLocalOrders] = useState<ShippableShipment[]>([]);
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
          location:client_locations(name, location_code),
          shipments:order_shipments(
            id,
            shipment_number,
            delivery_method,
            location_id,
            ship_to_name,
            ship_to_city,
            location:client_locations(name, location_code)
          ),
          line_items:order_line_items(
            id,
            product_id,
            quantity_units,
            shipment_id,
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

  // Fetch ship picks early so order-wide "all picked" state is available
  // when building shipment cards.
  const { data: shipPicksForGating } = useQuery({
    queryKey: ['ship-picks-gating'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ship_picks')
        .select('order_line_item_id, units_picked');
      if (error) throw error;
      return data ?? [];
    },
  });

  const fullyPickedOrderIds = useMemo(() => {
    const picksByLi = new Map<string, number>();
    for (const p of shipPicksForGating ?? []) picksByLi.set(p.order_line_item_id, p.units_picked);
    const set = new Set<string>();
    for (const o of ordersForShipping ?? []) {
      const lines = (o as { line_items?: { id: string; quantity_units: number }[] }).line_items ?? [];
      if (lines.length === 0) continue;
      if (lines.every((l) => (picksByLi.get(l.id) ?? 0) >= l.quantity_units)) set.add(o.id);
    }
    return set;
  }, [ordersForShipping, shipPicksForGating]);

  // Compute one card per shipment (flattened across all orders in view).
  const allOrdersWithMetrics = useMemo((): ShippableShipment[] => {
    if (!ordersForShipping) return [];

    type RawLine = {
      id: string;
      product_id: string;
      quantity_units: number;
      shipment_id: string | null;
      product: {
        product_name: string;
        bag_size_g: number;
        packaging_variant: PackagingVariant | null;
        roast_group: string | null;
      } | null;
    };
    type RawShipment = {
      id: string;
      shipment_number: number;
      delivery_method: string;
      location_id: string | null;
      ship_to_name: string | null;
      ship_to_city: string | null;
      location: { name: string | null; location_code: string | null } | null;
    };

    const cards: ShippableShipment[] = [];

    for (const order of ordersForShipping) {
      const allLines: RawLine[] = (order.line_items ?? []) as RawLine[];
      const shipments: RawShipment[] = ((order as { shipments?: RawShipment[] }).shipments ?? [])
        .slice()
        .sort((a, b) => a.shipment_number - b.shipment_number);

      // Fallback: if backfill missed this order, render a synthetic single shipment
      // so the order still appears in the queue.
      const renderShipments: RawShipment[] = shipments.length
        ? shipments
        : [
            {
              id: `synthetic-${order.id}`,
              shipment_number: 1,
              delivery_method: order.delivery_method,
              location_id: null,
              ship_to_name: null,
              ship_to_city: null,
              location: (order as { location?: { name: string | null; location_code: string | null } | null }).location ?? null,
            },
          ];

      const clientName =
        (order as { account?: { account_name?: string } }).account?.account_name ??
        order.client?.name ??
        'Unknown';

      // Order-level priority lookup
      let orderPriority: ShipPriority = 'NORMAL';
      for (const li of allLines) {
        const bag = li.product?.bag_size_g ?? 0;
        const cm = checkmarks?.find((c) => c.product_id === li.product_id && c.bag_size_g === bag);
        if (cm?.ship_priority === 'TIME_SENSITIVE') {
          orderPriority = 'TIME_SENSITIVE';
          break;
        }
      }

      // Order-level contention (any shared SKU short)
      const hasContention = allLines.some((li) => {
        const totalDemanded = demandByProduct[li.product_id] ?? 0;
        const totalFg = fgInventoryMap[li.product_id] ?? 0;
        return totalFg < totalDemanded;
      });

      renderShipments.forEach((s, idx) => {
        // Filter lines for this shipment. When there's only one shipment, also
        // pick up any lines whose shipment_id is still null (legacy / not-yet-backfilled).
        const linesForShipment = allLines.filter((l) => {
          if (renderShipments.length === 1) return l.shipment_id === s.id || l.shipment_id === null;
          return l.shipment_id === s.id;
        });

        const lineItems: LineItem[] = linesForShipment.map((li) => ({
          id: li.id,
          product_name: li.product?.product_name ?? 'Unknown',
          quantity_units: li.quantity_units,
          bag_size_g: li.product?.bag_size_g ?? 0,
          packaging_variant: li.product?.packaging_variant ?? null,
          product_id: li.product_id,
          roast_group: li.product?.roast_group ?? null,
          shipment_id: li.shipment_id,
        }));

        const skuCount = lineItems.length;
        const totalUnits = lineItems.reduce((sum, li) => sum + li.quantity_units, 0);

        let missingSkuCount = 0;
        let missingUnitsTotal = 0;
        for (const li of lineItems) {
          const fgAvailable = fgInventoryMap[li.product_id] ?? 0;
          if (fgAvailable < li.quantity_units) {
            missingSkuCount++;
            missingUnitsTotal += Math.max(0, li.quantity_units - fgAvailable);
          }
        }
        const allLineItemsPacked = lineItems.length > 0 && missingSkuCount === 0;

        // Build ship-to label
        let shipToLabel: string;
        if (s.location?.location_code || s.location?.name) {
          shipToLabel = [s.location.location_code, s.location.name].filter(Boolean).join(' · ');
        } else if (s.ship_to_name || s.ship_to_city) {
          shipToLabel = [s.ship_to_name, s.ship_to_city].filter(Boolean).join(', ');
        } else {
          shipToLabel = `Shipment ${s.shipment_number}`;
        }

        cards.push({
          cardId: `${order.id}:${s.id}`,
          order_id: order.id,
          shipment_id: s.id,
          shipment_number: s.shipment_number,
          shipmentCountForOrder: renderShipments.length,
          isFirstShipmentInOrder: idx === 0,
          shipToLabel,
          order_number: order.order_number,
          client_name: clientName,
          requested_ship_date: order.requested_ship_date,
          work_deadline: order.work_deadline_at ?? null,
          delivery_method: s.delivery_method ?? order.delivery_method,
          client_notes: order.client_notes,
          internal_ops_notes: order.internal_ops_notes,
          roasted: order.roasted,
          packed: order.packed,
          invoiced: order.invoiced,
          lineItems,
          allLineItemsPacked,
          orderAllPicked: fullyPickedOrderIds.has(order.id),
          priority: orderPriority,
          hasContention,
          skuCount,
          totalUnits,
          missingSkuCount,
          missingUnitsTotal,
          ship_display_order: order.ship_display_order ?? null,
          manually_deprioritized: order.manually_deprioritized ?? false,
        });
      });
    }

    // Sort by parent order's display order, then shipment_number so an order's
    // shipments stay adjacent.
    return cards.sort((a, b) => {
      const orderA = a.ship_display_order ?? 999999;
      const orderB = b.ship_display_order ?? 999999;
      if (orderA !== orderB) return orderA - orderB;
      const oncmp = a.order_number.localeCompare(b.order_number);
      if (oncmp !== 0) return oncmp;
      return a.shipment_number - b.shipment_number;
    });
  }, [ordersForShipping, checkmarks, fgInventoryMap, demandByProduct, fullyPickedOrderIds]);

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

  // Handle drag end. Reorder is by parent order — multiple shipments of the
  // same order move together since they share ship_display_order and sort by
  // shipment_number afterward.
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localOrders.findIndex((o) => o.cardId === active.id);
    const newIndex = localOrders.findIndex((o) => o.cardId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    hasUserReorderedRef.current = true;

    const reordered = arrayMove(localOrders, oldIndex, newIndex);
    setLocalOrders(reordered);

    // Assign display order per unique parent order based on first occurrence
    const seen = new Set<string>();
    let rank = 0;
    reordered.forEach((card) => {
      if (seen.has(card.order_id)) return;
      seen.add(card.order_id);
      rank += 1;
      updateDisplayOrderMutation.mutate({ orderId: card.order_id, newOrder: rank * 10 });
    });
  }, [localOrders, updateDisplayOrderMutation]);

  const toggleOrderPriority = (order: ShippableShipment) => {
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
    mutationFn: async (order: ShippableShipment) => {
      const currentDate = order.work_deadline ? parseISO(order.work_deadline) : new Date();
      const newDate = format(addDays(currentDate, 1), 'yyyy-MM-dd');
      
      const { error } = await supabase
        .from('orders')
        .update({
          work_deadline: newDate,
          manually_deprioritized: true,
        })
        .eq('id', order.order_id);
      
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
    mutationFn: async (order: ShippableShipment) => {
      const { error } = await supabase
        .from('orders')
        .update({
          work_deadline: todayPlusOne,
          manually_deprioritized: false,
        })
        .eq('id', order.order_id);
      
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

  const handleDoThisLater = useCallback((order: ShippableShipment) => {
    doThisLaterMutation.mutate(order);
  }, [doThisLaterMutation]);

  const handleDoThisToday = useCallback((order: ShippableShipment) => {
    doThisTodayMutation.mutate(order);
  }, [doThisTodayMutation]);

  // Mark shipped (whole-order transition; only fired from one shipment's card).
  const handleMarkOrderShipped = useCallback((order: ShippableShipment) => {
    markOrderShippedMutation.mutate(order.order_id);
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
                items={displayOrders.map((o) => o.cardId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                {displayOrders.map((order) => (
                    <SortableShipCard
                      key={order.cardId}
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
