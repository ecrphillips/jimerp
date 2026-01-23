import React, { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';

interface OhShitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: {
    id: string;
    roast_group: string;
    target_date: string;
    planned_output_kg: number | null;
    actual_output_kg: number;
    status: 'PLANNED' | 'ROASTED';
  };
  allBatches: {
    id: string;
    roast_group: string;
    target_date: string;
    actual_output_kg: number;
    status: 'PLANNED' | 'ROASTED';
  }[];
  allRoastGroups: string[];
  today: string;
}

type Step = 'choose' | 'destoner' | 'bin-same' | 'bin-different-select' | 'bin-different-action' | 'adjust' | 'deconstruct' | 'other' | 'confirm';
type EventType = 'DESTONER_SPILL' | 'BIN_MIX_SAME' | 'BIN_MIX_DIFFERENT' | 'WIP_ADJUSTMENT' | 'DECONSTRUCT' | 'OTHER';

interface FlowData {
  eventType: EventType | null;
  // Destoner flow
  outputKg: string;
  // Bin mix same
  prevBatchKg: string;
  newBatchKg: string;
  // Bin mix different
  contaminatedBatchId: string | null;
  contaminatedKg: string;
  binMixAction: 'writeoff' | 'reclassify' | '';
  destinationRoastGroup: string;
  // Adjust WIP
  adjustRoastGroup: string;
  adjustKg: string;
  adjustReason: 'end_of_bin' | 'packing_loss' | 'scale_correction' | '';
  // Deconstruct
  deconstructProductId: string;
  deconstructUnits: string;
  // Common
  notes: string;
}

