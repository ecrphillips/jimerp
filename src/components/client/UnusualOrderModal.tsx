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

interface FlaggedItem {
  productName: string;
  lastQty: number;
  currentQty: number;
  multiplier: number;
}

interface UnusualOrderModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  flaggedItems: FlaggedItem[];
  totalFlag: {
    lastTotal: number;
    currentTotal: number;
    multiplier: number;
  } | null;
}

export function UnusualOrderModal({
  open,
  onClose,
  onConfirm,
  flaggedItems,
  totalFlag,
}: UnusualOrderModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unusual Order Size</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                This order is significantly larger than your last order. Please confirm this is
                intentional.
              </p>

              {flaggedItems.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-foreground text-sm">Flagged items:</p>
                  <ul className="text-sm space-y-1">
                    {flaggedItems.map((item, i) => (
                      <li key={i} className="flex justify-between border-b pb-1">
                        <span className="truncate">{item.productName}</span>
                        <span className="text-muted-foreground shrink-0 ml-2">
                          {item.lastQty} → {item.currentQty} ({item.multiplier.toFixed(1)}×)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {totalFlag && (
                <div className="text-sm border-t pt-2">
                  <span className="font-medium text-foreground">Total units: </span>
                  <span className="text-muted-foreground">
                    {totalFlag.lastTotal} → {totalFlag.currentTotal} ({totalFlag.multiplier.toFixed(1)}×)
                  </span>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Submit anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
