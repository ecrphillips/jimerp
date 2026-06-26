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
  /** Title shown in the modal header. Defaults to "Incomplete Fulfillment Steps". */
  title?: string;
  /** Sentence shown above the action buttons. Defaults to "Mark as shipped anyway?". */
  promptText?: string;
  /** Label on the confirm button. Defaults to "Mark as Shipped". */
  confirmLabel?: string;
}

export function IncompleteFulfillmentModal({
  open,
  onOpenChange,
  incompleteSteps,
  onConfirm,
  title = 'Incomplete Fulfillment Steps',
  promptText = 'Mark as shipped anyway?',
  confirmLabel = 'Mark as Shipped',
}: IncompleteFulfillmentModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2">
            The following steps are not marked complete:
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {incompleteSteps.map((step) => (
                <li key={step} className="text-foreground font-medium">{step}</li>
              ))}
            </ul>
            <span className="block mt-3">{promptText}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go Back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
