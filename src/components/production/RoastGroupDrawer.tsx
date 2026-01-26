import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  AlertTriangle,
  GripVertical
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
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
  expected_yield_loss_pct: number;
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
  isDragging?: boolean;
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
  isDragging = false,
}: RoastGroupDrawerProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Sortable hook for drag and drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: roastGroup });
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [undoConfirmBatchId, setUndoConfirmBatchId] = useState<string | null>(null);
  const [deleteConfirmBatchId, setDeleteConfirmBatchId] = useState<string | null>(null);
  const [ohShitBatch, setOhShitBatch] = useState<RoastBatch | null>(null);
  
  // Edit mode tracking for sort-freeze - freeze order while user is editing
  const [hasEditedSinceOpen, setHasEditedSinceOpen] = useState(false);
  
  // Frozen batches order - captured when drawer opens, only refreshed on collapse/reopen or Mark Roasted
  const [frozenBatches, setFrozenBatches] = useState<RoastBatch[] | null>(null);
  
  // Track drawer open state to detect reopen
  const prevExpandedRef = React.useRef(isExpanded);

  // Calculate stats
  const plannedBatches = batches.filter(b => b.status === 'PLANNED');
  const roastedBatches = batches.filter(b => b.status === 'ROASTED');
  const standardBatch = config?.standard_batch_kg ?? 20;
  const defaultRoaster = config?.default_roaster ?? 'EITHER';
  const yieldLossPct = config?.expected_yield_loss_pct ?? 16;
  
  // Track if all batches are roasted (no PLANNED remaining)
  const isFullyRoasted = plannedBatches.length === 0 && roastedBatches.length > 0;
  
  // Calculate expected output for PLANNED batches (apply yield loss to inbound green kg)
  const plannedExpectedOutput = plannedBatches.reduce((sum, b) => {
    const inboundKg = b.planned_output_kg ?? 0;
    const expectedOutput = inboundKg * (1 - yieldLossPct / 100);
    return sum + expectedOutput;
  }, 0);
  
  // ROASTED batches use actual output
  const roastedTodayKg = roastedBatches.reduce((sum, b) => sum + b.actual_output_kg, 0);
  
  // Total coverage = expected from planned + actual from roasted
  const totalCoverage = plannedExpectedOutput + roastedTotal;
  const coverageDelta = totalCoverage - demandKg;

  // Sort batches helper function - STATIC ORDER by created_at only
  // No resorting by status - preserve user's "work down the list" flow
  const sortBatches = useCallback((batchList: RoastBatch[]) => {
    return [...batchList].sort((a, b) => {
      // Sort ONLY by created_at - do not move roasted batches to bottom
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    });
  }, []);

  // Capture frozen order when drawer opens or reopens
  useEffect(() => {
    const wasCollapsed = !prevExpandedRef.current;
    const isNowExpanded = isExpanded;
    
    if (wasCollapsed && isNowExpanded) {
      // Drawer just opened - freeze the current order
      setFrozenBatches(sortBatches(batches));
      setHasEditedSinceOpen(false);
    } else if (!isNowExpanded) {
      // Drawer closed - clear frozen state
      setFrozenBatches(null);
      setHasEditedSinceOpen(false);
    }
    
    prevExpandedRef.current = isExpanded;
  }, [isExpanded, batches, sortBatches]);

  // Use frozen order while drawer is open, but update batch data values (not positions)
  const sortedBatches = useMemo(() => {
    if (frozenBatches && hasEditedSinceOpen) {
      // Keep frozen order but with updated data values
      return frozenBatches
        .map(frozen => {
          const updated = batches.find(b => b.id === frozen.id);
          return updated ?? frozen;
        })
        .filter(b => batches.some(batch => batch.id === b.id));
    }
    // Not frozen or no edits yet - use live sorted order
    return sortBatches(batches);
  }, [frozenBatches, hasEditedSinceOpen, batches, sortBatches]);

  // Refresh frozen batches (called after Mark Roasted to reflect new positions)
  const refreshFrozenBatches = useCallback(() => {
    if (isExpanded) {
      // Re-freeze with current sorted order
      setFrozenBatches(sortBatches(batches));
      setHasEditedSinceOpen(false);
    }
  }, [isExpanded, batches, sortBatches]);

  // Notify parent of editing state changes (for outer roast group sorting)
  const notifyEditingChange = useCallback((editing: boolean) => {
    onEditingChange(editing);
  }, [onEditingChange]);

  // Called when user starts editing any input - freeze the batch order
  const handleInputFocus = useCallback(() => {
    setHasEditedSinceOpen(true);
    notifyEditingChange(true);
  }, [notifyEditingChange]);

  // Called when user leaves input - don't unfreeze (keep frozen until drawer closes)
  const handleInputBlur = useCallback(() => {
    // Don't unfreeze on blur - keep order stable while drawer is open
    // Parent sort-freeze is handled separately
    notifyEditingChange(false);
  }, [notifyEditingChange]);

  // Called when user types - mark as edited
  const handleInputChange = useCallback(() => {
    setHasEditedSinceOpen(true);
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
      // Refresh frozen batch order to reflect new status positions
      refreshFrozenBatches();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to mark batch as roasted');
    },
  });

  const revertToPlannedMutation = useMutation({
    mutationFn: async ({ id, actual_output_kg, roast_group, target_date, planned_output_kg, cropster_batch_id }: { 
      id: string;
      actual_output_kg: number;
      roast_group: string;
      target_date: string;
      planned_output_kg: number | null;
      cropster_batch_id: string | null;
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
      
      return { planned_output_kg, cropster_batch_id };
    },
    onSuccess: (data) => {
      const batchDetails = [
        data.planned_output_kg ? `${data.planned_output_kg} kg` : null,
        data.cropster_batch_id ? `Cropster: ${data.cropster_batch_id}` : null,
      ].filter(Boolean).join(' • ');
      
      toast.success(
        batchDetails 
          ? `Batch reverted to planned (${batchDetails})`
          : 'Batch reverted to planned'
      );
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['wip-ledger'] });
      setUndoConfirmBatchId(null);
      // Refresh frozen batch order to reflect new status positions
      refreshFrozenBatches();
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
        planned_output_kg: batch.planned_output_kg,
        cropster_batch_id: batch.cropster_batch_id,
      });
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <>
      {/* Collapsed Row */}
      <tr 
        ref={setNodeRef}
        style={style}
        className={`border-b cursor-pointer transition-colors 
          ${isFullyRoasted ? 'opacity-60' : ''}
          ${hasTimeSensitive && !isFullyRoasted ? 'bg-destructive/5' : ''} 
          ${isExpanded ? 'bg-accent/40 border-l-2 border-l-primary' : 'hover:bg-muted/50'}
          ${isDragging ? 'opacity-50' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <td className="py-3 w-8 px-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td 
          className="py-1 w-10 cursor-grab active:cursor-grabbing" 
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
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
          <div className="flex flex-col items-end">
            <span className="font-medium">{plannedExpectedOutput.toFixed(1)}</span>
            <span className="text-muted-foreground text-xs">expected</span>
          </div>
        </td>
        <td className="py-3 text-right">
          <span className="font-medium text-primary">{roastedTodayKg.toFixed(1)}</span>
          <span className="text-muted-foreground text-xs ml-1">kg</span>
        </td>
        <td className="py-3 text-right">
          {coverageDelta >= 0 ? (
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
              +{coverageDelta.toFixed(1)} kg expected
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">
              Short {Math.abs(coverageDelta).toFixed(1)} kg roasted
            </Badge>
          )}
        </td>
      </tr>

      {/* Expanded Drawer */}
      {isExpanded && (
        <tr className="bg-accent/30 border-l-2 border-l-primary">
          <td colSpan={7} className="py-3 px-4 pl-8">
            <div className="space-y-3">
              {/* Header with config button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Std batch: {standardBatch} kg inbound</span>
                  <span className="text-xs">({yieldLossPct}% loss)</span>
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
                      expectedYieldLossPct={yieldLossPct}
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
  expectedYieldLossPct: number;
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
  expectedYieldLossPct,
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
  // Default actual output to expected output based on yield loss
  const inboundDefault = batch.planned_output_kg ?? 0;
  const expectedOutputDefault = inboundDefault * (1 - expectedYieldLossPct / 100);
  const [actualKg, setActualKg] = useState(
    batch.actual_output_kg > 0 
      ? batch.actual_output_kg.toString() 
      : (inboundDefault > 0 ? expectedOutputDefault.toFixed(1) : '0')
  );
  const [cropsterId, setCropsterId] = useState(batch.cropster_batch_id ?? '');
  const [notes, setNotes] = useState(batch.notes ?? '');
  const [showYieldWarning, setShowYieldWarning] = useState(false);
  const [pendingMarkRoasted, setPendingMarkRoasted] = useState<{ id: string; actualKg: number } | null>(null);
  
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

  // Calculate expected output and implied loss
  const inboundKg = parseFloat(plannedKg) || 0;
  const outputKg = parseFloat(actualKg) || 0;
  const expectedOutputKg = inboundKg * (1 - expectedYieldLossPct / 100);
  const impliedLossPct = inboundKg > 0 && outputKg > 0 ? (1 - outputKg / inboundKg) * 100 : null;
  const isImpliedLossUnusual = impliedLossPct !== null && (impliedLossPct < 10 || impliedLossPct > 20);

  const handleMarkRoasted = () => {
    const actualValue = outputKg || expectedOutputKg;
    
    // Calculate implied loss for sanity check
    const checkInbound = inboundKg;
    const checkOutput = actualValue;
    const checkLoss = checkInbound > 0 ? (1 - checkOutput / checkInbound) * 100 : expectedYieldLossPct;
    
    // If implied loss is outside 10-20%, show warning
    if (checkInbound > 0 && (checkLoss < 10 || checkLoss > 20)) {
      setPendingMarkRoasted({ id: batch.id, actualKg: actualValue });
      setShowYieldWarning(true);
    } else {
      onMarkRoasted(batch.id, actualValue);
    }
  };

  const handleConfirmMarkRoasted = () => {
    if (pendingMarkRoasted) {
      onMarkRoasted(pendingMarkRoasted.id, pendingMarkRoasted.actualKg);
    }
    setShowYieldWarning(false);
    setPendingMarkRoasted(null);
  };

  const isPlanned = batch.status === 'PLANNED';
  const isRoasted = batch.status === 'ROASTED';

  return (
    <>
      <div
        className={`flex flex-col gap-1 p-2 rounded border text-sm
          ${isRoasted ? 'bg-green-50 border-green-200' : 'bg-background'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Main row with inputs */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status indicator */}
          <div className="flex items-center gap-1 min-w-[24px]">
            {isRoasted ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Flame className="h-4 w-4 text-muted-foreground" />
            )}
          </div>

          {/* Inbound/Green kg */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Inbound/Green:</span>
            <Input
              type="number"
              step="0.1"
              min="0"
              className="w-16 h-7 text-sm px-2"
              value={plannedKg}
              onChange={handlePlannedKgChange}
              onFocus={onInputFocus}
              onBlur={onInputBlur}
              disabled={isUpdating}
            />
            <span className="text-xs text-muted-foreground">kg</span>
          </div>

          {/* Actual output kg */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Actual output:</span>
            <Input
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
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

        {/* Hints row */}
        <div className="flex items-center gap-3 pl-8 text-xs text-muted-foreground">
          {/* Expected output hint (when inbound is set but no output yet) */}
          {isPlanned && inboundKg > 0 && outputKg === 0 && (
            <span>
              Expected output: {expectedOutputKg.toFixed(1)} kg (at {expectedYieldLossPct}% loss)
            </span>
          )}
          {/* Implied loss hint (when both inbound and output are set) */}
          {inboundKg > 0 && outputKg > 0 && impliedLossPct !== null && (
            <span className={isImpliedLossUnusual ? 'text-amber-600 font-medium' : ''}>
              Implied loss: {impliedLossPct.toFixed(1)}%
              {isImpliedLossUnusual && ' (unusual)'}
            </span>
          )}
        </div>
      </div>

      {/* Yield Warning Dialog */}
      <AlertDialog open={showYieldWarning} onOpenChange={setShowYieldWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Unusual Yield Loss
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  The implied yield loss for this batch is{' '}
                  <strong>
                    {pendingMarkRoasted && inboundKg > 0 
                      ? ((1 - pendingMarkRoasted.actualKg / inboundKg) * 100).toFixed(1)
                      : '—'}%
                  </strong>
                  , which is outside the typical 10–20% range.
                </p>
                <p className="text-sm">
                  This could indicate a data entry error. Please double-check the inbound (green) and output (roasted) weights.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingMarkRoasted(null)}>
              Edit Numbers
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmMarkRoasted}>
              Confirm Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
