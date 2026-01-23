import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Flame, Plus, Check, Edit2, Zap, Clock, Settings, Trash2 } from 'lucide-react';

interface RoastTabProps {
  dateFilter: string[];
  today: string;
}

type RoasterMachine = 'SAMIAC' | 'LORING';
type DefaultRoaster = 'SAMIAC' | 'LORING' | 'EITHER';
type RoasterFilter = 'ALL' | 'SAMIAC' | 'LORING' | 'UNASSIGNED';

interface RoastBatch {
  id: string;
  roast_group: string;
  target_date: string;
  planned_output_kg: number | null;
  actual_output_kg: number;
  status: 'PLANNED' | 'ROASTED';
  notes: string | null;
  assigned_roaster: RoasterMachine | null;
}

interface RoastGroupConfig {
  roast_group: string;
  standard_batch_kg: number;
  default_roaster: DefaultRoaster;
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
  const [assignedRoaster, setAssignedRoaster] = useState<RoasterMachine | ''>('');
  
  // Roaster filter
  const [roasterFilter, setRoasterFilter] = useState<RoasterFilter>('ALL');
  
  // Roast group config dialog
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [configRoastGroup, setConfigRoastGroup] = useState<string>('');
  const [configStandardBatch, setConfigStandardBatch] = useState<string>('20');
  const [configDefaultRoaster, setConfigDefaultRoaster] = useState<DefaultRoaster>('EITHER');

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

  // Map roast group to config
  const configByGroup = useMemo(() => {
    const map: Record<string, RoastGroupConfig> = {};
    for (const rg of roastGroupsConfig ?? []) {
      map[rg.roast_group] = rg;
    }
    return map;
  }, [roastGroupsConfig]);

