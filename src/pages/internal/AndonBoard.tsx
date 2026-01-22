import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Check, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface PickEntry {
  id: string;
  product_id: string;
  units_picked: number;
  units_supplied: number;
}

type BoardSource = 'MATCHSTICK' | 'FUNK' | 'NOSMOKE';

interface AndonBoardProps {
  source: BoardSource;
  title: string;
}

export default function AndonBoard({ source, title }: AndonBoardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [targetDate, setTargetDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isDirty, setIsDirty] = useState(false);

  // Fetch products configured for this board (cast source for NOSMOKE support)
  const { data: boardProducts, isLoading: productsLoading } = useQuery({
    queryKey: ['board-products', source],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('source_board_products')
        .select('id, product_id, display_order, is_active, product:products(id, product_name, sku, bag_size_g)')
        .eq('source', source as 'MATCHSTICK' | 'FUNK')
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
        .eq('source', source as 'MATCHSTICK' | 'FUNK')
        .eq('target_date', targetDate);

      if (error) throw error;
      return (data ?? []) as DemandEntry[];
    },
  });

  // Fetch existing picks for selected date
  const { data: existingPicks, isLoading: picksLoading } = useQuery({
    queryKey: ['andon-picks', source, targetDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('andon_picks')
        .select('id, product_id, units_picked, units_supplied')
        .eq('board', source)
        .eq('target_date', targetDate);

      if (error) throw error;
      return (data ?? []) as PickEntry[];
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

  // Build picks map (picked and supplied)
  const picksMap = React.useMemo(() => {
    const map: Record<string, { picked: number; supplied: number }> = {};
    for (const p of existingPicks ?? []) {
      map[p.product_id] = { picked: p.units_picked, supplied: p.units_supplied };
    }
    return map;
  }, [existingPicks]);

  const saveDemandMutation = useMutation({
    mutationFn: async () => {
      // Upsert all quantities (cast source for type compatibility)
      const upserts = Object.entries(quantities).map(([productId, qty]) => ({
        source: source as 'MATCHSTICK' | 'FUNK',
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

  // Mutation for updating picks (and supplied)
  const updatePickMutation = useMutation({
    mutationFn: async ({ productId, picked, supplied }: { productId: string; picked: number; supplied: number }) => {
      const { error } = await supabase
        .from('andon_picks')
        .upsert(
          {
            board: source,
            target_date: targetDate,
            product_id: productId,
            units_picked: picked,
            units_supplied: supplied,
            updated_by: user?.id,
          },
          { onConflict: 'board,product_id,target_date' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['andon-picks', source, targetDate] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update');
    },
  });

  const updateQuantity = (productId: string, value: number) => {
    setQuantities((prev) => ({ ...prev, [productId]: Math.max(0, value) }));
    setIsDirty(true);
  };

  const handleSuppliedChange = (productId: string, newSupplied: number, required: number) => {
    const current = picksMap[productId] ?? { picked: 0, supplied: 0 };
    const clampedSupplied = Math.max(0, newSupplied);
    // If supplied decreases below picked, clamp picked down
    let newPicked = current.picked;
    if (clampedSupplied < current.picked) {
      newPicked = clampedSupplied;
      toast.warning(`Picked clamped to ${clampedSupplied} (cannot exceed Supplied)`);
    }
    updatePickMutation.mutate({ productId, picked: newPicked, supplied: clampedSupplied });
  };

  const handlePickChange = (productId: string, newValue: number, supplied: number) => {
    // Clamp between 0 and supplied
    const clamped = Math.max(0, Math.min(newValue, supplied));
    const currentSupplied = picksMap[productId]?.supplied ?? supplied;
    updatePickMutation.mutate({ productId, picked: clamped, supplied: currentSupplied });
  };

  const isLoading = productsLoading || demandLoading || picksLoading;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="text-sm text-muted-foreground">Enter daily production quantities and track picks</p>
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
            onClick={() => saveDemandMutation.mutate()}
            disabled={saveDemandMutation.isPending || !isDirty}
          >
            {saveDemandMutation.isPending ? 'Saving…' : 'Save Demand'}
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
                  <th className="pb-2 w-28 text-center">Required</th>
                  <th className="pb-2 w-28 text-center">Supplied</th>
                  <th className="pb-2 w-40 text-center">Picked</th>
                  <th className="pb-2 w-32 text-center">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {boardProducts.map((bp) => {
                  const required = quantities[bp.product_id] ?? 0;
                  const pickData = picksMap[bp.product_id] ?? { picked: 0, supplied: 0 };
                  // Default supplied to required if not yet set
                  const supplied = pickData.supplied > 0 ? pickData.supplied : required;
                  const picked = pickData.picked;
                  const remaining = Math.max(supplied - picked, 0);
                  const isComplete = supplied > 0 && remaining === 0;
                  const isPartial = picked > 0 && remaining > 0;
                  const surplus = supplied - required;

                  return (
                    <tr
                      key={bp.id}
                      className={cn(
                        'border-b last:border-0 transition-colors',
                        isComplete && 'bg-accent/50'
                      )}
                    >
                      <td className="py-3 font-medium">
                        <div className="flex items-center gap-2">
                          {bp.product?.product_name ?? 'Unknown'}
                          {isComplete && (
                            <Badge variant="default" className="bg-primary text-primary-foreground">
                              <Check className="h-3 w-3 mr-1" />
                              Picked
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3">{bp.product?.sku || '—'}</td>
                      <td className="py-3 text-center">
                        <Input
                          type="number"
                          min={0}
                          className="w-20 mx-auto text-center"
                          value={quantities[bp.product_id] ?? 0}
                          onChange={(e) => updateQuantity(bp.product_id, parseInt(e.target.value) || 0)}
                        />
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            className="w-20 text-center"
                            value={supplied}
                            onChange={(e) => handleSuppliedChange(bp.product_id, parseInt(e.target.value) || 0, required)}
                          />
                          {surplus > 0 && (
                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                              Surplus +{surplus}
                            </Badge>
                          )}
                          {surplus < 0 && (
                            <Badge variant="destructive" className="text-xs">
                              Short {Math.abs(surplus)}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePickChange(bp.product_id, picked - 1, supplied)}
                            disabled={picked <= 0 || updatePickMutation.isPending}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            min={0}
                            max={supplied}
                            className="w-16 text-center"
                            value={picked}
                            onChange={(e) => handlePickChange(bp.product_id, parseInt(e.target.value) || 0, supplied)}
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handlePickChange(bp.product_id, picked + 1, supplied)}
                            disabled={picked >= supplied || updatePickMutation.isPending}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                      <td className="py-3 text-center">
                        {supplied === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : isComplete ? (
                          <span className="text-primary font-medium">0</span>
                        ) : (
                          <span className={cn('font-medium', isPartial && 'text-warning')}>
                            {remaining} remaining
                          </span>
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

      {isDirty && (
        <p className="mt-4 text-sm text-warning">
          You have unsaved demand changes. Click "Save Demand" to update the run sheet.
        </p>
      )}
    </div>
  );
}
