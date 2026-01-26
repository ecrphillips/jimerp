import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Package, Check, AlertTriangle, Clock, ShoppingCart, ChevronDown, ChevronRight, ChevronUp, Sparkles } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { InlinePackingControl } from './InlinePackingControl';
import { PackRowDrawer } from './PackRowDrawer';

type SortOption = 'urgent' | 'shortage' | 'alpha';

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
  earliestShipDate: string | null;
  shortage: number;
  unblocksOrders: number;
  pack_display_order: number | null;
}

export function PackTab({ dateFilter, today }: PackTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [sortBy, setSortBy] = useState<SortOption>('urgent');
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

    // Calculate shortage, earliest ship date, and unblocks orders
    for (const product of Object.values(productMap)) {
      const packed = packingByProductUnits[product.product_id] ?? 0;
      product.shortage = Math.max(0, product.demanded_units - packed);
      
      // Get earliest ship date
      if (product.shipDates.length > 0) {
        product.earliestShipDate = product.shipDates.sort()[0];
      }
      
      // Calculate how many orders this SKU unblocks if packed
      // An order is "blocked" if this SKU is short AND the order's quantity > packed
      let unblocksCount = 0;
      for (const li of orderLineItems ?? []) {
        if (li.product_id !== product.product_id) continue;
        const packedForProduct = packingByProductUnits[product.product_id] ?? 0;
        if (packedForProduct < li.quantity_units) {
          unblocksCount++;
        }
      }
      product.unblocksOrders = unblocksCount;
    }

    return Object.values(productMap).map(({ orderIds, shipDates, ...rest }) => rest);
  }, [orderLineItems, checkmarks, packingByProductUnits]);

  // Sort products based on selected sort option
  const computedSortedProducts = useMemo(() => {
    const sorted = [...demandByProduct];
    
    switch (sortBy) {
      case 'urgent':
        // TIME_SENSITIVE first, then earliest ship date, then highest shortage
        sorted.sort((a, b) => {
          if (a.hasTimeSensitive !== b.hasTimeSensitive) {
            return a.hasTimeSensitive ? -1 : 1;
          }
          if (a.earliestShipDate !== b.earliestShipDate) {
            if (!a.earliestShipDate) return 1;
            if (!b.earliestShipDate) return -1;
            return a.earliestShipDate.localeCompare(b.earliestShipDate);
          }
          return b.shortage - a.shortage;
        });
        break;
      case 'shortage':
        sorted.sort((a, b) => b.shortage - a.shortage);
        break;
      case 'alpha':
        sorted.sort((a, b) => a.product_name.localeCompare(b.product_name));
        break;
    }
    
    return sorted;
  }, [demandByProduct, sortBy]);

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

  // Group by roast_group for inventory display
  const roastGroupSummary = useMemo(() => {
    const groups: Record<string, { roasted_kg: number; products: string[] }> = {};
    
    for (const product of products ?? []) {
      if (product.roast_group) {
        if (!groups[product.roast_group]) {
          groups[product.roast_group] = {
            roasted_kg: roastedInventory[product.roast_group] ?? 0,
            products: [],
          };
        }
        groups[product.roast_group].products.push(product.product_name);
      }
    }
    
    return groups;
  }, [products, roastedInventory]);

  return (
    <div className="space-y-4">
      {/* Roasted Inventory Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Roasted Inventory On Hand
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Net roasted kg by roast group (roasted output − kg consumed by packing).
          </p>
        </CardHeader>
        <CardContent>
          {Object.keys(roastGroupSummary).length === 0 ? (
            <p className="text-muted-foreground">No roast groups with inventory.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {Object.entries(roastGroupSummary).map(([group, data]) => (
                <Badge key={group} variant="outline" className="text-sm py-1 px-3">
                  {group}: {data.roasted_kg.toFixed(2)} kg
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Packing Progress */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Pack SKUs
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Track packing progress per SKU. This is the source of truth for shipped quantity checks.
              </p>
            </div>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="urgent">Most urgent first</SelectItem>
                <SelectItem value="shortage">Largest shortage first</SelectItem>
                <SelectItem value="alpha">Alphabetical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {sortedProducts.length === 0 ? (
            <p className="text-muted-foreground py-4">No products demanded for selected dates.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
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
                  const isComplete = packed >= product.demanded_units;
                  const isExpanded = expandedProductId === product.product_id;
                  
                  const toggleExpand = () => {
                    setExpandedProductId(isExpanded ? null : product.product_id);
                  };
                  
                  return (
                    <React.Fragment key={product.product_id}>
                      <tr 
                        className={`border-b last:border-0 cursor-pointer transition-colors 
                          ${product.hasTimeSensitive ? 'bg-destructive/5' : ''} 
                          ${isExpanded 
                            ? 'bg-accent/40 border-l-2 border-l-primary' 
                            : 'hover:bg-muted/50'
                          }`}
                        onClick={toggleExpand}
                      >
                        <td className="py-3 w-8">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{product.product_name}</span>
                            <PackagingBadge variant={product.packaging_variant} />
                            {product.hasTimeSensitive && (
                              <Badge variant="destructive" className="text-xs">
                                <Clock className="h-3 w-3 mr-1" />
                                Urgent
                              </Badge>
                            )}
                            {product.unblocksOrders > 0 && product.shortage > 0 && (
                              <Badge variant="outline" className="text-xs">
                                <ShoppingCart className="h-3 w-3 mr-1" />
                                Unblocks: {product.unblocksOrders} order{product.unblocksOrders !== 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {product.bag_size_g}g • {product.sku || 'No SKU'}
                          </div>
                        </td>
                        <td className="py-3">
                          {product.roast_group ? (
                            <Badge variant="secondary">{product.roast_group}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <span className="font-medium">{product.demanded_units}</span>
                          <span className="text-muted-foreground text-xs ml-1">units</span>
                        </td>
                        <td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <InlinePackingControl
                            value={packed}
                            onCommit={(newValue) => updatePackingUnits(product.product_id, newValue)}
                            onEditingChange={(isEditing) => handleEditingChange(product.product_id, isEditing)}
                            isComplete={isComplete}
                          />
                        </td>
                        <td className="py-3 text-right">
                          {isComplete ? (
                            <Badge variant="default" className="bg-primary text-primary-foreground">
                              <Check className="h-3 w-3 mr-1" />
                              Complete
                            </Badge>
                          ) : packed > 0 ? (
                            <Badge variant="secondary">
                              {Math.round((packed / product.demanded_units) * 100)}%
                            </Badge>
                          ) : (
                            <Badge variant="outline">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Pending
                            </Badge>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <PackRowDrawer
                          productId={product.product_id}
                          productName={product.product_name}
                          sku={product.sku}
                          roastGroup={product.roast_group}
                          packingRun={packing}
                          unblocksOrders={product.unblocksOrders}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
