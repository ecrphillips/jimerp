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
import { Flame, Plus, Check, Zap, Clock, Settings, Sparkles, Package, Layers } from 'lucide-react';
import { RoastGroupDrawer } from './RoastGroupDrawer';
import { WipFgAdjustModal } from './WipFgAdjustModal';
import { PlanBlendBatchesModal } from './PlanBlendBatchesModal';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { DateFilterConfig } from './types';
// Use AUTHORITATIVE inventory hooks - computed from source-of-truth tables
import { useAuthoritativeWip, useAuthoritativeRoastDemand } from '@/hooks/useAuthoritativeInventory';
import { AuthoritativeSummaryPanel } from './AuthoritativeTotals';

interface RoastTabProps {
  dateFilterConfig: DateFilterConfig;
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
  is_blend: boolean;
  notes: string | null;
  display_order: number | null;
  display_name: string | null;
}

interface DemandByRoastGroup {
  roast_group: string;
  total_kg: number;
  net_demand_kg: number; // total_kg - wip_kg - fg_kg
  wip_kg: number;
  fg_kg: number;
  products: { name: string; kg: number }[];
  hasTimeSensitive: boolean;
  earliestShipDate: string | null;
}

export function RoastTab({ dateFilterConfig, today }: RoastTabProps) {
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
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  const lastEditTimeRef = useRef<number>(0);
  
  // Auto-prioritize confirmation dialog
  const [showAutoPrioritizeConfirm, setShowAutoPrioritizeConfirm] = useState(false);
  
  // WIP/FG adjustment modal state
  const [wipFgModalGroup, setWipFgModalGroup] = useState<string | null>(null);
  
  // Blend planning modal state
  const [blendPlanModal, setBlendPlanModal] = useState<{
    roastGroup: string;
    displayName: string;
    demandKg: number;
    netDemandKg: number;
  } | null>(null);
  const { data: roastGroupsConfig } = useQuery({
    queryKey: ['roast-groups-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('roast_group', { ascending: true });
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
  // NOW FILTERS BY work_deadline instead of requested_ship_date
  const { data: orderLineItems } = useQuery({
    queryKey: ['roast-demand', dateFilterConfig],
    queryFn: async () => {
      let query = supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order:orders!inner(id, status, work_deadline, manually_deprioritized),
          product:products(id, product_name, roast_group, bag_size_g)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);
      
      // Apply date filter based on mode - using work_deadline with 13:00 rule
      if (dateFilterConfig.mode === 'today') {
        // TODAY: work_deadline <= tomorrow at 13:00
        query = query.lte('order.work_deadline', dateFilterConfig.maxDate);
      } else if (dateFilterConfig.mode === 'tomorrow') {
        // TOMORROW: (work_deadline > tomorrow 13:00 AND <= day after tomorrow 13:00) OR manually_deprioritized
        query = query.or(
          `and(work_deadline.gt.${dateFilterConfig.minDate},work_deadline.lte.${dateFilterConfig.maxDate}),manually_deprioritized.eq.true`, 
          { referencedTable: 'orders' }
        );
      }
      // ALL mode: no date filter
      
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch production checkmarks for TIME_SENSITIVE priority
  const { data: checkmarks } = useQuery({
    queryKey: ['production-checkmarks-for-roast', dateFilterConfig],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checkmarks')
        .select('product_id, ship_priority');
      
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
    queryKey: ['roasted-batches', dateFilterConfig],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return (data ?? []) as RoastBatch[];
    },
  });

  // ========== AUTHORITATIVE INVENTORY (from source-of-truth tables) ==========
  // WIP = sum(roasted_batches.actual_output_kg) - sum(packing_runs.kg_consumed)
  const { data: authWip } = useAuthoritativeWip();
  const { data: authRoastDemand } = useAuthoritativeRoastDemand();

  // Map roast_group to authoritative inventory levels (replaces cached levels table)
  const inventoryLevelsByGroup = useMemo(() => {
    const map: Record<string, { wip_kg: number; fg_kg: number }> = {};
    for (const [rg, data] of Object.entries(authWip ?? {})) {
      map[rg] = {
        wip_kg: data.wip_available_kg,
        fg_kg: 0, // FG is tracked per-product, not per-roast-group directly
      };
    }
    // Merge in FG from authRoastDemand if available
    for (const [rg, data] of Object.entries(authRoastDemand ?? {})) {
      if (!map[rg]) {
        map[rg] = { wip_kg: 0, fg_kg: 0 };
      }
      map[rg].fg_kg = data.fg_unallocated_kg;
    }
    return map;
  }, [authWip, authRoastDemand]);

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
      const workDeadline = li.order?.work_deadline ?? null;
      
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
      
      if (workDeadline && (!groupMap[roastGroup].earliestShipDate || workDeadline < groupMap[roastGroup].earliestShipDate)) {
        groupMap[roastGroup].earliestShipDate = workDeadline;
      }
      
      const productName = li.product?.product_name ?? 'Unknown';
      const existing = groupMap[roastGroup].products.get(productName) ?? 0;
      groupMap[roastGroup].products.set(productName, existing + kgForLine);
    }

    return Object.entries(groupMap).map(([roast_group, data]) => {
      const wip_kg = inventoryLevelsByGroup[roast_group]?.wip_kg ?? 0;
      const fg_kg = inventoryLevelsByGroup[roast_group]?.fg_kg ?? 0;
      const net_demand_kg = Math.max(0, data.total_kg - wip_kg - fg_kg);
      
      return {
        roast_group,
        total_kg: data.total_kg,
        net_demand_kg,
        wip_kg,
        fg_kg,
        products: Array.from(data.products.entries()).map(([name, kg]) => ({ name, kg })),
        hasTimeSensitive: data.hasTimeSensitive,
        earliestShipDate: data.earliestShipDate,
      };
    });
  }, [orderLineItems, timeSensitiveProducts, inventoryLevelsByGroup]);

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

  // Computed sorted groups - use display_order from config (manual ordering only)
  // NO automatic reprioritization - order is strictly user-controlled
  const computedSortedGroups = useMemo(() => {
    const filtered = demandByRoastGroup.filter(group => groupMatchesRoasterFilter(group.roast_group));
    
    // Sort ONLY by display_order (manual), then by name as tie-breaker
    return [...filtered].sort((a, b) => {
      const configA = configByGroup[a.roast_group];
      const configB = configByGroup[b.roast_group];
      const orderA = configA?.display_order ?? 999999;
      const orderB = configB?.display_order ?? 999999;
      
      if (orderA !== orderB) return orderA - orderB;
      return a.roast_group.localeCompare(b.roast_group);
    });
  }, [demandByRoastGroup, roasterFilter, configByGroup]);

  // Handle editing state changes from drawer - freeze order by roast_group names
  const handleEditingChange = useCallback((groupId: string, isEditing: boolean) => {
    if (isEditing) {
      // Freeze the current order when editing starts
      if (!editingGroupId) {
        setFrozenOrder(computedSortedGroups.map(g => g.roast_group));
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
      // Return groups in frozen order but with updated demand data
      return frozenOrder
        .map(groupName => demandByRoastGroup.find(g => g.roast_group === groupName))
        .filter((g): g is DemandByRoastGroup => g !== undefined)
        .filter(g => groupMatchesRoasterFilter(g.roast_group));
    }
    return computedSortedGroups;
  }, [editingGroupId, frozenOrder, computedSortedGroups, demandByRoastGroup, groupMatchesRoasterFilter]);

  // Manual ordering mutations
  const updateDisplayOrderMutation = useMutation({
    mutationFn: async ({ roastGroup, newOrder }: { roastGroup: string; newOrder: number }) => {
      const { error } = await supabase
        .from('roast_groups')
        .update({ display_order: newOrder })
        .eq('roast_group', roastGroup);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roast-groups-config'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update order');
    },
  });

  // Handle drag end for reordering
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;
    
    const oldIndex = sortedGroups.findIndex(g => g.roast_group === active.id);
    const newIndex = sortedGroups.findIndex(g => g.roast_group === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;
    
    // Calculate new display_order values - reindex all groups
    const reorderedGroups = [...sortedGroups];
    const [movedGroup] = reorderedGroups.splice(oldIndex, 1);
    reorderedGroups.splice(newIndex, 0, movedGroup);
    
    // Update all groups with new display_order
    reorderedGroups.forEach((group, index) => {
      updateDisplayOrderMutation.mutate({ roastGroup: group.roast_group, newOrder: (index + 1) * 10 });
    });
  }, [sortedGroups, updateDisplayOrderMutation]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Auto-prioritize: reorder based on urgency
  const autoPrioritizeMutation = useMutation({
    mutationFn: async () => {
      // Calculate priority order: TIME_SENSITIVE first, then earliest ship date, then shortage
      const prioritized = [...demandByRoastGroup].sort((a, b) => {
        if (a.hasTimeSensitive !== b.hasTimeSensitive) {
          return a.hasTimeSensitive ? -1 : 1;
        }
        if (a.earliestShipDate !== b.earliestShipDate) {
          if (!a.earliestShipDate) return 1;
          if (!b.earliestShipDate) return -1;
          return a.earliestShipDate.localeCompare(b.earliestShipDate);
        }
        return b.total_kg - a.total_kg; // Higher demand = higher priority
      });
      
      // Update display_order for all groups
      for (let i = 0; i < prioritized.length; i++) {
        const { error } = await supabase
          .from('roast_groups')
          .update({ display_order: (i + 1) * 10 })
          .eq('roast_group', prioritized[i].roast_group);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Roast groups reordered by urgency');
      queryClient.invalidateQueries({ queryKey: ['roast-groups-config'] });
      setShowAutoPrioritizeConfirm(false);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to auto-prioritize');
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

  const upsertRoastGroupMutation = useMutation({
    mutationFn: async ({ roastGroup, standardBatchKg, defaultRoaster, expectedYieldLossPct }: { 
      roastGroup: string; 
      standardBatchKg: number; 
      defaultRoaster: DefaultRoaster;
      expectedYieldLossPct: number;
    }) => {
      // First check if group exists to get its code, or generate a new one
      const { data: existing } = await supabase
        .from('roast_groups')
        .select('roast_group_code')
        .eq('roast_group', roastGroup)
        .single();
      
      const roastGroupCode = existing?.roast_group_code ?? 
        roastGroup.replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase();
      
      // Get existing display_name or generate one
      const { data: existingGroup } = await supabase
        .from('roast_groups')
        .select('display_name')
        .eq('roast_group', roastGroup)
        .single();
      
      const displayName = existingGroup?.display_name ?? roastGroup.replace(/_/g, ' ');
      
      const { error } = await supabase
        .from('roast_groups')
        .upsert({
          roast_group: roastGroup,
          roast_group_code: roastGroupCode,
          display_name: displayName,
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
      {/* Authoritative Totals Summary */}
      <AuthoritativeSummaryPanel tab="roast" />
      
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Flame className="h-5 w-5" />
                Roast Plan
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Drag the grip handle to reorder groups manually. Order persists across sessions.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Auto-prioritize button hidden for MVP - manual ordering only */}
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
          ) : sortedGroups.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-lg font-medium text-foreground mb-1">All caught up!</p>
              <p className="text-muted-foreground text-sm">
                {dateFilterConfig.mode === 'today' 
                  ? "No roast demand for today. Check 'Tomorrow' or 'All' for future demand."
                  : dateFilterConfig.mode === 'tomorrow'
                    ? "No roast demand for tomorrow. Check 'All' for future demand."
                    : "No roast demand across all dates."}
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedGroups.map(g => g.roast_group)}
                strategy={verticalListSortingStrategy}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 w-8"></th>
                      <th className="pb-2 w-10"></th>
                      <th className="pb-2">Roast Group</th>
                      <th className="pb-2 text-right">Demand</th>
                      <th className="pb-2 text-right">Planned</th>
                      <th className="pb-2 text-right">Roasted</th>
                      <th className="pb-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGroups.map((group, index) => {
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
                            netDemandKg={group.net_demand_kg}
                            wipKg={group.wip_kg}
                            fgKg={group.fg_kg}
                            hasTimeSensitive={group.hasTimeSensitive}
                            batches={groupBatches}
                            config={config}
                            roastedTotal={roastedTotal}
                            today={today}
                            allRoastGroups={allRoastGroups}
                            onOpenConfig={openConfigDialog}
                            onEditingChange={(isEditing) => handleEditingChange(group.roast_group, isEditing)}
                            onAdjustWipFg={(rg) => setWipFgModalGroup(rg)}
                            isBlend={config?.is_blend ?? false}
                            onPlanBlendBatches={() => setBlendPlanModal({
                              roastGroup: group.roast_group,
                              displayName: config?.display_name?.trim() || group.roast_group.replace(/_/g, ' '),
                              demandKg: group.total_kg,
                              netDemandKg: group.net_demand_kg,
                            })}
                          />
                          
                          {/* Quick batch suggestion row (shown below collapsed row if there's demand and no batches visible) */}
                          {suggestedBatches > 0 && !hasConfig && (
                            <tr className="bg-muted/30">
                              <td colSpan={7} className="py-2 px-4 pl-10 text-sm">
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
                      const remainingNeed = Math.max(0, g.total_kg - roastedTotal - plannedExpectedOutput);
                      return remainingNeed > 0;
                    }) && (
                      <tr className="bg-primary/5 border-t-2 border-primary/20">
                        <td colSpan={7} className="py-3 px-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-primary mr-2">Quick add batches:</span>
                            {sortedGroups.map(g => {
                              const config = configByGroup[g.roast_group];
                              if (!config) return null;
                              const groupBatches = batchesByGroup[g.roast_group] ?? [];
                              const yieldLossPct = config.expected_yield_loss_pct ?? 16;
                              const plannedExpectedOutput = groupBatches
                                .filter(b => b.status === 'PLANNED')
                                .reduce((sum, b) => sum + (b.planned_output_kg ?? 0) * (1 - yieldLossPct / 100), 0);
                              const roastedTotal = roastedInventory[g.roast_group] ?? 0;
                              const remainingNeed = Math.max(0, g.total_kg - roastedTotal - plannedExpectedOutput);
                              const expectedOutputPerBatch = config.standard_batch_kg * (1 - yieldLossPct / 100);
                              const suggestedBatches = remainingNeed > 0 ? Math.ceil(remainingNeed / expectedOutputPerBatch) : 0;
                              
                              if (suggestedBatches === 0) return null;
                              
                              return (
                                <Button
                                  key={g.roast_group}
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => handleCreateSuggestedBatches(g.roast_group, g.total_kg)}
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
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* Completed Batches - roast groups without current demand but with batches */}
      {allRoastGroups
        .filter((g) => !demandByRoastGroup.find((d) => d.roast_group === g))
        .filter((g) => batchesByGroup[g]?.length > 0)
        .filter((g) => groupMatchesRoasterFilter(g))
        .length > 0 && (
        <Card className="opacity-70">
          <CardHeader>
            <CardTitle className="text-base">Completed Batches</CardTitle>
            <p className="text-sm text-muted-foreground">
              Roast groups with completed batches but no current demand.
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
                        netDemandKg={0}
                        wipKg={inventoryLevelsByGroup[roastGroup]?.wip_kg ?? 0}
                        fgKg={inventoryLevelsByGroup[roastGroup]?.fg_kg ?? 0}
                        hasTimeSensitive={false}
                        batches={groupBatches}
                        config={config}
                        roastedTotal={roastedTotal}
                        today={today}
                        allRoastGroups={allRoastGroups}
                        onOpenConfig={openConfigDialog}
                        onEditingChange={(isEditing) => handleEditingChange(roastGroup, isEditing)}
                        onAdjustWipFg={(rg) => setWipFgModalGroup(rg)}
                        isBlend={config?.is_blend ?? false}
                        onPlanBlendBatches={() => setBlendPlanModal({
                          roastGroup: roastGroup,
                          displayName: config?.display_name?.trim() || roastGroup.replace(/_/g, ' '),
                          demandKg: 0,
                          netDemandKg: 0,
                        })}
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

      {/* Auto-prioritize Confirmation Dialog */}
      <AlertDialog open={showAutoPrioritizeConfirm} onOpenChange={setShowAutoPrioritizeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Auto-prioritize Roast Groups?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will reorder all roast groups based on urgency: TIME_SENSITIVE orders first, 
              then earliest ship date, then highest demand. Your manual ordering will be replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => autoPrioritizeMutation.mutate()}
              disabled={autoPrioritizeMutation.isPending}
            >
              {autoPrioritizeMutation.isPending ? 'Reordering…' : 'Reorder by Urgency'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* WIP/FG Adjustment Modal */}
      {wipFgModalGroup && (
        <WipFgAdjustModal
          open={!!wipFgModalGroup}
          onOpenChange={(open) => !open && setWipFgModalGroup(null)}
          roastGroup={wipFgModalGroup}
          currentWipKg={inventoryLevelsByGroup[wipFgModalGroup]?.wip_kg ?? 0}
          currentFgKg={inventoryLevelsByGroup[wipFgModalGroup]?.fg_kg ?? 0}
        />
      )}
      
      {/* Blend Planning Modal */}
      {blendPlanModal && (
        <PlanBlendBatchesModal
          open={!!blendPlanModal}
          onOpenChange={(open) => !open && setBlendPlanModal(null)}
          blendRoastGroup={blendPlanModal.roastGroup}
          blendDisplayName={blendPlanModal.displayName}
          blendDemandKg={blendPlanModal.demandKg}
          blendNetDemandKg={blendPlanModal.netDemandKg}
          today={today}
        />
      )}
    </div>
  );
}
