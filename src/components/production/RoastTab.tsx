import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Flame, Plus, Check, Edit2 } from 'lucide-react';

interface RoastTabProps {
  dateFilter: string[];
  today: string;
}

interface RoastBatch {
  id: string;
  roast_group: string;
  target_date: string;
  planned_output_kg: number | null;
  actual_output_kg: number;
  status: 'PLANNED' | 'ROASTED';
  notes: string | null;
}

interface DemandByRoastGroup {
  roast_group: string;
  total_kg: number;
  products: { name: string; kg: number }[];
}

export function RoastTab({ dateFilter, today }: RoastTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [editingBatch, setEditingBatch] = useState<RoastBatch | null>(null);
  const [selectedRoastGroup, setSelectedRoastGroup] = useState<string>('');
  const [plannedKg, setPlannedKg] = useState<string>('');
  const [actualKg, setActualKg] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Fetch products with roast_group
  const { data: products } = useQuery({
    queryKey: ['products-with-roast-group'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, roast_group, bag_size_g')
        .not('roast_group', 'is', null);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch order line items for demand calculation
  const { data: orderLineItems } = useQuery({
    queryKey: ['roast-demand', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order:orders!inner(status, requested_ship_date),
          product:products(id, product_name, roast_group, bag_size_g)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .in('order.requested_ship_date', dateFilter);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch existing batches
  const { data: batches } = useQuery({
    queryKey: ['roasted-batches', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('*')
        .in('target_date', dateFilter)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as RoastBatch[];
    },
  });

  // Aggregate demand by roast_group
  const demandByRoastGroup = useMemo((): DemandByRoastGroup[] => {
    const groupMap: Record<string, { total_kg: number; products: Map<string, number> }> = {};

    for (const li of orderLineItems ?? []) {
      const roastGroup = li.product?.roast_group;
      if (!roastGroup) continue;

      const kgForLine = (li.quantity_units * (li.product?.bag_size_g ?? 0)) / 1000;
      
      if (!groupMap[roastGroup]) {
        groupMap[roastGroup] = { total_kg: 0, products: new Map() };
      }
      groupMap[roastGroup].total_kg += kgForLine;
      
      const productName = li.product?.product_name ?? 'Unknown';
      const existing = groupMap[roastGroup].products.get(productName) ?? 0;
      groupMap[roastGroup].products.set(productName, existing + kgForLine);
    }

    return Object.entries(groupMap).map(([roast_group, data]) => ({
      roast_group,
      total_kg: data.total_kg,
      products: Array.from(data.products.entries()).map(([name, kg]) => ({ name, kg })),
    })).sort((a, b) => a.roast_group.localeCompare(b.roast_group));
  }, [orderLineItems]);

  // Calculate roasted inventory per roast_group (sum of ROASTED batches)
  const roastedInventory = useMemo(() => {
    const inventory: Record<string, number> = {};
    for (const b of batches ?? []) {
      if (b.status === 'ROASTED') {
        inventory[b.roast_group] = (inventory[b.roast_group] ?? 0) + b.actual_output_kg;
      }
    }
    return inventory;
  }, [batches]);

  // Get unique roast groups from products
  const allRoastGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const p of products ?? []) {
      if (p.roast_group) groups.add(p.roast_group);
    }
    return Array.from(groups).sort();
  }, [products]);

  const createBatchMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('roasted_batches')
        .insert({
          roast_group: selectedRoastGroup,
          target_date: today,
          planned_output_kg: plannedKg ? parseFloat(plannedKg) : null,
          actual_output_kg: 0,
          status: 'PLANNED',
          notes: notes || null,
          created_by: user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Batch planned');
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      closeBatchDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to create batch');
    },
  });

  const updateBatchMutation = useMutation({
    mutationFn: async ({ id, status, actual_output_kg, notes }: { id: string; status: 'PLANNED' | 'ROASTED'; actual_output_kg: number; notes: string | null }) => {
      const { error } = await supabase
        .from('roasted_batches')
        .update({ status, actual_output_kg, notes })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Batch updated');
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      closeBatchDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update batch');
    },
  });

  const openNewBatch = (roastGroup: string, suggestedKg?: number) => {
    setEditingBatch(null);
    setSelectedRoastGroup(roastGroup);
    setPlannedKg(suggestedKg?.toFixed(2) ?? '');
    setActualKg('');
    setNotes('');
    setShowBatchDialog(true);
  };

  const openEditBatch = (batch: RoastBatch) => {
    setEditingBatch(batch);
    setSelectedRoastGroup(batch.roast_group);
    setPlannedKg(batch.planned_output_kg?.toString() ?? '');
    setActualKg(batch.actual_output_kg.toString());
    setNotes(batch.notes ?? '');
    setShowBatchDialog(true);
  };

  const closeBatchDialog = () => {
    setShowBatchDialog(false);
    setEditingBatch(null);
    setSelectedRoastGroup('');
    setPlannedKg('');
    setActualKg('');
    setNotes('');
  };

  const handleSaveBatch = () => {
    if (editingBatch) {
      updateBatchMutation.mutate({
        id: editingBatch.id,
        status: editingBatch.status,
        actual_output_kg: parseFloat(actualKg) || 0,
        notes: notes || null,
      });
    } else {
      createBatchMutation.mutate();
    }
  };

  const handleMarkRoasted = () => {
    if (!editingBatch) return;
    updateBatchMutation.mutate({
      id: editingBatch.id,
      status: 'ROASTED',
      actual_output_kg: parseFloat(actualKg) || 0,
      notes: notes || null,
    });
  };

  // Group batches by roast_group
  const batchesByGroup = useMemo(() => {
    const grouped: Record<string, RoastBatch[]> = {};
    for (const b of batches ?? []) {
      if (!grouped[b.roast_group]) grouped[b.roast_group] = [];
      grouped[b.roast_group].push(b);
    }
    return grouped;
  }, [batches]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5" />
            Roast Summary by Group
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Roast station: plan batches and mark them complete when roasted.
          </p>
        </CardHeader>
        <CardContent>
          {demandByRoastGroup.length === 0 && allRoastGroups.length === 0 ? (
            <p className="text-muted-foreground py-4">
              No products have roast_group assigned. Edit products to set roast groups.
            </p>
          ) : (
            <div className="space-y-6">
              {/* Roast groups with demand */}
              {demandByRoastGroup.map((group) => {
                const groupBatches = batchesByGroup[group.roast_group] ?? [];
                const plannedTotal = groupBatches.filter(b => b.status === 'PLANNED').reduce((sum, b) => sum + (b.planned_output_kg ?? 0), 0);
                const roastedTotal = roastedInventory[group.roast_group] ?? 0;
                
                return (
                  <div key={group.roast_group} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-lg">{group.roast_group}</h3>
                        <p className="text-sm text-muted-foreground">
                          Demand: {group.total_kg.toFixed(2)} kg
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={roastedTotal >= group.total_kg ? 'default' : 'secondary'}>
                          {roastedTotal.toFixed(2)} kg roasted
                        </Badge>
                        <Button size="sm" variant="outline" onClick={() => openNewBatch(group.roast_group, group.total_kg - roastedTotal)}>
                          <Plus className="h-4 w-4 mr-1" />
                          Plan Batch
                        </Button>
                      </div>
                    </div>

                    {/* Products in this group */}
                    <div className="text-xs text-muted-foreground mb-3">
                      {group.products.map((p, i) => (
                        <span key={p.name}>
                          {p.name} ({p.kg.toFixed(2)} kg){i < group.products.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </div>

                    {/* Batches */}
                    {groupBatches.length > 0 && (
                      <div className="space-y-2">
                        {groupBatches.map((batch) => (
                          <div
                            key={batch.id}
                            className={`flex items-center justify-between p-2 rounded border ${
                              batch.status === 'ROASTED' ? 'bg-green-50 border-green-200' : 'bg-muted/30'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {batch.status === 'ROASTED' ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <Flame className="h-4 w-4 text-muted-foreground" />
                              )}
                              <div>
                                <span className="text-sm font-medium">
                                  {batch.status === 'ROASTED' 
                                    ? `${batch.actual_output_kg} kg roasted`
                                    : `${batch.planned_output_kg ?? 0} kg planned`
                                  }
                                </span>
                                {batch.notes && (
                                  <p className="text-xs text-muted-foreground">{batch.notes}</p>
                                )}
                              </div>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => openEditBatch(batch)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Roast groups without current demand but with batches */}
              {allRoastGroups
                .filter((g) => !demandByRoastGroup.find((d) => d.roast_group === g))
                .filter((g) => batchesByGroup[g]?.length > 0)
                .map((roastGroup) => {
                  const groupBatches = batchesByGroup[roastGroup] ?? [];
                  const roastedTotal = roastedInventory[roastGroup] ?? 0;
                  
                  return (
                    <div key={roastGroup} className="border rounded-lg p-4 opacity-70">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-lg">{roastGroup}</h3>
                          <p className="text-sm text-muted-foreground">No demand for selected dates</p>
                        </div>
                        <Badge variant="outline">{roastedTotal.toFixed(2)} kg on hand</Badge>
                      </div>
                      {groupBatches.length > 0 && (
                        <div className="space-y-2">
                          {groupBatches.map((batch) => (
                            <div
                              key={batch.id}
                              className={`flex items-center justify-between p-2 rounded border ${
                                batch.status === 'ROASTED' ? 'bg-green-50 border-green-200' : 'bg-muted/30'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {batch.status === 'ROASTED' ? (
                                  <Check className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Flame className="h-4 w-4 text-muted-foreground" />
                                )}
                                <span className="text-sm">
                                  {batch.status === 'ROASTED' 
                                    ? `${batch.actual_output_kg} kg roasted`
                                    : `${batch.planned_output_kg ?? 0} kg planned`
                                  }
                                </span>
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => openEditBatch(batch)}>
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch Dialog */}
      <Dialog open={showBatchDialog} onOpenChange={setShowBatchDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingBatch ? 'Edit Roast Batch' : 'Plan Roast Batch'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Roast Group</Label>
              <p className="font-medium">{selectedRoastGroup}</p>
            </div>
            {!editingBatch && (
              <div>
                <Label htmlFor="plannedKg">Planned Output (kg)</Label>
                <Input
                  id="plannedKg"
                  type="number"
                  step="0.01"
                  value={plannedKg}
                  onChange={(e) => setPlannedKg(e.target.value)}
                  placeholder="e.g. 12.5"
                />
              </div>
            )}
            {editingBatch && (
              <>
                <div>
                  <Label>Status</Label>
                  <p className="font-medium">
                    {editingBatch.status === 'ROASTED' ? (
                      <Badge className="bg-green-600">Roasted</Badge>
                    ) : (
                      <Badge variant="secondary">Planned</Badge>
                    )}
                  </p>
                </div>
                <div>
                  <Label htmlFor="actualKg">Actual Output (kg)</Label>
                  <Input
                    id="actualKg"
                    type="number"
                    step="0.01"
                    value={actualKg}
                    onChange={(e) => setActualKg(e.target.value)}
                    placeholder="e.g. 11.8"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Editable at any time. Negative values allowed for adjustments.
                  </p>
                </div>
              </>
            )}
            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. blend notes, batch number"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={closeBatchDialog}>Cancel</Button>
              {editingBatch && editingBatch.status === 'PLANNED' && (
                <Button 
                  variant="default"
                  onClick={handleMarkRoasted}
                  disabled={updateBatchMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Mark Roasted
                </Button>
              )}
              <Button 
                onClick={handleSaveBatch} 
                disabled={createBatchMutation.isPending || updateBatchMutation.isPending || (!editingBatch && !selectedRoastGroup)}
              >
                {editingBatch ? 'Update' : 'Plan Batch'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
