import React from 'react';
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
import { RotateCcw } from 'lucide-react';

interface StatusChangeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus: string;
  newStatus: string;
  onConfirm: () => void;
}

export function StatusChangeModal({
  open,
  onOpenChange,
  currentStatus,
  newStatus,
  onConfirm,
}: StatusChangeModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <RotateCcw className="h-5 w-5 text-muted-foreground" />
            </div>
            <AlertDialogTitle>Change Order Status?</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2">
            This will change the order status from <strong>{currentStatus}</strong> to{' '}
            <strong>{newStatus}</strong>. This may affect historical accuracy and reporting.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Change Status
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
