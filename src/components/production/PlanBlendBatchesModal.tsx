import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, AlertTriangle, Plus, Minus, ExternalLink, CheckCircle2 } from 'lucide-react';
import { DepletionWarningModal, executeDepletionSwaps, type DepletionSwap } from './DepletionWarningModal';
import { evaluateMultiRoastGroupImpacts, type MultiRgImpact } from '@/hooks/useGreenLotDepletion';

type RoasterMachine = 'SAMIAC' | 'LORING';
type DefaultRoaster = 'SAMIAC' | 'LORING' | 'EITHER';

interface BlendComponent {
  componentRoastGroup: string;
  componentDisplayName: string;
  pct: number;
  displayOrder: number;
  // Computed from config
  standardBatchKg: number;
  expectedYieldLossPct: number;
  defaultRoaster: DefaultRoaster;
  // Inventory (authoritative from inventory_transactions)
  wipKg: number;
  // Coverage from existing batches - ONLY for this blend
  plannedExpectedOutputKg: number;
  roastedOutputKg: number;
  // Counts for visibility
  plannedBatchCount: number;
  roastedBatchCount: number;
}

interface RoastGroupConfig {
  roast_group: string;
  display_name: string | null;
  standard_batch_kg: number;
  expected_yield_loss_pct: number;
  default_roaster: DefaultRoaster;
  is_blend: boolean;
}

interface PlanBlendBatchesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blendRoastGroup: string;
  blendDisplayName: string;
  blendDemandKg: number;
  blendNetDemandKg: number;
  today: string;
  onNavigateToComponent?: (componentRoastGroup: string) => void;
}

interface ComponentBatchPlan {
  componentRoastGroup: string;
  batchCount: number;
  suggestedCount: number;
  shortKg: number;
}

