import React, { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    cropster_batch_id?: string | null;
  };
  allBatches: {
    id: string;
    roast_group: string;
    target_date: string;
    actual_output_kg: number;
    status: 'PLANNED' | 'ROASTED';
    planned_output_kg?: number | null;
    cropster_batch_id?: string | null;
  }[];
  allRoastGroups: string[];
  today: string;
}

type Step = 
  | 'choose' 
  | 'blend-check' 
  | 'blend-same' 
  | 'blend-different' 
  | 'spill' 
  | 'contamination' 
  | 'adjust' 
  | 'other' 
  | 'confirm';

type EventType = 'BIN_MIX_SAME' | 'BIN_MIX_DIFFERENT' | 'DESTONER_SPILL' | 'WIP_ADJUSTMENT' | 'OTHER';

interface FlowData {
  eventType: EventType | null;
  // Blend same coffee
  batch1OutputKg: string;
  batch1CropsterId: string;
  batch1Notes: string;
  batch2OutputKg: string;
  batch2CropsterId: string;
  batch2Notes: string;
  affectedBatchId: string | null;
  // Blend different coffee
  blendedOutputKg: string;
  salvageRoastGroup: string;
  blendCropsterId: string;
  // Spill
  recoveredKg: string;
  estimatedLossKg: string;
  // Adjust WIP
  adjustRoastGroup: string;
  adjustKg: string;
  adjustReason: 'end_of_bin' | 'packing_loss' | 'scale_correction' | '';
  // Other
  otherOutputKg: string;
  // Common
  notes: string;
}