  // Fetch products with roast_group (only active)
  const { data: products } = useQuery({
    queryKey: ['products-with-roast-group'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, roast_group, bag_size_g')
        .eq('is_active', true)
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

  // Helper to check if a roast group matches the roaster filter
  const groupMatchesRoasterFilter = (roastGroup: string): boolean => {
    if (roasterFilter === 'ALL') return true;
    
    const config = configByGroup[roastGroup];
    const defaultRoaster = config?.default_roaster ?? 'EITHER';
    const groupBatches = batchesByGroup[roastGroup] ?? [];
    
    if (roasterFilter === 'UNASSIGNED') {
      // Show if default_roaster is EITHER or any batch is unassigned
      if (defaultRoaster === 'EITHER') return true;
      return groupBatches.some(b => b.assigned_roaster === null);
    }
    
    // SAMIAC or LORING filter
    if (defaultRoaster === roasterFilter) return true;
    return groupBatches.some(b => b.assigned_roaster === roasterFilter);
  };

  // Filter batches within a group based on roaster filter
  const filterBatchesByRoaster = (groupBatches: RoastBatch[]): RoastBatch[] => {
    if (roasterFilter === 'ALL') return groupBatches;
    
    if (roasterFilter === 'UNASSIGNED') {
      return groupBatches.filter(b => b.assigned_roaster === null);
    }
    
    // SAMIAC or LORING - show assigned to that roaster OR unassigned (they might use it)
    return groupBatches.filter(b => b.assigned_roaster === roasterFilter || b.assigned_roaster === null);
  };

  // Filtered demand groups
  const filteredDemandByRoastGroup = useMemo(() => {
    return demandByRoastGroup.filter(group => groupMatchesRoasterFilter(group.roast_group));
  }, [demandByRoastGroup, roasterFilter, configByGroup, batchesByGroup]);

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
          assigned_roaster: assignedRoaster || null,
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

  // Create multiple suggested batches at once with default roaster
  const createSuggestedBatchesMutation = useMutation({
    mutationFn: async ({ roastGroup, count, batchKg, defaultRoaster }: { roastGroup: string; count: number; batchKg: number; defaultRoaster: DefaultRoaster }) => {
      // Determine assigned_roaster based on default_roaster
      let roaster: RoasterMachine | null = null;
      if (defaultRoaster === 'SAMIAC') {
        roaster = 'SAMIAC';
      } else if (defaultRoaster === 'LORING') {
        roaster = 'LORING';
      }
      // If 'EITHER', leave as null
      
      const batchesToInsert = Array.from({ length: count }, () => ({
        roast_group: roastGroup,
        target_date: today,
        planned_output_kg: batchKg,
        actual_output_kg: 0,
        status: 'PLANNED' as const,
        assigned_roaster: roaster,
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
    mutationFn: async ({ id, status, actual_output_kg, notes, assigned_roaster }: { 
      id: string; 
      status: 'PLANNED' | 'ROASTED'; 
      actual_output_kg: number; 
      notes: string | null;
      assigned_roaster: RoasterMachine | null;
    }) => {
      const { error } = await supabase
        .from('roasted_batches')
        .update({ status, actual_output_kg, notes, assigned_roaster })
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

  // Quick update roaster inline
  const quickUpdateRoasterMutation = useMutation({
    mutationFn: async ({ id, assigned_roaster }: { id: string; assigned_roaster: RoasterMachine | null }) => {
      const { error } = await supabase
        .from('roasted_batches')
        .update({ assigned_roaster })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update roaster');
    },
  });

  // Delete a PLANNED batch
  const deleteBatchMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('roasted_batches')
        .delete()
        .eq('id', id)
        .eq('status', 'PLANNED'); // Only allow deleting PLANNED batches
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Batch deleted');
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to delete batch');
    },
  });
  const upsertRoastGroupMutation = useMutation({
    mutationFn: async ({ roastGroup, standardBatchKg, defaultRoaster }: { roastGroup: string; standardBatchKg: number; defaultRoaster: DefaultRoaster }) => {
      const { error } = await supabase
        .from('roast_groups')
        .upsert({
          roast_group: roastGroup,
          standard_batch_kg: standardBatchKg,
          default_roaster: defaultRoaster,
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

  const openNewBatch = (roastGroup: string, suggestedKg?: number, defaultRoaster?: DefaultRoaster) => {
    setEditingBatch(null);
    setSelectedRoastGroup(roastGroup);
    setPlannedKg(suggestedKg?.toFixed(2) ?? '');
    setActualKg('');
    setNotes('');
    // Set roaster based on default
    if (defaultRoaster === 'SAMIAC') {
      setAssignedRoaster('SAMIAC');
    } else if (defaultRoaster === 'LORING') {
      setAssignedRoaster('LORING');
    } else {
      setAssignedRoaster('');
    }
    setShowBatchDialog(true);
  };

  const openEditBatch = (batch: RoastBatch) => {
    setEditingBatch(batch);
    setSelectedRoastGroup(batch.roast_group);
    setPlannedKg(batch.planned_output_kg?.toString() ?? '');
    setActualKg(batch.actual_output_kg.toString());
    setNotes(batch.notes ?? '');
    setAssignedRoaster(batch.assigned_roaster ?? '');
    setShowBatchDialog(true);
  };

  const closeBatchDialog = () => {
    setShowBatchDialog(false);
    setEditingBatch(null);
    setSelectedRoastGroup('');
    setPlannedKg('');
    setActualKg('');
    setNotes('');
    setAssignedRoaster('');
  };

  const openConfigDialog = (roastGroup: string) => {
    const config = configByGroup[roastGroup];
    setConfigRoastGroup(roastGroup);
    setConfigStandardBatch((config?.standard_batch_kg ?? 20).toString());
    setConfigDefaultRoaster(config?.default_roaster ?? 'EITHER');
    setShowConfigDialog(true);
  };

  const handleSaveBatch = () => {
    if (editingBatch) {
      updateBatchMutation.mutate({
        id: editingBatch.id,
        status: editingBatch.status,
        actual_output_kg: parseFloat(actualKg) || 0,
        notes: notes || null,
        assigned_roaster: assignedRoaster || null,
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
      assigned_roaster: assignedRoaster || null,
    });
  };

  const handleCreateSuggestedBatches = (roastGroup: string, demandKg: number) => {
    const config = configByGroup[roastGroup];
    const standardBatch = config?.standard_batch_kg ?? 20;
    const defaultRoaster = config?.default_roaster ?? 'EITHER';
    
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
      defaultRoaster,
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
      defaultRoaster: configDefaultRoaster,
    });
  };

  const getRoasterBadgeColor = (roaster: RoasterMachine | null) => {
    if (roaster === 'SAMIAC') return 'bg-blue-100 text-blue-800 border-blue-300';
    if (roaster === 'LORING') return 'bg-orange-100 text-orange-800 border-orange-300';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-5 w-5" />
                Roast Plan
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Plan batches based on demand and standard batch sizes. Assign roasters. Urgent orders shown first.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filter:</span>
              <ToggleGroup 
                type="single" 
                value={roasterFilter} 
                onValueChange={(val) => val && setRoasterFilter(val as RoasterFilter)}
                className="border rounded-md"
              >
                <ToggleGroupItem value="ALL" aria-label="All roasters" className="text-xs px-3">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem value="SAMIAC" aria-label="Samiac only" className="text-xs px-3 data-[state=on]:bg-blue-100 data-[state=on]:text-blue-800">
                  Samiac
                </ToggleGroupItem>
                <ToggleGroupItem value="LORING" aria-label="Loring only" className="text-xs px-3 data-[state=on]:bg-orange-100 data-[state=on]:text-orange-800">
                  Loring
                </ToggleGroupItem>
                <ToggleGroupItem value="UNASSIGNED" aria-label="Unassigned" className="text-xs px-3">
                  Unassigned
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredDemandByRoastGroup.length === 0 && allRoastGroups.length === 0 ? (
            <p className="text-muted-foreground py-4">
              No products have roast_group assigned. Edit products to set roast groups.
            </p>
          ) : filteredDemandByRoastGroup.length === 0 && roasterFilter !== 'ALL' ? (
            <p className="text-muted-foreground py-4">
              No roast groups match the "{roasterFilter}" filter. Try selecting "All".
            </p>
          ) : (
            <div className="space-y-6">
              {/* Roast groups with demand */}
              {filteredDemandByRoastGroup.map((group) => {
                const groupBatches = batchesByGroup[group.roast_group] ?? [];
                const filteredBatches = filterBatchesByRoaster(groupBatches);
                const plannedBatches = groupBatches.filter(b => b.status === 'PLANNED');
                const plannedTotal = plannedBatches.reduce((sum, b) => sum + (b.planned_output_kg ?? 0), 0);
                const roastedTotal = roastedInventory[group.roast_group] ?? 0;
                const config = configByGroup[group.roast_group];
                const standardBatch = config?.standard_batch_kg ?? 20;
                const defaultRoaster = config?.default_roaster ?? 'EITHER';
                const hasConfig = group.roast_group in configByGroup;
                
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
                          {defaultRoaster !== 'EITHER' && (
                            <Badge variant="outline" className={`text-xs ${getRoasterBadgeColor(defaultRoaster as RoasterMachine)}`}>
                              {defaultRoaster}
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
                            No config set. Click ⚙ to set standard batch size and roaster.
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
                          {defaultRoaster !== 'EITHER' && ` (${defaultRoaster})`}
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
                    {filteredBatches.length > 0 && (
                      <div className="space-y-2">
                        {filteredBatches.map((batch) => (
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
                            <div className="flex items-center gap-2">
                              {/* Inline roaster selector */}
                              <Select
                                value={batch.assigned_roaster ?? 'UNASSIGNED'}
                                onValueChange={(val) => {
                                  quickUpdateRoasterMutation.mutate({
                                    id: batch.id,
                                    assigned_roaster: val === 'UNASSIGNED' ? null : val as RoasterMachine,
                                  });
                                }}
                              >
                                <SelectTrigger className={`h-7 w-24 text-xs ${getRoasterBadgeColor(batch.assigned_roaster)}`}>
                                  <SelectValue placeholder="Roaster" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                                  <SelectItem value="SAMIAC">SAMIAC</SelectItem>
                                  <SelectItem value="LORING">LORING</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button size="sm" variant="ghost" onClick={() => openEditBatch(batch)}>
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              {batch.status === 'PLANNED' && (
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => deleteBatchMutation.mutate(batch.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Manual add batch button */}
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="mt-2 text-muted-foreground"
                      onClick={() => openNewBatch(group.roast_group, standardBatch, defaultRoaster)}
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
                .filter((g) => groupMatchesRoasterFilter(g))
                .map((roastGroup) => {
                  const groupBatches = batchesByGroup[roastGroup] ?? [];
                  const filteredBatches = filterBatchesByRoaster(groupBatches);
                  const roastedTotal = roastedInventory[roastGroup] ?? 0;
                  const config = configByGroup[roastGroup];
                  const defaultRoaster = config?.default_roaster ?? 'EITHER';
                  
                  if (filteredBatches.length === 0 && roasterFilter !== 'ALL') return null;
                  
                  return (
                    <div key={roastGroup} className="border rounded-lg p-4 opacity-70">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg">{roastGroup}</h3>
                          {defaultRoaster !== 'EITHER' && (
                            <Badge variant="outline" className={`text-xs ${getRoasterBadgeColor(defaultRoaster as RoasterMachine)}`}>
                              {defaultRoaster}
                            </Badge>
                          )}
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
                      {filteredBatches.length > 0 && (
                        <div className="space-y-2">
                          {filteredBatches.map((batch) => (
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
                              <div className="flex items-center gap-2">
                                <Select
                                  value={batch.assigned_roaster ?? 'UNASSIGNED'}
                                  onValueChange={(val) => {
                                    quickUpdateRoasterMutation.mutate({
                                      id: batch.id,
                                      assigned_roaster: val === 'UNASSIGNED' ? null : val as RoasterMachine,
                                    });
                                  }}
                                >
                                  <SelectTrigger className={`h-7 w-24 text-xs ${getRoasterBadgeColor(batch.assigned_roaster)}`}>
                                    <SelectValue placeholder="Roaster" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                                    <SelectItem value="SAMIAC">SAMIAC</SelectItem>
                                    <SelectItem value="LORING">LORING</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button size="sm" variant="ghost" onClick={() => openEditBatch(batch)}>
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                {batch.status === 'PLANNED' && (
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => deleteBatchMutation.mutate(batch.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
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
            <div>
              <Label htmlFor="assignedRoaster">Assigned Roaster</Label>
              <Select
                value={assignedRoaster || 'UNASSIGNED'}
                onValueChange={(val) => setAssignedRoaster(val === 'UNASSIGNED' ? '' : val as RoasterMachine)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select roaster" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                  <SelectItem value="SAMIAC">SAMIAC</SelectItem>
                  <SelectItem value="LORING">LORING</SelectItem>
                </SelectContent>
              </Select>
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
            <div>
              <Label htmlFor="defaultRoaster">Default Roaster</Label>
              <Select
                value={configDefaultRoaster}
                onValueChange={(val) => setConfigDefaultRoaster(val as DefaultRoaster)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EITHER">Either (no default)</SelectItem>
                  <SelectItem value="SAMIAC">SAMIAC</SelectItem>
                  <SelectItem value="LORING">LORING</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Pre-assigns roaster when creating planned batches.
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
