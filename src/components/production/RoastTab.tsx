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
import { Checkbox } from '@/components/ui/checkbox';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { createOrReuseRoastGroup } from '@/lib/roastGroupCreation';
import { PlanBlendBatchesModal } from './PlanBlendBatchesModal';
import { BlendExecuteModal } from './BlendExecuteModal';
import { DepletionWarningModal, executeDepletionSwaps, type DepletionSwap } from './DepletionWarningModal';
import { evaluateMultiRoastGroupImpacts, type MultiRgImpact } from '@/hooks/useGreenLotDepletion';
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
import { useRoastGroupComponents, getComponentBreakdown, type ComponentDisplay } from '@/hooks/useRoastGroupComponents';
import { AuthoritativeSummaryPanel } from './AuthoritativeTotals';
import { filterOrderByWorkStart } from '@/lib/productionScheduling';

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
  origin: string | null;
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
  isCompleted: boolean; // true if net_demand_kg === 0 but has activity (batches/WIP)
}

export function RoastTab({ dateFilterConfig, today }: RoastTabProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Roaster filter
  const [roasterFilter, setRoasterFilter] = useState<RoasterFilter>('ALL');
  
  // Show completed toggle - default ON so completed groups remain visible
  const [showCompleted, setShowCompleted] = useState(true);
  
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
  
  // Add batch modal state
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [addBatchRgKey, setAddBatchRgKey] = useState('');
  
  const [addBatchKg, setAddBatchKg] = useState('');
  const [addBatchRoaster, setAddBatchRoaster] = useState<'SAMIAC' | 'LORING' | ''>('');
  const [addBatchDate, setAddBatchDate] = useState(today);
  const [addBatchCropster, setAddBatchCropster] = useState('');
  const [addBatchMode, setAddBatchMode] = useState<'existing' | 'new'>('existing');
  const [addBatchSaving, setAddBatchSaving] = useState(false);
  const [addBatchNewName, setAddBatchNewName] = useState('');

  // Depletion warning modal state (Add Batch flow)
  const [depletionState, setDepletionState] = useState<{
    roastGroupKey: string;
    roastGroupDisplayName: string;
    impacts: MultiRgImpact[];
    pctByLinkId: Record<string, number | null>;
    proceedFn: (swaps: DepletionSwap[]) => Promise<void>;
  } | null>(null);
  const [depletionProceeding, setDepletionProceeding] = useState(false);
  
  // Blend planning modal state
  const [blendPlanModal, setBlendPlanModal] = useState<{
    roastGroup: string;
    displayName: string;
    demandKg: number;
    netDemandKg: number;
  } | null>(null);
  
  // Blend execution modal state (for executing the blend after component batches are roasted)
  const [blendExecuteModal, setBlendExecuteModal] = useState<{
    roastGroup: string;
    displayName: string;
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

  // Fetch roast group components (blend recipes)
  const { data: roastGroupComponents } = useRoastGroupComponents();

  // Create a map of roast_group -> { display_name, origin } for component display lookup
  const roastGroupsLookupMap = useMemo(() => {
    const map = new Map<string, { display_name: string | null; origin: string | null }>();
    for (const rg of roastGroupsConfig ?? []) {
      map.set(rg.roast_group, {
        display_name: rg.display_name ?? null,
        origin: (rg as any).origin ?? null,
      });
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
  // Fetch ship_picks to know what's already picked (allocated)
  // Picked items should NOT contribute to upstream demand (roast/pack)
  const { data: shipPicks } = useQuery({
    queryKey: ['roast-tab-ship-picks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ship_picks')
        .select('order_line_item_id, units_picked');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Map order_line_item_id to units_picked
  const picksByLineItemId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pick of shipPicks ?? []) {
      map[pick.order_line_item_id] = pick.units_picked;
    }
    return map;
  }, [shipPicks]);

  // Fetch ALL order line items for demand calculation
  // Filtering by work_start_at happens client-side for accurate production window logic
  // IMPORTANT: Uses work_deadline_at (timestamptz), NOT work_deadline (legacy text field)
  const { data: allOrderLineItems } = useQuery({
    queryKey: ['roast-demand-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order:orders!inner(id, status, work_deadline_at, manually_deprioritized),
          product:products(id, product_name, roast_group, bag_size_g)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);
      
      if (error) throw error;
      return data ?? [];
    },
  });
  
  // Client-side filter using work_start_at calculation
  // Uses work_deadline_at field for accurate timestamptz-based scheduling
  const orderLineItems = useMemo(() => {
    if (!allOrderLineItems) return [];
    if (dateFilterConfig.mode === 'all') return allOrderLineItems;
    
    return allOrderLineItems.filter(li => {
      const workDeadlineAt = li.order?.work_deadline_at ?? null;
      const manuallyDeprioritized = li.order?.manually_deprioritized ?? false;
      return filterOrderByWorkStart(workDeadlineAt, manuallyDeprioritized, dateFilterConfig.mode);
    });
  }, [allOrderLineItems, dateFilterConfig.mode]);

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
  // CRITICAL: Use REMAINING units (after picks) not total demanded units
  // Once an item is PICKED (allocated to a specific order), it should NOT contribute to upstream demand
  // 
  // ALSO: Include groups that have activity (batches, WIP) even if demand is now 0
  // This ensures completed work remains visible for editing/review
  const demandByRoastGroup = useMemo((): DemandByRoastGroup[] => {
    const groupMap: Record<string, { 
      total_kg: number; 
      products: Map<string, number>; 
      hasTimeSensitive: boolean;
      earliestShipDate: string | null;
    }> = {};

    // 1. Build demand from order line items (unpicked only)
    for (const li of orderLineItems ?? []) {
      const roastGroup = li.product?.roast_group;
      if (!roastGroup) continue;

      // Calculate remaining (unpicked) units - this is the actual demand on upstream production
      const pickedUnits = picksByLineItemId[li.id] ?? 0;
      const remainingUnits = Math.max(0, li.quantity_units - pickedUnits);
      
      // Skip line items that are fully picked - they have no upstream demand
      if (remainingUnits <= 0) continue;
      
      const kgForLine = (remainingUnits * (li.product?.bag_size_g ?? 0)) / 1000;
      const isTimeSensitive = timeSensitiveProducts.has(li.product_id);
      // Use work_deadline_at (timestamptz) for accurate scheduling
      const workDeadlineAt = li.order?.work_deadline_at ?? null;
      
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
      
      if (workDeadlineAt && (!groupMap[roastGroup].earliestShipDate || workDeadlineAt < groupMap[roastGroup].earliestShipDate)) {
        groupMap[roastGroup].earliestShipDate = workDeadlineAt;
      }
      
      const productName = li.product?.product_name ?? 'Unknown';
      const existing = groupMap[roastGroup].products.get(productName) ?? 0;
      groupMap[roastGroup].products.set(productName, existing + kgForLine);
    }

    // 2. Identify groups with ACTIVITY (batches or WIP) that may not have remaining demand
    // These should still appear on the run sheet for visibility and editing
    const groupsWithActivity = new Set<string>();
    
    // Groups with batches (planned or roasted)
    for (const b of batches ?? []) {
      groupsWithActivity.add(b.roast_group);
    }
    
    // Groups with WIP inventory
    for (const [rg, data] of Object.entries(authWip ?? {})) {
      if (data.wip_available_kg > 0 || data.roasted_completed_kg > 0 || data.packed_consumed_kg > 0) {
        groupsWithActivity.add(rg);
      }
    }
    
    // 3. Merge: ensure all groups with activity are represented
    for (const rg of groupsWithActivity) {
      if (!groupMap[rg]) {
        groupMap[rg] = {
          total_kg: 0,
          products: new Map(),
          hasTimeSensitive: false,
          earliestShipDate: null,
        };
      }
    }

    // 4. Build final array with isCompleted flag
    return Object.entries(groupMap).map(([roast_group, data]) => {
      const wip_kg = inventoryLevelsByGroup[roast_group]?.wip_kg ?? 0;
      const fg_kg = inventoryLevelsByGroup[roast_group]?.fg_kg ?? 0;
      const net_demand_kg = Math.max(0, data.total_kg - wip_kg - fg_kg);
      
      // A group is "completed" if it has no net demand but has some form of activity
      const hasActivity = groupsWithActivity.has(roast_group);
      const isCompleted = net_demand_kg === 0 && hasActivity;
      
      return {
        roast_group,
        total_kg: data.total_kg,
        net_demand_kg,
        wip_kg,
        fg_kg,
        products: Array.from(data.products.entries()).map(([name, kg]) => ({ name, kg })),
        hasTimeSensitive: data.hasTimeSensitive,
        earliestShipDate: data.earliestShipDate,
        isCompleted,
      };
    });
  }, [orderLineItems, timeSensitiveProducts, inventoryLevelsByGroup, picksByLineItemId, batches, authWip]);

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
  // Apply showCompleted filter: if OFF, hide groups with isCompleted=true
  const computedSortedGroups = useMemo(() => {
    let filtered = demandByRoastGroup.filter(group => groupMatchesRoasterFilter(group.roast_group));
    
    // Apply "show completed" filter
    if (!showCompleted) {
      filtered = filtered.filter(group => !group.isCompleted);
    }
    
    // Sort: active groups (with demand) first, then completed groups
    // Within each category, sort by display_order (manual), then by name
    return [...filtered].sort((a, b) => {
      // Active groups before completed groups
      if (a.isCompleted !== b.isCompleted) {
        return a.isCompleted ? 1 : -1;
      }
      
      const configA = configByGroup[a.roast_group];
      const configB = configByGroup[b.roast_group];
      const orderA = configA?.display_order ?? 999999;
      const orderB = configB?.display_order ?? 999999;
      
      if (orderA !== orderB) return orderA - orderB;
      return a.roast_group.localeCompare(b.roast_group);
    });
  }, [demandByRoastGroup, roasterFilter, configByGroup, showCompleted]);

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
    if (roaster === 'SAMIAC') return 'bg-yellow-200 text-red-700 border-yellow-400';
    if (roaster === 'LORING') return 'bg-sky-100 text-sky-800 border-sky-300';
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
            <div className="flex items-center gap-4 flex-wrap">
              {/* Show completed toggle */}
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="show-completed" 
                  checked={showCompleted} 
                  onCheckedChange={(checked) => setShowCompleted(checked === true)}
                />
                <Label htmlFor="show-completed" className="text-sm text-muted-foreground cursor-pointer">
                  Show completed
                </Label>
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
                  <ToggleGroupItem value="SAMIAC" aria-label="Samiac only" className="text-xs px-3 data-[state=on]:bg-yellow-200 data-[state=on]:text-red-700">
                    Samiac
                  </ToggleGroupItem>
                  <ToggleGroupItem value="LORING" aria-label="Loring only" className="text-xs px-3 data-[state=on]:bg-sky-100 data-[state=on]:text-sky-800">
                    Loring
                  </ToggleGroupItem>
                  <ToggleGroupItem value="UNASSIGNED" aria-label="Unassigned" className="text-xs px-3">
                    Unassigned
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              
              <Button variant="outline" size="sm" onClick={() => setShowAddBatchModal(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Batch
              </Button>
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
              <div className="text-4xl mb-3">☕</div>
              <p className="text-lg font-medium text-foreground mb-1">No roast demand right now</p>
              <p className="text-muted-foreground text-sm">
                {dateFilterConfig.mode === 'today' 
                  ? "Check 'Tomorrow' or 'All' for future orders, or enjoy being caught up!"
                  : dateFilterConfig.mode === 'tomorrow'
                    ? "Check 'All' for future orders, or enjoy being caught up!"
                    : "No roast demand across all dates — enjoy being caught up!"}
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
                            isCompleted={group.isCompleted}
                            onPlanBlendBatches={() => setBlendPlanModal({
                              roastGroup: group.roast_group,
                              displayName: config?.display_name?.trim() || group.roast_group.replace(/_/g, ' '),
                              demandKg: group.total_kg,
                              netDemandKg: group.net_demand_kg,
                            })}
                            onBlendBatches={() => setBlendExecuteModal({
                              roastGroup: group.roast_group,
                              displayName: config?.display_name?.trim() || group.roast_group.replace(/_/g, ' '),
                            })}
                            components={roastGroupComponents ?? []}
                            roastGroupsLookupMap={roastGroupsLookupMap}
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

      {/* Completed Batches - roast groups with ROASTED batches but no current demand */}
      {(() => {
        // Only include roast groups that have at least one ROASTED batch
        const completedGroups = allRoastGroups
          .filter((g) => !demandByRoastGroup.find((d) => d.roast_group === g))
          .filter((g) => (batchesByGroup[g] ?? []).some(b => b.status === 'ROASTED'))
          .filter((g) => groupMatchesRoasterFilter(g));
        
        if (completedGroups.length === 0) return null;
        
        return (
          <Card className="opacity-70">
            <CardHeader>
              <CardTitle className="text-base">Completed Batches</CardTitle>
              <p className="text-sm text-muted-foreground">
                Roast groups with roasted inventory but no demand in the current view.
              </p>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 w-8"></th>
                    <th className="pb-2">Roast Group</th>
                    <th className="pb-2 text-right">WIP On Hand</th>
                    <th className="pb-2 text-right">FG (Unalloc)</th>
                    <th className="pb-2 text-right">Roasted (Actual)</th>
                    <th className="pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {completedGroups.map((roastGroup) => {
                    const groupBatches = batchesByGroup[roastGroup] ?? [];
                    const config = configByGroup[roastGroup];
                    const roastedTotal = roastedInventory[roastGroup] ?? 0;
                    const wipKg = inventoryLevelsByGroup[roastGroup]?.wip_kg ?? 0;
                    const fgKg = inventoryLevelsByGroup[roastGroup]?.fg_kg ?? 0;
                    
                    return (
                      <RoastGroupDrawer
                        key={roastGroup}
                        roastGroup={roastGroup}
                        demandKg={0}
                        netDemandKg={0}
                        wipKg={wipKg}
                        fgKg={fgKg}
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
                        onBlendBatches={() => setBlendExecuteModal({
                          roastGroup: roastGroup,
                          displayName: config?.display_name?.trim() || roastGroup.replace(/_/g, ' '),
                        })}
                        components={roastGroupComponents ?? []}
                        roastGroupsLookupMap={roastGroupsLookupMap}
                      />
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })()}
      
      {/* Planned Batches (No Current Demand) - roast groups with ONLY planned batches but no demand */}
      {(() => {
        // Only include roast groups that have planned batches but NO roasted batches and no demand
        const plannedOnlyGroups = allRoastGroups
          .filter((g) => !demandByRoastGroup.find((d) => d.roast_group === g))
          .filter((g) => {
            const groupBatches = batchesByGroup[g] ?? [];
            const hasPlanned = groupBatches.some(b => b.status === 'PLANNED');
            const hasRoasted = groupBatches.some(b => b.status === 'ROASTED');
            return hasPlanned && !hasRoasted;
          })
          .filter((g) => groupMatchesRoasterFilter(g));
        
        if (plannedOnlyGroups.length === 0) return null;
        
        return (
          <Card className="opacity-50 border-dashed">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Planned Batches (No Current Demand)
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Batches planned but not yet roasted, with no demand in the current view.
              </p>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 w-8"></th>
                    <th className="pb-2">Roast Group</th>
                    <th className="pb-2 text-right">Planned Batches</th>
                    <th className="pb-2 text-right">Expected Output</th>
                    <th className="pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {plannedOnlyGroups.map((roastGroup) => {
                    const groupBatches = batchesByGroup[roastGroup] ?? [];
                    const config = configByGroup[roastGroup];
                    const plannedBatches = groupBatches.filter(b => b.status === 'PLANNED');
                    const yieldLossPct = config?.expected_yield_loss_pct ?? 16;
                    const expectedOutput = plannedBatches.reduce(
                      (sum, b) => sum + (b.planned_output_kg ?? 0) * (1 - yieldLossPct / 100), 0
                    );
                    const displayName = config?.display_name?.trim() || roastGroup.replace(/_/g, ' ');
                    
                    return (
                      <tr key={roastGroup} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        </td>
                        <td className="py-2">
                          <span className="font-medium">{displayName}</span>
                          <span className="text-muted-foreground text-xs ml-2">({roastGroup})</span>
                        </td>
                        <td className="py-2 text-right font-mono">
                          {plannedBatches.length} batch{plannedBatches.length !== 1 ? 'es' : ''}
                        </td>
                        <td className="py-2 text-right font-mono">
                          {expectedOutput.toFixed(1)} kg
                        </td>
                        <td className="py-2 text-right">
                          <Badge variant="secondary" className="text-xs">
                            Awaiting demand
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })()}

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
      
      {/* Blend Execution Modal (for actually blending component WIP into blend WIP) */}
      {blendExecuteModal && (
        <BlendExecuteModal
          open={!!blendExecuteModal}
          onOpenChange={(open) => !open && setBlendExecuteModal(null)}
          blendRoastGroup={blendExecuteModal.roastGroup}
          blendDisplayName={blendExecuteModal.displayName}
          today={today}
        />
      )}
      {/* Add Batch Modal */}
      <Dialog open={showAddBatchModal} onOpenChange={(open) => {
        if (!open) {
          setShowAddBatchModal(false);
          setAddBatchRgKey('');
          setAddBatchNewName('');
          setAddBatchKg('');
          setAddBatchRoaster('');
          setAddBatchDate(today);
          setAddBatchCropster('');
          setAddBatchMode('existing');
          setAddBatchSaving(false);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Batch</DialogTitle>
          </DialogHeader>
          
          {/* Mode selector tiles */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { key: 'existing' as const, label: 'Existing roast group' },
              { key: 'new' as const, label: 'New roast group' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setAddBatchMode(key)}
                className={`border rounded-lg p-3 cursor-pointer text-sm text-left transition-colors ${
                  addBatchMode === key
                    ? 'border-primary bg-accent'
                    : 'border-border hover:bg-accent/30'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-4 mt-2">
            {/* Mode-specific fields */}
            {addBatchMode === 'existing' && (
              <div className="space-y-2">
                <Label>Roast Group</Label>
                <Select value={addBatchRgKey} onValueChange={setAddBatchRgKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select roast group…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roastGroupsConfig ?? []).map((rg) => (
                      <SelectItem key={rg.roast_group} value={rg.roast_group}>
                        {rg.display_name ?? rg.roast_group}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {addBatchMode === 'new' && (
              <div className="space-y-2">
                <Label>Roast group name</Label>
                <Input
                  value={addBatchNewName}
                  onChange={(e) => setAddBatchNewName(e.target.value)}
                  placeholder="e.g. Colombia Huila"
                />
              </div>
            )}



            {/* Shared fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Target date</Label>
                <Input
                  type="date"
                  value={addBatchDate}
                  onChange={(e) => setAddBatchDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Planned output (kg)</Label>
                <Input
                  type="number"
                  value={addBatchKg}
                  onChange={(e) => setAddBatchKg(e.target.value)}
                  placeholder="Optional"
                  min={0}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Roaster</Label>
              <RadioGroup
                value={addBatchRoaster}
                onValueChange={(val) => setAddBatchRoaster(val as 'SAMIAC' | 'LORING' | '')}
                className="flex gap-4"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="SAMIAC" id="ab-samiac" />
                  <Label htmlFor="ab-samiac" className="cursor-pointer text-sm">Samiac</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="LORING" id="ab-loring" />
                  <Label htmlFor="ab-loring" className="cursor-pointer text-sm">Loring</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="" id="ab-either" />
                  <Label htmlFor="ab-either" className="cursor-pointer text-sm">Either</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Cropster batch ID</Label>
              <Input
                value={addBatchCropster}
                onChange={(e) => setAddBatchCropster(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowAddBatchModal(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                addBatchSaving ||
                (addBatchMode === 'existing' && !addBatchRgKey) ||
                (addBatchMode === 'new' && !addBatchNewName.trim())
              }
              onClick={async () => {
                setAddBatchSaving(true);
                try {
                  let roastGroupKey: string;
                  let isNewlyCreated = false;

                  if (addBatchMode === 'existing') {
                    roastGroupKey = addBatchRgKey;
                  } else {
                    const displayName = addBatchNewName.trim();
                    const result = await createOrReuseRoastGroup({
                      displayName,
                      isBlend: false,
                      origin: null,
                    });
                    if (result.error) {
                      toast.error(result.error);
                      return;
                    }
                    roastGroupKey = result.roastGroupKey;
                    isNewlyCreated = true;
                    queryClient.invalidateQueries({ queryKey: ['roast-groups-config'] });
                  }

                  const plannedKg = addBatchKg ? parseFloat(addBatchKg) : 0;

                  const performInsert = async (swaps: DepletionSwap[] = []) => {
                    const { error } = await supabase.from('roasted_batches').insert({
                      roast_group: roastGroupKey,
                      target_date: addBatchDate,
                      planned_output_kg: addBatchKg ? parseFloat(addBatchKg) : null,
                      actual_output_kg: 0,
                      status: 'PLANNED' as const,
                      assigned_roaster: addBatchRoaster || null,
                      cropster_batch_id: addBatchCropster.trim() || null,
                      created_by: user?.id,
                    });
                    if (error) throw error;

                    if (swaps.length > 0) {
                      await executeDepletionSwaps(swaps);
                      queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', roastGroupKey] });
                      queryClient.invalidateQueries({ queryKey: ['depletion-links', roastGroupKey] });
                    }

                    toast.success(swaps.length > 0 ? `Batch added — ${swaps.length} successor swap(s) applied` : 'Batch added');
                    queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
                    setShowAddBatchModal(false);
                    setAddBatchRgKey('');
                    setAddBatchNewName('');
                    setAddBatchKg('');
                    setAddBatchRoaster('');
                    setAddBatchDate(today);
                    setAddBatchCropster('');
                    setAddBatchMode('existing');
                  };

                  // Skip depletion check for brand-new groups (no links yet)
                  if (!isNewlyCreated) {
                    const { impacts, pctByLinkId } = await evaluateMultiRoastGroupImpacts([
                      { roastGroup: roastGroupKey, newPlannedOutputKg: plannedKg },
                    ]);
                    if (impacts.length > 0) {
                      const rgDisplay = configByGroup[roastGroupKey]?.display_name ?? roastGroupKey;
                      setDepletionState({
                        roastGroupKey,
                        roastGroupDisplayName: rgDisplay,
                        impacts,
                        pctByLinkId,
                        proceedFn: performInsert,
                      });
                      setAddBatchSaving(false);
                      return;
                    }
                  }

                  await performInsert();
                } catch (err: any) {
                  console.error(err);
                  toast.error('Failed to add batch');
                } finally {
                  setAddBatchSaving(false);
                }
              }}
            >
              {addBatchSaving ? 'Saving…' : 'Add Batch'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
