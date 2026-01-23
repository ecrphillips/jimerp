import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Package, Check, AlertTriangle, Clock, ShoppingCart } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';

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
}

export function PackTab({ dateFilter, today }: PackTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [unitsPacked, setUnitsPacked] = useState<string>('');
  const [kgConsumed, setKgConsumed] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortOption>('urgent');

  // Fetch products (only active)
  const { data: products } = useQuery({
    queryKey: ['all-products-for-pack'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, packaging_variant, roast_group')
        .eq('is_active', true);
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
  const sortedProducts = useMemo(() => {
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

  // Map packing runs by product_id
  const packingByProduct = useMemo(() => {
    const map: Record<string, PackingRun> = {};
    for (const pr of packingRuns ?? []) {
      map[pr.product_id] = pr;
    }
    return map;
  }, [packingRuns]);

  const packingMutation = useMutation({
    mutationFn: async ({ productId, units, kg }: { productId: string; units: number; kg: number }) => {
      const { error } = await supabase
        .from('packing_runs')
        .upsert({
          product_id: productId,
          target_date: today,
          units_packed: units,
          kg_consumed: kg,
          updated_by: user?.id,
        }, {
          onConflict: 'product_id,target_date',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Packing progress saved');
      queryClient.invalidateQueries({ queryKey: ['packing-runs'] });
      setEditingProductId(null);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save packing progress');
    },
  });

  const startEditing = (productId: string) => {
    const existing = packingByProduct[productId];
    setEditingProductId(productId);
    setUnitsPacked(existing?.units_packed?.toString() ?? '0');
    setKgConsumed(existing?.kg_consumed?.toString() ?? '0');
  };

  const savePacking = (productId: string) => {
    packingMutation.mutate({
      productId,
      units: parseInt(unitsPacked) || 0,
      kg: parseFloat(kgConsumed) || 0,
    });
  };

  const cancelEditing = () => {
    setEditingProductId(null);
    setUnitsPacked('');
    setKgConsumed('');
  };

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
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Roast Group</th>
                  <th className="pb-2 text-right">Demanded</th>
                  <th className="pb-2 text-right">Packed</th>
                  <th className="pb-2 text-right">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((product) => {
                  const packing = packingByProduct[product.product_id];
                  const packed = packing?.units_packed ?? 0;
                  const isComplete = packed >= product.demanded_units;
                  const isEditing = editingProductId === product.product_id;
                  
                  return (
                    <tr 
                      key={product.product_id} 
                      className={`border-b last:border-0 ${product.hasTimeSensitive ? 'bg-destructive/5' : ''}`}
                    >
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
                            <Badge variant="outline" className="text-xs border-blue-400 text-blue-700 bg-blue-50">
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
                      <td className="py-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center gap-2 justify-end">
                            <Input
                              type="number"
                              className="w-20 text-right"
                              value={unitsPacked}
                              onChange={(e) => setUnitsPacked(e.target.value)}
                            />
                          </div>
                        ) : (
                          <span className={isComplete ? 'text-green-600 font-medium' : ''}>
                            {packed}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {isComplete ? (
                          <Badge className="bg-green-600">
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
                      <td className="py-3 text-right">
                        {isEditing ? (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="outline" onClick={cancelEditing}>
                              Cancel
                            </Button>
                            <Button 
                              size="sm" 
                              onClick={() => savePacking(product.product_id)}
                              disabled={packingMutation.isPending}
                            >
                              Save
                            </Button>
                          </div>
                        ) : (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => startEditing(product.product_id)}
                          >
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
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
