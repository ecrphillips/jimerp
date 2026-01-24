import React, { useState, useMemo, useCallback, useRef } from 'react';
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
import { Flame, Plus, Check, Zap, Clock, Settings } from 'lucide-react';
import { RoastGroupDrawer } from './RoastGroupDrawer';

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
  cropster_batch_id: string | null;
  created_at?: string;
  updated_at?: string;
}

interface RoastGroupConfig {
  roast_group: string;
  standard_batch_kg: number;
  default_roaster: DefaultRoaster;
  expected_yield_loss_pct: number;
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
  
  // Roaster filter
  const [roasterFilter, setRoasterFilter] = useState<RoasterFilter>('ALL');
  
  // Roast group config dialog
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [configRoastGroup, setConfigRoastGroup] = useState<string>('');
  const [configStandardBatch, setConfigStandardBatch] = useState<string>('20');
  const [configDefaultRoaster, setConfigDefaultRoaster] = useState<DefaultRoaster>('EITHER');
  const [configYieldLoss, setConfigYieldLoss] = useState<string>('16');

  // Sort-freeze state for drawer editing
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [frozenOrder, setFrozenOrder] = useState<DemandByRoastGroup[] | null>(null);
  const lastEditTimeRef = useRef<number>(0);

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

  // Computed sorted groups (for freeze logic) - fully roasted groups move to bottom
  const computedSortedGroups = useMemo(() => {
    const filtered = demandByRoastGroup.filter(group => groupMatchesRoasterFilter(group.roast_group));
    
    // Sort: groups with PLANNED batches first, fully roasted (no PLANNED) last
    return [...filtered].sort((a, b) => {
      const aBatches = batchesByGroup[a.roast_group] ?? [];
      const bBatches = batchesByGroup[b.roast_group] ?? [];
      const aHasPlanned = aBatches.some(batch => batch.status === 'PLANNED');
      const bHasPlanned = bBatches.some(batch => batch.status === 'PLANNED');
      const aFullyRoasted = !aHasPlanned && aBatches.some(batch => batch.status === 'ROASTED');
      const bFullyRoasted = !bHasPlanned && bBatches.some(batch => batch.status === 'ROASTED');
      
      // Fully roasted groups go to the bottom
      if (aFullyRoasted && !bFullyRoasted) return 1;
      if (!aFullyRoasted && bFullyRoasted) return -1;
      
      // Then by TIME_SENSITIVE
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
  }, [demandByRoastGroup, roasterFilter, configByGroup, batchesByGroup]);

  // Handle editing state changes from drawer
  const handleEditingChange = useCallback((groupId: string, isEditing: boolean) => {
    if (isEditing) {
      // Freeze the current order when editing starts
      if (!editingGroupId) {
        setFrozenOrder(computedSortedGroups);
      }
      setEditingGroupId(groupId);
      lastEditTimeRef.current = Date.now();
    } else {
      // Only unfreeze if this is the group that was being edited
      if (editingGroupId === groupId) {
        setEditingGroupId(null);
        setFrozenOrder(null);
      }
    }
  }, [editingGroupId, computedSortedGroups]);

  // Use frozen order while editing, otherwise use computed sorted groups
  const sortedGroups = useMemo(() => {
    if (editingGroupId && frozenOrder) {
      // Return frozen order but with updated data (keep order, update values)
      return frozenOrder.map(frozen => {
        const updated = demandByRoastGroup.find(g => g.roast_group === frozen.roast_group);
        return updated ?? frozen;
      }).filter(g => demandByRoastGroup.some(d => d.roast_group === g.roast_group));
    }
    return computedSortedGroups;
  }, [editingGroupId, frozenOrder, computedSortedGroups, demandByRoastGroup]);

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

  const upsertRoastGroupMutation = useMutation({
    mutationFn: async ({ roastGroup, standardBatchKg, defaultRoaster, expectedYieldLossPct }: { 
      roastGroup: string; 
      standardBatchKg: number; 
      defaultRoaster: DefaultRoaster;
      expectedYieldLossPct: number;
    }) => {
      const { error } = await supabase
        .from('roast_groups')
        .upsert({
          roast_group: roastGroup,
          standard_batch_kg: standardBatchKg,
          default_roaster: defaultRoaster,
          expected_yield_loss_pct: expectedYieldLossPct,
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

  const openConfigDialog = (roastGroup: string) => {
    const config = configByGroup[roastGroup];
    setConfigRoastGroup(roastGroup);
    setConfigStandardBatch((config?.standard_batch_kg ?? 20).toString());
    setConfigDefaultRoaster(config?.default_roaster ?? 'EITHER');
    setConfigYieldLoss((config?.expected_yield_loss_pct ?? 16).toString());
    setShowConfigDialog(true);
  };

  const handleCreateSuggestedBatches = (roastGroup: string, demandKg: number) => {
    const config = configByGroup[roastGroup];
    const standardBatch = config?.standard_batch_kg ?? 20;
    const defaultRoaster = config?.default_roaster ?? 'EITHER';
    const yieldLossPct = config?.expected_yield_loss_pct ?? 16;
    
    // Calculate expected output from planned batches (applying yield loss)
    const plannedExpectedOutput = (batchesByGroup[roastGroup] ?? [])
      .filter(b => b.status === 'PLANNED')
      .reduce((sum, b) => {
        const inboundKg = b.planned_output_kg ?? 0;
        return sum + inboundKg * (1 - yieldLossPct / 100);
      }, 0);
    const roastedKg = roastedInventory[roastGroup] ?? 0;
    const remainingNeed = demandKg - roastedKg - plannedExpectedOutput;
    
    if (remainingNeed <= 0) {
      toast.info('No additional batches needed');
      return;
    }
    
    // Calculate how many batches needed based on expected output per batch
    const expectedOutputPerBatch = standardBatch * (1 - yieldLossPct / 100);
    const batchCount = Math.ceil(remainingNeed / expectedOutputPerBatch);
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
    const yieldLoss = parseFloat(configYieldLoss);
    if (isNaN(yieldLoss) || yieldLoss < 0 || yieldLoss > 100) {
      toast.error('Expected yield loss must be between 0 and 100');
      return;
    }
    upsertRoastGroupMutation.mutate({
      roastGroup: configRoastGroup,
      standardBatchKg: batchKg,
      defaultRoaster: configDefaultRoaster,
      expectedYieldLossPct: yieldLoss,
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
                Click a roast group to expand batch queue. Urgent orders shown first.
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
          {sortedGroups.length === 0 && allRoastGroups.length === 0 ? (
            <p className="text-muted-foreground py-4">
              No products have roast_group assigned. Edit products to set roast groups.
            </p>
          ) : sortedGroups.length === 0 && roasterFilter !== 'ALL' ? (
            <p className="text-muted-foreground py-4">
              No roast groups match the "{roasterFilter}" filter. Try selecting "All".
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 w-8"></th>
                  <th className="pb-2">Roast Group</th>
                  <th className="pb-2 text-right">Demand</th>
                  <th className="pb-2 text-right">Planned</th>
                  <th className="pb-2 text-right">Roasted</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedGroups.map((group) => {
                  const groupBatches = batchesByGroup[group.roast_group] ?? [];
                  const config = configByGroup[group.roast_group];
                  const roastedTotal = roastedInventory[group.roast_group] ?? 0;
                  const standardBatch = config?.standard_batch_kg ?? 20;
                  const defaultRoaster = config?.default_roaster ?? 'EITHER';
                  const hasConfig = group.roast_group in configByGroup;
                  
                  // Calculate suggestion for quick-add (using expected output)
                  const yieldLossPct = config?.expected_yield_loss_pct ?? 16;
                  const plannedExpectedOutput = groupBatches
                    .filter(b => b.status === 'PLANNED')
                    .reduce((sum, b) => {
                      const inboundKg = b.planned_output_kg ?? 0;
                      return sum + inboundKg * (1 - yieldLossPct / 100);
                    }, 0);
                  const remainingNeed = Math.max(0, group.total_kg - roastedTotal - plannedExpectedOutput);
                  const expectedOutputPerBatch = standardBatch * (1 - yieldLossPct / 100);
                  const suggestedBatches = remainingNeed > 0 ? Math.ceil(remainingNeed / expectedOutputPerBatch) : 0;
                  
                  return (
                    <React.Fragment key={group.roast_group}>
                      <RoastGroupDrawer
                        roastGroup={group.roast_group}
                        demandKg={group.total_kg}
                        hasTimeSensitive={group.hasTimeSensitive}
                        batches={groupBatches}
                        config={config}
                        roastedTotal={roastedTotal}
                        today={today}
                        allRoastGroups={allRoastGroups}
                        onOpenConfig={openConfigDialog}
                        onEditingChange={(isEditing) => handleEditingChange(group.roast_group, isEditing)}
                      />
                      
                      {/* Quick batch suggestion row (shown below collapsed row if there's demand and no batches visible) */}
                      {suggestedBatches > 0 && !hasConfig && (
                        <tr className="bg-muted/30">
                          <td colSpan={6} className="py-2 px-4 pl-10 text-sm">
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className="text-xs">
                                <Settings className="h-3 w-3 mr-1" />
                                No config
                              </Badge>
                              <span className="text-muted-foreground">
                                Set batch size to get suggestions
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs"
                                onClick={() => openConfigDialog(group.roast_group)}
                              >
                                Configure
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                
                {/* Quick-add batches section */}
                {sortedGroups.some(g => {
                  const config = configByGroup[g.roast_group];
                  if (!config) return false;
                  const groupBatches = batchesByGroup[g.roast_group] ?? [];
                  const yieldLossPct = config.expected_yield_loss_pct ?? 16;
                  const plannedExpectedOutput = groupBatches
                    .filter(b => b.status === 'PLANNED')
                    .reduce((sum, b) => sum + (b.planned_output_kg ?? 0) * (1 - yieldLossPct / 100), 0);
                  const roastedTotal = roastedInventory[g.roast_group] ?? 0;
                  const remainingNeed = g.total_kg - roastedTotal - plannedExpectedOutput;
                  return remainingNeed > 0;
                }) && (
                  <tr className="border-t bg-muted/20">
                    <td colSpan={6} className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Zap className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Quick add suggested batches:</span>
                        {sortedGroups.map(g => {
                          const config = configByGroup[g.roast_group];
                          if (!config) return null;
                          
                          const groupBatches = batchesByGroup[g.roast_group] ?? [];
                          const yieldLossPct = config.expected_yield_loss_pct ?? 16;
                          const plannedExpectedOutput = groupBatches
                            .filter(b => b.status === 'PLANNED')
                            .reduce((sum, b) => sum + (b.planned_output_kg ?? 0) * (1 - yieldLossPct / 100), 0);
                          const roastedTotal = roastedInventory[g.roast_group] ?? 0;
                          const remainingNeed = g.total_kg - roastedTotal - plannedExpectedOutput;
                          const expectedOutputPerBatch = config.standard_batch_kg * (1 - yieldLossPct / 100);
                          const suggestedBatches = remainingNeed > 0 ? Math.ceil(remainingNeed / expectedOutputPerBatch) : 0;
                          
                          if (suggestedBatches <= 0) return null;
                          
                          return (
                            <Button
                              key={g.roast_group}
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleCreateSuggestedBatches(g.roast_group, g.total_kg)}
                              disabled={createSuggestedBatchesMutation.isPending}
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              {g.roast_group} (+{suggestedBatches})
                            </Button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Roast groups without current demand but with batches */}
      {allRoastGroups
        .filter((g) => !demandByRoastGroup.find((d) => d.roast_group === g))
        .filter((g) => batchesByGroup[g]?.length > 0)
        .filter((g) => groupMatchesRoasterFilter(g))
        .length > 0 && (
        <Card className="opacity-70">
          <CardHeader>
            <CardTitle className="text-base">Groups Without Demand</CardTitle>
            <p className="text-sm text-muted-foreground">
              These roast groups have batches but no orders for the selected dates.
            </p>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 w-8"></th>
                  <th className="pb-2">Roast Group</th>
                  <th className="pb-2 text-right">Demand</th>
                  <th className="pb-2 text-right">Planned</th>
                  <th className="pb-2 text-right">Roasted</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {allRoastGroups
                  .filter((g) => !demandByRoastGroup.find((d) => d.roast_group === g))
                  .filter((g) => batchesByGroup[g]?.length > 0)
                  .filter((g) => groupMatchesRoasterFilter(g))
                  .map((roastGroup) => {
                    const groupBatches = batchesByGroup[roastGroup] ?? [];
                    const config = configByGroup[roastGroup];
                    const roastedTotal = roastedInventory[roastGroup] ?? 0;
                    
                    return (
                      <RoastGroupDrawer
                        key={roastGroup}
                        roastGroup={roastGroup}
                        demandKg={0}
                        hasTimeSensitive={false}
                        batches={groupBatches}
                        config={config}
                        roastedTotal={roastedTotal}
                        today={today}
                        allRoastGroups={allRoastGroups}
                        onOpenConfig={openConfigDialog}
                        onEditingChange={(isEditing) => handleEditingChange(roastGroup, isEditing)}
                      />
                    );
                  })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

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
            <div>
              <Label htmlFor="yieldLoss">Expected Yield Loss (%)</Label>
              <Input
                id="yieldLoss"
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={configYieldLoss}
                onChange={(e) => setConfigYieldLoss(e.target.value)}
                placeholder="16"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Typical roast shrinkage. Used to estimate output from inbound green kg.
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
