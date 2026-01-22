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
import { Flame, Plus, Check, Edit2, Zap, Clock, Settings } from 'lucide-react';

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

interface RoastGroupConfig {
  roast_group: string;
  standard_batch_kg: number;
  is_active: boolean;
  notes: string | null;
}

interface DemandByRoastGroup {
  roast_group: string;
  total_kg: number;
  products: { name: string; kg: number }[];
  hasTimeSensitive: boolean;
  earliestShipDate: string | null;
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
  
  // Roast group config dialog
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [configRoastGroup, setConfigRoastGroup] = useState<string>('');
  const [configStandardBatch, setConfigStandardBatch] = useState<string>('20');

  // Fetch roast_groups config
  const { data: roastGroupsConfig } = useQuery({
    queryKey: ['roast-groups-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('*')
        .eq('is_active', true);
      if (error) throw error;
      return (data ?? []) as RoastGroupConfig[];
    },
  });

  // Map roast group to standard batch kg
  const standardBatchByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const rg of roastGroupsConfig ?? []) {
      map[rg.roast_group] = rg.standard_batch_kg;
    }
    return map;
  }, [roastGroupsConfig]);

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

  // Fetch order line items for demand calculation with ship_priority
  const { data: orderLineItems } = useQuery({
    queryKey: ['roast-demand', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order:orders!inner(id, status, requested_ship_date),
          product:products(id, product_name, roast_group, bag_size_g)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .in('order.requested_ship_date', dateFilter);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch production checkmarks for TIME_SENSITIVE priority
  const { data: checkmarks } = useQuery({
    queryKey: ['production-checkmarks-for-roast', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checkmarks')
        .select('product_id, ship_priority')
        .in('target_date', dateFilter);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Map product_id to TIME_SENSITIVE
  const timeSensitiveProducts = useMemo(() => {
    const set = new Set<string>();
    for (const cm of checkmarks ?? []) {
      if (cm.ship_priority === 'TIME_SENSITIVE') {
        set.add(cm.product_id);
      }
    }
    return set;
  }, [checkmarks]);

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

  // Aggregate demand by roast_group with priority info
  const demandByRoastGroup = useMemo((): DemandByRoastGroup[] => {
    const groupMap: Record<string, { 
      total_kg: number; 
      products: Map<string, number>; 
      hasTimeSensitive: boolean;
      earliestShipDate: string | null;
    }> = {};

    for (const li of orderLineItems ?? []) {
      const roastGroup = li.product?.roast_group;
      if (!roastGroup) continue;

      const kgForLine = (li.quantity_units * (li.product?.bag_size_g ?? 0)) / 1000;
      const isTimeSensitive = timeSensitiveProducts.has(li.product_id);
      const shipDate = li.order?.requested_ship_date ?? null;
      
      if (!groupMap[roastGroup]) {
        groupMap[roastGroup] = { 
          total_kg: 0, 
          products: new Map(), 
          hasTimeSensitive: false,
          earliestShipDate: null,
        };
      }
      groupMap[roastGroup].total_kg += kgForLine;
      
      if (isTimeSensitive) {
        groupMap[roastGroup].hasTimeSensitive = true;
      }
      
      if (shipDate && (!groupMap[roastGroup].earliestShipDate || shipDate < groupMap[roastGroup].earliestShipDate)) {
        groupMap[roastGroup].earliestShipDate = shipDate;
      }
      
      const productName = li.product?.product_name ?? 'Unknown';
      const existing = groupMap[roastGroup].products.get(productName) ?? 0;
      groupMap[roastGroup].products.set(productName, existing + kgForLine);
    }

    return Object.entries(groupMap).map(([roast_group, data]) => ({
      roast_group,
      total_kg: data.total_kg,
      products: Array.from(data.products.entries()).map(([name, kg]) => ({ name, kg })),
      hasTimeSensitive: data.hasTimeSensitive,
      earliestShipDate: data.earliestShipDate,
    })).sort((a, b) => {
      // Sort by TIME_SENSITIVE first
      if (a.hasTimeSensitive && !b.hasTimeSensitive) return -1;
      if (!a.hasTimeSensitive && b.hasTimeSensitive) return 1;
      // Then by earliest ship date
      if (a.earliestShipDate && b.earliestShipDate) {
        if (a.earliestShipDate < b.earliestShipDate) return -1;
        if (a.earliestShipDate > b.earliestShipDate) return 1;
      }
      // Then by name
      return a.roast_group.localeCompare(b.roast_group);
    });
  }, [orderLineItems, timeSensitiveProducts]);

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

  // Group batches by roast_group
  const batchesByGroup = useMemo(() => {
    const grouped: Record<string, RoastBatch[]> = {};
    for (const b of batches ?? []) {
      if (!grouped[b.roast_group]) grouped[b.roast_group] = [];
      grouped[b.roast_group].push(b);
    }
    return grouped;
  }, [batches]);

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

  // Create multiple suggested batches at once
  const createSuggestedBatchesMutation = useMutation({
    mutationFn: async ({ roastGroup, count, batchKg }: { roastGroup: string; count: number; batchKg: number }) => {
      const batchesToInsert = Array.from({ length: count }, () => ({
        roast_group: roastGroup,
        target_date: today,
        planned_output_kg: batchKg,
        actual_output_kg: 0,
        status: 'PLANNED' as const,
        created_by: user?.id,
      }));
      
      const { error } = await supabase
        .from('roasted_batches')
        .insert(batchesToInsert);
      if (error) throw error;
    },
    onSuccess: (_, { count }) => {
      toast.success(`Created ${count} planned batches`);
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to create batches');
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

  // Upsert roast group config
  const upsertRoastGroupMutation = useMutation({
    mutationFn: async ({ roastGroup, standardBatchKg }: { roastGroup: string; standardBatchKg: number }) => {
      const { error } = await supabase
        .from('roast_groups')
        .upsert({
          roast_group: roastGroup,
          standard_batch_kg: standardBatchKg,
          is_active: true,
        }, {
          onConflict: 'roast_group',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Roast group config saved');
      queryClient.invalidateQueries({ queryKey: ['roast-groups-config'] });
      setShowConfigDialog(false);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save config');
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

  const openConfigDialog = (roastGroup: string) => {
    setConfigRoastGroup(roastGroup);
    setConfigStandardBatch((standardBatchByGroup[roastGroup] ?? 20).toString());
    setShowConfigDialog(true);
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

  const handleCreateSuggestedBatches = (roastGroup: string, demandKg: number) => {
    const standardBatch = standardBatchByGroup[roastGroup] ?? 20;
    const existingPlannedKg = (batchesByGroup[roastGroup] ?? [])
      .filter(b => b.status === 'PLANNED')
      .reduce((sum, b) => sum + (b.planned_output_kg ?? 0), 0);
    const roastedKg = roastedInventory[roastGroup] ?? 0;
    const remainingNeed = demandKg - roastedKg - existingPlannedKg;
    
    if (remainingNeed <= 0) {
      toast.info('No additional batches needed');
      return;
    }
    
    const batchCount = Math.ceil(remainingNeed / standardBatch);
    createSuggestedBatchesMutation.mutate({
      roastGroup,
      count: batchCount,
      batchKg: standardBatch,
    });
  };

  const handleSaveConfig = () => {
    const batchKg = parseFloat(configStandardBatch);
    if (!batchKg || batchKg <= 0) {
      toast.error('Standard batch must be a positive number');
      return;
    }
    upsertRoastGroupMutation.mutate({
      roastGroup: configRoastGroup,
      standardBatchKg: batchKg,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5" />
            Roast Plan
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Plan batches based on demand and standard batch sizes. Urgent orders shown first.
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
                const plannedBatches = groupBatches.filter(b => b.status === 'PLANNED');
                const plannedTotal = plannedBatches.reduce((sum, b) => sum + (b.planned_output_kg ?? 0), 0);
                const roastedTotal = roastedInventory[group.roast_group] ?? 0;
                const standardBatch = standardBatchByGroup[group.roast_group] ?? 20;
                const hasConfig = group.roast_group in standardBatchByGroup;
                
                // Calculate suggestion
                const remainingNeed = Math.max(0, group.total_kg - roastedTotal - plannedTotal);
                const suggestedBatches = remainingNeed > 0 ? Math.ceil(remainingNeed / standardBatch) : 0;
                const suggestedTotalKg = suggestedBatches * standardBatch;
                
                return (
                  <div 
                    key={group.roast_group} 
                    className={`border rounded-lg p-4 ${group.hasTimeSensitive ? 'border-destructive bg-destructive/5' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">{group.roast_group}</h3>
                          {group.hasTimeSensitive && (
                            <Badge variant="destructive" className="text-xs">
                              <Clock className="h-3 w-3 mr-1" />
                              Urgent
                            </Badge>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 w-6 p-0"
                            onClick={() => openConfigDialog(group.roast_group)}
                          >
                            <Settings className="h-3 w-3" />
                          </Button>
                        </div>
                        {!hasConfig && (
                          <p className="text-xs text-amber-600">
                            No config set. Click ⚙ to set standard batch size.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={roastedTotal >= group.total_kg ? 'default' : 'secondary'}>
                          {roastedTotal.toFixed(1)} kg roasted
                        </Badge>
                      </div>
                    </div>

                    {/* Batch suggestion summary */}
                    <div className="bg-muted/50 rounded p-3 mb-3 text-sm">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>
                          <strong>Demand:</strong> {group.total_kg.toFixed(1)} kg
                        </span>
                        <span>
                          <strong>Std batch:</strong> {standardBatch} kg
                        </span>
                        {suggestedBatches > 0 ? (
                          <span className="text-primary font-medium">
                            <Zap className="h-4 w-4 inline mr-1" />
                            Suggest: {suggestedBatches} batch{suggestedBatches > 1 ? 'es' : ''} ({suggestedTotalKg} kg)
                          </span>
                        ) : (
                          <span className="text-green-600">
                            <Check className="h-4 w-4 inline mr-1" />
                            Covered
                          </span>
                        )}
                      </div>
                      {suggestedBatches > 0 && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="mt-2"
                          onClick={() => handleCreateSuggestedBatches(group.roast_group, group.total_kg)}
                          disabled={createSuggestedBatchesMutation.isPending}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Create {suggestedBatches} planned batch{suggestedBatches > 1 ? 'es' : ''}
                        </Button>
                      )}
                    </div>

                    {/* Products in this group */}
                    <div className="text-xs text-muted-foreground mb-3">
                      {group.products.map((p, i) => (
                        <span key={p.name}>
                          {p.name} ({p.kg.toFixed(1)} kg){i < group.products.length - 1 ? ', ' : ''}
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
                              batch.status === 'ROASTED' ? 'bg-green-50 border-green-200' : 'bg-background'
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

                    {/* Manual add batch button */}
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="mt-2 text-muted-foreground"
                      onClick={() => openNewBatch(group.roast_group, standardBatch)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add custom batch
                    </Button>
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
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">{roastGroup}</h3>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 w-6 p-0"
                            onClick={() => openConfigDialog(roastGroup)}
                          >
                            <Settings className="h-3 w-3" />
                          </Button>
                        </div>
                        <Badge variant="outline">{roastedTotal.toFixed(1)} kg on hand</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">No demand for selected dates</p>
                      {groupBatches.length > 0 && (
                        <div className="space-y-2">
                          {groupBatches.map((batch) => (
                            <div
                              key={batch.id}
                              className={`flex items-center justify-between p-2 rounded border ${
                                batch.status === 'ROASTED' ? 'bg-green-50 border-green-200' : 'bg-background'
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

      {/* Roast Group Config Dialog */}
      <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Configure Roast Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Roast Group</Label>
              <p className="font-medium">{configRoastGroup}</p>
            </div>
            <div>
              <Label htmlFor="standardBatch">Standard Batch Size (kg)</Label>
              <Input
                id="standardBatch"
                type="number"
                step="0.1"
                value={configStandardBatch}
                onChange={(e) => setConfigStandardBatch(e.target.value)}
                placeholder="20"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Used to calculate suggested batch counts.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowConfigDialog(false)}>Cancel</Button>
              <Button 
                onClick={handleSaveConfig}
                disabled={upsertRoastGroupMutation.isPending}
              >
                {upsertRoastGroupMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
