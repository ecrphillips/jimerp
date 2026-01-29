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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Package, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type PackagingVariant } from '@/components/PackagingBadge';
import { SortablePackRow } from './SortablePackRow';
import type { DateFilterConfig } from './types';
// Use AUTHORITATIVE inventory hooks - computed from source-of-truth tables
import { useAuthoritativeWip } from '@/hooks/useAuthoritativeInventory';
import { AuthoritativeSummaryPanel } from './AuthoritativeTotals';
import { filterOrderByWorkStart } from '@/lib/productionScheduling';

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
  
  // Local order state for optimistic DnD updates
  const [localProducts, setLocalProducts] = useState<ProductDemand[]>([]);
  const hasUserReorderedRef = useRef(false);
  
  // Sort-freeze state: track which product is being edited
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [frozenOrder, setFrozenOrder] = useState<ProductDemand[] | null>(null);
  const lastEditTimeRef = useRef<number>(0);

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

    // Calculate shortage, earliest ship date, unblocks orders, and WIP readiness
    for (const product of Object.values(productMap)) {
      const packed = packingByProductUnits[product.product_id] ?? 0;
      product.shortage = Math.max(0, product.demanded_units - packed);
      
      // Get earliest ship date
      if (product.shipDates.length > 0) {
        product.earliestShipDate = product.shipDates.sort()[0];
      }
      
      // Calculate how many orders this SKU unblocks if packed
      let unblocksCount = 0;
      for (const li of orderLineItems ?? []) {
        if (li.product_id !== product.product_id) continue;
        const packedForProduct = packingByProductUnits[product.product_id] ?? 0;
        if (packedForProduct < li.quantity_units) {
          unblocksCount++;
        }
      }
      product.unblocksOrders = unblocksCount;
      
      // Calculate WIP readiness - based purely on ledger WIP availability
      // WIP is available if there's positive roasted coffee on hand for this roast group
      const wipAvailableKg = product.roast_group ? (roastedInventory[product.roast_group] ?? 0) : 0;
      const remainingUnits = Math.max(0, product.demanded_units - packed);
      const requiredKg = (remainingUnits * product.bag_size_g) / 1000;
      
      product.wipAvailableKg = wipAvailableKg;
      product.requiredKg = requiredKg;
      
      // NEW: WIP status for color coding
      // - 'full': enough WIP to complete entire row (wipAvailable >= requiredKg)
      // - 'partial': some WIP available but not enough (0 < wipAvailable < requiredKg)
      // - 'none': no WIP available or no remaining demand
      if (remainingUnits === 0) {
        product.wipStatus = 'none'; // No remaining work = no color needed
      } else if (wipAvailableKg >= requiredKg) {
        product.wipStatus = 'full'; // GREEN: can complete entire row
      } else if (wipAvailableKg > 0) {
        product.wipStatus = 'partial'; // AMBER: some but not enough
      } else {
        product.wipStatus = 'none'; // NO COLOR: no WIP at all
      }
    }

    return Object.values(productMap).map(({ orderIds, shipDates, ...rest }) => rest);
  }, [orderLineItems, checkmarks, packingByProductUnits, roastedInventory, products]);

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
    const delta = newUnits - previousUnits;
    
    // No change, skip
    if (delta === 0) return;
    
    // Calculate kg consumed/returned for the delta
    const kgDelta = bagSizeG > 0 ? (delta * bagSizeG) / 1000 : 0;
    
    console.log('[PackTab] updatePackingUnits:', { 
      productId, newUnits, previousUnits, delta, bagSizeG, kgDelta, roastGroup, target_date: today 
    });
    
    // Update packing_runs for legacy compatibility and tracking
    const { error: packingError } = await supabase
      .from('packing_runs')
      .upsert({
        product_id: productId,
        target_date: today,
        units_packed: newUnits,
        kg_consumed: bagSizeG > 0 ? (newUnits * bagSizeG) / 1000 : 0,
        updated_by: user?.id,
      }, {
        onConflict: 'product_id,target_date',
      });
    
    if (packingError) {
      toast.error('Failed to save packing progress');
      throw packingError;
    }
    
    // Write ledger transactions for the delta
    // For positive delta: consume WIP, produce FG
    // For negative delta (reversal): return WIP, reduce FG
    const transactions = [];
    
    // PACK_CONSUME_WIP: negative kg (consuming) or positive kg (returning)
    if (roastGroup && kgDelta !== 0) {
      transactions.push({
        transaction_type: 'PACK_CONSUME_WIP' as const,
        roast_group: roastGroup,
        product_id: productId,
        quantity_kg: -kgDelta, // negative for consumption, positive for return
        quantity_units: null,
        notes: delta > 0 
          ? `Packed ${delta} units of ${bagSizeG}g` 
          : `Reversed ${Math.abs(delta)} units of ${bagSizeG}g`,
        is_system_generated: true,
        created_by: user?.id,
      });
    }
    
    // PACK_PRODUCE_FG: positive units (producing) or negative units (reversing)
    if (delta !== 0) {
      transactions.push({
        transaction_type: 'PACK_PRODUCE_FG' as const,
        roast_group: roastGroup,
        product_id: productId,
        quantity_kg: null,
        quantity_units: delta, // positive for production, negative for reversal
        notes: delta > 0 
          ? `Packed ${delta} units` 
          : `Reversed ${Math.abs(delta)} units`,
        is_system_generated: true,
        created_by: user?.id,
      });
    }
    
    if (transactions.length > 0) {
      const { error: ledgerError } = await supabase
        .from('inventory_transactions')
        .insert(transactions);
      
      if (ledgerError) {
        console.error('[PackTab] Ledger write failed:', ledgerError);
        toast.error('Failed to update inventory ledger');
        throw ledgerError;
      }
    }
    
    // Invalidate queries to refresh UI
    queryClient.invalidateQueries({ queryKey: ['packing-runs'] });
    queryClient.invalidateQueries({ queryKey: ['authoritative-packing-runs'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-ledger-wip'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-ledger-fg'] });
  }, [today, user?.id, queryClient]);

  // Mutation to update pack_display_order
  const updateDisplayOrderMutation = useMutation({
    mutationFn: async ({ productId, newOrder }: { productId: string; newOrder: number }) => {
      const { error } = await supabase
        .from('products')
        .update({ pack_display_order: newOrder })
        .eq('id', productId);
      if (error) throw error;
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update order');
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
    
    const oldIndex = sortedProducts.findIndex(p => p.product_id === active.id);
    const newIndex = sortedProducts.findIndex(p => p.product_id === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;
    
    // Mark that user has reordered to prevent server sync from overriding
    hasUserReorderedRef.current = true;
    
    // Optimistically update local state immediately
    const reordered = arrayMove(sortedProducts, oldIndex, newIndex);
    setLocalProducts(reordered);
    
    // Persist new order to DB
    reordered.forEach((product, index) => {
      updateDisplayOrderMutation.mutate({ productId: product.product_id, newOrder: (index + 1) * 10 });
    });
  }, [sortedProducts, updateDisplayOrderMutation]);

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
                Drag rows to reorder. Green = WIP covers full row. Amber = partial WIP.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/inventory?tab=wip&from=pack">
                  <Layers className="h-4 w-4 mr-1" />
                  Open Roasted Inventory Ledger
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sortedProducts.length === 0 ? (
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
                items={sortedProducts.map(p => p.product_id)}
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
                    {sortedProducts.map((product) => {
                      const packing = packingByProduct[product.product_id];
                      const packed = packing?.units_packed ?? 0;
                      const isExpanded = expandedProductId === product.product_id;
                      
                      return (
                        <SortablePackRow
                          key={product.product_id}
                          productId={product.product_id}
                          productName={product.product_name}
                          sku={product.sku}
                          bagSizeG={product.bag_size_g}
                          packagingVariant={product.packaging_variant}
                          roastGroup={product.roast_group}
                          demandedUnits={product.demanded_units}
                          packedUnits={packed}
                          hasTimeSensitive={product.hasTimeSensitive}
                          wipStatus={product.wipStatus}
                          unblocksOrders={product.unblocksOrders}
                          wipAvailableKg={product.wipAvailableKg}
                          requiredKg={product.requiredKg}
                          packingRun={packing}
                          isExpanded={isExpanded}
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
