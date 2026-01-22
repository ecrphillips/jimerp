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
import { AlertTriangle } from 'lucide-react';

interface IncompleteFulfillmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incompleteSteps: string[];
  onConfirm: () => void;
}

export function IncompleteFulfillmentModal({
  open,
  onOpenChange,
  incompleteSteps,
  onConfirm,
}: IncompleteFulfillmentModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <AlertDialogTitle>Incomplete Fulfillment Steps</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2">
            The following steps are not marked complete:
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {incompleteSteps.map((step) => (
                <li key={step} className="text-foreground font-medium">{step}</li>
              ))}
            </ul>
            <span className="block mt-3">Mark as shipped anyway?</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go Back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Mark as Shipped
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
