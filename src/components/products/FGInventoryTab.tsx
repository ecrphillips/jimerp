import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Minus, Search } from 'lucide-react';
import { format } from 'date-fns';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { useAuthoritativeFg } from '@/hooks/useAuthoritativeInventory';

interface FGRow {
  product_id: string;
  units_on_hand: number;
  product_name: string;
  sku: string | null;
  packaging_variant: PackagingVariant | null;
  client_name: string | null;
}

export function FGInventoryTab() {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const sortFreezeTimeout = useRef<NodeJS.Timeout | null>(null);
  const [isSortFrozen, setIsSortFrozen] = useState(false);
  // Per-product "last counted by X at <time>" from the ledger row just written.
  const [lastCounted, setLastCounted] = useState<Record<string, { at: string; by: string }>>({});

  // FG on-hand from the inventory_transactions ledger (single source of truth).
  const { data: authoritativeFg, isLoading: fgLoading } = useAuthoritativeFg();

  // Active products supply the display metadata (client, packaging, sku).
  const { data: activeProducts, isLoading: productsLoading } = useQuery({
    queryKey: ['active-products-for-fg'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, packaging_variant, client:clients(name)')
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const isLoading = fgLoading || productsLoading;

  const rows = useMemo<FGRow[]>(() => {
    const fg = authoritativeFg ?? {};
    return (activeProducts ?? []).map((p) => ({
      product_id: p.id,
      units_on_hand: fg[p.id]?.fg_available_units ?? 0,
      product_name: p.product_name,
      sku: p.sku,
      packaging_variant: (p.packaging_variant as PackagingVariant | null) ?? null,
      client_name: (p.client as { name: string } | null)?.name ?? null,
    }));
  }, [activeProducts, authoritativeFg]);

  const filteredInventory = useMemo(() => {
    let filtered = rows;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((row) =>
        row.product_name.toLowerCase().includes(query) ||
        row.sku?.toLowerCase().includes(query) ||
        row.client_name?.toLowerCase().includes(query)
      );
    }
    if (!isSortFrozen) {
      filtered = [...filtered].sort((a, b) => {
        const clientA = a.client_name ?? '';
        const clientB = b.client_name ?? '';
        if (clientA !== clientB) return clientA.localeCompare(clientB);
        return a.product_name.localeCompare(b.product_name);
      });
    }
    return filtered;
  }, [rows, searchQuery, isSortFrozen]);

  const freezeSort = useCallback(() => {
    setIsSortFrozen(true);
    if (sortFreezeTimeout.current) clearTimeout(sortFreezeTimeout.current);
    sortFreezeTimeout.current = setTimeout(() => {
      setIsSortFrozen(false);
      setEditingRowId(null);
    }, 1200);
  }, []);

  // A change writes ONE balancing ADJUSTMENT row to inventory_transactions
  // (quantity_units = counted − current ledger balance). Stamped with the user;
  // created_at provides the timestamp. No writes to the retired fg_inventory.
  const adjustMutation = useMutation({
    mutationFn: async ({ productId, unitsDelta, newUnits }: { productId: string; unitsDelta: number; newUnits: number }) => {
      if (!unitsDelta) return null;
      const { data, error } = await supabase
        .from('inventory_transactions')
        .insert({
          transaction_type: 'ADJUSTMENT',
          product_id: productId,
          quantity_units: unitsDelta,
          notes: `FG floor count: counted ${newUnits} units (delta ${unitsDelta >= 0 ? '+' : ''}${unitsDelta})`,
          created_by: authUser?.id,
          is_system_generated: false,
        })
        .select('created_at, created_by')
        .single();
      if (error) throw error;
      return { productId, newUnits, createdAt: data.created_at };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['authoritative-fg-ledger'] });
      if (!result) return;
      const by = authUser?.profile?.name ?? authUser?.email ?? 'Unknown';
      setLastCounted((prev) => ({
        ...prev,
        [result.productId]: { at: result.createdAt, by },
      }));
      toast.success(`Counted ${result.newUnits} units.`);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update inventory');
    },
  });

  const handleQuantityChange = (row: FGRow, delta: number) => {
    const newUnits = Math.max(0, row.units_on_hand + delta);
    setEditingRowId(row.product_id);
    freezeSort();
    adjustMutation.mutate({ productId: row.product_id, unitsDelta: newUnits - row.units_on_hand, newUnits });
  };

  const handleInputChange = (row: FGRow, value: string) => {
    const numValue = value.replace(/[^0-9]/g, '');
    const newUnits = numValue === '' ? 0 : parseInt(numValue, 10);
    setEditingRowId(row.product_id);
    freezeSort();
    adjustMutation.mutate({ productId: row.product_id, unitsDelta: Math.max(0, newUnits) - row.units_on_hand, newUnits: Math.max(0, newUnits) });
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
              {searchQuery ? 'No matching products.' : 'No active products.'}
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
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map((row) => (
                  <tr
                    key={row.product_id}
                    className={`border-b last:border-0 ${editingRowId === row.product_id ? 'bg-muted/50' : ''}`}
                  >
                    <td className="py-2 font-medium">
                      {row.product_name}
                      {lastCounted[row.product_id] && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Last counted by {lastCounted[row.product_id].by} at{' '}
                          {format(new Date(lastCounted[row.product_id].at), 'MMM d, h:mm a')}
                        </span>
                      )}
                    </td>
                    <td className="py-2">{row.client_name ?? '—'}</td>
                    <td className="py-2">{row.sku || '—'}</td>
                    <td className="py-2">
                      {row.packaging_variant ? (
                        <PackagingBadge variant={row.packaging_variant} />
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
                            setEditingRowId(row.product_id);
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
