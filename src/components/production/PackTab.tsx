import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Package, Layers, GripVertical, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type PackagingVariant } from '@/components/PackagingBadge';
import { SortablePackRow } from './SortablePackRow';
import type { DateFilterConfig } from './types';
// Use AUTHORITATIVE inventory hooks - computed from source-of-truth tables
import { useAuthoritativeWip, useAuthoritativePlannedWip } from '@/hooks/useAuthoritativeInventory';
import { AuthoritativeSummaryPanel } from './AuthoritativeTotals';
import { filterOrderByWorkStart } from '@/lib/productionScheduling';
import {
  orderPackGroups,
  rollUpGroupTier,
  type PackSortMode,
  type PackGroupMeta,
} from '@/lib/packGroupSort';

const UNASSIGNED = '__unassigned__';

const SORT_OPTIONS: { value: PackSortMode; label: string }[] = [
  { value: 'wip', label: 'WIP priority' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'alpha', label: 'A–Z' },
];

/** A draggable pill in the group-order bar (drag to reorder roast groups). */
function GroupOrderPill({ id, label, tier }: { id: string; label: string; tier: 'full' | 'partial' | 'none' }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const dot =
    tier === 'full' ? 'bg-green-500' : tier === 'partial' ? 'bg-amber-500' : 'bg-muted-foreground/40';
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs select-none cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-60 shadow' : ''
      }`}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground" />
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="font-medium">{label}</span>
    </div>
  );
}

// Removed SortOption type - no more auto-sorting, order is manual via pack_display_order

interface PackTabProps {
  dateFilterConfig: DateFilterConfig;
  today: string;
}

interface PackingRun {
  id: string;
  product_id: string;
  target_date: string;
  units_packed: number;
  kg_consumed: number;
  notes: string | null;
}

interface ProductDemand {
  product_id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  packaging_variant: PackagingVariant | null;
  roast_group: string | null;
  demanded_units: number;
  demanded_kg: number;
  hasTimeSensitive: boolean;
  wipAvailableKg: number;
  requiredKg: number;
  plannedKg: number;
  plannedCount: number;
  wipStatus: 'full' | 'partial' | 'none'; // NEW: WIP status for color coding
  earliestShipDate: string | null;
  shortage: number;
  unblocksOrders: number;
  pack_display_order: number | null;
}

export function PackTab({ dateFilterConfig, today }: PackTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Removed sortBy state - order is now manual only via pack_display_order
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  // Snapshot of product IDs that were already complete when this session/view started.
  // These rows render de-emphasized so the packer's eye lands on outstanding work.
  // Resets on remount (nav away + back, refresh, new session). The "Refresh complete"
  // button below lets the packer fold newly-completed rows in without leaving the tab.
  const [deemphasizedIds, setDeemphasizedIds] = useState<Set<string> | null>(null);
  
  // Local order state for optimistic DnD updates
  const [localProducts, setLocalProducts] = useState<ProductDemand[]>([]);
  const hasUserReorderedRef = useRef(false);
  
  // Sort-freeze state: track which product is being edited
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [frozenOrder, setFrozenOrder] = useState<ProductDemand[] | null>(null);
  const lastEditTimeRef = useRef<number>(0);

  // Roast-group ordering controls.
  // sortMode drives the default group order; a manual drag order (held in memory,
  // not persisted) overrides it until the group set changes or the user resets.
  const [sortMode, setSortMode] = useState<PackSortMode>('wip');
  const [manualGroupOrder, setManualGroupOrder] = useState<string[] | null>(null);

  // Roast-group config for display names + the Roast-tab sequence (display_order),
  // used as the tie-break for the "no WIP" tier so it mirrors the Roast tab.
  const { data: roastGroupsConfig } = useQuery({
    queryKey: ['pack-roast-groups-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name, display_order');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30000,
  });

  // Fetch products (only active) with pack_display_order
  const { data: products } = useQuery({
    queryKey: ['all-products-for-pack'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, packaging_variant, roast_group, pack_display_order')
        .eq('is_active', true)
        .order('pack_display_order', { ascending: true, nullsFirst: false })
        .order('product_name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30000, // 30 seconds to prevent refetches overriding user reorder
    refetchOnWindowFocus: false,
  });

  // Fetch ALL order line items for demand
  // Filtering by work_start_at happens client-side for accurate production window logic
  // IMPORTANT: Uses work_deadline_at (timestamptz), NOT work_deadline (legacy text field)
  const { data: allOrderLineItems } = useQuery({
    queryKey: ['pack-demand-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order_id,
          order:orders!inner(id, status, work_deadline_at, manually_deprioritized),
          product:products(id, product_name, sku, bag_size_g, packaging_variant, roast_group)
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

  // Fetch production checkmarks for TIME_SENSITIVE priority
  const { data: checkmarks } = useQuery({
    queryKey: ['production-checkmarks', dateFilterConfig],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checkmarks')
        .select('*');
      
      if (error) throw error;
      return data ?? [];
    },
  });

  // ========== AUTHORITATIVE INVENTORY (from source-of-truth tables) ==========
  // WIP = sum(roasted_batches.actual_output_kg) - sum(packing_runs.kg_consumed)
  const { data: authWip } = useAuthoritativeWip();
  const { data: plannedWip } = useAuthoritativePlannedWip();
  
  // Use authoritative WIP for roasted inventory display
  const roastedInventory = useMemo(() => {
    const result: Record<string, number> = {};
    for (const [rg, data] of Object.entries(authWip ?? {})) {
      result[rg] = data.wip_available_kg;
    }
    return result;
  }, [authWip]);

  // Fetch packing runs (still needed for units_packed tracking until ledger migration)
  const { data: packingRuns } = useQuery({
    queryKey: ['packing-runs', dateFilterConfig],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packing_runs')
        .select('*');
      
      if (error) throw error;
      return (data ?? []) as PackingRun[];
    },
  });

  // Map packing by product for unblocks calculation
  const packingByProductUnits = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pr of packingRuns ?? []) {
      map[pr.product_id] = (map[pr.product_id] ?? 0) + pr.units_packed;
    }
    return map;
  }, [packingRuns]);

  // Fetch ship_picks for OPEN orders, aggregated by product.
  // A pick is physical evidence that a bag was packed — the downstream station
  // can't pick a bag that wasn't produced. We treat each picked unit as an
  // *implicit* packed unit for shortage / completeness so a packer who's lagging
  // on data entry doesn't get nudged to over-pack what the shipper already grabbed.
  const { data: pickedByProductUnits } = useQuery<Record<string, number>>({
    queryKey: ['pack-tab-picks-by-product'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ship_picks')
        .select(`
          units_picked,
          order:orders!inner(status),
          order_line_item:order_line_items!inner(product_id)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as any[]) {
        const pid = row.order_line_item?.product_id;
        if (!pid) continue;
        map[pid] = (map[pid] ?? 0) + Number(row.units_picked ?? 0);
      }
      return map;
    },
  });

  // Aggregate demand by product with urgency info
  const demandByProduct = useMemo((): ProductDemand[] => {
    const productMap: Record<string, ProductDemand & { orderIds: Set<string>; shipDates: string[] }> = {};

    for (const li of orderLineItems ?? []) {
      if (!li.product) continue;
      
      if (!productMap[li.product_id]) {
        // Get pack_display_order from products query
        const productInfo = products?.find(p => p.id === li.product_id);
        productMap[li.product_id] = {
          product_id: li.product_id,
          product_name: li.product.product_name,
          sku: li.product.sku,
          bag_size_g: li.product.bag_size_g,
          packaging_variant: li.product.packaging_variant as PackagingVariant | null,
          roast_group: li.product.roast_group,
          demanded_units: 0,
          demanded_kg: 0,
          hasTimeSensitive: false,
          earliestShipDate: null,
          shortage: 0,
          unblocksOrders: 0,
          pack_display_order: productInfo?.pack_display_order ?? null,
          orderIds: new Set(),
          shipDates: [],
          wipAvailableKg: 0,
          requiredKg: 0,
          plannedKg: 0,
          plannedCount: 0,
          wipStatus: 'none' as const, // NEW: WIP status for color coding
        };
      }
      productMap[li.product_id].demanded_units += li.quantity_units;
      productMap[li.product_id].demanded_kg += (li.quantity_units * li.product.bag_size_g) / 1000;
      productMap[li.product_id].orderIds.add(li.order_id);
      
      // Track work_deadline_at for urgency calculation (timestamptz field)
      const workDeadlineAt = li.order?.work_deadline_at;
      if (workDeadlineAt) {
        productMap[li.product_id].shipDates.push(workDeadlineAt);
      }
      
      // Check for TIME_SENSITIVE from checkmarks
      const cm = checkmarks?.find(
        (c) => c.product_id === li.product_id && c.bag_size_g === li.product?.bag_size_g
      );
      if (cm?.ship_priority === 'TIME_SENSITIVE') {
        productMap[li.product_id].hasTimeSensitive = true;
      }
    }

    // Calculate shortage, earliest ship date, unblocks orders, and WIP readiness.
    // "Effective packed" treats downstream picks as implicit packs — a picked bag
    // physically exists, so the upstream demand is already satisfied even if the
    // packer hasn't clicked through yet. This prevents the Pack tab from
    // pressuring the user into over-packing a SKU the shipper has already grabbed.
    for (const product of Object.values(productMap)) {
      const packed = packingByProductUnits[product.product_id] ?? 0;
      const picked = pickedByProductUnits?.[product.product_id] ?? 0;
      const effectivePacked = Math.max(packed, picked);
      product.shortage = Math.max(0, product.demanded_units - effectivePacked);

      // Get earliest ship date
      if (product.shipDates.length > 0) {
        product.earliestShipDate = product.shipDates.sort()[0];
      }

      // Calculate how many orders this SKU unblocks if packed
      let unblocksCount = 0;
      for (const li of orderLineItems ?? []) {
        if (li.product_id !== product.product_id) continue;
        if (effectivePacked < li.quantity_units) {
          unblocksCount++;
        }
      }
      product.unblocksOrders = unblocksCount;

      // Calculate WIP readiness - based purely on ledger WIP availability
      const wipAvailableKg = product.roast_group ? (roastedInventory[product.roast_group] ?? 0) : 0;
      const remainingUnits = Math.max(0, product.demanded_units - effectivePacked);
      const requiredKg = (remainingUnits * product.bag_size_g) / 1000;

      product.wipAvailableKg = wipAvailableKg;
      product.requiredKg = requiredKg;

      // Planned-batch hint (informational, not counted in WIP)
      const plannedInfo = product.roast_group ? plannedWip?.[product.roast_group] : undefined;
      product.plannedKg = plannedInfo?.planned_kg ?? 0;
      product.plannedCount = plannedInfo?.count ?? 0;

      if (remainingUnits === 0) {
        product.wipStatus = 'none';
      } else if (wipAvailableKg >= requiredKg) {
        product.wipStatus = 'full';
      } else if (wipAvailableKg > 0) {
        product.wipStatus = 'partial';
      } else {
        product.wipStatus = 'none';
      }
    }

    return Object.values(productMap).map(({ orderIds, shipDates, ...rest }) => rest);
  }, [orderLineItems, checkmarks, packingByProductUnits, pickedByProductUnits, roastedInventory, products, plannedWip]);

  // Sort products by pack_display_order only (manual ordering)
  // NO automatic reprioritization - order is strictly user-controlled
  const computedSortedProducts = useMemo(() => {
    const sorted = [...demandByProduct];
    
    // Sort ONLY by pack_display_order (manual), then by name as tie-breaker
    sorted.sort((a, b) => {
      const orderA = a.pack_display_order ?? 999999;
      const orderB = b.pack_display_order ?? 999999;
      
      if (orderA !== orderB) return orderA - orderB;
      return a.product_name.localeCompare(b.product_name);
    });
    
    return sorted;
  }, [demandByProduct]);

  // Sync local state from server data, but only when not actively reordering
  useEffect(() => {
    if (!hasUserReorderedRef.current && computedSortedProducts.length > 0) {
      setLocalProducts(computedSortedProducts);
    }
  }, [computedSortedProducts]);

  // Reset the reorder flag after a delay to allow server sync
  useEffect(() => {
    if (hasUserReorderedRef.current) {
      const timeout = setTimeout(() => {
        hasUserReorderedRef.current = false;
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [localProducts]);

  // Handle editing state changes from InlinePackingControl
  const handleEditingChange = useCallback((productId: string, isEditing: boolean) => {
    if (isEditing) {
      // Freeze the current order when editing starts
      if (!editingProductId) {
        setFrozenOrder(localProducts);
      }
      setEditingProductId(productId);
      lastEditTimeRef.current = Date.now();
    } else {
      // Only unfreeze if this is the product that was being edited
      if (editingProductId === productId) {
        setEditingProductId(null);
        setFrozenOrder(null);
      }
    }
  }, [editingProductId, localProducts]);

  // Use frozen order while editing, otherwise use local products
  const sortedProducts = useMemo(() => {
    if (editingProductId && frozenOrder) {
      // Return frozen order but with updated data (keep order, update values)
      return frozenOrder.map(frozen => {
        const updated = demandByProduct.find(p => p.product_id === frozen.product_id);
        return updated ?? frozen;
      }).filter(p => demandByProduct.some(d => d.product_id === p.product_id));
    }
    return localProducts.length > 0 ? localProducts : computedSortedProducts;
  }, [editingProductId, frozenOrder, localProducts, computedSortedProducts, demandByProduct]);

  // ===== Roast-group ordering (WIP-priority default, sort control, manual drag) =====

  const groupKeyOf = useCallback(
    (rg: string | null) => rg ?? UNASSIGNED,
    [],
  );

  // Build one PackGroupMeta per roast group currently present, rolling product
  // readiness up to a group tier and pulling display name + roast-tab index.
  const groupMetas = useMemo((): PackGroupMeta[] => {
    const configByKey = new Map(
      (roastGroupsConfig ?? []).map((c) => [c.roast_group, c]),
    );
    const byGroup = new Map<string, ProductDemand[]>();
    for (const p of sortedProducts) {
      const key = groupKeyOf(p.roast_group);
      const arr = byGroup.get(key) ?? [];
      arr.push(p);
      byGroup.set(key, arr);
    }

    const metas: PackGroupMeta[] = [];
    for (const [key, prods] of byGroup) {
      const cfg = key === UNASSIGNED ? undefined : configByKey.get(key);
      const tier = rollUpGroupTier(
        prods.map((p) => ({ wipStatus: p.wipStatus, remainingUnits: p.shortage })),
      );
      const shipDates = prods
        .map((p) => p.earliestShipDate)
        .filter((d): d is string => !!d)
        .sort();
      metas.push({
        roastGroup: key,
        displayName: cfg?.display_name?.trim() || (key === UNASSIGNED ? 'Unassigned' : key.replace(/_/g, ' ')),
        tier,
        roastTabIndex: cfg?.display_order ?? 999999,
        earliestShipDate: shipDates[0] ?? null,
      });
    }
    return metas;
  }, [sortedProducts, roastGroupsConfig, groupKeyOf]);

  // The active group order (manual drag wins, else the sort-control order).
  //
  // Frozen during a session so completing a group's last row does NOT bounce it to
  // the bottom live (WIP-priority stays the rule). The order is only recomputed when
  // the user explicitly changes sort mode / drags, when the SET of groups changes
  // (add/remove), or on remount (nav away + back / refresh) — at which point WIP sort
  // naturally sinks fully-packed groups (tier 'none') to the bottom.
  const groupKeySig = useMemo(
    () => groupMetas.map((m) => m.roastGroup).sort().join('|'),
    [groupMetas],
  );
  const [frozenGroupOrder, setFrozenGroupOrder] = useState<string[] | null>(null);
  useEffect(() => {
    setFrozenGroupOrder(orderPackGroups(groupMetas, sortMode, manualGroupOrder));
    // groupMetas intentionally omitted: live tier/completion changes must NOT re-sort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode, manualGroupOrder, groupKeySig]);

  const groupOrder = useMemo(
    () => frozenGroupOrder ?? orderPackGroups(groupMetas, sortMode, manualGroupOrder),
    [frozenGroupOrder, groupMetas, sortMode, manualGroupOrder],
  );

  const metaByKey = useMemo(
    () => new Map(groupMetas.map((m) => [m.roastGroup, m])),
    [groupMetas],
  );

  // Flatten products into the chosen group order; within a group, keep the existing
  // row order (pack_display_order / manual row drag). This drives both render + row DnD.
  const displayProducts = useMemo(() => {
    const byGroup = new Map<string, ProductDemand[]>();
    for (const p of sortedProducts) {
      const key = groupKeyOf(p.roast_group);
      const arr = byGroup.get(key) ?? [];
      arr.push(p);
      byGroup.set(key, arr);
    }
    const out: ProductDemand[] = [];
    for (const key of groupOrder) {
      out.push(...(byGroup.get(key) ?? []));
    }
    return out;
  }, [sortedProducts, groupOrder, groupKeyOf]);

  // Compute which products are currently complete (effective packed >= demanded).
  // Mirrors the SortablePackRow logic so the two never disagree.
  const completeProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of displayProducts) {
      const packed = packingByProductUnits[p.product_id] ?? 0;
      const picked = pickedByProductUnits?.[p.product_id] ?? 0;
      const effective = Math.max(packed, picked);
      if (p.demanded_units > 0 && effective >= p.demanded_units) {
        ids.add(p.product_id);
      }
    }
    return ids;
  }, [displayProducts, packingByProductUnits, pickedByProductUnits]);

  // First time we get a populated list, snapshot what was already complete.
  useEffect(() => {
    if (deemphasizedIds === null && displayProducts.length > 0) {
      setDeemphasizedIds(new Set(completeProductIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayProducts.length]);

  // Manual refresh: fold all currently-complete rows into the de-emphasized set
  // and collapse the drawer if it just got de-emphasized.
  const handleRefreshComplete = useCallback(() => {
    setDeemphasizedIds(new Set(completeProductIds));
    if (expandedProductId && completeProductIds.has(expandedProductId)) {
      setExpandedProductId(null);
    }
  }, [completeProductIds, expandedProductId]);

  // Drag-reorder of the group-order bar.
  const handleGroupDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groupOrder.indexOf(String(active.id));
    const newIndex = groupOrder.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    setManualGroupOrder(arrayMove(groupOrder, oldIndex, newIndex));
  }, [groupOrder]);


  // Map packing runs by product_id
  const packingByProduct = useMemo(() => {
    const map: Record<string, PackingRun> = {};
    for (const pr of packingRuns ?? []) {
      map[pr.product_id] = pr;
    }
    return map;
  }, [packingRuns]);

  // Inline update for packing - writes ledger transactions for WIP consumption and FG production
  // Now uses inventory_transactions ledger as source of truth
  const updatePackingUnits = useCallback(async (
    productId: string,
    newUnits: number,
    bagSizeG: number,
    roastGroup: string | null,
    previousUnits: number
  ) => {
    // Cheap client-side no-op skip; the RPC recomputes the real delta against
    // the DB row under lock, so a stale previousUnits here can't lose updates.
    if (newUnits === previousUnits) return;

    // Atomic RPC: upserts packing_runs and writes the PACK_CONSUME_WIP /
    // PACK_PRODUCE_FG ledger rows in one transaction, with the real delta
    // recomputed against the DB row under lock.
    //
    // No upstream-material gating: a user packing a bag the system thinks doesn't
    // exist is treated as an upstream data-entry lag, not a physical shortage. The
    // "0 available" / amber WIP color cues are nudge enough; never block completion.
    const { error } = await supabase.rpc('update_packing_units', {
      p_product_id: productId,
      p_target_date: today,
      p_new_units: newUnits,
      p_bag_size_g: bagSizeG,
      p_roast_group: roastGroup,
    });

    if (error) {
      console.error('[PackTab] updatePackingUnits failed:', error);
      toast.error(error.message || 'Failed to save packing progress');
      throw error;
    }

    // Invalidate queries to refresh UI
    queryClient.invalidateQueries({ queryKey: ['packing-runs'] });
    queryClient.invalidateQueries({ queryKey: ['authoritative-packing-runs'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-ledger-wip'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-ledger-fg'] });
    queryClient.invalidateQueries({ queryKey: ['authoritative-wip-ledger'] });
  }, [today, queryClient]);

  // Mutation to update pack_display_order for a whole reordered list at once.
  // A single mutation (vs one per product) means one error path; on any
  // failure we refetch so the UI resyncs instead of persisting a partial order.
  const updateDisplayOrderMutation = useMutation({
    mutationFn: async (rows: Array<{ productId: string; newOrder: number }>) => {
      const results = await Promise.allSettled(
        rows.map(({ productId, newOrder }) =>
          supabase
            .from('products')
            .update({ pack_display_order: newOrder })
            .eq('id', productId)
            .then(({ error }) => {
              if (error) throw error;
            })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) throw new Error(`${failed} of ${rows.length} reorder updates failed`);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save new order — resyncing');
      hasUserReorderedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ['all-products-for-pack'] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-products-for-pack'] });
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

    const oldIndex = displayProducts.findIndex(p => p.product_id === active.id);
    const newIndex = displayProducts.findIndex(p => p.product_id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Mark that user has reordered to prevent server sync from overriding
    hasUserReorderedRef.current = true;

    // Optimistically update local state immediately
    const reordered = arrayMove(displayProducts, oldIndex, newIndex);
    setLocalProducts(reordered);

    // Persist new order to DB in one mutation
    updateDisplayOrderMutation.mutate(
      reordered.map((product, index) => ({ productId: product.product_id, newOrder: (index + 1) * 10 }))
    );
  }, [displayProducts, updateDisplayOrderMutation]);

  return (
    <div className="space-y-4">
      {/* Authoritative Totals Summary */}
      <AuthoritativeSummaryPanel tab="pack" />
      
      {/* Packing Progress */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Pack SKUs
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Drag rows to reorder within a group. Green = WIP covers full row. Amber = partial WIP.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Sort control — overrides the default WIP-priority group order */}
              <div className="flex items-center rounded-md border p-0.5">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setSortMode(opt.value); setManualGroupOrder(null); }}
                    className={`px-2 py-1 text-xs rounded ${
                      sortMode === opt.value && !manualGroupOrder
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshComplete}
                title="Fold completed rows into the de-emphasized state without reloading"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Refresh complete
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/inventory?tab=wip&from=pack">
                  <Layers className="h-4 w-4 mr-1" />
                  Open Roasted Inventory Ledger
                </Link>
              </Button>
            </div>
          </div>

          {/* Group-order bar: drag pills to reorder roast groups themselves */}
          {groupOrder.length > 1 && (
            <div className="mt-3 rounded-md border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Group order {manualGroupOrder ? '(manual)' : `(${SORT_OPTIONS.find(o => o.value === sortMode)?.label})`} — drag to reorder
                </span>
                {manualGroupOrder && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setManualGroupOrder(null)}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                  </Button>
                )}
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
                <SortableContext items={groupOrder} strategy={horizontalListSortingStrategy}>
                  <div className="flex flex-wrap gap-1.5">
                    {groupOrder.map((key) => {
                      const meta = metaByKey.get(key);
                      return (
                        <GroupOrderPill
                          key={key}
                          id={key}
                          label={meta?.displayName ?? key}
                          tier={meta?.tier ?? 'none'}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {displayProducts.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-4xl mb-3">📦</div>
              <p className="text-lg font-medium text-foreground mb-1">No packing demand right now</p>
              <p className="text-muted-foreground text-sm">
                {dateFilterConfig.mode === 'today' 
                  ? "Check 'Tomorrow' or 'All' for future orders, or enjoy being caught up!"
                  : dateFilterConfig.mode === 'tomorrow'
                    ? "Check 'All' for future orders, or enjoy being caught up!"
                    : "No packing demand across all dates — enjoy being caught up!"}
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displayProducts.map(p => p.product_id)}
                strategy={verticalListSortingStrategy}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 w-10"></th>
                      <th className="pb-2 w-8"></th>
                      <th className="pb-2">Product</th>
                      <th className="pb-2">Roast Group</th>
                      <th className="pb-2 text-right">Demanded</th>
                      <th className="pb-2 text-right">Packed</th>
                      <th className="pb-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayProducts.map((product, index) => {
                      const packing = packingByProduct[product.product_id];
                      const packed = packing?.units_packed ?? 0;
                      const picked = pickedByProductUnits?.[product.product_id] ?? 0;
                      const isExpanded = expandedProductId === product.product_id;
                      const prevRoastGroup = index > 0 ? displayProducts[index - 1].roast_group : undefined;
                      const showHeader = product.roast_group !== prevRoastGroup;
                      const headerLabel = product.roast_group
                        ? product.roast_group.replace(/_/g, ' ')
                        : 'Unassigned';
                      const headerWipKg = product.roast_group
                        ? (roastedInventory[product.roast_group] ?? 0)
                        : 0;
                      const headerPlanned = product.roast_group
                        ? plannedWip?.[product.roast_group]
                        : undefined;
                      
                      return (
                        <React.Fragment key={product.product_id}>
                          {showHeader && (
                            <tr
                              aria-hidden="true"
                              className={`bg-muted/60 border-b border-t ${index > 0 ? '[&>td]:pt-4' : ''}`}
                            >
                              <td colSpan={7} className="py-2 px-3">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-sm font-bold text-foreground uppercase tracking-wide">
                                    {headerLabel}
                                  </span>
                                  {product.roast_group && (
                                    <span className="text-xs font-medium text-muted-foreground">
                                      {headerWipKg.toFixed(1)} kg WIP available
                                      {headerPlanned && headerPlanned.count > 0 && (
                                        <>
                                          {' · '}
                                          {headerPlanned.count} planned (~{headerPlanned.planned_kg.toFixed(1)} kg)
                                        </>
                                      )}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        <SortablePackRow
                          productId={product.product_id}
                          productName={product.product_name}
                          sku={product.sku}
                          bagSizeG={product.bag_size_g}
                          packagingVariant={product.packaging_variant}
                          roastGroup={product.roast_group}
                          demandedUnits={product.demanded_units}
                          packedUnits={packed}
                          pickedUnits={picked}
                          hasTimeSensitive={product.hasTimeSensitive}
                          wipStatus={product.wipStatus}
                          unblocksOrders={product.unblocksOrders}
                          wipAvailableKg={product.wipAvailableKg}
                          requiredKg={product.requiredKg}
                          plannedKg={product.plannedKg}
                          plannedCount={product.plannedCount}
                          packingRun={packing}
                          isExpanded={isExpanded && !(deemphasizedIds?.has(product.product_id) ?? false)}
                          deemphasized={deemphasizedIds?.has(product.product_id) ?? false}
                          onToggleExpand={() => setExpandedProductId(isExpanded ? null : product.product_id)}
                          onUpdatePackedUnits={(newValue) => updatePackingUnits(
                            product.product_id, 
                            newValue, 
                            product.bag_size_g,
                            product.roast_group,
                            packed
                          )}
                          onEditingChange={(isEditing) => handleEditingChange(product.product_id, isEditing)}
                        />
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
