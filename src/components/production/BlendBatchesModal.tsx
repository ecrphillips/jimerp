import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, AlertTriangle, CheckCircle2, Layers, ArrowRight } from 'lucide-react';

interface BlendComponent {
  componentRoastGroup: string;
  componentDisplayName: string;
  pct: number;
  displayOrder: number;
  wipAvailableKg: number;
}

interface RoastGroupConfig {
  roast_group: string;
  display_name: string | null;
  standard_batch_kg: number;
  expected_yield_loss_pct: number;
}

interface BlendBatchesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blendRoastGroup: string;
  blendDisplayName: string;
  today: string;
}

export function BlendBatchesModal({
  open,
  onOpenChange,
  blendRoastGroup,
  blendDisplayName,
  today,
}: BlendBatchesModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [blendKg, setBlendKg] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [blendedAmount, setBlendedAmount] = useState<number>(0);
  
  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setBlendKg('');
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
        .select('roast_group, display_name, standard_batch_kg, expected_yield_loss_pct');
      
      if (error) throw error;
      return (data ?? []) as RoastGroupConfig[];
    },
    enabled: open,
  });
  
  // Fetch WIP for all component groups (authoritative from inventory_transactions)
  const { data: wipData } = useQuery({
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
      const wipKg = wipData?.[comp.component_roast_group] ?? 0;
      
      return {
        componentRoastGroup: comp.component_roast_group,
        componentDisplayName: config?.display_name?.trim() || comp.component_roast_group.replace(/_/g, ' '),
        pct: Number(comp.pct),
        displayOrder: comp.display_order,
        wipAvailableKg: Math.max(0, wipKg),
      };
    });
  }, [blendComponents, configByGroup, wipData]);
  
  // Check if recipe is valid (sums to 100%)
  const recipeTotalPct = useMemo(() => 
    enrichedComponents.reduce((sum, c) => sum + c.pct, 0),
    [enrichedComponents]
  );
  const recipeValid = recipeTotalPct === 100;
  
  // Calculate how much blend we can make based on available WIP
  const maxBlendKg = useMemo(() => {
    if (enrichedComponents.length === 0) return 0;
    
    // For each component, calculate how much total blend it can support
    const maxPerComponent = enrichedComponents.map(comp => {
      if (comp.pct === 0) return Infinity;
      return (comp.wipAvailableKg / comp.pct) * 100;
    });
    
    return Math.floor(Math.min(...maxPerComponent) * 10) / 10; // Round down to 0.1
  }, [enrichedComponents]);
  
  // Calculate component consumptions for the entered blend amount
  const componentConsumptions = useMemo(() => {
    const blendAmount = parseFloat(blendKg) || 0;
    
    return enrichedComponents.map(comp => ({
      ...comp,
      consumeKg: (blendAmount * comp.pct) / 100,
      remainingKg: comp.wipAvailableKg - (blendAmount * comp.pct) / 100,
    }));
  }, [enrichedComponents, blendKg]);
  
  // Check if all components have enough WIP
  const allComponentsHaveStock = componentConsumptions.every(c => c.remainingKg >= 0);
  const blendAmount = parseFloat(blendKg) || 0;
  const canBlend = blendAmount > 0 && allComponentsHaveStock && recipeValid;
  
  // Blend mutation
  const blendMutation = useMutation({
    mutationFn: async () => {
      if (!canBlend) throw new Error('Cannot blend - insufficient components or invalid amount');
      
      const transactions: Array<{
        transaction_type: 'ADJUSTMENT';
        roast_group: string;
        quantity_kg: number;
        is_system_generated: boolean;
        created_by: string | undefined;
        notes: string;
      }> = [];
      
      // Decrement each component's WIP
      for (const comp of componentConsumptions) {
        if (comp.consumeKg > 0) {
          transactions.push({
            transaction_type: 'ADJUSTMENT',
            roast_group: comp.componentRoastGroup,
            quantity_kg: -comp.consumeKg, // Negative = decrement
            is_system_generated: true,
            created_by: user?.id,
            notes: `Consumed for blend: ${blendDisplayName} (${comp.pct}% of ${blendAmount.toFixed(1)} kg)`,
          });
        }
      }
      
      // Increment the blend's WIP
      transactions.push({
        transaction_type: 'ADJUSTMENT',
        roast_group: blendRoastGroup,
        quantity_kg: blendAmount, // Positive = increment
        is_system_generated: true,
        created_by: user?.id,
        notes: `Blended from components: ${componentConsumptions.map(c => `${c.componentDisplayName} ${c.consumeKg.toFixed(1)}kg`).join(', ')}`,
      });
      
      const { error } = await supabase
        .from('inventory_transactions')
        .insert(transactions);
      
      if (error) throw error;
      
      return blendAmount;
    },
    onSuccess: (amount) => {
      toast.success(`Blended ${amount.toFixed(1)} kg of ${blendDisplayName}`);
      queryClient.invalidateQueries({ queryKey: ['inventory-ledger-wip'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['roast-demand'] });
      setBlendedAmount(amount);
      setShowSuccess(true);
    },
    onError: (err: Error) => {
      console.error('Failed to blend:', err);
      toast.error(err.message || 'Failed to blend');
    },
  });
  
  const handleSetMax = useCallback(() => {
    setBlendKg(maxBlendKg.toFixed(1));
  }, [maxBlendKg]);
  
  const isLoading = loadingComponents;
  const hasComponents = enrichedComponents.length > 0;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
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
        ) : showSuccess ? (
          <div className="space-y-4">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Successfully created {blendedAmount.toFixed(1)} kg of {blendDisplayName} WIP!
              </AlertDescription>
            </Alert>
            
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Component WIP summary */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Available Component WIP</Label>
              <div className="border rounded-lg divide-y">
                {enrichedComponents.map(comp => (
                  <div key={comp.componentRoastGroup} className="flex items-center justify-between p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span>{comp.componentDisplayName}</span>
                      <Badge variant="secondary" className="text-xs">{comp.pct}%</Badge>
                    </div>
                    <span className={comp.wipAvailableKg > 0 ? 'font-medium' : 'text-muted-foreground'}>
                      {comp.wipAvailableKg.toFixed(1)} kg
                    </span>
                  </div>
                ))}
              </div>
              {maxBlendKg > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Max blend possible: <strong>{maxBlendKg.toFixed(1)} kg</strong>
                </p>
              ) : (
                <p className="text-xs text-destructive">
                  Insufficient component WIP to create any blend.
                </p>
              )}
            </div>
            
            {/* Blend amount input */}
            <div className="space-y-2">
              <Label htmlFor="blendKg">How much to blend? (kg)</Label>
              <div className="flex gap-2">
                <Input
                  id="blendKg"
                  type="number"
                  step="0.1"
                  min="0"
                  max={maxBlendKg}
                  value={blendKg}
                  onChange={(e) => setBlendKg(e.target.value)}
                  placeholder="0.0"
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={handleSetMax} disabled={maxBlendKg === 0}>
                  Max
                </Button>
              </div>
            </div>
            
            {/* Preview of what will happen */}
            {blendAmount > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <ArrowRight className="h-4 w-4" />
                  This will:
                </p>
                <div className="text-xs space-y-1 pl-6">
                  {componentConsumptions.map(comp => (
                    <div key={comp.componentRoastGroup} className="flex justify-between">
                      <span>Consume from {comp.componentDisplayName}:</span>
                      <span className={comp.remainingKg < 0 ? 'text-destructive font-medium' : ''}>
                        {comp.consumeKg.toFixed(2)} kg
                        {comp.remainingKg < 0 && ' (not enough!)'}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between font-medium pt-1 border-t">
                    <span>Create {blendDisplayName} WIP:</span>
                    <span className="text-primary">{blendAmount.toFixed(1)} kg</span>
                  </div>
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
                  `Blend ${blendAmount > 0 ? blendAmount.toFixed(1) + ' kg' : ''}`
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
