import React, { useState } from 'react';
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
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface PreflightData {
  order_number: string;
  order_status: string;
  line_items_count: number;
  ship_picks_count: number;
  ship_picks_units: number;
  inventory_txns_count: number;
  production_plan_count: number;
  error?: string;
}

interface OrderDeleteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
}

export function OrderDeleteModal({
  open,
  onOpenChange,
  orderId,
  orderNumber,
}: OrderDeleteModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [showDestructive, setShowDestructive] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Fetch preflight data when modal opens
  const { data: preflight, isLoading: preflightLoading } = useQuery({
    queryKey: ['order-delete-preflight', orderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_order_delete_preflight', {
        p_order_id: orderId,
      });
      if (error) throw error;
      return data as unknown as PreflightData;
    },
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('delete_order_safe', {
        p_order_id: orderId,
        p_force: true,
      });
      if (error) throw error;
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error((data as { error: string }).error);
      }
      return data;
    },
    onSuccess: (data) => {
      const result = data as { deleted?: { line_items?: number; ship_picks?: number; inventory_txns_reversed?: number } };
      toast.success(`Order ${orderNumber} deleted`, {
        description: `Removed ${result?.deleted?.line_items ?? 0} line items, ${result?.deleted?.ship_picks ?? 0} picks, reversed ${result?.deleted?.inventory_txns_reversed ?? 0} inventory transactions`,
      });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      onOpenChange(false);
      navigate('/orders');
    },
    onError: (err) => {
      console.error('Delete order error:', err);
      toast.error('Failed to delete order', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    },
  });

  const hasDownstreamActivity = preflight && (
    preflight.ship_picks_count > 0 ||
    preflight.inventory_txns_count > 0 ||
    preflight.production_plan_count > 0
  );

  const isConfirmed = confirmText.toUpperCase() === 'DELETE';

  const handleClose = () => {
    setConfirmText('');
    setShowDestructive(false);
    onOpenChange(false);
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  // Simple delete - no downstream activity
  if (!hasDownstreamActivity && preflight && !preflight.error) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete order {orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This order has <span className="font-semibold">{preflight.line_items_count}</span> line items.
              Deleting it will permanently remove the order and all associated records.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete Order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // Loading or guarded delete with downstream activity
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[520px] max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5 text-amber-600">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <AlertDialogTitle className="text-amber-600 text-lg">
              Delete order {orderNumber}?
            </AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        {/* Scrollable content */}
        <AlertDialogDescription asChild>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {preflightLoading ? (
              <p className="text-muted-foreground">Loading order data…</p>
            ) : preflight?.error ? (
              <p className="text-destructive">{preflight.error}</p>
            ) : (
              <>
                {/* Impact summary */}
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-2">This order has:</p>
                  <div className="flex justify-between">
                    <span>Line items</span>
                    <span className="font-medium text-foreground">{preflight?.line_items_count ?? 0}</span>
                  </div>
                  {(preflight?.ship_picks_count ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span>Pick records ({preflight?.ship_picks_units ?? 0} units)</span>
                      <span className="font-medium text-foreground">{preflight?.ship_picks_count}</span>
                    </div>
                  )}
                  {(preflight?.inventory_txns_count ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span>Inventory transactions</span>
                      <span className="font-medium text-foreground">{preflight?.inventory_txns_count}</span>
                    </div>
                  )}
                  {(preflight?.production_plan_count ?? 0) > 0 && (
                    <div className="flex justify-between">
                      <span>Production plan items</span>
                      <span className="font-medium text-foreground">{preflight?.production_plan_count}</span>
                    </div>
                  )}
                </div>

                {/* Warning copy */}
                <div className="bg-destructive/10 border border-destructive/20 rounded-md px-4 py-3 text-sm">
                  <p className="text-destructive-foreground font-medium">
                    Deleting this order will permanently remove all associated records and reverse any inventory effects.
                  </p>
                </div>

                {!showDestructive ? (
                  <p className="text-sm text-muted-foreground">
                    If you only want to cancel this order without affecting historical records, 
                    consider changing its status to <span className="font-medium">CANCELLED</span> instead.
                  </p>
                ) : (
                  /* Destructive confirmation */
                  <div className="space-y-3 pt-2 border-t border-border">
                    <p className="text-sm text-destructive font-medium">
                      Type DELETE to confirm permanent deletion:
                    </p>
                    <Input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="Type DELETE"
                      className="font-mono"
                      autoFocus
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </AlertDialogDescription>

        {/* Sticky footer */}
        <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t border-border bg-background flex-row justify-between gap-3">
          <AlertDialogCancel onClick={handleClose} className="mt-0">
            Cancel
          </AlertDialogCancel>
          
          <div className="flex gap-2">
            {!showDestructive ? (
              <Button
                variant="destructive"
                onClick={() => setShowDestructive(true)}
                disabled={preflightLoading || !!preflight?.error}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Order
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDestructive(false);
                    setConfirmText('');
                  }}
                >
                  Back
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={!isConfirmed || deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Permanently Delete'}
                </Button>
              </>
            )}
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