export function PlanBlendBatchesModal({
  open,
  onOpenChange,
  blendRoastGroup,
  blendDisplayName,
  blendDemandKg,
  blendNetDemandKg,
  today,
  onNavigateToComponent,
}: PlanBlendBatchesModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdSummary, setCreatedSummary] = useState<Array<{ name: string; count: number }>>([]);
  const [orphanCleanupDone, setOrphanCleanupDone] = useState(false);
  const [depletionState, setDepletionState] = useState<{
    impacts: MultiRgImpact[];
    pctByLinkId: Record<string, number | null>;
  } | null>(null);
  const [depletionProceeding, setDepletionProceeding] = useState(false);
  
  // Fetch blend components
  const { data: blendComponents, isLoading: loadingComponents } = useQuery({
    queryKey: ['blend-components', blendRoastGroup],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_group_components')
        .select('component_roast_group, pct, display_order')
        .eq('parent_roast_group', blendRoastGroup)
        .order('display_order');
      
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });
  
  // Fetch roast group configs for all components
  const { data: roastGroupConfigs } = useQuery({
    queryKey: ['roast-groups-config-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name, standard_batch_kg, expected_yield_loss_pct, default_roaster, is_blend');
      
      if (error) throw error;
      return (data ?? []) as RoastGroupConfig[];
    },
    enabled: open,
  });
  
  // Fetch AUTHORITATIVE WIP from inventory_transactions (not legacy cached table)
  const { data: authoritativeWip } = useQuery({
    queryKey: ['inventory-ledger-wip-for-blend', blendRoastGroup],
    queryFn: async () => {
      if (!blendComponents || blendComponents.length === 0) return {};
      
      const componentGroups = blendComponents.map(c => c.component_roast_group);
      
      // Get roast outputs
      const { data: roastOutputs, error: roastError } = await supabase
        .from('inventory_transactions')
        .select('roast_group, quantity_kg')
        .eq('transaction_type', 'ROAST_OUTPUT')
        .in('roast_group', componentGroups);
      
      if (roastError) throw roastError;
      
      // Get pack consumptions
      const { data: packConsumptions, error: packError } = await supabase
        .from('inventory_transactions')
        .select('roast_group, quantity_kg')
        .eq('transaction_type', 'PACK_CONSUME_WIP')
        .in('roast_group', componentGroups);
      
      if (packError) throw packError;
      
      // Get adjustments and losses
      const { data: adjustments, error: adjError } = await supabase
        .from('inventory_transactions')
        .select('roast_group, quantity_kg')
        .in('transaction_type', ['ADJUSTMENT', 'LOSS'])
        .in('roast_group', componentGroups);
      
      if (adjError) throw adjError;
      
      // Calculate WIP per group
      const wipByGroup: Record<string, number> = {};
      
      for (const output of roastOutputs ?? []) {
        if (output.roast_group) {
          wipByGroup[output.roast_group] = (wipByGroup[output.roast_group] ?? 0) + (Number(output.quantity_kg) || 0);
        }
      }
      
      for (const consume of packConsumptions ?? []) {
        if (consume.roast_group) {
          wipByGroup[consume.roast_group] = (wipByGroup[consume.roast_group] ?? 0) + (Number(consume.quantity_kg) || 0);
        }
      }
      
      for (const adj of adjustments ?? []) {
        if (adj.roast_group) {
          wipByGroup[adj.roast_group] = (wipByGroup[adj.roast_group] ?? 0) + (Number(adj.quantity_kg) || 0);
        }
      }
      
      return wipByGroup;
    },
    enabled: open && !!blendComponents && blendComponents.length > 0,
  });
  
  // Fetch existing batches for components - ONLY batches linked to THIS blend
  // This is the key fix: planned_for_blend_roast_group must match this blend
  const { data: existingBatches, refetch: refetchBatches } = useQuery({
    queryKey: ['roasted-batches-for-blend', blendRoastGroup],
    queryFn: async () => {
      if (!blendComponents || blendComponents.length === 0) return [];
      
      const componentGroups = blendComponents.map(c => c.component_roast_group);
      
      // Only fetch PLANNED/ROASTED batches that are either:
      // 1. Explicitly linked to this blend via planned_for_blend_roast_group
      // 2. OR not linked to any blend (general component batches)
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('id, roast_group, status, planned_output_kg, actual_output_kg, planned_for_blend_roast_group, notes')
        .in('roast_group', componentGroups)
        .in('status', ['PLANNED', 'ROASTED']);
      
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!blendComponents && blendComponents.length > 0,
  });

  // Orphan cleanup mutation - marks orphaned PLANNED batches as cancelled
  const cleanupOrphansMutation = useMutation({
    mutationFn: async () => {
      if (!existingBatches) return { cleaned: 0 };
      
      // Find PLANNED batches linked to this blend
      const linkedPlannedBatches = existingBatches.filter(
        b => b.status === 'PLANNED' && b.planned_for_blend_roast_group === blendRoastGroup
      );
      
      // Check if any of these are "orphaned" - old planned batches that should no longer exist
      // An orphan is a PLANNED batch that was created for a blend but the demand is now 0 or negative
      // For MVP, we just log these rather than auto-cancelling
      if (linkedPlannedBatches.length > 0) {
        console.log(`[Blend Planning] Found ${linkedPlannedBatches.length} PLANNED batches linked to ${blendRoastGroup}:`, 
          linkedPlannedBatches.map(b => ({ id: b.id.slice(0, 8), roast_group: b.roast_group }))
        );
      }
      
      return { cleaned: 0 };
    },
    onSuccess: () => {
      setOrphanCleanupDone(true);
    },
  });

  // Run orphan cleanup when modal opens
  useEffect(() => {
    if (open && existingBatches && !orphanCleanupDone) {
      cleanupOrphansMutation.mutate();
    }
    if (!open) {
      setOrphanCleanupDone(false);
    }
  }, [open, existingBatches, orphanCleanupDone]);
  
  // Build config map
  const configByGroup = useMemo(() => {
    const map: Record<string, RoastGroupConfig> = {};
    for (const rg of roastGroupConfigs ?? []) {
      map[rg.roast_group] = rg;
    }
    return map;
  }, [roastGroupConfigs]);
  
  // Build inventory map from AUTHORITATIVE WIP data
  const inventoryByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [roastGroup, wipKg] of Object.entries(authoritativeWip ?? {})) {
      map[roastGroup] = Math.max(0, wipKg);
    }
    return map;
  }, [authoritativeWip]);
  
  // Calculate batch coverage for each component - ONLY count batches linked to THIS blend
  const batchCoverageByGroup = useMemo(() => {
    const planned: Record<string, { kg: number; count: number }> = {};
    const roasted: Record<string, { kg: number; count: number }> = {};
    
    for (const batch of existingBatches ?? []) {
      // Only count batches explicitly linked to THIS blend
      if (batch.planned_for_blend_roast_group !== blendRoastGroup) {
        continue;
      }
      
      const config = configByGroup[batch.roast_group];
      const yieldLoss = config?.expected_yield_loss_pct ?? 16;
      
      if (batch.status === 'PLANNED') {
        const inbound = batch.planned_output_kg ?? 0;
        const expected = inbound * (1 - yieldLoss / 100);
        if (!planned[batch.roast_group]) {
          planned[batch.roast_group] = { kg: 0, count: 0 };
        }
        planned[batch.roast_group].kg += expected;
        planned[batch.roast_group].count += 1;
      } else if (batch.status === 'ROASTED') {
        if (!roasted[batch.roast_group]) {
          roasted[batch.roast_group] = { kg: 0, count: 0 };
        }
        roasted[batch.roast_group].kg += batch.actual_output_kg;
        roasted[batch.roast_group].count += 1;
      }
    }
    
    return { planned, roasted };
  }, [existingBatches, configByGroup, blendRoastGroup]);
  
  // Build enriched component list
  const enrichedComponents: BlendComponent[] = useMemo(() => {
    if (!blendComponents) return [];
    
    return blendComponents.map(comp => {
      const config = configByGroup[comp.component_roast_group];
      const wipKg = inventoryByGroup[comp.component_roast_group] ?? 0;
      const plannedData = batchCoverageByGroup.planned[comp.component_roast_group];
      const roastedData = batchCoverageByGroup.roasted[comp.component_roast_group];
      
      return {
        componentRoastGroup: comp.component_roast_group,
        componentDisplayName: config?.display_name?.trim() || comp.component_roast_group.replace(/_/g, ' '),
        pct: Number(comp.pct),
        displayOrder: comp.display_order,
        standardBatchKg: config?.standard_batch_kg ?? 20,
        expectedYieldLossPct: config?.expected_yield_loss_pct ?? 16,
        defaultRoaster: config?.default_roaster ?? 'EITHER',
        wipKg,
        plannedExpectedOutputKg: plannedData?.kg ?? 0,
        roastedOutputKg: roastedData?.kg ?? 0,
        plannedBatchCount: plannedData?.count ?? 0,
        roastedBatchCount: roastedData?.count ?? 0,
      };
    });
  }, [blendComponents, configByGroup, inventoryByGroup, batchCoverageByGroup]);
  
  // Check if recipe is valid (sums to 100%)
  const recipeTotalPct = useMemo(() => 
    enrichedComponents.reduce((sum, c) => sum + c.pct, 0),
    [enrichedComponents]
  );
  const recipeValid = recipeTotalPct === 100;
  
  // Calculate component shortfalls based on blend demand
  // For blends, we use available WIP from component groups, not the output linked to this blend
  const componentShortfalls = useMemo(() => {
    return enrichedComponents.map(comp => {
      const componentDemandKg = blendNetDemandKg * (comp.pct / 100);
      // Available = current WIP in that component group + planned batches for this blend + roasted batches for this blend
      const availableKg = comp.wipKg + comp.plannedExpectedOutputKg + comp.roastedOutputKg;
      const shortKg = Math.max(0, componentDemandKg - availableKg);
      
      // Calculate suggested batches
      const expectedOutputPerBatch = comp.standardBatchKg * (1 - comp.expectedYieldLossPct / 100);
      const suggestedBatches = shortKg > 0 ? Math.ceil(shortKg / expectedOutputPerBatch) : 0;
      
      return {
        componentRoastGroup: comp.componentRoastGroup,
        componentDemandKg,
        availableKg,
        shortKg,
        suggestedBatches,
        expectedOutputPerBatch,
      };
    });
  }, [enrichedComponents, blendNetDemandKg]);
  
  // User-editable batch counts
  const [batchPlans, setBatchPlans] = useState<ComponentBatchPlan[]>([]);
  
  // Initialize batch plans when components load
  useEffect(() => {
    if (componentShortfalls.length > 0 && batchPlans.length === 0) {
      setBatchPlans(componentShortfalls.map(sf => ({
        componentRoastGroup: sf.componentRoastGroup,
        batchCount: sf.suggestedBatches,
        suggestedCount: sf.suggestedBatches,
        shortKg: sf.shortKg,
      })));
    }
  }, [componentShortfalls, batchPlans.length]);
  
  // Reset plans when modal opens
  useEffect(() => {
    if (open) {
      setBatchPlans([]);
      setShowSuccess(false);
      setCreatedSummary([]);
    }
  }, [open]);
  
  // Batch count adjustment handlers
  const adjustBatchCount = useCallback((componentRoastGroup: string, delta: number) => {
    setBatchPlans(prev => prev.map(p => 
      p.componentRoastGroup === componentRoastGroup
        ? { ...p, batchCount: Math.max(0, p.batchCount + delta) }
        : p
    ));
  }, []);
  
  // Calculate projected coverage after planning
  const projectedCoverage = useMemo(() => {
    return enrichedComponents.map(comp => {
      const plan = batchPlans.find(p => p.componentRoastGroup === comp.componentRoastGroup);
      const plannedBatches = plan?.batchCount ?? 0;
      const expectedOutputPerBatch = comp.standardBatchKg * (1 - comp.expectedYieldLossPct / 100);
      const additionalOutput = plannedBatches * expectedOutputPerBatch;
      
      const componentDemandKg = blendNetDemandKg * (comp.pct / 100);
      const currentCoverage = comp.wipKg + comp.plannedExpectedOutputKg + comp.roastedOutputKg;
      const projectedTotal = currentCoverage + additionalOutput;
      const projectedDelta = projectedTotal - componentDemandKg;
      
      return {
        componentRoastGroup: comp.componentRoastGroup,
        componentDisplayName: comp.componentDisplayName,
        componentDemandKg,
        projectedTotal,
        projectedDelta,
        isCovered: projectedDelta >= 0,
      };
    });
  }, [enrichedComponents, batchPlans, blendNetDemandKg]);
  
  const allComponentsCovered = projectedCoverage.every(c => c.isCovered);
  const totalBatchesToCreate = batchPlans.reduce((sum, p) => sum + p.batchCount, 0);
  
  // Create batches mutation
  const createBatchesMutation = useMutation({
    mutationFn: async () => {
      const batchInserts: Array<{
        roast_group: string;
        target_date: string;
        planned_output_kg: number;
        actual_output_kg: number;
        status: 'PLANNED';
        assigned_roaster: RoasterMachine | null;
        created_by: string | undefined;
        notes: string;
        planned_for_blend_roast_group: string;
      }> = [];
      
      for (const plan of batchPlans) {
        if (plan.batchCount === 0) continue;
        
        const comp = enrichedComponents.find(c => c.componentRoastGroup === plan.componentRoastGroup);
        if (!comp) continue;
        
        const roaster: RoasterMachine | null = 
          comp.defaultRoaster === 'SAMIAC' ? 'SAMIAC' :
          comp.defaultRoaster === 'LORING' ? 'LORING' :
          null;
        
        for (let i = 0; i < plan.batchCount; i++) {
          batchInserts.push({
            roast_group: plan.componentRoastGroup,
            target_date: today,
            planned_output_kg: comp.standardBatchKg,
            actual_output_kg: 0,
            status: 'PLANNED',
            assigned_roaster: roaster,
            created_by: user?.id,
            notes: `Planned for blend: ${blendDisplayName}`,
            planned_for_blend_roast_group: blendRoastGroup,
          });
        }
      }
      
      if (batchInserts.length === 0) {
        throw new Error('No batches to create');
      }
      
      const { error } = await supabase
        .from('roasted_batches')
        .insert(batchInserts);
      
      if (error) throw error;
      
      // Build summary
      const summary: Array<{ name: string; count: number }> = [];
      for (const plan of batchPlans) {
        if (plan.batchCount === 0) continue;
        const comp = enrichedComponents.find(c => c.componentRoastGroup === plan.componentRoastGroup);
        summary.push({
          name: comp?.componentDisplayName ?? plan.componentRoastGroup,
          count: plan.batchCount,
        });
      }
      
      return summary;
    },
    onSuccess: (summary) => {
      toast.success(`Created ${totalBatchesToCreate} planned batches for ${blendDisplayName}`);
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      setCreatedSummary(summary);
      setShowSuccess(true);
    },
    onError: (err: any) => {
      console.error('Failed to create blend batches:', err);
      toast.error(err?.message || 'Failed to create batches');
    },
  });
  
  const handleNavigateToComponent = (componentRoastGroup: string) => {
    onOpenChange(false);
    onNavigateToComponent?.(componentRoastGroup);
  };
  
  const isLoading = loadingComponents;
  const hasComponents = enrichedComponents.length > 0;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Plan Batches for {blendDisplayName} (Blend)</DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !hasComponents ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This blend has no component recipe defined. Please set up the blend components in Products → Roast Groups.
            </AlertDescription>
          </Alert>
        ) : !recipeValid ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Blend recipe percentages must sum to 100%. Current total: {recipeTotalPct}%.
            </AlertDescription>
          </Alert>
        ) : showSuccess ? (
          <div className="space-y-4">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Component batches created successfully! These batches now appear under each component roast group on the run sheet.
              </AlertDescription>
            </Alert>
            
            <div className="space-y-2">
              <p className="text-sm font-medium">Created:</p>
              {createdSummary.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm border-b pb-2">
                  <span>{item.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{item.count} batches</Badge>
                    {onNavigateToComponent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleNavigateToComponent(
                          batchPlans.find(p => 
                            enrichedComponents.find(c => 
                              c.componentDisplayName === item.name
                            )?.componentRoastGroup === p.componentRoastGroup
                          )?.componentRoastGroup ?? ''
                        )}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <Alert className="border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800 text-xs">
                <strong>Next step:</strong> Roast the component batches, then return here and use "Blend…" to combine them into {blendDisplayName} WIP.
              </AlertDescription>
            </Alert>
            
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Blend demand summary */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Blend net demand:</span>
                <span className="font-medium">{blendNetDemandKg.toFixed(1)} kg (roasted output)</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Plan component batches below to cover this blend demand. Only batches linked to this blend are counted.
              </p>
            </div>
            
            {/* Component rows */}
            <div className="space-y-3">
              {enrichedComponents.map((comp, idx) => {
                const shortfall = componentShortfalls.find(s => s.componentRoastGroup === comp.componentRoastGroup);
                const plan = batchPlans.find(p => p.componentRoastGroup === comp.componentRoastGroup);
                const projected = projectedCoverage.find(p => p.componentRoastGroup === comp.componentRoastGroup);
                
                const componentDemandKg = blendNetDemandKg * (comp.pct / 100);
                const expectedOutputPerBatch = comp.standardBatchKg * (1 - comp.expectedYieldLossPct / 100);
                
                return (
                  <div key={comp.componentRoastGroup} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium">{comp.componentDisplayName}</span>
                        <span className="text-muted-foreground ml-2 text-sm">({comp.pct}%)</span>
                      </div>
                      <Badge 
                        variant="secondary" 
                        className={projected?.isCovered 
                          ? 'bg-green-100 text-green-800 border-green-300'
                          : 'bg-amber-100 text-amber-800 border-amber-300'
                        }
                      >
                        {projected?.isCovered ? 'Covered' : `Short ${Math.abs(projected?.projectedDelta ?? 0).toFixed(1)} kg`}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                      <div>
                        <div>Component demand: {componentDemandKg.toFixed(1)} kg</div>
                        <div>WIP available: {comp.wipKg.toFixed(1)} kg</div>
                        <div className="flex items-center gap-1">
                          <span>Planned for this blend:</span>
                          <span className={comp.plannedBatchCount > 0 ? 'text-blue-600 font-medium' : ''}>
                            {comp.plannedExpectedOutputKg.toFixed(1)} kg ({comp.plannedBatchCount} batch{comp.plannedBatchCount !== 1 ? 'es' : ''})
                          </span>
                        </div>
                        {comp.roastedBatchCount > 0 && (
                          <div className="flex items-center gap-1">
                            <span>Roasted for this blend:</span>
                            <span className="text-green-600 font-medium">
                              {comp.roastedOutputKg.toFixed(1)} kg ({comp.roastedBatchCount} batch{comp.roastedBatchCount !== 1 ? 'es' : ''})
                            </span>
                          </div>
                        )}
                      </div>
                      <div>
                        <div>Std batch: {comp.standardBatchKg} kg inbound</div>
                        <div>→ {expectedOutputPerBatch.toFixed(1)} kg expected output</div>
                        <div className={shortfall?.shortKg === 0 ? 'text-green-600' : 'text-amber-600 font-medium'}>
                          Short: {(shortfall?.shortKg ?? 0).toFixed(1)} kg
                        </div>
                      </div>
                    </div>
                    
                    {/* Batch count control */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">Batches to add:</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => adjustBatchCount(comp.componentRoastGroup, -1)}
                            disabled={(plan?.batchCount ?? 0) === 0}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center font-medium">{plan?.batchCount ?? 0}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => adjustBatchCount(comp.componentRoastGroup, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      
                      {shortfall?.shortKg === 0 && (
                        <span className="text-xs text-green-600">✓ Already covered by WIP/planned</span>
                      )}
                      
                      {shortfall && shortfall.shortKg > 0 && plan && plan.batchCount < shortfall.suggestedBatches && (
                        <span className="text-xs text-amber-600">
                          Suggest {shortfall.suggestedBatches} batches
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Summary */}
            <div className="bg-muted/30 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm">
                Total: <strong>{totalBatchesToCreate}</strong> batches across {batchPlans.filter(p => p.batchCount > 0).length} components
              </span>
              {!allComponentsCovered && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                  Some components still short
                </Badge>
              )}
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createBatchesMutation.mutate()}
                disabled={totalBatchesToCreate === 0 || createBatchesMutation.isPending}
              >
                {createBatchesMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  `Create ${totalBatchesToCreate} Batches`
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
