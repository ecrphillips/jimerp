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
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            <AlertDialogTitle className="text-amber-600">
              This {entityLabel} has {entityType === 'roast_group' ? 'history' : 'orders'}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              {/* Counts display */}
              <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                {counts?.open_orders !== undefined && (
                  <p><strong>Open orders:</strong> {counts.open_orders}</p>
                )}
                {counts?.completed_orders !== undefined && (
                  <p><strong>Completed orders:</strong> {counts.completed_orders}</p>
                )}
                {counts?.cancelled_orders !== undefined && counts.cancelled_orders > 0 && (
                  <p className="text-muted-foreground"><strong>Cancelled orders:</strong> {counts.cancelled_orders}</p>
                )}
                {counts?.products !== undefined && counts.products > 0 && (
                  <p><strong>Products:</strong> {counts.products}</p>
                )}
                {counts?.batches !== undefined && counts.batches > 0 && (
                  <p><strong>Roast batches:</strong> {counts.batches}</p>
                )}
              </div>

              <p className="text-sm">
                Deleting will {(counts?.open_orders ?? 0) > 0 ? 'cancel open orders and ' : ''}
                remove historical records. <strong>This is usually not what you want.</strong>
              </p>

              {!showDestructive ? (
                <div className="bg-accent border border-border rounded-md p-3">
                  <p className="text-sm text-accent-foreground">
                    <strong>Recommended:</strong> Setting inactive preserves all history and is reversible.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 border-t pt-3">
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
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={handleClose} className="sm:mr-auto">
            Cancel
          </AlertDialogCancel>
          
          {!showDestructive ? (
            <>
              <Button
                variant="outline"
                onClick={() => setShowDestructive(true)}
                className="text-destructive border-destructive hover:bg-destructive/10"
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
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