export function OhShitModal({
  open,
  onOpenChange,
  batch,
  allBatches,
  allRoastGroups,
  today,
}: OhShitModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [step, setStep] = useState<Step>('choose');
  const [flowData, setFlowData] = useState<FlowData>({
    eventType: null,
    outputKg: '',
    prevBatchKg: '',
    newBatchKg: '',
    contaminatedBatchId: null,
    contaminatedKg: '',
    binMixAction: '',
    destinationRoastGroup: '',
    adjustRoastGroup: batch.roast_group,
    adjustKg: '',
    adjustReason: '',
    deconstructProductId: '',
    deconstructUnits: '',
    notes: '',
  });

  // Fetch products with packing runs for deconstruct
  const { data: productsWithPacking } = useQuery({
    queryKey: ['products-with-packing-for-deconstruct', today],
    queryFn: async () => {
      const { data: packingRuns, error: packingError } = await supabase
        .from('packing_runs')
        .select('product_id, units_packed, kg_consumed')
        .eq('target_date', today)
        .gt('units_packed', 0);
      
      if (packingError) throw packingError;
      if (!packingRuns?.length) return [];
      
      const productIds = packingRuns.map(pr => pr.product_id);
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('id, product_name, bag_size_g, roast_group')
        .in('id', productIds);
      
      if (productError) throw productError;
      
      return packingRuns.map(pr => {
        const product = products?.find(p => p.id === pr.product_id);
        return {
          ...pr,
          product_name: product?.product_name ?? 'Unknown',
          bag_size_g: product?.bag_size_g ?? 0,
          roast_group: product?.roast_group ?? null,
        };
      });
    },
    enabled: open,
  });

  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setStep('choose');
      setFlowData({
        eventType: null,
        outputKg: batch.actual_output_kg > 0 ? batch.actual_output_kg.toString() : '',
        prevBatchKg: '',
        newBatchKg: '',
        contaminatedBatchId: null,
        contaminatedKg: '',
        binMixAction: '',
        destinationRoastGroup: '',
        adjustRoastGroup: batch.roast_group,
        adjustKg: '',
        adjustReason: '',
        deconstructProductId: '',
        deconstructUnits: '',
        notes: '',
      });
    }
  }, [open, batch]);

  // Get recent ROASTED batches for bin mix selection (same day, same roaster typically)
  const recentBatches = useMemo(() => {
    return allBatches.filter(b => 
      b.status === 'ROASTED' && 
      b.id !== batch.id &&
      b.target_date === batch.target_date
    );
  }, [allBatches, batch]);

  // Calculate yield for destoner flow
  const inboundKg = batch.planned_output_kg ?? 0;
  const outputKg = parseFloat(flowData.outputKg) || 0;
  const yieldPercent = inboundKg > 0 ? (outputKg / inboundKg) * 100 : 0;
  const isNormalYield = yieldPercent >= 80 && yieldPercent <= 90;
  const needsNotesForYield = !isNormalYield && flowData.notes.trim() === '';

  // Calculate deconstruct kg
  const deconstructProduct = productsWithPacking?.find(p => p.product_id === flowData.deconstructProductId);
  const deconstructKg = deconstructProduct 
    ? (parseInt(flowData.deconstructUnits) || 0) * (deconstructProduct.bag_size_g / 1000)
    : 0;

  // Mutation for applying changes
  const applyChangesMutation = useMutation({
    mutationFn: async () => {
      const userId = user?.id;
      
      switch (flowData.eventType) {
        case 'DESTONER_SPILL': {
          const newOutput = parseFloat(flowData.outputKg) || 0;
          const previousOutput = batch.actual_output_kg;
          const deltaWip = newOutput - previousOutput;
          
          // Update batch
          if (batch.status === 'PLANNED') {
            // Mark as roasted with the output
            const { error: batchError } = await supabase
              .from('roasted_batches')
              .update({ 
                status: 'ROASTED',
                actual_output_kg: newOutput 
              })
              .eq('id', batch.id);
            if (batchError) throw batchError;
            
            // Create WIP ledger entry for roast output
            const { error: ledgerError } = await supabase
              .from('wip_ledger')
              .insert({
                target_date: batch.target_date,
                roast_group: batch.roast_group,
                entry_type: 'ROAST_OUTPUT',
                delta_kg: newOutput,
                related_batch_id: batch.id,
                created_by: userId,
                notes: flowData.notes,
              });
            if (ledgerError) throw ledgerError;
          } else {
            // Already roasted - update output and adjust WIP
            const { error: batchError } = await supabase
              .from('roasted_batches')
              .update({ actual_output_kg: newOutput })
              .eq('id', batch.id);
            if (batchError) throw batchError;
            
            if (deltaWip !== 0) {
              const { error: ledgerError } = await supabase
                .from('wip_ledger')
                .insert({
                  target_date: batch.target_date,
                  roast_group: batch.roast_group,
                  entry_type: 'ADJUSTMENT',
                  delta_kg: deltaWip,
                  related_batch_id: batch.id,
                  created_by: userId,
                  notes: `Destoner spill adjustment: ${flowData.notes}`,
                });
              if (ledgerError) throw ledgerError;
            }
          }
          
          // Create exception event
          const { error: eventError } = await supabase
            .from('roast_exception_events')
            .insert({
              target_date: batch.target_date,
              roast_group: batch.roast_group,
              batch_id: batch.id,
              event_type: 'DESTONER_SPILL',
              delta_wip_kg: deltaWip,
              notes: flowData.notes,
              created_by: userId,
              metadata: {
                inbound_kg: inboundKg,
                output_kg: newOutput,
                yield_percent: yieldPercent.toFixed(1),
              },
            });
          if (eventError) throw eventError;
          break;
        }
        
        case 'BIN_MIX_SAME': {
          const prevKg = parseFloat(flowData.prevBatchKg) || 0;
          const newKg = parseFloat(flowData.newBatchKg) || 0;
          
          // Create exception event
          const { error: eventError } = await supabase
            .from('roast_exception_events')
            .insert({
              target_date: batch.target_date,
              roast_group: batch.roast_group,
              batch_id: batch.id,
              event_type: 'BIN_MIX_SAME',
              delta_wip_kg: 0, // No net change
              notes: flowData.notes,
              created_by: userId,
              metadata: {
                prev_batch_kg: prevKg,
                new_batch_kg: newKg,
              },
            });
          if (eventError) throw eventError;
          break;
        }
        
        case 'BIN_MIX_DIFFERENT': {
          const contaminatedKg = parseFloat(flowData.contaminatedKg) || 0;
          const sourceBatch = recentBatches.find(b => b.id === flowData.contaminatedBatchId);
          const sourceGroup = sourceBatch?.roast_group ?? batch.roast_group;
          
          // Remove from source roast group
          const { error: lossError } = await supabase
            .from('wip_ledger')
            .insert({
              target_date: batch.target_date,
              roast_group: sourceGroup,
              entry_type: flowData.binMixAction === 'writeoff' ? 'LOSS' : 'REALLOCATE_OUT',
              delta_kg: -contaminatedKg,
              related_batch_id: flowData.contaminatedBatchId,
              created_by: userId,
              notes: flowData.notes,
            });
          if (lossError) throw lossError;
          
          // If reclassifying, add to destination
          if (flowData.binMixAction === 'reclassify' && flowData.destinationRoastGroup) {
            const { error: reallocError } = await supabase
              .from('wip_ledger')
              .insert({
                target_date: batch.target_date,
                roast_group: flowData.destinationRoastGroup,
                entry_type: 'REALLOCATE_IN',
                delta_kg: contaminatedKg,
                created_by: userId,
                notes: `Reclassified from ${sourceGroup}: ${flowData.notes}`,
              });
            if (reallocError) throw reallocError;
          }
          
          // Create exception event
          const { error: eventError } = await supabase
            .from('roast_exception_events')
            .insert({
              target_date: batch.target_date,
              roast_group: sourceGroup,
              batch_id: flowData.contaminatedBatchId,
              event_type: 'BIN_MIX_DIFFERENT',
              delta_wip_kg: -contaminatedKg,
              notes: flowData.notes,
              created_by: userId,
              metadata: {
                source_roast_group: sourceGroup,
                destination_roast_group: flowData.binMixAction === 'reclassify' ? flowData.destinationRoastGroup : null,
                contaminated_kg: contaminatedKg,
                action: flowData.binMixAction,
              },
            });
          if (eventError) throw eventError;
          break;
        }
        
        case 'WIP_ADJUSTMENT': {
          const adjustKg = parseFloat(flowData.adjustKg) || 0;
          
          // Add WIP ledger entry
          const { error: ledgerError } = await supabase
            .from('wip_ledger')
            .insert({
              target_date: today,
              roast_group: flowData.adjustRoastGroup,
              entry_type: 'ADJUSTMENT',
              delta_kg: adjustKg,
              created_by: userId,
              notes: flowData.notes,
              metadata: { reason: flowData.adjustReason },
            });
          if (ledgerError) throw ledgerError;
          
          // Create exception event
          const { error: eventError } = await supabase
            .from('roast_exception_events')
            .insert({
              target_date: today,
              roast_group: flowData.adjustRoastGroup,
              batch_id: null,
              event_type: 'WIP_ADJUSTMENT',
              delta_wip_kg: adjustKg,
              notes: flowData.notes,
              created_by: userId,
              metadata: { reason: flowData.adjustReason },
            });
          if (eventError) throw eventError;
          break;
        }
        
        case 'DECONSTRUCT': {
          if (!deconstructProduct) throw new Error('No product selected');
          
          const units = parseInt(flowData.deconstructUnits) || 0;
          const kgReturned = deconstructKg;
          const roastGroup = deconstructProduct.roast_group;
          
          // Decrement packing_runs
          const newUnits = Math.max(0, deconstructProduct.units_packed - units);
          const kgPerUnit = deconstructProduct.bag_size_g / 1000;
          const newKgConsumed = Math.max(0, deconstructProduct.kg_consumed - (units * kgPerUnit));
          
          const { error: packError } = await supabase
            .from('packing_runs')
            .update({
              units_packed: newUnits,
              kg_consumed: newKgConsumed,
            })
            .eq('product_id', flowData.deconstructProductId)
            .eq('target_date', today);
          if (packError) throw packError;
          
          // Add WIP back
          if (roastGroup) {
            const { error: ledgerError } = await supabase
              .from('wip_ledger')
              .insert({
                target_date: today,
                roast_group: roastGroup,
                entry_type: 'DECONSTRUCT_IN',
                delta_kg: kgReturned,
                related_product_id: flowData.deconstructProductId,
                created_by: userId,
                notes: flowData.notes,
              });
            if (ledgerError) throw ledgerError;
          }
          
          // Create exception event
          const { error: eventError } = await supabase
            .from('roast_exception_events')
            .insert({
              target_date: today,
              roast_group: roastGroup ?? 'UNKNOWN',
              batch_id: null,
              event_type: 'DECONSTRUCT',
              delta_wip_kg: kgReturned,
              notes: flowData.notes,
              created_by: userId,
              metadata: {
                product_id: flowData.deconstructProductId,
                product_name: deconstructProduct.product_name,
                units: units,
                kg_returned: kgReturned,
              },
            });
          if (eventError) throw eventError;
          break;
        }
        
        case 'OTHER': {
          const adjustKg = parseFloat(flowData.adjustKg) || 0;
          
          // Add WIP adjustment if provided
          if (adjustKg !== 0) {
            const { error: ledgerError } = await supabase
              .from('wip_ledger')
              .insert({
                target_date: today,
                roast_group: batch.roast_group,
                entry_type: 'ADJUSTMENT',
                delta_kg: adjustKg,
                related_batch_id: batch.id,
                created_by: userId,
                notes: flowData.notes,
              });
            if (ledgerError) throw ledgerError;
          }
          
          // Create exception event
          const { error: eventError } = await supabase
            .from('roast_exception_events')
            .insert({
              target_date: today,
              roast_group: batch.roast_group,
              batch_id: batch.id,
              event_type: 'OTHER',
              delta_wip_kg: adjustKg,
              notes: flowData.notes,
              created_by: userId,
              metadata: {},
            });
          if (eventError) throw eventError;
          break;
        }
      }
    },
    onSuccess: () => {
      toast.success('Changes applied successfully');
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['wip-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['packing-runs'] });
      queryClient.invalidateQueries({ queryKey: ['roast-exception-events'] });
      onOpenChange(false);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to apply changes');
    },
  });

  const handleChooseOption = (option: string) => {
    switch (option) {
      case 'destoner':
        setFlowData(d => ({ ...d, eventType: 'DESTONER_SPILL' }));
        setStep('destoner');
        break;
      case 'bin-same':
        setFlowData(d => ({ ...d, eventType: 'BIN_MIX_SAME' }));
        setStep('bin-same');
        break;
      case 'bin-different':
        setFlowData(d => ({ ...d, eventType: 'BIN_MIX_DIFFERENT' }));
        setStep('bin-different-select');
        break;
      case 'adjust':
        setFlowData(d => ({ ...d, eventType: 'WIP_ADJUSTMENT' }));
        setStep('adjust');
        break;
      case 'deconstruct':
        setFlowData(d => ({ ...d, eventType: 'DECONSTRUCT' }));
        setStep('deconstruct');
        break;
      case 'other':
        setFlowData(d => ({ ...d, eventType: 'OTHER' }));
        setStep('other');
        break;
    }
  };

  const canProceedToConfirm = (): boolean => {
    switch (step) {
      case 'destoner':
        return flowData.outputKg.trim() !== '' && !needsNotesForYield;
      case 'bin-same':
        return flowData.prevBatchKg.trim() !== '' && flowData.newBatchKg.trim() !== '';
      case 'bin-different-select':
        return flowData.contaminatedBatchId !== null && flowData.contaminatedKg.trim() !== '';
      case 'bin-different-action':
        return flowData.binMixAction !== '' && 
          (flowData.binMixAction === 'writeoff' || flowData.destinationRoastGroup !== '') &&
          flowData.notes.trim() !== '';
      case 'adjust':
        return flowData.adjustRoastGroup !== '' && 
          flowData.adjustKg.trim() !== '' && 
          flowData.adjustReason !== '' &&
          (Math.abs(parseFloat(flowData.adjustKg) || 0) < 0.5 || flowData.notes.trim() !== '');
      case 'deconstruct':
        return flowData.deconstructProductId !== '' && 
          flowData.deconstructUnits.trim() !== '' &&
          parseInt(flowData.deconstructUnits) > 0 &&
          flowData.notes.trim() !== '';
      case 'other':
        return flowData.notes.trim() !== '';
      default:
        return false;
    }
  };

  const goToConfirm = () => {
    if (step === 'bin-different-select') {
      setStep('bin-different-action');
    } else {
      setStep('confirm');
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'choose':
        return (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
              <h3 className="text-lg font-semibold">Don't panic.</h3>
              <p className="text-muted-foreground">What happened?</p>
            </div>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3"
                onClick={() => handleChooseOption('destoner')}
              >
                <span>Some of the batch was lost at the destoner (spill / no bin)</span>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3"
                onClick={() => handleChooseOption('bin-same')}
              >
                <span>This bin already had coffee in it (same coffee)</span>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3"
                onClick={() => handleChooseOption('bin-different')}
              >
                <span>This bin already had coffee in it (different coffee)</span>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3"
                onClick={() => handleChooseOption('adjust')}
              >
                <span>I need to adjust WIP inventory (end-of-bin / mismatch / packing loss)</span>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3"
                onClick={() => handleChooseOption('deconstruct')}
              >
                <span>I need to break packed bags to finish another order</span>
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3"
                onClick={() => handleChooseOption('other')}
              >
                <span>Something else</span>
              </Button>
            </div>
          </div>
        );

      case 'destoner':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Lost at destoner</h3>
              <p className="text-sm text-muted-foreground">
                Record the actual output weight after the spill.
              </p>
            </div>
            
            <div className="p-3 bg-muted rounded-md text-sm">
              <div className="flex justify-between">
                <span>Batch:</span>
                <span className="font-medium">{batch.roast_group}</span>
              </div>
              <div className="flex justify-between">
                <span>Inbound (green) kg:</span>
                <span className="font-medium">{inboundKg.toFixed(1)} kg</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="output-kg">Output (roasted) kg *</Label>
              <Input
                id="output-kg"
                type="number"
                step="0.1"
                value={flowData.outputKg}
                onChange={(e) => setFlowData(d => ({ ...d, outputKg: e.target.value }))}
                placeholder="e.g. 17.5"
              />
              {flowData.outputKg && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Yield: {yieldPercent.toFixed(1)}%
                  </span>
                  {isNormalYield ? (
                    <Badge variant="default" className="text-xs">Normal</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-xs">Outside 80-90%</Badge>
                  )}
                </div>
              )}
            </div>
            
            {!isNormalYield && flowData.outputKg && (
              <Alert variant="destructive">
                <AlertDescription>
                  This yield looks outside the normal 10–20% loss range. 
                  Double-check inbound/output numbers or record a loss explanation.
                </AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="notes">
                Notes {!isNormalYield && '*'}
              </Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="What happened?"
                rows={2}
              />
            </div>
          </div>
        );

      case 'bin-same':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Bin already had same coffee</h3>
              <p className="text-sm text-muted-foreground">
                Record the weights to reconcile batch outputs.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="prev-kg">Previous batch output in bin (kg) *</Label>
              <Input
                id="prev-kg"
                type="number"
                step="0.1"
                value={flowData.prevBatchKg}
                onChange={(e) => setFlowData(d => ({ ...d, prevBatchKg: e.target.value }))}
                placeholder="e.g. 18.0"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="new-kg">New batch output now in bin (kg) *</Label>
              <Input
                id="new-kg"
                type="number"
                step="0.1"
                value={flowData.newBatchKg}
                onChange={(e) => setFlowData(d => ({ ...d, newBatchKg: e.target.value }))}
                placeholder="e.g. 17.5"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Optional notes"
                rows={2}
              />
            </div>
          </div>
        );

      case 'bin-different-select':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Bin had different coffee</h3>
              <p className="text-sm text-muted-foreground">
                Which batch was contaminated and how much?
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Contaminated batch *</Label>
              <Select
                value={flowData.contaminatedBatchId ?? ''}
                onValueChange={(val) => setFlowData(d => ({ ...d, contaminatedBatchId: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select batch..." />
                </SelectTrigger>
                <SelectContent>
                  {recentBatches.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.roast_group} - {b.actual_output_kg.toFixed(1)} kg
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="contaminated-kg">Estimated contaminated amount (kg) *</Label>
              <Input
                id="contaminated-kg"
                type="number"
                step="0.1"
                value={flowData.contaminatedKg}
                onChange={(e) => setFlowData(d => ({ ...d, contaminatedKg: e.target.value }))}
                placeholder="e.g. 2.5"
              />
            </div>
          </div>
        );

      case 'bin-different-action':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">What do you want to do?</h3>
              <p className="text-sm text-muted-foreground">
                {parseFloat(flowData.contaminatedKg) || 0} kg contaminated
              </p>
            </div>
            
            <RadioGroup
              value={flowData.binMixAction}
              onValueChange={(val) => setFlowData(d => ({ 
                ...d, 
                binMixAction: val as 'writeoff' | 'reclassify' 
              }))}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="writeoff" id="writeoff" />
                <Label htmlFor="writeoff">Write off (loss)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="reclassify" id="reclassify" />
                <Label htmlFor="reclassify">Reclassify into a special blend</Label>
              </div>
            </RadioGroup>
            
            {flowData.binMixAction === 'reclassify' && (
              <div className="space-y-2">
                <Label>Destination roast group *</Label>
                <Select
                  value={flowData.destinationRoastGroup}
                  onValueChange={(val) => setFlowData(d => ({ ...d, destinationRoastGroup: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select or type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allRoastGroups.map(g => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Or type new roast group name"
                  value={flowData.destinationRoastGroup}
                  onChange={(e) => setFlowData(d => ({ ...d, destinationRoastGroup: e.target.value }))}
                />
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="notes">Notes *</Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Describe what happened"
                rows={2}
              />
            </div>
          </div>
        );

      case 'adjust':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Adjust WIP inventory</h3>
              <p className="text-sm text-muted-foreground">
                Record an inventory adjustment for a roast group.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Roast group *</Label>
              <Select
                value={flowData.adjustRoastGroup}
                onValueChange={(val) => setFlowData(d => ({ ...d, adjustRoastGroup: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select roast group..." />
                </SelectTrigger>
                <SelectContent>
                  {allRoastGroups.map(g => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="adjust-kg">Adjustment (kg) *</Label>
              <Input
                id="adjust-kg"
                type="number"
                step="0.1"
                value={flowData.adjustKg}
                onChange={(e) => setFlowData(d => ({ ...d, adjustKg: e.target.value }))}
                placeholder="e.g. -0.5 or 1.2"
              />
              <p className="text-xs text-muted-foreground">
                Negative = reduce WIP, Positive = add to WIP
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Select
                value={flowData.adjustReason}
                onValueChange={(val) => setFlowData(d => ({ 
                  ...d, 
                  adjustReason: val as 'end_of_bin' | 'packing_loss' | 'scale_correction' 
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="end_of_bin">End-of-bin adjustment</SelectItem>
                  <SelectItem value="packing_loss">Packing loss / sweepings</SelectItem>
                  <SelectItem value="scale_correction">Scale/entry correction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="notes">
                Notes {Math.abs(parseFloat(flowData.adjustKg) || 0) >= 0.5 && '*'}
              </Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Explain the adjustment"
                rows={2}
              />
              {Math.abs(parseFloat(flowData.adjustKg) || 0) >= 0.5 && (
                <p className="text-xs text-muted-foreground">
                  Notes required for adjustments ≥ 0.5 kg
                </p>
              )}
            </div>
          </div>
        );

      case 'deconstruct':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Break packed bags</h3>
              <p className="text-sm text-muted-foreground">
                Return coffee to WIP by deconstructing packed units.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Product to break *</Label>
              <Select
                value={flowData.deconstructProductId}
                onValueChange={(val) => setFlowData(d => ({ ...d, deconstructProductId: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product..." />
                </SelectTrigger>
                <SelectContent>
                  {productsWithPacking?.map(p => (
                    <SelectItem key={p.product_id} value={p.product_id}>
                      {p.product_name} ({p.units_packed} packed)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {deconstructProduct && (
              <div className="p-3 bg-muted rounded-md text-sm">
                <div className="flex justify-between">
                  <span>Available to break:</span>
                  <span className="font-medium">{deconstructProduct.units_packed} units</span>
                </div>
                <div className="flex justify-between">
                  <span>Bag size:</span>
                  <span className="font-medium">{deconstructProduct.bag_size_g}g</span>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="units">Units to break *</Label>
              <Input
                id="units"
                type="number"
                min="1"
                max={deconstructProduct?.units_packed ?? 999}
                value={flowData.deconstructUnits}
                onChange={(e) => setFlowData(d => ({ ...d, deconstructUnits: e.target.value }))}
                placeholder="e.g. 5"
              />
              {flowData.deconstructUnits && deconstructProduct && (
                <p className="text-sm text-muted-foreground">
                  Returns {deconstructKg.toFixed(2)} kg to WIP ({deconstructProduct.roast_group})
                </p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="notes">Notes *</Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Why are you breaking these bags?"
                rows={2}
              />
            </div>
          </div>
        );

      case 'other':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Something else</h3>
              <p className="text-sm text-muted-foreground">
                Describe what happened. We'll log it for reference.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="notes">Description *</Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="What happened?"
                rows={3}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="adjust-kg">WIP adjustment (kg, optional)</Label>
              <Input
                id="adjust-kg"
                type="number"
                step="0.1"
                value={flowData.adjustKg}
                onChange={(e) => setFlowData(d => ({ ...d, adjustKg: e.target.value }))}
                placeholder="Leave empty if no adjustment needed"
              />
            </div>
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <Check className="h-12 w-12 text-primary mx-auto" />
              <h3 className="text-lg font-semibold">Confirm changes</h3>
            </div>
            
            <div className="p-3 bg-muted rounded-md text-sm space-y-2">
              <div className="flex justify-between">
                <span>Event type:</span>
                <Badge variant="outline">{flowData.eventType}</Badge>
              </div>
              {flowData.eventType === 'DESTONER_SPILL' && (
                <>
                  <div className="flex justify-between">
                    <span>Output recorded:</span>
                    <span className="font-medium">{flowData.outputKg} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Yield:</span>
                    <span className="font-medium">{yieldPercent.toFixed(1)}%</span>
                  </div>
                </>
              )}
              {flowData.eventType === 'WIP_ADJUSTMENT' && (
                <>
                  <div className="flex justify-between">
                    <span>Roast group:</span>
                    <span className="font-medium">{flowData.adjustRoastGroup}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Adjustment:</span>
                    <span className="font-medium">{flowData.adjustKg} kg</span>
                  </div>
                </>
              )}
              {flowData.eventType === 'DECONSTRUCT' && deconstructProduct && (
                <>
                  <div className="flex justify-between">
                    <span>Product:</span>
                    <span className="font-medium">{deconstructProduct.product_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Units to break:</span>
                    <span className="font-medium">{flowData.deconstructUnits}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>KG returned to WIP:</span>
                    <span className="font-medium">{deconstructKg.toFixed(2)} kg</span>
                  </div>
                </>
              )}
              {flowData.notes && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground">Notes:</span>
                  <p className="mt-1">{flowData.notes}</p>
                </div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Issue with batch
          </DialogTitle>
          {step !== 'choose' && step !== 'confirm' && (
            <DialogDescription>
              {batch.roast_group} — {batch.target_date}
            </DialogDescription>
          )}
        </DialogHeader>
        
        {renderStep()}
        
        <DialogFooter className="flex-row gap-2">
          {step !== 'choose' && (
            <Button
              variant="outline"
              onClick={() => {
                if (step === 'bin-different-action') {
                  setStep('bin-different-select');
                } else if (step === 'confirm') {
                  // Go back to the previous flow step based on event type
                  switch (flowData.eventType) {
                    case 'DESTONER_SPILL': setStep('destoner'); break;
                    case 'BIN_MIX_SAME': setStep('bin-same'); break;
                    case 'BIN_MIX_DIFFERENT': setStep('bin-different-action'); break;
                    case 'WIP_ADJUSTMENT': setStep('adjust'); break;
                    case 'DECONSTRUCT': setStep('deconstruct'); break;
                    case 'OTHER': setStep('other'); break;
                    default: setStep('choose');
                  }
                } else {
                  setStep('choose');
                }
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          
          {step !== 'choose' && step !== 'confirm' && (
            <Button
              onClick={goToConfirm}
              disabled={!canProceedToConfirm()}
            >
              {step === 'bin-different-select' ? 'Next' : 'Review'}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          
          {step === 'confirm' && (
            <Button
              onClick={() => applyChangesMutation.mutate()}
              disabled={applyChangesMutation.isPending}
            >
              {applyChangesMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  Apply changes
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
