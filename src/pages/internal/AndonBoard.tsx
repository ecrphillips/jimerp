import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface BoardProduct {
  id: string;
  product_id: string;
  display_order: number;
  is_active: boolean;
  product: {
    id: string;
    product_name: string;
    sku: string | null;
    bag_size_g: number;
  } | null;
}

interface DemandEntry {
  id: string;
  product_id: string;
  quantity_units: number;
}

interface AndonBoardProps {
  source: 'MATCHSTICK' | 'FUNK';
  title: string;
}

export default function AndonBoard({ source, title }: AndonBoardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [targetDate, setTargetDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isDirty, setIsDirty] = useState(false);

  // Fetch products configured for this board
  const { data: boardProducts, isLoading: productsLoading } = useQuery({
    queryKey: ['board-products', source],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('source_board_products')
        .select('id, product_id, display_order, is_active, product:products(id, product_name, sku, bag_size_g)')
        .eq('source', source)
        .eq('is_active', true)
        .order('display_order');

      if (error) throw error;
      return (data ?? []) as BoardProduct[];
    },
  });

  // Fetch existing demand for selected date
  const { data: existingDemand, isLoading: demandLoading } = useQuery({
    queryKey: ['external-demand', source, targetDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_demand')
        .select('id, product_id, quantity_units')
        .eq('source', source)
        .eq('target_date', targetDate);

      if (error) throw error;
      return (data ?? []) as DemandEntry[];
    },
  });

  // Initialize quantities when data loads
  React.useEffect(() => {
    if (boardProducts && existingDemand && !isDirty) {
      const initialQuantities: Record<string, number> = {};
      for (const bp of boardProducts) {
        const demand = existingDemand.find((d) => d.product_id === bp.product_id);
        initialQuantities[bp.product_id] = demand?.quantity_units ?? 0;
      }
      setQuantities(initialQuantities);
    }
  }, [boardProducts, existingDemand, isDirty]);

  // Reset dirty flag when date changes
  React.useEffect(() => {
    setIsDirty(false);
  }, [targetDate]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Upsert all quantities
      const upserts = Object.entries(quantities).map(([productId, qty]) => ({
        source,
        target_date: targetDate,
        product_id: productId,
        quantity_units: qty,
        updated_by: user?.id,
      }));

      for (const upsert of upserts) {
        const { error } = await supabase
          .from('external_demand')
          .upsert(upsert, {
            onConflict: 'source,target_date,product_id',
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Demand saved');
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['external-demand'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save demand');
    },
  });

  const updateQuantity = (productId: string, value: number) => {
    setQuantities((prev) => ({ ...prev, [productId]: Math.max(0, value) }));
    setIsDirty(true);
  };

  const isLoading = productsLoading || demandLoading;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="text-sm text-muted-foreground">Enter daily production quantities</p>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <Label htmlFor="date" className="sr-only">Date</Label>
            <Input
              id="date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !isDirty}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products for {format(new Date(targetDate), 'MMM d, yyyy')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !boardProducts || boardProducts.length === 0 ? (
            <p className="text-muted-foreground">
              No products configured for this board. Go to Board Management to add products.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">SKU</th>
                  <th className="pb-2">Bag Size</th>
                  <th className="pb-2 w-32">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {boardProducts.map((bp) => (
                  <tr key={bp.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{bp.product?.product_name ?? 'Unknown'}</td>
                    <td className="py-2">{bp.product?.sku || '—'}</td>
                    <td className="py-2">{bp.product?.bag_size_g ?? 0}g</td>
                    <td className="py-2">
                      <Input
                        type="number"
                        min={0}
                        className="w-24"
                        value={quantities[bp.product_id] ?? 0}
                        onChange={(e) => updateQuantity(bp.product_id, parseInt(e.target.value) || 0)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {isDirty && (
        <p className="mt-4 text-sm text-warning">
          You have unsaved changes. Click "Save" to update the run sheet.
        </p>
      )}
    </div>
  );
}
