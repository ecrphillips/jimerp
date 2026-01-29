/**
 * Undo/Unwind Workflow Modal
 * 
 * Provides dependency-aware reversal for production operations.
 * Models reversals as explicit ledger transactions rather than hard deletes.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { 
  AlertTriangle, 
  Undo2, 
  ChevronRight, 
  Flame, 
  Package, 
  Truck, 
  CheckCircle,
  ArrowDown,
  Loader2,
} from 'lucide-react';

// Types for undo operations
export type UndoOperationType = 'roast_batch' | 'pack_run' | 'ship_pick' | 'ship_order';

interface UndoTarget {
  type: UndoOperationType;
  id: string;
  label: string;
  roastGroup?: string;
  productId?: string;
  orderId?: string;
  quantityKg?: number;
  quantityUnits?: number;
}

interface Dependency {
  type: 'pack' | 'pick' | 'ship';
  id: string;
  label: string;
  units?: number;
  kg?: number;
  orderId?: string;
  orderNumber?: string;
}

interface UndoWorkflowModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: UndoTarget;
}

export function UndoWorkflowModal({ 
  open, 
  onOpenChange, 
  target 
}: UndoWorkflowModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [forceConfirmText, setForceConfirmText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch dependencies for this target
  const { data: dependencies, isLoading: depsLoading } = useQuery({
    queryKey: ['undo-dependencies', target.type, target.id],
    queryFn: async (): Promise<Dependency[]> => {
      const deps: Dependency[] = [];

      if (target.type === 'roast_batch' && target.roastGroup) {
        // Check if WIP from this batch has been consumed by packing
        const { data: packingRuns } = await supabase
          .from('packing_runs')
          .select(`
            id, 
            product_id, 
            units_packed, 
            kg_consumed,
            product:products!inner(product_name, roast_group)
          `)
          .eq('product.roast_group', target.roastGroup)
          .gt('units_packed', 0);

        for (const pr of packingRuns ?? []) {
          deps.push({
            type: 'pack',
            id: pr.id,
            label: `Packed ${pr.units_packed} units of ${(pr.product as any)?.product_name ?? 'Unknown'}`,
            units: pr.units_packed,
            kg: Number(pr.kg_consumed),
          });
        }
      }

      if (target.type === 'pack_run' && target.productId) {
        // Check if FG from this pack run has been picked
        const { data: shipPicks } = await supabase
          .from('ship_picks')
          .select(`
            id, 
            units_picked, 
            order_id,
            order:orders!inner(order_number, status)
          `)
          .gt('units_picked', 0);

        // Get order line items for this product
        const { data: lineItems } = await supabase
          .from('order_line_items')
          .select('id, order_id')
          .eq('product_id', target.productId);

        const lineItemIds = new Set((lineItems ?? []).map(li => li.id));
        
        for (const pick of shipPicks ?? []) {
          if (lineItemIds.has(pick.id.split(':')[0])) { // Check if pick relates to our product
            deps.push({
              type: 'pick',
              id: pick.id,
              label: `Picked ${pick.units_picked} units for order ${(pick.order as any)?.order_number}`,
              units: pick.units_picked,
              orderId: pick.order_id,
              orderNumber: (pick.order as any)?.order_number,
            });
          }
        }
      }

      if (target.type === 'ship_pick' && target.orderId) {
        // Check if order has been marked as shipped
        const { data: order } = await supabase
          .from('orders')
          .select('id, order_number, status')
          .eq('id', target.orderId)
          .single();

        if (order?.status === 'SHIPPED') {
          deps.push({
            type: 'ship',
            id: order.id,
            label: `Order ${order.order_number} is marked as SHIPPED`,
            orderId: order.id,
            orderNumber: order.order_number,
          });
        }
      }

      return deps;
    },
    enabled: open,
  });

  // Check if we can do a clean undo (no downstream dependencies)
  const canCleanUndo = useMemo(() => {
    return !depsLoading && (dependencies?.length ?? 0) === 0;
  }, [dependencies, depsLoading]);

  // Calculate what inventory changes will happen
  const inventoryImpact = useMemo(() => {
    const impact: { wipDelta: number; fgDelta: number; description: string[] } = {
      wipDelta: 0,
      fgDelta: 0,
      description: [],
    };

    if (target.type === 'roast_batch') {
      impact.wipDelta = -(target.quantityKg ?? 0);
      impact.description.push(`Remove ${(target.quantityKg ?? 0).toFixed(1)} kg from WIP`);
    }

    if (target.type === 'pack_run') {
      impact.wipDelta = target.quantityKg ?? 0; // Return WIP
      impact.fgDelta = -(target.quantityUnits ?? 0); // Remove FG
      impact.description.push(`Return ${(target.quantityKg ?? 0).toFixed(2)} kg to WIP`);
      impact.description.push(`Remove ${target.quantityUnits ?? 0} units from FG`);
    }

    if (target.type === 'ship_pick') {
      impact.fgDelta = target.quantityUnits ?? 0; // Return FG
      impact.description.push(`Return ${target.quantityUnits ?? 0} units to FG`);
    }

    return impact;
  }, [target]);

  // Execute clean undo
  const executeCleanUndo = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);

      if (target.type === 'roast_batch') {
        // Revert batch to PLANNED and write reversal transaction
        const { error: batchError } = await supabase
          .from('roasted_batches')
          .update({ status: 'PLANNED' })
          .eq('id', target.id);
        
        if (batchError) throw batchError;

        // Write reversal to inventory_transactions
        const { error: txnError } = await supabase
          .from('inventory_transactions')
          .insert({
            transaction_type: 'ADJUSTMENT',
            roast_group: target.roastGroup,
            quantity_kg: -(target.quantityKg ?? 0),
            is_system_generated: false,
            created_by: user?.id,
            notes: `Undo roast batch ${target.id.slice(0, 8)} - reverted to PLANNED`,
          });

        if (txnError) throw txnError;
      }

      if (target.type === 'pack_run') {
        // Reset packing run and write reversal transactions
        const { error: packError } = await supabase
          .from('packing_runs')
          .update({ units_packed: 0, kg_consumed: 0 })
          .eq('id', target.id);

        if (packError) throw packError;

        // Return WIP
        if (target.roastGroup) {
          const { error: wipError } = await supabase
            .from('inventory_transactions')
            .insert({
              transaction_type: 'PACK_CONSUME_WIP',
              roast_group: target.roastGroup,
              product_id: target.productId,
              quantity_kg: target.quantityKg ?? 0, // Positive = return
              is_system_generated: false,
              created_by: user?.id,
              notes: `Undo packing - returned ${(target.quantityKg ?? 0).toFixed(2)} kg`,
            });

          if (wipError) throw wipError;
        }

        // Remove FG
        const { error: fgError } = await supabase
          .from('inventory_transactions')
          .insert({
            transaction_type: 'PACK_PRODUCE_FG',
            product_id: target.productId,
            quantity_units: -(target.quantityUnits ?? 0), // Negative = remove
            is_system_generated: false,
            created_by: user?.id,
            notes: `Undo packing - removed ${target.quantityUnits ?? 0} units`,
          });

        if (fgError) throw fgError;
      }

      if (target.type === 'ship_pick') {
        // Reset ship pick and return FG
        const { error: pickError } = await supabase
          .from('ship_picks')
          .update({ units_picked: 0 })
          .eq('id', target.id);

        if (pickError) throw pickError;

        // Return FG
        const { error: fgError } = await supabase
          .from('inventory_transactions')
          .insert({
            transaction_type: 'SHIP_CONSUME_FG',
            product_id: target.productId,
            order_id: target.orderId,
            quantity_units: target.quantityUnits ?? 0, // Positive = return
            is_system_generated: false,
            created_by: user?.id,
            notes: `Undo pick - returned ${target.quantityUnits ?? 0} units`,
          });

        if (fgError) throw fgError;
      }

      if (target.type === 'ship_order') {
        // Revert order from SHIPPED back to READY
        const { error: orderError } = await supabase
          .from('orders')
          .update({ status: 'READY', shipped_or_ready: false })
          .eq('id', target.id);

        if (orderError) throw orderError;
      }
    },
    onSuccess: () => {
      toast.success(`Undo completed: ${target.label}`);
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['packing-runs'] });
      queryClient.invalidateQueries({ queryKey: ['ship-picks'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['authoritative'] });
      onOpenChange(false);
    },
    onError: (err) => {
      console.error('Undo failed:', err);
      toast.error('Failed to undo operation');
    },
    onSettled: () => {
      setIsProcessing(false);
    },
  });

  // Execute cascading undo (unwind all dependencies first)
  const executeCascadeUndo = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);

      // Process dependencies in reverse order (ship → pick → pack → roast)
      const sortedDeps = [...(dependencies ?? [])].sort((a, b) => {
        const order = { ship: 0, pick: 1, pack: 2 };
        return (order[a.type] ?? 99) - (order[b.type] ?? 99);
      });

      for (const dep of sortedDeps) {
        if (dep.type === 'ship') {
          // Revert shipped order
          await supabase
            .from('orders')
            .update({ status: 'READY', shipped_or_ready: false })
            .eq('id', dep.orderId);
        }

        if (dep.type === 'pick') {
          // Reset pick and return FG
          await supabase
            .from('ship_picks')
            .update({ units_picked: 0 })
            .eq('id', dep.id);

          await supabase
            .from('inventory_transactions')
            .insert({
              transaction_type: 'SHIP_CONSUME_FG',
              order_id: dep.orderId,
              quantity_units: dep.units ?? 0,
              is_system_generated: false,
              created_by: user?.id,
              notes: `Cascade undo - returned ${dep.units} units from order ${dep.orderNumber}`,
            });
        }

        if (dep.type === 'pack') {
          // Reset pack and write reversal transactions
          const packRun = await supabase
            .from('packing_runs')
            .select('product_id, units_packed, kg_consumed, product:products(roast_group)')
            .eq('id', dep.id)
            .single();

          if (packRun.data) {
            await supabase
              .from('packing_runs')
              .update({ units_packed: 0, kg_consumed: 0 })
              .eq('id', dep.id);

            // Return WIP
            if ((packRun.data.product as any)?.roast_group) {
              await supabase
                .from('inventory_transactions')
                .insert({
                  transaction_type: 'PACK_CONSUME_WIP',
                  roast_group: (packRun.data.product as any).roast_group,
                  product_id: packRun.data.product_id,
                  quantity_kg: Number(packRun.data.kg_consumed),
                  is_system_generated: false,
                  created_by: user?.id,
                  notes: `Cascade undo - returned ${packRun.data.kg_consumed} kg`,
                });
            }

            // Remove FG
            await supabase
              .from('inventory_transactions')
              .insert({
                transaction_type: 'PACK_PRODUCE_FG',
                product_id: packRun.data.product_id,
                quantity_units: -packRun.data.units_packed,
                is_system_generated: false,
                created_by: user?.id,
                notes: `Cascade undo - removed ${packRun.data.units_packed} units`,
              });
          }
        }
      }

      // Now execute the main undo
      await executeCleanUndo.mutateAsync();
    },
    onSuccess: () => {
      toast.success(`Cascade undo completed: unwound ${(dependencies?.length ?? 0)} dependencies`);
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (err) => {
      console.error('Cascade undo failed:', err);
      toast.error('Failed to cascade undo');
    },
    onSettled: () => {
      setIsProcessing(false);
    },
  });

  // Force undo via adjustment (for when clean undo isn't possible)
  const executeForceUndo = useMutation({
    mutationFn: async () => {
      setIsProcessing(true);

      // Write an ADJUSTMENT transaction to reconcile the inventory
      if (target.type === 'roast_batch') {
        // Revert batch status
        await supabase
          .from('roasted_batches')
          .update({ status: 'PLANNED' })
          .eq('id', target.id);

        // Force adjustment - this might result in negative WIP temporarily
        await supabase
          .from('inventory_transactions')
          .insert({
            transaction_type: 'ADJUSTMENT',
            roast_group: target.roastGroup,
            quantity_kg: -(target.quantityKg ?? 0),
            is_system_generated: false,
            created_by: user?.id,
            notes: `FORCE UNDO: Batch ${target.id.slice(0, 8)} - inventory may need reconciliation`,
          });
      }
    },
    onSuccess: () => {
      toast.warning('Force undo completed - inventory may need manual reconciliation');
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (err) => {
      console.error('Force undo failed:', err);
      toast.error('Failed to force undo');
    },
    onSettled: () => {
      setIsProcessing(false);
      setShowForceConfirm(false);
      setForceConfirmText('');
    },
  });

  const getOperationIcon = (type: UndoOperationType | Dependency['type']) => {
    switch (type) {
      case 'roast_batch':
        return <Flame className="h-4 w-4" />;
      case 'pack':
      case 'pack_run':
        return <Package className="h-4 w-4" />;
      case 'pick':
      case 'ship_pick':
      case 'ship':
      case 'ship_order':
        return <Truck className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5" />
              Undo Operation
            </DialogTitle>
            <DialogDescription>
              Review the impact before undoing this operation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Target Operation */}
            <div className="p-3 bg-muted/50 rounded-md">
              <div className="flex items-center gap-2 text-sm font-medium">
                {getOperationIcon(target.type)}
                <span>{target.label}</span>
              </div>
            </div>

            {/* Loading state */}
            {depsLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking dependencies...
              </div>
            )}

            {/* Dependencies */}
            {!depsLoading && (dependencies?.length ?? 0) > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Downstream Dependencies Found</AlertTitle>
                <AlertDescription className="mt-2 space-y-2">
                  <p className="text-sm">
                    This operation has been consumed by downstream processes. 
                    You can either unwind them in order or force an adjustment.
                  </p>
                  <div className="space-y-1 mt-2">
                    {dependencies?.map((dep, i) => (
                      <div key={dep.id} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px]">
                          {dep.type.toUpperCase()}
                        </Badge>
                        <span>{dep.label}</span>
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Clean undo available */}
            {!depsLoading && canCleanUndo && (
              <Alert>
                <CheckCircle className="h-4 w-4 text-primary" />
                <AlertTitle>Clean Undo Available</AlertTitle>
                <AlertDescription>
                  No downstream dependencies. This operation can be safely reversed.
                </AlertDescription>
              </Alert>
            )}

            {/* Inventory Impact */}
            {inventoryImpact.description.length > 0 && (
              <div className="p-3 border rounded-md">
                <div className="text-sm font-medium mb-2">Inventory Changes:</div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {inventoryImpact.description.map((desc, i) => (
                    <li key={i} className="flex items-center gap-1">
                      <ArrowDown className="h-3 w-3" />
                      {desc}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            
            {canCleanUndo && (
              <Button 
                onClick={() => executeCleanUndo.mutate()}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Undo2 className="h-4 w-4 mr-2" />
                    Undo
                  </>
                )}
              </Button>
            )}

            {!canCleanUndo && !depsLoading && (
              <>
                <Button 
                  variant="secondary"
                  onClick={() => executeCascadeUndo.mutate()}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <ChevronRight className="h-4 w-4 mr-2" />
                      Unwind All ({dependencies?.length})
                    </>
                  )}
                </Button>
                <Button 
                  variant="destructive"
                  onClick={() => setShowForceConfirm(true)}
                  disabled={isProcessing}
                >
                  Force via Adjustment
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Confirmation Dialog */}
      <AlertDialog open={showForceConfirm} onOpenChange={setShowForceConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Force Undo via Adjustment
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will force the undo by creating an inventory adjustment. 
                This may result in negative inventory temporarily and will require manual reconciliation.
              </p>
              <p className="font-medium">
                Type "FORCE" to confirm:
              </p>
              <Input
                value={forceConfirmText}
                onChange={(e) => setForceConfirmText(e.target.value)}
                placeholder="Type FORCE to confirm"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={forceConfirmText !== 'FORCE' || isProcessing}
              onClick={() => executeForceUndo.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? 'Processing...' : 'Force Undo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Hook to trigger undo workflow
export function useUndoWorkflow() {
  const [undoTarget, setUndoTarget] = useState<UndoTarget | null>(null);

  const openUndo = useCallback((target: UndoTarget) => {
    setUndoTarget(target);
  }, []);

  const closeUndo = useCallback(() => {
    setUndoTarget(null);
  }, []);

  return {
    undoTarget,
    openUndo,
    closeUndo,
    isOpen: !!undoTarget,
  };
}
