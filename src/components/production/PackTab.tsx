import React, { useState, useMemo, useCallback, useRef } from 'react';
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Package, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type PackagingVariant } from '@/components/PackagingBadge';
import { SortablePackRow } from './SortablePackRow';

// Removed SortOption type - no more auto-sorting, order is manual via pack_display_order

interface PackTabProps {
  dateFilter: string[];
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
  isReadyToPack: boolean;
  earliestShipDate: string | null;
  shortage: number;
  unblocksOrders: number;
  pack_display_order: number | null;
}

export function PackTab({ dateFilter, today }: PackTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Removed sortBy state - order is now manual only via pack_display_order
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  
  // Sort-freeze state: track which product is being edited
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [frozenOrder, setFrozenOrder] = useState<ProductDemand[] | null>(null);
  const lastEditTimeRef = useRef<number>(0);
  
  // Auto-prioritize confirmation dialog
  const [showAutoPrioritizeConfirm, setShowAutoPrioritizeConfirm] = useState(false);

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
  });

  // Fetch order line items for demand with ship_priority from production_checkmarks
  const { data: orderLineItems } = useQuery({
    queryKey: ['pack-demand', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order_id,
          order:orders!inner(id, status, requested_ship_date),
          product:products(id, product_name, sku, bag_size_g, packaging_variant, roast_group)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .in('order.requested_ship_date', dateFilter);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch production checkmarks for TIME_SENSITIVE priority
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

  // Fetch roasted batches for inventory display (all ROASTED batches in date window)
  const { data: roastedBatches } = useQuery({
    queryKey: ['roasted-batches-for-pack', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('*')
        .eq('status', 'ROASTED')
        .in('target_date', dateFilter);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch packing runs for the date window
  const { data: packingRuns } = useQuery({
    queryKey: ['packing-runs', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packing_runs')
        .select('*')
        .in('target_date', dateFilter);
      if (error) throw error;
      return (data ?? []) as PackingRun[];
    },
  });

  // Map products to roast_group for consumption calculation
  const productRoastGroupMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of products ?? []) {
      if (p.roast_group) {
        map[p.id] = p.roast_group;
      }
    }
    return map;
  }, [products]);

  // Calculate roasted inventory by roast_group:
  // sum(roasted_batches.actual_output_kg) - sum(packing_runs.kg_consumed)
  const roastedInventory = useMemo(() => {
    // Sum roasted output
    const roastedOutput: Record<string, number> = {};
    for (const b of roastedBatches ?? []) {
      roastedOutput[b.roast_group] = (roastedOutput[b.roast_group] ?? 0) + b.actual_output_kg;
    }

    // Sum kg consumed from packing runs by roast_group
    const consumed: Record<string, number> = {};
    for (const pr of packingRuns ?? []) {
      const roastGroup = productRoastGroupMap[pr.product_id];
      if (roastGroup) {
        consumed[roastGroup] = (consumed[roastGroup] ?? 0) + pr.kg_consumed;
      }
    }

    // Net inventory = roasted - consumed
    const inventory: Record<string, number> = {};
    const allGroups = new Set([...Object.keys(roastedOutput), ...Object.keys(consumed)]);
    for (const group of allGroups) {
      inventory[group] = (roastedOutput[group] ?? 0) - (consumed[group] ?? 0);
    }
    return inventory;
  }, [roastedBatches, packingRuns, productRoastGroupMap]);

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
          isReadyToPack: false,
        };
      }
      productMap[li.product_id].demanded_units += li.quantity_units;
      productMap[li.product_id].demanded_kg += (li.quantity_units * li.product.bag_size_g) / 1000;
      productMap[li.product_id].orderIds.add(li.order_id);
      
      // Track ship dates
      const shipDate = li.order?.requested_ship_date;
      if (shipDate) {
        productMap[li.product_id].shipDates.push(shipDate);
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
      
      // Calculate WIP readiness
      const remainingUnits = Math.max(0, product.demanded_units - packed);
      const requiredKg = (remainingUnits * product.bag_size_g) / 1000;
      const wipAvailableKg = product.roast_group ? (roastedInventory[product.roast_group] ?? 0) : 0;
      
      product.wipAvailableKg = wipAvailableKg;
      product.requiredKg = requiredKg;
      product.isReadyToPack = wipAvailableKg >= requiredKg && remainingUnits > 0;
    }

    return Object.values(productMap).map(({ orderIds, shipDates, ...rest }) => rest);
  }, [orderLineItems, checkmarks, packingByProductUnits, roastedInventory]);

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

  // Handle editing state changes from InlinePackingControl
  const handleEditingChange = useCallback((productId: string, isEditing: boolean) => {
    if (isEditing) {
      // Freeze the current order when editing starts
      if (!editingProductId) {
        setFrozenOrder(computedSortedProducts);
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
  }, [editingProductId, computedSortedProducts]);

  // Use frozen order while editing, otherwise use computed sorted products
  const sortedProducts = useMemo(() => {
    if (editingProductId && frozenOrder) {
      // Return frozen order but with updated data (keep order, update values)
      return frozenOrder.map(frozen => {
        const updated = demandByProduct.find(p => p.product_id === frozen.product_id);
        return updated ?? frozen;
      }).filter(p => demandByProduct.some(d => d.product_id === p.product_id));
    }
    return computedSortedProducts;
  }, [editingProductId, frozenOrder, computedSortedProducts, demandByProduct]);


  // Map packing runs by product_id
  const packingByProduct = useMemo(() => {
    const map: Record<string, PackingRun> = {};
    for (const pr of packingRuns ?? []) {
      map[pr.product_id] = pr;
    }
    return map;
  }, [packingRuns]);

  // Inline update for packing - returns a promise for the InlinePackingControl
  const updatePackingUnits = useCallback(async (productId: string, newUnits: number) => {
    const existing = packingByProduct[productId];
    const kgConsumed = existing?.kg_consumed ?? 0;
    
    const { error } = await supabase
      .from('packing_runs')
      .upsert({
        product_id: productId,
        target_date: today,
        units_packed: newUnits,
        kg_consumed: kgConsumed,
        updated_by: user?.id,
      }, {
        onConflict: 'product_id,target_date',
      });
    
    if (error) {
      toast.error('Failed to save packing progress');
      throw error;
    }
    
    // Silently invalidate - no success toast for inline edits
    queryClient.invalidateQueries({ queryKey: ['packing-runs'] });
  }, [packingByProduct, today, user?.id, queryClient]);

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

  // Handle drag end for reordering
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;
    
    const oldIndex = sortedProducts.findIndex(p => p.product_id === active.id);
    const newIndex = sortedProducts.findIndex(p => p.product_id === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;
    
    // Reorder and persist
    const reordered = [...sortedProducts];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    
    // Update all items with new display_order
    reordered.forEach((product, index) => {
      updateDisplayOrderMutation.mutate({ productId: product.product_id, newOrder: (index + 1) * 10 });
    });
  }, [sortedProducts, updateDisplayOrderMutation]);

  return (
    <div className="space-y-4">
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
                Drag rows to reorder. Green highlight = WIP available.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/inventory?tab=wip">
                  <Layers className="h-4 w-4 mr-1" />
                  Open Roasted Inventory Ledger
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sortedProducts.length === 0 ? (
            <p className="text-muted-foreground py-4">No products demanded for selected dates.</p>
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
                      const hasWipAvailable = product.isReadyToPack;
                      
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
                          hasWipAvailable={hasWipAvailable}
                          unblocksOrders={product.unblocksOrders}
                          wipAvailableKg={product.wipAvailableKg}
                          requiredKg={product.requiredKg}
                          packingRun={packing}
                          isExpanded={isExpanded}
                          onToggleExpand={() => setExpandedProductId(isExpanded ? null : product.product_id)}
                          onUpdatePackedUnits={(newValue) => updatePackingUnits(product.product_id, newValue)}
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
