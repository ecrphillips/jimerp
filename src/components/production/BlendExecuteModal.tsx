import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, AlertTriangle, CheckCircle2, Layers, ArrowRight, Beaker } from 'lucide-react';

interface RoastedBatch {
  id: string;
  roast_group: string;
  actual_output_kg: number;
  status: 'PLANNED' | 'ROASTED';
  planned_for_blend_roast_group: string | null;
  consumed_by_blend_at: string | null;  // null = available for blending
  notes: string | null;
  target_date: string;
  created_at: string;
}

interface BlendComponent {
  componentRoastGroup: string;
  componentDisplayName: string;
  pct: number;
  displayOrder: number;
}

interface RoastGroupConfig {
  roast_group: string;
  display_name: string | null;
}

interface BlendExecuteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blendRoastGroup: string;
  blendDisplayName: string;
  today: string;
}

interface SelectedBatch {
  batchId: string;
  consumeKg: number;
  availableKg: number;
}

export function BlendExecuteModal({
  open,
  onOpenChange,
  blendRoastGroup,
  blendDisplayName,
  today,
}: BlendExecuteModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [selectedBatches, setSelectedBatches] = useState<Record<string, SelectedBatch>>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const [blendedAmount, setBlendedAmount] = useState<number>(0);
  
  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setSelectedBatches({});
      setShowSuccess(false);
      setBlendedAmount(0);
    }
  }, [open]);
  
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
  
  // Fetch roast group configs for display names
  const { data: roastGroupConfigs } = useQuery({
    queryKey: ['roast-groups-config-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name');
      
      if (error) throw error;
      return (data ?? []) as RoastGroupConfig[];
    },
    enabled: open,
  });
  
  // Fetch ROASTED batches for component groups (available for blending)
  // Only include batches that have NOT been consumed by a prior blend
  const { data: roastedBatches } = useQuery({
    queryKey: ['roasted-batches-for-blending', blendRoastGroup],
    queryFn: async () => {
      if (!blendComponents || blendComponents.length === 0) return [];
      
      const componentGroups = blendComponents.map(c => c.component_roast_group);
      
      // Get all ROASTED batches for component groups that are NOT consumed
      // consumed_by_blend_at IS NULL means the batch is still available
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('id, roast_group, actual_output_kg, status, planned_for_blend_roast_group, consumed_by_blend_at, notes, target_date, created_at')
        .in('roast_group', componentGroups)
        .eq('status', 'ROASTED')
        .is('consumed_by_blend_at', null)  // Only unconsumed batches
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return (data ?? []) as RoastedBatch[];
    },
    enabled: open && !!blendComponents && blendComponents.length > 0,
  });
  
  // Fetch current WIP consumed (from pack operations) to calculate available batch output
  const { data: wipConsumptions } = useQuery({
    queryKey: ['wip-consumptions-for-batches'],
    queryFn: async () => {
      if (!blendComponents || blendComponents.length === 0) return {};
      
      const componentGroups = blendComponents.map(c => c.component_roast_group);
      
      // Get pack consumptions per roast group
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('roast_group, quantity_kg')
        .eq('transaction_type', 'PACK_CONSUME_WIP')
        .in('roast_group', componentGroups);
      
      if (error) throw error;
      
      const consumedByGroup: Record<string, number> = {};
      for (const t of data ?? []) {
        if (t.roast_group) {
          // quantity_kg is negative for consumption
          consumedByGroup[t.roast_group] = (consumedByGroup[t.roast_group] ?? 0) + Math.abs(Number(t.quantity_kg) || 0);
        }
      }
      
      return consumedByGroup;
    },
    enabled: open && !!blendComponents && blendComponents.length > 0,
  });
  
  // Build config map
  const configByGroup = useMemo(() => {
    const map: Record<string, RoastGroupConfig> = {};
    for (const rg of roastGroupConfigs ?? []) {
      map[rg.roast_group] = rg;
    }
    return map;
  }, [roastGroupConfigs]);
  
  // Build enriched component list
  const enrichedComponents: BlendComponent[] = useMemo(() => {
    if (!blendComponents) return [];
    
    return blendComponents.map(comp => {
      const config = configByGroup[comp.component_roast_group];
      
      return {
        componentRoastGroup: comp.component_roast_group,
        componentDisplayName: config?.display_name?.trim() || comp.component_roast_group.replace(/_/g, ' '),
        pct: Number(comp.pct),
        displayOrder: comp.display_order,
      };
    });
  }, [blendComponents, configByGroup]);
  
  // Calculate available kg per batch (output - already consumed via pack)
  // For MVP, we'll use a simple approach: assume batches are consumed FIFO within a roast group
  const batchesWithAvailable = useMemo(() => {
    if (!roastedBatches) return [];
    
    // Group batches by roast_group and calculate remaining available
    const batchesByGroup: Record<string, RoastedBatch[]> = {};
    for (const batch of roastedBatches) {
      if (!batchesByGroup[batch.roast_group]) {
        batchesByGroup[batch.roast_group] = [];
      }
      batchesByGroup[batch.roast_group].push(batch);
    }
    
    const result: Array<RoastedBatch & { availableKg: number; linkedToThisBlend: boolean }> = [];
    
    for (const [roastGroup, batches] of Object.entries(batchesByGroup)) {
      const totalConsumed = wipConsumptions?.[roastGroup] ?? 0;
      let remainingConsumed = totalConsumed;
      
      // Sort by created_at for FIFO consumption
      const sortedBatches = [...batches].sort((a, b) => 
        (a.created_at ?? '').localeCompare(b.created_at ?? '')
      );
      
      for (const batch of sortedBatches) {
        const consumedFromThis = Math.min(remainingConsumed, batch.actual_output_kg);
        const available = batch.actual_output_kg - consumedFromThis;
        remainingConsumed -= consumedFromThis;
        
        if (available > 0.01) { // Only show if there's meaningful available kg
          result.push({
            ...batch,
            availableKg: available,
            linkedToThisBlend: batch.planned_for_blend_roast_group === blendRoastGroup,
          });
        }
      }
    }
    
    return result;
  }, [roastedBatches, wipConsumptions, blendRoastGroup]);
  
  // Group available batches by component
  const batchesByComponent = useMemo(() => {
    const grouped: Record<string, Array<RoastedBatch & { availableKg: number; linkedToThisBlend: boolean }>> = {};
    for (const batch of batchesWithAvailable) {
      if (!grouped[batch.roast_group]) {
        grouped[batch.roast_group] = [];
      }
      grouped[batch.roast_group].push(batch);
    }
    return grouped;
  }, [batchesWithAvailable]);
  
  // Check if recipe is valid (sums to 100%)
  const recipeTotalPct = useMemo(() => 
    enrichedComponents.reduce((sum, c) => sum + c.pct, 0),
    [enrichedComponents]
  );
  const recipeValid = Math.abs(recipeTotalPct - 100) <= 1;
  
  // Calculate totals by component
  const componentTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    
    for (const [batchId, selection] of Object.entries(selectedBatches)) {
      const batch = batchesWithAvailable.find(b => b.id === batchId);
      if (batch) {
        totals[batch.roast_group] = (totals[batch.roast_group] ?? 0) + selection.consumeKg;
      }
    }
    
    return totals;
  }, [selectedBatches, batchesWithAvailable]);
  
  // Calculate total blend output
  const totalBlendOutput = useMemo(() => {
    return Object.values(componentTotals).reduce((sum, kg) => sum + kg, 0);
  }, [componentTotals]);
  
  // Check recipe proportions
  const proportionCheck = useMemo(() => {
    if (totalBlendOutput === 0) return { valid: true, errors: [] };
    
    const errors: string[] = [];
    const tolerance = 2; // ±2% tolerance
    
    for (const comp of enrichedComponents) {
      const actual = componentTotals[comp.componentRoastGroup] ?? 0;
      const expectedPct = comp.pct;
      const actualPct = (actual / totalBlendOutput) * 100;
      
      if (Math.abs(actualPct - expectedPct) > tolerance) {
        errors.push(
          `${comp.componentDisplayName}: ${actualPct.toFixed(1)}% (should be ${expectedPct}%)`
        );
      }
    }
    
    return { valid: errors.length === 0, errors };
  }, [enrichedComponents, componentTotals, totalBlendOutput]);
  
  // Toggle batch selection
  const toggleBatch = useCallback((batch: RoastedBatch & { availableKg: number }) => {
    setSelectedBatches(prev => {
      if (prev[batch.id]) {
        // Deselect
        const { [batch.id]: _, ...rest } = prev;
        return rest;
      } else {
        // Select with default consume = available
        return {
          ...prev,
          [batch.id]: {
            batchId: batch.id,
            consumeKg: batch.availableKg,
            availableKg: batch.availableKg,
          },
        };
      }
    });
  }, []);
  
  // Update consume amount for a batch
  const updateConsumeAmount = useCallback((batchId: string, kg: number) => {
    setSelectedBatches(prev => {
      if (!prev[batchId]) return prev;
      return {
        ...prev,
        [batchId]: {
          ...prev[batchId],
          consumeKg: Math.min(Math.max(0, kg), prev[batchId].availableKg),
        },
      };
    });
  }, []);
  
  // Check if we can blend
  const canBlend = totalBlendOutput > 0 && proportionCheck.valid && recipeValid;
  
  // Blend mutation with idempotency guard
  const blendMutation = useMutation({
    mutationFn: async () => {
      if (!canBlend) throw new Error('Cannot blend - check proportions and selections');
      
      const batchIdsToConsume: string[] = [];
      const componentTransactions: Array<{
        transaction_type: 'ADJUSTMENT';
        roast_group: string;
        quantity_kg: number;
        is_system_generated: boolean;
        created_by: string | undefined;
        notes: string;
      }> = [];
      
      // Collect batch IDs and component decrements
      for (const [batchId, selection] of Object.entries(selectedBatches)) {
        if (selection.consumeKg <= 0) continue;
        
        const batch = batchesWithAvailable.find(b => b.id === batchId);
        if (!batch) continue;
        
        batchIdsToConsume.push(batchId);
        
        // Note: Component decrements are recorded for audit but NOT used for WIP calc
        // since component batches are NOT in WIP (they're "staged_for_blend")
        componentTransactions.push({
          transaction_type: 'ADJUSTMENT',
          roast_group: batch.roast_group,
          quantity_kg: -selection.consumeKg, // Negative = decrement component staging
          is_system_generated: true,
          created_by: user?.id,
          notes: `Blended into ${blendDisplayName} (batch ${batchId.slice(0, 8)})`,
        });
      }
      
      // Step 1: Atomically mark selected batches as consumed
      // This is the idempotency guard - if any batch is already consumed, abort
      const now = new Date().toISOString();
      const { error: consumeError, data: consumedData } = await supabase
        .from('roasted_batches')
        .update({ consumed_by_blend_at: now })
        .in('id', batchIdsToConsume)
        .is('consumed_by_blend_at', null)  // CRITICAL: Only update if not already consumed
        .select('id');
      
      if (consumeError) throw consumeError;
      
      // Verify ALL batches were consumed (no partial success = no race condition)
      if (!consumedData || consumedData.length !== batchIdsToConsume.length) {
        const consumedIds = new Set(consumedData?.map(b => b.id) ?? []);
        const failedIds = batchIdsToConsume.filter(id => !consumedIds.has(id));
        throw new Error(
          `Blend aborted: ${failedIds.length} batch(es) were already consumed by another blend. ` +
          `Please refresh and try again.`
        );
      }
      
      // Step 2: Create the blend output transaction (this is what adds to WIP)
      const blendTransaction = {
        transaction_type: 'ADJUSTMENT' as const,
        roast_group: blendRoastGroup,
        quantity_kg: totalBlendOutput, // Positive = increment parent blend WIP
        is_system_generated: true,
        created_by: user?.id,
        notes: `Created blend from ${batchIdsToConsume.length} component batches`,
      };
      
      // Insert ONLY the blend output transaction
      // (Component decrements are NOT inserted since components aren't in WIP)
      const { error: txError } = await supabase
        .from('inventory_transactions')
        .insert([blendTransaction]);
      
      if (txError) {
        // Rollback: un-consume the batches if transaction insert failed
        await supabase
          .from('roasted_batches')
          .update({ consumed_by_blend_at: null })
          .in('id', batchIdsToConsume);
        throw txError;
      }
      
      return totalBlendOutput;
    },
    onSuccess: (amount) => {
      toast.success(`Blended ${amount.toFixed(1)} kg of ${blendDisplayName}`);
      // Invalidate all inventory-related queries for immediate UI update
      queryClient.invalidateQueries({ queryKey: ['inventory-ledger-wip'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['roast-demand'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-wip'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-wip-adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-roast-demand'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative-roast-groups-info'] });
      queryClient.invalidateQueries({ queryKey: ['roasted-batches-for-blending'] });
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['roasted-component-batches-for-blending'] });
      queryClient.invalidateQueries({ queryKey: ['component-batches-for-blend'] });
      // Dashboard metrics
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics-v2'] });
      setBlendedAmount(amount);
      setShowSuccess(true);
    },
    onError: (err: Error) => {
      console.error('Failed to blend:', err);
      toast.error(err.message || 'Failed to blend');
    },
  });
  
  const isLoading = loadingComponents;
  const hasComponents = enrichedComponents.length > 0;
  const hasAvailableBatches = batchesWithAvailable.length > 0;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Beaker className="h-5 w-5 text-primary" />
            Blend: {blendDisplayName}
          </DialogTitle>
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
        ) : !hasAvailableBatches ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No roasted component batches available for blending. Roast component batches first, then return here to blend.
            </AlertDescription>
          </Alert>
        ) : showSuccess ? (
          <div className="space-y-4">
            <Alert className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                Successfully created {blendedAmount.toFixed(1)} kg of {blendDisplayName} WIP!
              </AlertDescription>
            </Alert>
            
            <p className="text-sm text-muted-foreground">
              The blend WIP is now available for packing in the Pack station.
            </p>
            
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Recipe summary */}
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm font-medium mb-2">Recipe:</p>
              <div className="flex flex-wrap gap-2">
                {enrichedComponents.map(comp => (
                  <Badge key={comp.componentRoastGroup} variant="outline">
                    {comp.pct}% {comp.componentDisplayName}
                  </Badge>
                ))}
              </div>
            </div>
            
            {/* Component batch selection */}
            <div className="space-y-4">
              {enrichedComponents.map(comp => {
                const batches = batchesByComponent[comp.componentRoastGroup] ?? [];
                const componentTotal = componentTotals[comp.componentRoastGroup] ?? 0;
                
                return (
                  <div key={comp.componentRoastGroup} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{comp.componentDisplayName}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{comp.pct}%</Badge>
                        {componentTotal > 0 && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            {componentTotal.toFixed(1)} kg selected
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    {batches.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">
                        No roasted batches available
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {batches.map(batch => {
                          const isSelected = !!selectedBatches[batch.id];
                          const selection = selectedBatches[batch.id];
                          
                          return (
                            <div 
                              key={batch.id} 
                              className={`flex items-center gap-3 p-2 rounded border ${
                                isSelected 
                                  ? 'border-primary bg-primary/5' 
                                  : 'border-transparent hover:bg-muted/50'
                              }`}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleBatch(batch)}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 text-sm">
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {batch.id.slice(0, 8)}
                                  </span>
                                  {batch.linkedToThisBlend && (
                                    <Badge variant="secondary" className="text-xs">
                                      For this blend
                                    </Badge>
                                  )}
                                  <span className="text-muted-foreground">
                                    {batch.availableKg.toFixed(1)} kg available
                                  </span>
                                </div>
                              </div>
                              {isSelected && (
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs">Use:</Label>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max={selection.availableKg}
                                    value={selection.consumeKg}
                                    onChange={(e) => updateConsumeAmount(batch.id, parseFloat(e.target.value) || 0)}
                                    className="w-20 h-7 text-sm"
                                  />
                                  <span className="text-xs text-muted-foreground">kg</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Proportion validation */}
            {totalBlendOutput > 0 && !proportionCheck.valid && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium mb-1">Proportions don't match recipe (±2% tolerance):</p>
                  <ul className="text-xs list-disc pl-4">
                    {proportionCheck.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            
            {/* Preview */}
            {totalBlendOutput > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <ArrowRight className="h-4 w-4" />
                  This will create:
                </p>
                <div className="text-sm pl-6">
                  <span className="font-medium text-primary">{totalBlendOutput.toFixed(1)} kg</span>
                  <span className="text-muted-foreground"> of {blendDisplayName} WIP</span>
                </div>
                <div className="text-xs text-muted-foreground pl-6">
                  From: {Object.keys(selectedBatches).length} batches across {
                    Object.keys(componentTotals).filter(k => componentTotals[k] > 0).length
                  } components
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => blendMutation.mutate()}
                disabled={!canBlend || blendMutation.isPending}
              >
                {blendMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Blending...
                  </>
                ) : (
                  `Create ${totalBlendOutput > 0 ? totalBlendOutput.toFixed(1) + ' kg ' : ''}Blend`
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
