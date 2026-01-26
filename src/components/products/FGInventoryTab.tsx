import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Minus, Search, PackagePlus } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { format } from 'date-fns';

interface FGInventoryRow {
  id: string;
  product_id: string;
  units_on_hand: number;
  updated_at: string;
  product: {
    id: string;
    product_name: string;
    sku: string | null;
    packaging_variant: PackagingVariant | null;
    is_active: boolean;
    client: { name: string } | null;
  };
}

interface ActiveProduct {
  id: string;
  product_name: string;
  sku: string | null;
  packaging_variant: PackagingVariant | null;
  client: { name: string } | null;
}

export function FGInventoryTab() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const lastEditTime = useRef<number>(0);
  const sortFreezeTimeout = useRef<NodeJS.Timeout | null>(null);
  const [isSortFrozen, setIsSortFrozen] = useState(false);

  // Fetch FG inventory with product info
  const { data: inventory, isLoading } = useQuery({
    queryKey: ['fg-inventory-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fg_inventory')
        .select(`
          id,
          product_id,
          units_on_hand,
          updated_at,
          product:products(id, product_name, sku, packaging_variant, is_active, client:clients(name))
        `)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as FGInventoryRow[];
    },
  });

  // Fetch all active products (for backfill)
  const { data: activeProducts } = useQuery({
    queryKey: ['active-products-for-fg'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, packaging_variant, client:clients(name)')
        .eq('is_active', true)
        .order('product_name');

      if (error) throw error;
      return (data ?? []) as ActiveProduct[];
    },
  });

  // Products without inventory rows
  const productsWithoutInventory = useMemo(() => {
    if (!activeProducts || !inventory) return [];
    const inventoryProductIds = new Set(inventory.map((i) => i.product_id));
    return activeProducts.filter((p) => !inventoryProductIds.has(p.id));
  }, [activeProducts, inventory]);

  // Filter and sort inventory
  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    
    let filtered = inventory.filter((row) => row.product.is_active);
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((row) =>
        row.product.product_name.toLowerCase().includes(query) ||
        row.product.sku?.toLowerCase().includes(query) ||
        row.product.client?.name.toLowerCase().includes(query)
      );
    }

    // Sort by client, then product name (unless sort is frozen)
    if (!isSortFrozen) {
      filtered.sort((a, b) => {
        const clientA = a.product.client?.name ?? '';
        const clientB = b.product.client?.name ?? '';
        if (clientA !== clientB) return clientA.localeCompare(clientB);
        return a.product.product_name.localeCompare(b.product.product_name);
      });
    }

    return filtered;
  }, [inventory, searchQuery, isSortFrozen]);

  // Freeze sort on edit
  const freezeSort = useCallback(() => {
    setIsSortFrozen(true);
    lastEditTime.current = Date.now();
    
    if (sortFreezeTimeout.current) {
      clearTimeout(sortFreezeTimeout.current);
    }
    sortFreezeTimeout.current = setTimeout(() => {
      setIsSortFrozen(false);
      setEditingRowId(null);
    }, 1200);
  }, []);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, units }: { id: string; units: number }) => {
      const { error } = await supabase
        .from('fg_inventory')
        .update({ units_on_hand: units, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fg-inventory-all'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update inventory');
    },
  });

  // Backfill mutation
  const backfillMutation = useMutation({
    mutationFn: async () => {
      if (productsWithoutInventory.length === 0) return 0;

      const rows = productsWithoutInventory.map((p) => ({
        product_id: p.id,
        units_on_hand: 0,
      }));

      const { error } = await supabase.from('fg_inventory').insert(rows);
      if (error) throw error;

      return productsWithoutInventory.length;
    },
    onSuccess: (count) => {
      if (count > 0) {
        toast.success(`Added ${count} inventory row${count > 1 ? 's' : ''}`);
        queryClient.invalidateQueries({ queryKey: ['fg-inventory-all'] });
      }
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to add inventory rows');
    },
  });

  const handleQuantityChange = (row: FGInventoryRow, delta: number) => {
    const newUnits = Math.max(0, row.units_on_hand + delta);
    setEditingRowId(row.id);
    freezeSort();
    updateMutation.mutate({ id: row.id, units: newUnits });
  };

  const handleInputChange = (row: FGInventoryRow, value: string) => {
    const numValue = value.replace(/[^0-9]/g, '');
    const units = numValue === '' ? 0 : parseInt(numValue, 10);
    setEditingRowId(row.id);
    freezeSort();
    updateMutation.mutate({ id: row.id, units: Math.max(0, units) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by product, SKU, or client..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {productsWithoutInventory.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            className="gap-2"
          >
            <PackagePlus className="h-4 w-4" />
            {backfillMutation.isPending
              ? 'Adding…'
              : `Add ${productsWithoutInventory.length} missing`}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Finished Goods On Hand</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : filteredInventory.length === 0 ? (
            <p className="text-muted-foreground">
              {searchQuery ? 'No matching products.' : 'No inventory records yet.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Client</th>
                  <th className="pb-2">SKU</th>
                  <th className="pb-2">Packaging</th>
                  <th className="pb-2 text-right">On Hand</th>
                  <th className="pb-2 text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b last:border-0 ${editingRowId === row.id ? 'bg-muted/50' : ''}`}
                  >
                    <td className="py-2 font-medium">{row.product.product_name}</td>
                    <td className="py-2">{row.product.client?.name ?? '—'}</td>
                    <td className="py-2">{row.product.sku || '—'}</td>
                    <td className="py-2">
                      {row.product.packaging_variant ? (
                        <PackagingBadge variant={row.product.packaging_variant} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => handleQuantityChange(row, -1)}
                          disabled={row.units_on_hand <= 0}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="text"
                          inputMode="numeric"
                          className="w-16 h-7 text-center text-sm px-1"
                          value={row.units_on_hand}
                          onChange={(e) => handleInputChange(row, e.target.value)}
                          onFocus={() => {
                            setEditingRowId(row.id);
                            freezeSort();
                          }}
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={() => handleQuantityChange(row, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                    <td className="py-2 text-right text-muted-foreground text-xs">
                      {format(new Date(row.updated_at), 'MMM d, h:mm a')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
