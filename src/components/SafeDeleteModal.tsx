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
import { AlertTriangle, Trash2, Ban } from 'lucide-react';

interface DeleteCounts {
  open_orders?: number;
  completed_orders?: number;
  cancelled_orders?: number;
  products?: number;
  batches?: number;
}

interface SafeDeleteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: 'client' | 'product' | 'roast_group';
  entityName: string;
  counts: DeleteCounts | null;
  isBlocked?: boolean;
  blockedMessage?: string;
  isLoading?: boolean;
  onSetInactive: () => void;
  onConfirmDelete: () => void;
}

export function SafeDeleteModal({
  open,
  onOpenChange,
  entityType,
  entityName,
  counts,
  isBlocked = false,
  blockedMessage,
  isLoading = false,
  onSetInactive,
  onConfirmDelete,
}: SafeDeleteModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [showDestructive, setShowDestructive] = useState(false);

  const hasReferences = counts && (
    (counts.open_orders ?? 0) > 0 ||
    (counts.completed_orders ?? 0) > 0 ||
    (counts.products ?? 0) > 0 ||
    (counts.batches ?? 0) > 0
  );

  const isConfirmed = confirmText.toUpperCase() === 'DELETE';

  const handleClose = () => {
    setConfirmText('');
    setShowDestructive(false);
    onOpenChange(false);
  };

  const handleSetInactive = () => {
    onSetInactive();
    handleClose();
  };

  const handleDelete = () => {
    onConfirmDelete();
    handleClose();
  };

  const entityLabel = entityType === 'roast_group' ? 'roast group' : entityType;

  // Simple delete - no references
  if (!hasReferences && !isBlocked) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {entityLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-semibold">{entityName}</span>? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // Blocked delete - roast group with products
  if (isBlocked) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-amber-600">
              <Ban className="h-5 w-5" />
              <AlertDialogTitle className="text-amber-600">Cannot Delete {entityLabel}</AlertDialogTitle>
            </div>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{blockedMessage}</p>
                {counts && (
                  <div className="bg-muted rounded-md p-3 text-sm">
                    <p><strong>Products:</strong> {counts.products ?? 0}</p>
                  </div>
                )}
                <p className="text-sm">
                  You can set this {entityLabel} as inactive instead, which will hide it from 
                  production screens while preserving all historical data.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleClose}>Cancel</AlertDialogCancel>
            <Button onClick={handleSetInactive} disabled={isLoading}>
              Set Inactive
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // Guarded delete - has references
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[500px] max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5 text-amber-600">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <AlertDialogTitle className="text-amber-600 text-lg">
              This {entityLabel} has {entityType === 'roast_group' ? 'history' : 'orders'}
            </AlertDialogTitle>
          </div>
        </AlertDialogHeader>

        {/* Scrollable content */}
        <AlertDialogDescription asChild>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Impact summary - simple list */}
            <div className="space-y-1.5 text-sm text-muted-foreground">
              {counts?.open_orders !== undefined && (
                <div className="flex justify-between">
                  <span>Open orders</span>
                  <span className="font-medium text-foreground">{counts.open_orders}</span>
                </div>
              )}
              {counts?.completed_orders !== undefined && (
                <div className="flex justify-between">
                  <span>Completed orders</span>
                  <span className="font-medium text-foreground">{counts.completed_orders}</span>
                </div>
              )}
              {counts?.cancelled_orders !== undefined && counts.cancelled_orders > 0 && (
                <div className="flex justify-between">
                  <span>Cancelled orders</span>
                  <span className="font-medium text-foreground">{counts.cancelled_orders}</span>
                </div>
              )}
              {counts?.products !== undefined && counts.products > 0 && (
                <div className="flex justify-between">
                  <span>Products</span>
                  <span className="font-medium text-foreground">{counts.products}</span>
                </div>
              )}
              {counts?.batches !== undefined && counts.batches > 0 && (
                <div className="flex justify-between">
                  <span>Roast batches</span>
                  <span className="font-medium text-foreground">{counts.batches}</span>
                </div>
              )}
            </div>

            {/* Warning copy */}
            <p className="text-sm text-muted-foreground">
              Deleting will {(counts?.open_orders ?? 0) > 0 ? 'cancel open orders and ' : ''}
              remove historical records.{' '}
              <span className="text-foreground font-medium">This is usually not what you want.</span>
            </p>

            {!showDestructive ? (
              /* Recommended action callout */
              <div className="bg-accent/50 border border-accent rounded-md px-4 py-3">
                <p className="text-sm text-foreground">
                  <span className="font-medium">Recommended:</span>{' '}
                  <span className="text-muted-foreground">Setting inactive preserves all history and is reversible.</span>
                </p>
              </div>
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
          </div>
        </AlertDialogDescription>

        {/* Sticky footer */}
        <AlertDialogFooter className="flex-shrink-0 px-6 py-4 border-t border-border bg-background flex-row justify-between gap-3">
          <AlertDialogCancel onClick={handleClose} className="mt-0">
            Cancel
          </AlertDialogCancel>
          
          <div className="flex gap-2">
            {!showDestructive ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowDestructive(true)}
                  className="text-destructive border-destructive/50 hover:bg-destructive/10 hover:border-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Anyway
                </Button>
                <Button onClick={handleSetInactive} disabled={isLoading}>
                  Set Inactive Instead
                </Button>
              </>
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
                  disabled={!isConfirmed || isLoading}
                >
                  {isLoading ? 'Deleting…' : 'Permanently Delete'}
                </Button>
              </>
            )}
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
