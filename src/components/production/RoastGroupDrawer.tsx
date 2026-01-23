import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { 
  ChevronDown, 
  ChevronRight, 
  Flame, 
  Check, 
  Trash2, 
  Plus,
  Undo2,
  Settings,
  Clock,
  Loader2,
  AlertTriangle
} from 'lucide-react';
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
import { OhShitModal } from './OhShitModal';

type RoasterMachine = 'SAMIAC' | 'LORING';
type DefaultRoaster = 'SAMIAC' | 'LORING' | 'EITHER';

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
  is_active: boolean;
  notes: string | null;
}

interface RoastGroupDrawerProps {
  roastGroup: string;
  demandKg: number;
  hasTimeSensitive: boolean;
  batches: RoastBatch[];
  config: RoastGroupConfig | undefined;
  roastedTotal: number;
  today: string;
  allRoastGroups: string[];
  onOpenConfig: (roastGroup: string) => void;
  onEditingChange: (isEditing: boolean) => void;
}

export function RoastGroupDrawer({
  roastGroup,
  demandKg,
  hasTimeSensitive,
  batches,
  config,
  roastedTotal,
  today,
  allRoastGroups,
  onOpenConfig,
  onEditingChange,
}: RoastGroupDrawerProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [undoConfirmBatchId, setUndoConfirmBatchId] = useState<string | null>(null);
  const [deleteConfirmBatchId, setDeleteConfirmBatchId] = useState<string | null>(null);
  const [ohShitBatch, setOhShitBatch] = useState<RoastBatch | null>(null);
  
  // Edit mode tracking for sort-freeze
  const [isEditingAny, setIsEditingAny] = useState(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate stats
  const plannedBatches = batches.filter(b => b.status === 'PLANNED');
  const roastedBatches = batches.filter(b => b.status === 'ROASTED');
  const plannedTotal = plannedBatches.reduce((sum, b) => sum + (b.planned_output_kg ?? 0), 0);
  const roastedTodayKg = roastedBatches.reduce((sum, b) => sum + b.actual_output_kg, 0);
  const standardBatch = config?.standard_batch_kg ?? 20;
  const defaultRoaster = config?.default_roaster ?? 'EITHER';
  
  const isCovered = (roastedTotal + plannedTotal) >= demandKg;

  // Sort batches: PLANNED first (created_at asc), then ROASTED (updated_at desc)
  const sortedBatches = [...batches].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'PLANNED' ? -1 : 1;
    }
    if (a.status === 'PLANNED') {
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    }
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  });

  // Notify parent of editing state changes
  const notifyEditingChange = useCallback((editing: boolean) => {
    setIsEditingAny(editing);
    onEditingChange(editing);
  }, [onEditingChange]);

  // Reset idle timeout - allows re-sort after 1200ms of inactivity
  const resetIdleTimeout = useCallback(() => {
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }
    idleTimeoutRef.current = setTimeout(() => {
      notifyEditingChange(false);
    }, 1200);
  }, [notifyEditingChange]);

  const handleInputFocus = useCallback(() => {
    notifyEditingChange(true);
    resetIdleTimeout();
  }, [notifyEditingChange, resetIdleTimeout]);

  const handleInputBlur = useCallback(() => {
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
    notifyEditingChange(false);
  }, [notifyEditingChange]);

  const handleInputChange = useCallback(() => {
    resetIdleTimeout();
  }, [resetIdleTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
    };
  }, []);

  // Mutations
  const updateBatchMutation = useMutation({
    mutationFn: async (data: { 
      id: string; 
      planned_output_kg?: number | null;
      actual_output_kg?: number;
      assigned_roaster?: RoasterMachine | null;
      notes?: string | null;
      cropster_batch_id?: string | null;
    }) => {
      const { id, ...updates } = data;
      const { error } = await supabase
        .from('roasted_batches')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update batch');
    },
  });

  const markRoastedMutation = useMutation({
    mutationFn: async ({ id, actual_output_kg, roast_group, target_date }: { 
      id: string; 
      actual_output_kg: number;
      roast_group: string;
      target_date: string;
    }) => {
      // Update batch status
      const { error: batchError } = await supabase
        .from('roasted_batches')
        .update({ 
          status: 'ROASTED',
          actual_output_kg,
        })
        .eq('id', id)
        .eq('status', 'PLANNED');
      if (batchError) throw batchError;
      
      // Create WIP ledger entry for roast output
      const { error: ledgerError } = await supabase
        .from('wip_ledger')
        .insert({
          target_date,
          roast_group,
          entry_type: 'ROAST_OUTPUT',
          delta_kg: actual_output_kg,
          related_batch_id: id,
          created_by: user?.id,
          notes: '',
        });
      if (ledgerError) throw ledgerError;
    },
    onSuccess: () => {
      toast.success('Batch marked as roasted');
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['wip-ledger'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark batch as roasted');
    },
  });

  const revertToPlannedMutation = useMutation({
    mutationFn: async ({ id, actual_output_kg, roast_group, target_date }: { 
      id: string;
      actual_output_kg: number;
      roast_group: string;
      target_date: string;
    }) => {
      // Revert batch status
      const { error: batchError } = await supabase
        .from('roasted_batches')
        .update({ status: 'PLANNED' })
        .eq('id', id)
        .eq('status', 'ROASTED');
      if (batchError) throw batchError;
      
      // Create reversing WIP ledger entry (negative of original output)
      const { error: ledgerError } = await supabase
        .from('wip_ledger')
        .insert({
          target_date,
          roast_group,
          entry_type: 'ADJUSTMENT',
          delta_kg: -actual_output_kg,
          related_batch_id: id,
          created_by: user?.id,
          notes: 'Reverted batch to planned',
        });
      if (ledgerError) throw ledgerError;
    },
    onSuccess: () => {
      toast.success('Batch reverted to planned');
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['wip-ledger'] });
      setUndoConfirmBatchId(null);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to revert batch');
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('roasted_batches')
        .delete()
        .eq('id', id)
        .eq('status', 'PLANNED');
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Batch deleted');
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      setDeleteConfirmBatchId(null);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to delete batch');
    },
  });

  const createBatchMutation = useMutation({
    mutationFn: async () => {
      const roaster: RoasterMachine | null = 
        defaultRoaster === 'SAMIAC' ? 'SAMIAC' : 
        defaultRoaster === 'LORING' ? 'LORING' : 
        null;
      
      const { error } = await supabase
        .from('roasted_batches')
        .insert({
          roast_group: roastGroup,
          target_date: today,
          planned_output_kg: standardBatch,
          actual_output_kg: 0,
          status: 'PLANNED',
          assigned_roaster: roaster,
          created_by: user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Batch added');
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to create batch');
    },
  });

  const getRoasterBadgeColor = (roaster: RoasterMachine | null | DefaultRoaster) => {
    if (roaster === 'SAMIAC') return 'bg-blue-100 text-blue-800 border-blue-300';
    if (roaster === 'LORING') return 'bg-orange-100 text-orange-800 border-orange-300';
    return 'bg-muted text-muted-foreground';
  };

  const handleUndoConfirm = () => {
    const batch = batches.find(b => b.id === undoConfirmBatchId);
    if (batch) {
      revertToPlannedMutation.mutate({
        id: batch.id,
        actual_output_kg: batch.actual_output_kg,
        roast_group: batch.roast_group,
        target_date: batch.target_date,
      });
    }
  };

  return (
    <>
      {/* Collapsed Row */}
      <tr 
        className={`border-b cursor-pointer transition-colors 
          ${hasTimeSensitive ? 'bg-destructive/5' : ''} 
          ${isExpanded ? 'bg-accent/40 border-l-2 border-l-primary' : 'hover:bg-muted/50'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <td className="py-3 w-8 px-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{roastGroup}</span>
            {defaultRoaster !== 'EITHER' && (
              <Badge variant="outline" className={`text-xs ${getRoasterBadgeColor(defaultRoaster)}`}>
                {defaultRoaster}
              </Badge>
            )}
            {hasTimeSensitive && (
              <Badge variant="destructive" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                Urgent
              </Badge>
            )}
          </div>
        </td>
        <td className="py-3 text-right">
          <span className="font-medium">{demandKg.toFixed(1)}</span>
          <span className="text-muted-foreground text-xs ml-1">kg</span>
        </td>
        <td className="py-3 text-right">
          <span className="font-medium">{plannedTotal.toFixed(1)}</span>
          <span className="text-muted-foreground text-xs ml-1">kg</span>
        </td>
        <td className="py-3 text-right">
          <span className="font-medium text-primary">{roastedTodayKg.toFixed(1)}</span>
          <span className="text-muted-foreground text-xs ml-1">kg</span>
        </td>
        <td className="py-3 text-right">
          {isCovered ? (
            <Badge variant="default" className="bg-primary text-primary-foreground">
              <Check className="h-3 w-3 mr-1" />
              Covered
            </Badge>
          ) : (
            <Badge variant="secondary">
              Short
            </Badge>
          )}
        </td>
      </tr>

      {/* Expanded Drawer */}
      {isExpanded && (
        <tr className="bg-accent/30 border-l-2 border-l-primary">
          <td colSpan={6} className="py-3 px-4 pl-8">
            <div className="space-y-3">
              {/* Header with config button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Std batch: {standardBatch} kg</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 w-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenConfig(roastGroup);
                    }}
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    createBatchMutation.mutate();
                  }}
                  disabled={createBatchMutation.isPending}
                >
                  {createBatchMutation.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3 mr-1" />
                  )}
                  Add batch
                </Button>
              </div>

              {/* Batch Queue */}
              {sortedBatches.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No batches queued.</p>
              ) : (
                <div className="space-y-2">
                  {sortedBatches.map((batch) => (
                    <BatchRow
                      key={batch.id}
                      batch={batch}
                      onMarkRoasted={(id, actual) => markRoastedMutation.mutate({ 
                        id, 
                        actual_output_kg: actual,
                        roast_group: batch.roast_group,
                        target_date: batch.target_date,
                      })}
                      onUndo={(id) => setUndoConfirmBatchId(id)}
                      onDelete={(id) => setDeleteConfirmBatchId(id)}
                      onOhShit={(batch) => setOhShitBatch(batch)}
                      onUpdate={(data) => updateBatchMutation.mutate(data)}
                      onInputFocus={handleInputFocus}
                      onInputBlur={handleInputBlur}
                      onInputChange={handleInputChange}
                      isUpdating={updateBatchMutation.isPending}
                      getRoasterBadgeColor={getRoasterBadgeColor}
                    />
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      {/* Undo Confirmation Dialog */}
      <AlertDialog open={!!undoConfirmBatchId} onOpenChange={(open) => !open && setUndoConfirmBatchId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert to Planned?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert the batch to PLANNED status. This may affect inventory and packing availability. 
              Your output kg, cropster ID, and notes will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUndoConfirm}
              disabled={revertToPlannedMutation.isPending}
            >
              {revertToPlannedMutation.isPending ? 'Reverting…' : 'Revert to Planned'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmBatchId} onOpenChange={(open) => !open && setDeleteConfirmBatchId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this planned batch. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmBatchId && deleteBatchMutation.mutate(deleteConfirmBatchId)}
              disabled={deleteBatchMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBatchMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Oh Shit Modal */}
      {ohShitBatch && (
        <OhShitModal
          open={!!ohShitBatch}
          onOpenChange={(open) => !open && setOhShitBatch(null)}
          batch={ohShitBatch}
          allBatches={batches}
          allRoastGroups={allRoastGroups}
          today={today}
        />
      )}
    </>
  );
}

// Inner batch row component
interface BatchRowProps {
  batch: RoastBatch;
  onMarkRoasted: (id: string, actualKg: number) => void;
  onUndo: (id: string) => void;
  onDelete: (id: string) => void;
  onOhShit: (batch: RoastBatch) => void;
  onUpdate: (data: { id: string; [key: string]: unknown }) => void;
  onInputFocus: () => void;
  onInputBlur: () => void;
  onInputChange: () => void;
  isUpdating: boolean;
  getRoasterBadgeColor: (roaster: RoasterMachine | null) => string;
}

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

function BatchRow({
  batch,
  onMarkRoasted,
  onUndo,
  onDelete,
  onOhShit,
  onUpdate,
  onInputFocus,
  onInputBlur,
  onInputChange,
  isUpdating,
  getRoasterBadgeColor,
}: BatchRowProps) {
  const [plannedKg, setPlannedKg] = useState(batch.planned_output_kg?.toString() ?? '');
  const [actualKg, setActualKg] = useState(batch.actual_output_kg?.toString() ?? '0');
  const [cropsterId, setCropsterId] = useState(batch.cropster_batch_id ?? '');
  const [notes, setNotes] = useState(batch.notes ?? '');
  
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Sync state when batch changes (after refetch)
  useEffect(() => {
    setPlannedKg(batch.planned_output_kg?.toString() ?? '');
    setActualKg(batch.actual_output_kg?.toString() ?? '0');
    setCropsterId(batch.cropster_batch_id ?? '');
    setNotes(batch.notes ?? '');
  }, [batch]);

  const scheduleUpdate = useCallback((field: string, value: unknown) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onUpdate({ id: batch.id, [field]: value });
    }, 500);
  }, [batch.id, onUpdate]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handlePlannedKgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPlannedKg(val);
    onInputChange();
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      scheduleUpdate('planned_output_kg', parsed);
    }
  };

  const handleActualKgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setActualKg(val);
    onInputChange();
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) {
      scheduleUpdate('actual_output_kg', parsed);
    }
  };

  const handleCropsterIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCropsterId(val);
    onInputChange();
    scheduleUpdate('cropster_batch_id', val || null);
  };

  const handleNotesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNotes(val);
    onInputChange();
    scheduleUpdate('notes', val || null);
  };

  const handleRoasterChange = (val: string) => {
    const roaster = val === 'UNASSIGNED' ? null : val as RoasterMachine;
    onUpdate({ id: batch.id, assigned_roaster: roaster });
  };

  const handleMarkRoasted = () => {
    const actualValue = parseFloat(actualKg) || parseFloat(plannedKg) || 0;
    onMarkRoasted(batch.id, actualValue);
  };

  const isPlanned = batch.status === 'PLANNED';
  const isRoasted = batch.status === 'ROASTED';

  return (
    <div
      className={`flex flex-wrap items-center gap-2 p-2 rounded border text-sm
        ${isRoasted ? 'bg-green-50 border-green-200' : 'bg-background'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-1 min-w-[24px]">
        {isRoasted ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : (
          <Flame className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Inbound (green) kg - renamed from "planned" */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">Inbound:</span>
        <Input
          type="number"
          step="0.1"
          className="w-16 h-7 text-sm px-2"
          value={plannedKg}
          onChange={handlePlannedKgChange}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
          disabled={isUpdating}
        />
        <span className="text-xs text-muted-foreground">kg</span>
      </div>

      {/* Output (roasted) kg - renamed from "actual" */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">Output:</span>
        <Input
          type="number"
          step="0.1"
          className="w-16 h-7 text-sm px-2"
          value={actualKg}
          onChange={handleActualKgChange}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
          disabled={isUpdating}
        />
        <span className="text-xs text-muted-foreground">kg</span>
      </div>

      {/* Roaster */}
      <Select
        value={batch.assigned_roaster ?? 'UNASSIGNED'}
        onValueChange={handleRoasterChange}
      >
        <SelectTrigger 
          className={`h-7 w-24 text-xs ${getRoasterBadgeColor(batch.assigned_roaster)}`}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
        >
          <SelectValue placeholder="Roaster" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
          <SelectItem value="SAMIAC">SAMIAC</SelectItem>
          <SelectItem value="LORING">LORING</SelectItem>
        </SelectContent>
      </Select>

      {/* Cropster ID */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">Cropster:</span>
        <Input
          type="text"
          className="w-20 h-7 text-sm px-2"
          value={cropsterId}
          onChange={handleCropsterIdChange}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
          placeholder="—"
          disabled={isUpdating}
        />
      </div>

      {/* Notes */}
      <div className="flex items-center gap-1 flex-1 min-w-[100px]">
        <span className="text-xs text-muted-foreground">Notes:</span>
        <Input
          type="text"
          className="h-7 text-sm px-2 flex-1"
          value={notes}
          onChange={handleNotesChange}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
          placeholder="—"
          disabled={isUpdating}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Oh Shit Button - always visible */}
        <Button 
          size="sm" 
          variant="ghost"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => onOhShit(batch)}
          title="Unexpected issue? Tap here."
        >
          <AlertTriangle className="h-4 w-4" />
        </Button>
        
        {isPlanned && (
          <>
            <Button 
              size="sm" 
              variant="default"
              className="h-7 text-xs"
              onClick={handleMarkRoasted}
            >
              <Flame className="h-3 w-3 mr-1" />
              Mark Roasted
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => onDelete(batch.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
        {isRoasted && (
          <Button 
            size="sm" 
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => onUndo(batch.id)}
          >
            <Undo2 className="h-3 w-3 mr-1" />
            Undo
          </Button>
        )}
      </div>
    </div>
  );
}
