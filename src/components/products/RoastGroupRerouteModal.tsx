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

interface RoastGroupRerouteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  currentRoastGroup: string | null;
  newRoastGroup: string | null;
  onConfirm: () => void;
  isPending?: boolean;
}

export function RoastGroupRerouteModal({
  open,
  onOpenChange,
  productName,
  currentRoastGroup,
  newRoastGroup,
  onConfirm,
  isPending,
}: RoastGroupRerouteModalProps) {
  const fromLabel = currentRoastGroup || 'None';
  const toLabel = newRoastGroup || 'None';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/20">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <AlertDialogTitle>Reroute Production Demand?</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="pt-3 space-y-3">
              <p>
                You are changing the roast group for <strong>{productName}</strong>:
              </p>
              <div className="bg-muted rounded-md p-3 font-mono text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">From:</span>
                  <span className={currentRoastGroup ? 'font-semibold' : 'text-muted-foreground italic'}>
                    {fromLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-muted-foreground">To:</span>
                  <span className={newRoastGroup ? 'font-semibold text-primary' : 'text-muted-foreground italic'}>
                    {toLabel}
                  </span>
                </div>
              </div>
              <div className="text-sm space-y-2">
                <p className="font-medium">This action will:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Reroute all <strong>unfulfilled</strong> demand to the new roast group</li>
                  <li>Trigger a full recalculation of roast demand</li>
                  <li>Update coverage indicators on the production run sheet</li>
                </ul>
                <p className="text-muted-foreground mt-2">
                  Historical (shipped/packed) demand will remain unchanged.
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-warning text-warning-foreground hover:bg-warning/90"
          >
            {isPending ? 'Rerouting…' : 'Confirm Reroute'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