const SALVAGE_ROAST_GROUP = 'SALVAGE_BLEND';

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
    batch1OutputKg: '',
    batch1CropsterId: '',
    batch1Notes: '',
    batch2OutputKg: '',
    batch2CropsterId: '',
    batch2Notes: '',
    affectedBatchId: null,
    blendedOutputKg: '',
    salvageRoastGroup: SALVAGE_ROAST_GROUP,
    blendCropsterId: '',
    recoveredKg: '',
    estimatedLossKg: '',
    adjustRoastGroup: batch.roast_group,
    adjustKg: '',
    adjustReason: '',
    otherOutputKg: '',
    notes: '',
  });

  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setStep('choose');
      setFlowData({
        eventType: null,
        batch1OutputKg: '',
        batch1CropsterId: batch.cropster_batch_id ?? '',
        batch1Notes: '',
        batch2OutputKg: '',
        batch2CropsterId: '',
        batch2Notes: '',
        affectedBatchId: null,
        blendedOutputKg: '',
        salvageRoastGroup: SALVAGE_ROAST_GROUP,
        blendCropsterId: '',
        recoveredKg: batch.actual_output_kg > 0 ? batch.actual_output_kg.toString() : '',
        estimatedLossKg: '',
        adjustRoastGroup: batch.roast_group,
        adjustKg: '',
        adjustReason: '',
        otherOutputKg: '',
        notes: '',
      });
    }
  }, [open, batch]);

  // Get recent batches for blend selection (same day, excluding current)
  const recentBatches = useMemo(() => {
    return allBatches.filter(b => 
      b.id !== batch.id &&
      b.target_date === batch.target_date
    );
  }, [allBatches, batch]);

  // Get batches that could have been in the destoner (same roast group for "same coffee")
  const sameCoffeeBatches = useMemo(() => {
    return recentBatches.filter(b => b.roast_group === batch.roast_group);
  }, [recentBatches, batch.roast_group]);

  // Calculate yield for spill flow
  const inboundKg = batch.planned_output_kg ?? 0;
  const recoveredKg = parseFloat(flowData.recoveredKg) || 0;
  const yieldPercent = inboundKg > 0 ? (recoveredKg / inboundKg) * 100 : 0;
  const isNormalYield = yieldPercent >= 80 && yieldPercent <= 90;

  // Mutation for applying changes
  const applyChangesMutation = useMutation({
    mutationFn: async () => {
      const userId = user?.id;
      
      switch (flowData.eventType) {
        case 'BIN_MIX_SAME': {
          const batch1Kg = parseFloat(flowData.batch1OutputKg) || 0;
          const batch2Kg = parseFloat(flowData.batch2OutputKg) || 0;
          const affectedBatch = recentBatches.find(b => b.id === flowData.affectedBatchId);
          
          // Update current batch (batch 2 - the one just released)
          const { error: batch2Error } = await supabase
            .from('roasted_batches')
            .update({ 
              status: 'ROASTED',
              actual_output_kg: batch2Kg,
              cropster_batch_id: flowData.batch2CropsterId || null,
              notes: flowData.batch2Notes || null,
            })
            .eq('id', batch.id);
          if (batch2Error) throw batch2Error;

          // Create WIP entry for batch 2 if it was PLANNED
          if (batch.status === 'PLANNED') {
            const { error: ledgerError } = await supabase
              .from('wip_ledger')
              .insert({
                target_date: batch.target_date,
                roast_group: batch.roast_group,
                entry_type: 'ROAST_OUTPUT',
                delta_kg: batch2Kg,
                related_batch_id: batch.id,
                created_by: userId,
                notes: 'Batch output after destoner blend reconciliation',
              });
            if (ledgerError) throw ledgerError;
          } else {
            // Adjust WIP if already roasted
            const deltaWip = batch2Kg - batch.actual_output_kg;
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
                  notes: 'Blend reconciliation adjustment',
                });
              if (ledgerError) throw ledgerError;
            }
          }

          // Update the affected batch (batch 1 - the previous one still in destoner)
          if (affectedBatch) {
            const previousOutput = affectedBatch.actual_output_kg;
            const { error: batch1Error } = await supabase
              .from('roasted_batches')
              .update({ 
                actual_output_kg: batch1Kg,
                cropster_batch_id: flowData.batch1CropsterId || null,
                notes: flowData.batch1Notes || null,
              })
              .eq('id', affectedBatch.id);
            if (batch1Error) throw batch1Error;

            // Adjust WIP for batch 1
            const batch1Delta = batch1Kg - previousOutput;
            if (batch1Delta !== 0) {
              const { error: ledgerError } = await supabase
                .from('wip_ledger')
                .insert({
                  target_date: batch.target_date,
                  roast_group: affectedBatch.roast_group,
                  entry_type: 'ADJUSTMENT',
                  delta_kg: batch1Delta,
                  related_batch_id: affectedBatch.id,
                  created_by: userId,
                  notes: 'Blend reconciliation adjustment',
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
              event_type: 'BIN_MIX_SAME',
              delta_wip_kg: 0,
              notes: flowData.notes || 'Two batches of same coffee blended in destoner',
              created_by: userId,
              metadata: {
                batch1_id: flowData.affectedBatchId,
                batch1_output_kg: batch1Kg,
                batch2_id: batch.id,
                batch2_output_kg: batch2Kg,
              },
            });
          if (eventError) throw eventError;
          break;
        }
        
        case 'BIN_MIX_DIFFERENT': {
          const blendedKg = parseFloat(flowData.blendedOutputKg) || 0;
          const affectedBatch = recentBatches.find(b => b.id === flowData.affectedBatchId);
          
          // Void current batch output (set to 0)
          const { error: voidCurrentError } = await supabase
            .from('roasted_batches')
            .update({ 
              status: 'ROASTED',
              actual_output_kg: 0,
              notes: `[VOIDED - BLEND] Output moved to salvage: ${flowData.notes}`,
            })
            .eq('id', batch.id);
          if (voidCurrentError) throw voidCurrentError;

          // If batch was PLANNED, don't add any WIP (output is 0)
          // If batch was already ROASTED, subtract its previous output
          if (batch.status === 'ROASTED' && batch.actual_output_kg > 0) {
            const { error: ledgerError } = await supabase
              .from('wip_ledger')
              .insert({
                target_date: batch.target_date,
                roast_group: batch.roast_group,
                entry_type: 'REALLOCATE_OUT',
                delta_kg: -batch.actual_output_kg,
                related_batch_id: batch.id,
                created_by: userId,
                notes: 'Output moved to salvage blend',
              });
            if (ledgerError) throw ledgerError;
          }

          // Void affected batch output if selected
          if (affectedBatch && affectedBatch.actual_output_kg > 0) {
            const { error: voidAffectedError } = await supabase
              .from('roasted_batches')
              .update({ 
                actual_output_kg: 0,
                notes: `[VOIDED - BLEND] Output moved to salvage: ${flowData.notes}`,
              })
              .eq('id', affectedBatch.id);
            if (voidAffectedError) throw voidAffectedError;

            // Remove WIP from affected batch's roast group
            const { error: ledgerError } = await supabase
              .from('wip_ledger')
              .insert({
                target_date: batch.target_date,
                roast_group: affectedBatch.roast_group,
                entry_type: 'REALLOCATE_OUT',
                delta_kg: -affectedBatch.actual_output_kg,
                related_batch_id: affectedBatch.id,
                created_by: userId,
                notes: 'Output moved to salvage blend',
              });
            if (ledgerError) throw ledgerError;
          }

          // Create salvage batch
          const { error: salvageError } = await supabase
            .from('roasted_batches')
            .insert({
              target_date: batch.target_date,
              roast_group: flowData.salvageRoastGroup,
              status: 'ROASTED',
              actual_output_kg: blendedKg,
              planned_output_kg: blendedKg,
              cropster_batch_id: flowData.blendCropsterId || null,
              notes: `Salvage blend: ${flowData.notes}`,
              created_by: userId,
            });
          if (salvageError) throw salvageError;

          // Add WIP for salvage
          const { error: salvageLedgerError } = await supabase
            .from('wip_ledger')
            .insert({
              target_date: batch.target_date,
              roast_group: flowData.salvageRoastGroup,
              entry_type: 'REALLOCATE_IN',
              delta_kg: blendedKg,
              created_by: userId,
              notes: `Salvage blend from contamination: ${flowData.notes}`,
            });
          if (salvageLedgerError) throw salvageLedgerError;
          
          // Create exception event
          const { error: eventError } = await supabase
            .from('roast_exception_events')
            .insert({
              target_date: batch.target_date,
              roast_group: batch.roast_group,
              batch_id: batch.id,
              event_type: 'BIN_MIX_DIFFERENT',
              delta_wip_kg: 0,
              notes: flowData.notes,
              created_by: userId,
              metadata: {
                current_batch_id: batch.id,
                current_batch_roast_group: batch.roast_group,
                affected_batch_id: flowData.affectedBatchId,
                affected_batch_roast_group: affectedBatch?.roast_group,
                blended_output_kg: blendedKg,
                salvage_roast_group: flowData.salvageRoastGroup,
              },
            });
          if (eventError) throw eventError;
          break;
        }
        
        case 'DESTONER_SPILL': {
          const recovered = parseFloat(flowData.recoveredKg) || 0;
          const previousOutput = batch.actual_output_kg;
          const deltaWip = recovered - previousOutput;
          
          // Update batch
          if (batch.status === 'PLANNED') {
            const { error: batchError } = await supabase
              .from('roasted_batches')
              .update({ 
                status: 'ROASTED',
                actual_output_kg: recovered,
                notes: `[SPILL] ${flowData.notes}`,
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
                delta_kg: recovered,
                related_batch_id: batch.id,
                created_by: userId,
                notes: `Spill recovery: ${flowData.notes}`,
              });
            if (ledgerError) throw ledgerError;
          } else {
            // Already roasted - update output and adjust WIP
            const { error: batchError } = await supabase
              .from('roasted_batches')
              .update({ 
                actual_output_kg: recovered,
                notes: `[SPILL] ${flowData.notes}`,
              })
              .eq('id', batch.id);
            if (batchError) throw batchError;
            
            if (deltaWip !== 0) {
              const { error: ledgerError } = await supabase
                .from('wip_ledger')
                .insert({
                  target_date: batch.target_date,
                  roast_group: batch.roast_group,
                  entry_type: 'LOSS',
                  delta_kg: deltaWip,
                  related_batch_id: batch.id,
                  created_by: userId,
                  notes: `Spill loss: ${flowData.notes}`,
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
                recovered_kg: recovered,
                estimated_loss_kg: parseFloat(flowData.estimatedLossKg) || null,
                yield_percent: yieldPercent.toFixed(1),
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
        
        case 'OTHER': {
          const adjustKg = parseFloat(flowData.otherOutputKg) || 0;
          
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
      queryClient.invalidateQueries({ queryKey: ['roast-exception-events'] });
      onOpenChange(false);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to apply changes');
    },
  });

  const canProceedToConfirm = (): boolean => {
    switch (step) {
      case 'blend-same':
        return flowData.batch1OutputKg.trim() !== '' && flowData.batch2OutputKg.trim() !== '';
      case 'blend-different':
        return flowData.blendedOutputKg.trim() !== '' && flowData.notes.trim() !== '';
      case 'spill':
        return flowData.recoveredKg.trim() !== '' && flowData.notes.trim() !== '';
      case 'contamination':
        return flowData.blendedOutputKg.trim() !== '' && flowData.notes.trim() !== '';
      case 'adjust':
        return flowData.adjustRoastGroup !== '' && 
          flowData.adjustKg.trim() !== '' && 
          flowData.adjustReason !== '' &&
          (Math.abs(parseFloat(flowData.adjustKg) || 0) < 0.5 || flowData.notes.trim() !== '');
      case 'other':
        return flowData.notes.trim() !== '';
      default:
        return false;
    }
  };

  const handleOptionClick = (option: string) => {
    switch (option) {
      case 'blend':
        setStep('blend-check');
        break;
      case 'spill':
        setFlowData(d => ({ ...d, eventType: 'DESTONER_SPILL' }));
        setStep('spill');
        break;
      case 'contamination':
        setFlowData(d => ({ ...d, eventType: 'BIN_MIX_DIFFERENT' }));
        setStep('contamination');
        break;
      case 'adjust':
        setFlowData(d => ({ ...d, eventType: 'WIP_ADJUSTMENT' }));
        setStep('adjust');
        break;
      case 'other':
        setFlowData(d => ({ ...d, eventType: 'OTHER' }));
        setStep('other');
        break;
    }
  };

  const handleBlendTypeChoice = (same: boolean) => {
    if (same) {
      setFlowData(d => ({ ...d, eventType: 'BIN_MIX_SAME' }));
      setStep('blend-same');
    } else {
      setFlowData(d => ({ ...d, eventType: 'BIN_MIX_DIFFERENT' }));
      setStep('blend-different');
    }
  };

  const goBack = () => {
    switch (step) {
      case 'blend-check':
      case 'spill':
      case 'contamination':
      case 'adjust':
      case 'other':
        setStep('choose');
        break;
      case 'blend-same':
      case 'blend-different':
        setStep('blend-check');
        break;
      case 'confirm':
        switch (flowData.eventType) {
          case 'BIN_MIX_SAME': setStep('blend-same'); break;
          case 'BIN_MIX_DIFFERENT': 
            if (step === 'confirm') setStep('blend-different');
            break;
          case 'DESTONER_SPILL': setStep('spill'); break;
          case 'WIP_ADJUSTMENT': setStep('adjust'); break;
          case 'OTHER': setStep('other'); break;
          default: setStep('choose');
        }
        break;
      default:
        setStep('choose');
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
              {/* Option 1: Most common - Two batches blended */}
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3 px-4 border-2 border-primary/50 bg-primary/5 hover:bg-primary/10"
                onClick={() => handleOptionClick('blend')}
              >
                <div className="space-y-0.5">
                  <div className="font-medium">Two batches got blended in the destoner</div>
                  <div className="text-xs text-muted-foreground">
                    I started releasing a batch and realized the previous batch was still in the destoner.
                  </div>
                </div>
              </Button>

              {/* Option 2: Spill */}
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3 px-4"
                onClick={() => handleOptionClick('spill')}
              >
                <div className="space-y-0.5">
                  <div className="font-medium">Some or all of the batch spilled on the floor</div>
                  <div className="text-xs text-muted-foreground">
                    I lost coffee during release/handling.
                  </div>
                </div>
              </Button>

              {/* Option 3: Contamination (different coffee dumped onto previous) */}
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3 px-4"
                onClick={() => handleOptionClick('contamination')}
              >
                <div className="space-y-0.5">
                  <div className="font-medium">Contamination: I dumped some of this batch onto the previous batch</div>
                  <div className="text-xs text-muted-foreground">
                    Two coffees mixed, but not necessarily fully blended in the destoner.
                  </div>
                </div>
              </Button>

              {/* Option 4: Something else */}
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto py-3 px-4"
                onClick={() => handleOptionClick('other')}
              >
                <div className="space-y-0.5">
                  <div className="font-medium">Something else happened</div>
                  <div className="text-xs text-muted-foreground">
                    I'm not sure which option fits.
                  </div>
                </div>
              </Button>
            </div>
          </div>
        );

      case 'blend-check':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Two batches blended in destoner</h3>
              <p className="text-sm text-muted-foreground">
                Are both batches the same coffee/roast group?
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-1"
                onClick={() => handleBlendTypeChoice(true)}
              >
                <span className="font-medium">Same coffee</span>
                <span className="text-xs text-muted-foreground">Easy fix</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-1 border-destructive/50"
                onClick={() => handleBlendTypeChoice(false)}
              >
                <span className="font-medium">Different coffees</span>
                <span className="text-xs text-muted-foreground">Blended product</span>
              </Button>
            </div>
          </div>
        );

      case 'blend-same':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Same coffee blended — Reconcile weights</h3>
            </div>
            
            {/* SOP Guidance */}
            <div className="p-3 bg-muted rounded-md text-sm space-y-2">
              <div className="font-medium text-xs uppercase tracking-wide text-muted-foreground">SOP Steps</div>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Get a second bin</li>
                <li>Continue releasing until all coffee is out</li>
                <li>Weigh both bins</li>
                <li>Enter weights for the two affected batches below</li>
              </ol>
            </div>

            {/* Select affected batch (the previous one) */}
            {sameCoffeeBatches.length > 0 && (
              <div className="space-y-2">
                <Label>Previous batch in destoner</Label>
                <Select
                  value={flowData.affectedBatchId ?? ''}
                  onValueChange={(val) => setFlowData(d => ({ ...d, affectedBatchId: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select the earlier batch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sameCoffeeBatches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.roast_group} — {b.actual_output_kg.toFixed(1)} kg (current output)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Batch 1 (previous batch) */}
            <div className="p-3 border rounded-md space-y-3">
              <div className="font-medium text-sm">Batch 1 (previous batch)</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="batch1-kg" className="text-xs">Output weight (kg) *</Label>
                  <Input
                    id="batch1-kg"
                    type="number"
                    step="0.1"
                    value={flowData.batch1OutputKg}
                    onChange={(e) => setFlowData(d => ({ ...d, batch1OutputKg: e.target.value }))}
                    placeholder="e.g. 18.0"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="batch1-cropster" className="text-xs">Cropster ID</Label>
                  <Input
                    id="batch1-cropster"
                    value={flowData.batch1CropsterId}
                    onChange={(e) => setFlowData(d => ({ ...d, batch1CropsterId: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="batch1-notes" className="text-xs">Notes</Label>
                <Textarea
                  id="batch1-notes"
                  value={flowData.batch1Notes}
                  onChange={(e) => setFlowData(d => ({ ...d, batch1Notes: e.target.value }))}
                  placeholder="Optional"
                  className="max-h-20 resize-none"
                  rows={1}
                />
              </div>
            </div>

            {/* Batch 2 (current batch) */}
            <div className="p-3 border rounded-md space-y-3">
              <div className="font-medium text-sm">Batch 2 (this batch: {batch.roast_group})</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="batch2-kg" className="text-xs">Output weight (kg) *</Label>
                  <Input
                    id="batch2-kg"
                    type="number"
                    step="0.1"
                    value={flowData.batch2OutputKg}
                    onChange={(e) => setFlowData(d => ({ ...d, batch2OutputKg: e.target.value }))}
                    placeholder="e.g. 17.5"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="batch2-cropster" className="text-xs">Cropster ID</Label>
                  <Input
                    id="batch2-cropster"
                    value={flowData.batch2CropsterId}
                    onChange={(e) => setFlowData(d => ({ ...d, batch2CropsterId: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="batch2-notes" className="text-xs">Notes</Label>
                <Textarea
                  id="batch2-notes"
                  value={flowData.batch2Notes}
                  onChange={(e) => setFlowData(d => ({ ...d, batch2Notes: e.target.value }))}
                  placeholder="Optional"
                  className="max-h-20 resize-none"
                  rows={1}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="blend-notes" className="text-xs">General notes</Label>
              <Textarea
                id="blend-notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Optional"
                className="max-h-20 resize-none"
                rows={1}
              />
            </div>
          </div>
        );

      case 'blend-different':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Different coffees blended — Salvage</h3>
            </div>
            
            {/* SOP Guidance */}
            <div className="p-3 bg-muted rounded-md text-sm space-y-2">
              <div className="font-medium text-xs uppercase tracking-wide text-muted-foreground">SOP Steps</div>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Treat 100% of the output as a blended/contaminated batch</li>
                <li>None of the output should count toward either planned product</li>
                <li>Record as salvage blend below</li>
              </ol>
            </div>

            {/* Select affected batch (optional) */}
            {recentBatches.length > 0 && (
              <div className="space-y-2">
                <Label>Previous batch affected (optional)</Label>
                <Select
                  value={flowData.affectedBatchId ?? ''}
                  onValueChange={(val) => setFlowData(d => ({ ...d, affectedBatchId: val || null }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select if known..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None / Unknown</SelectItem>
                    {recentBatches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.roast_group} — {b.actual_output_kg.toFixed(1)} kg
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="blended-kg">Total blended output weight (kg) *</Label>
              <Input
                id="blended-kg"
                type="number"
                step="0.1"
                value={flowData.blendedOutputKg}
                onChange={(e) => setFlowData(d => ({ ...d, blendedOutputKg: e.target.value }))}
                placeholder="e.g. 35.0"
              />
            </div>

            <div className="space-y-2">
              <Label>Salvage roast group</Label>
              <Select
                value={flowData.salvageRoastGroup}
                onValueChange={(val) => setFlowData(d => ({ ...d, salvageRoastGroup: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select or use default..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SALVAGE_ROAST_GROUP}>{SALVAGE_ROAST_GROUP}</SelectItem>
                  {allRoastGroups.filter(g => g !== SALVAGE_ROAST_GROUP).map(g => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="blend-cropster">Cropster batch ID(s)</Label>
              <Input
                id="blend-cropster"
                value={flowData.blendCropsterId}
                onChange={(e) => setFlowData(d => ({ ...d, blendCropsterId: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes *</Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Describe what happened and what coffees were mixed"
                className="max-h-24 resize-none"
                rows={2}
              />
            </div>
          </div>
        );

      case 'spill':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Batch spilled — Record recovery</h3>
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
              <Label htmlFor="recovered-kg">Output (roasted) kg actually recovered *</Label>
              <Input
                id="recovered-kg"
                type="number"
                step="0.1"
                value={flowData.recoveredKg}
                onChange={(e) => setFlowData(d => ({ ...d, recoveredKg: e.target.value }))}
                placeholder="e.g. 15.0"
              />
              {flowData.recoveredKg && inboundKg > 0 && (
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

            <div className="space-y-2">
              <Label htmlFor="loss-kg">Estimated loss (kg)</Label>
              <Input
                id="loss-kg"
                type="number"
                step="0.1"
                value={flowData.estimatedLossKg}
                onChange={(e) => setFlowData(d => ({ ...d, estimatedLossKg: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="notes">Notes *</Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="What happened? Where did it spill?"
                className="max-h-24 resize-none"
                rows={2}
              />
            </div>
          </div>
        );

      case 'contamination':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Contamination — Route to salvage</h3>
              <p className="text-sm text-muted-foreground">
                The contaminated output will be routed to a salvage product.
              </p>
            </div>
            
            {/* Select affected batch */}
            {recentBatches.length > 0 && (
              <div className="space-y-2">
                <Label>Which batch was contaminated?</Label>
                <Select
                  value={flowData.affectedBatchId ?? ''}
                  onValueChange={(val) => setFlowData(d => ({ ...d, affectedBatchId: val || null }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select if known..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None / Unknown</SelectItem>
                    {recentBatches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.roast_group} — {b.actual_output_kg.toFixed(1)} kg
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="contaminated-kg">Contaminated output weight (kg) *</Label>
              <Input
                id="contaminated-kg"
                type="number"
                step="0.1"
                value={flowData.blendedOutputKg}
                onChange={(e) => setFlowData(d => ({ ...d, blendedOutputKg: e.target.value }))}
                placeholder="e.g. 5.0"
              />
            </div>

            <div className="space-y-2">
              <Label>Salvage roast group</Label>
              <Select
                value={flowData.salvageRoastGroup}
                onValueChange={(val) => setFlowData(d => ({ ...d, salvageRoastGroup: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select or use default..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SALVAGE_ROAST_GROUP}>{SALVAGE_ROAST_GROUP}</SelectItem>
                  {allRoastGroups.filter(g => g !== SALVAGE_ROAST_GROUP).map(g => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes *</Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Describe what happened"
                className="max-h-24 resize-none"
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
                className="max-h-24 resize-none"
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

      case 'other':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold">Something else happened</h3>
            </div>
            
            {/* SOP Guidance */}
            <div className="p-3 bg-muted rounded-md text-sm space-y-2">
              <div className="font-medium text-xs uppercase tracking-wide text-muted-foreground">For now</div>
              <p className="text-sm">
                Reconcile inventory manually and leave detailed notes. We'll add a guided workflow later.
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="notes">Description *</Label>
              <Textarea
                id="notes"
                value={flowData.notes}
                onChange={(e) => setFlowData(d => ({ ...d, notes: e.target.value }))}
                placeholder="What happened?"
                className="max-h-28 resize-none"
                rows={3}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="other-kg">Output weight (kg) recovered</Label>
              <Input
                id="other-kg"
                type="number"
                step="0.1"
                value={flowData.otherOutputKg}
                onChange={(e) => setFlowData(d => ({ ...d, otherOutputKg: e.target.value }))}
                placeholder="Optional"
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
              
              {flowData.eventType === 'BIN_MIX_SAME' && (
                <>
                  <div className="flex justify-between">
                    <span>Batch 1 output:</span>
                    <span className="font-medium">{flowData.batch1OutputKg} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Batch 2 output:</span>
                    <span className="font-medium">{flowData.batch2OutputKg} kg</span>
                  </div>
                </>
              )}
              
              {flowData.eventType === 'BIN_MIX_DIFFERENT' && (
                <>
                  <div className="flex justify-between">
                    <span>Blended output:</span>
                    <span className="font-medium">{flowData.blendedOutputKg} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Salvage group:</span>
                    <span className="font-medium">{flowData.salvageRoastGroup}</span>
                  </div>
                </>
              )}
              
              {flowData.eventType === 'DESTONER_SPILL' && (
                <>
                  <div className="flex justify-between">
                    <span>Output recovered:</span>
                    <span className="font-medium">{flowData.recoveredKg} kg</span>
                  </div>
                  {inboundKg > 0 && (
                    <div className="flex justify-between">
                      <span>Yield:</span>
                      <span className="font-medium">{yieldPercent.toFixed(1)}%</span>
                    </div>
                  )}
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
              
              {flowData.notes && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground">Notes:</span>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{flowData.notes}</p>
                </div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
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
        
        <ScrollArea className="flex-1 px-6 overflow-y-auto">
          <div className="pb-4">
            {renderStep()}
          </div>
        </ScrollArea>
        
        {/* Sticky footer */}
        <div className="shrink-0 border-t bg-background px-6 py-4 flex flex-row gap-2 justify-end">
          {step === 'choose' ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={goBack}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              
              {step !== 'confirm' && step !== 'blend-check' && (
                <Button
                  onClick={() => setStep('confirm')}
                  disabled={!canProceedToConfirm()}
                >
                  Review
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
