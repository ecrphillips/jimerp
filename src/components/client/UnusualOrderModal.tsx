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
import { GramPackagingBadge } from '@/components/GramPackagingBadge';

export interface FlaggedItem {
  productName: string;
  packagingTypeName: string | null;
  gramsPerUnit: number | null;
  lastQty: number;
  currentQty: number;
  multiplier: number;
  baselineLabel: string; // "last order", "typical for Retail Bag", "large absolute quantity"
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
                This order is significantly larger than expected. Please confirm this is
                intentional.
              </p>

              {flaggedItems.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-foreground text-sm">Flagged items:</p>
                  <ul className="text-sm space-y-2">
                    {flaggedItems.map((item, i) => (
                      <li key={i} className="border-b pb-2">
                        <div className="flex items-center gap-2 mb-1">
                          <GramPackagingBadge 
                            packagingTypeName={item.packagingTypeName} 
                            gramsPerUnit={item.gramsPerUnit} 
                          />
                          <span className="font-medium truncate">{item.productName}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span className="text-xs italic">{item.baselineLabel}</span>
                          <span>
                            {item.lastQty} → {item.currentQty} ({item.multiplier.toFixed(1)}×)
                          </span>
                        </div>
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
