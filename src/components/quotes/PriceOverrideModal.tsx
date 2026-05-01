import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export type PriceOverrideValue = {
  final_price_per_bag_override: number | null;
  override_reason: string | null;
};

interface PriceOverrideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: PriceOverrideValue;
  calcPrice: number | null;
  onSave: (v: PriceOverrideValue) => void;
}

export function PriceOverrideModal({
  open,
  onOpenChange,
  initial,
  calcPrice,
  onSave,
}: PriceOverrideModalProps) {
  const [price, setPrice] = useState<string>(
    initial.final_price_per_bag_override != null
      ? String(initial.final_price_per_bag_override)
      : '',
  );
  const [reason, setReason] = useState<string>(initial.override_reason ?? '');

  useEffect(() => {
    if (!open) return;
    setPrice(
      initial.final_price_per_bag_override != null
        ? String(initial.final_price_per_bag_override)
        : '',
    );
    setReason(initial.override_reason ?? '');
  }, [open, initial]);

  const numericPrice = price.trim() === '' ? null : Number(price);
  const validPrice = numericPrice == null || (Number.isFinite(numericPrice) && numericPrice >= 0);
  const reasonRequired = numericPrice != null;
  const reasonOk = !reasonRequired || reason.trim().length > 0;

  const handleSave = () => {
    if (!validPrice || !reasonOk) return;
    onSave({
      final_price_per_bag_override: numericPrice,
      override_reason: numericPrice == null ? null : reason.trim(),
    });
    onOpenChange(false);
  };

  const handleClear = () => {
    setPrice('');
    setReason('');
    onSave({ final_price_per_bag_override: null, override_reason: null });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Override price</DialogTitle>
          <DialogDescription>
            Replaces the calculated price for this line. A reason is required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {calcPrice != null && (
            <div className="text-sm text-muted-foreground">
              Calculated price: <span className="font-mono">${calcPrice.toFixed(2)}</span> / bag
            </div>
          )}
          <div>
            <Label>Override price ($/bag)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Leave empty to clear override"
            />
          </div>
          <div>
            <Label>Reason{reasonRequired && <span className="text-destructive"> *</span>}</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. First-time buyer discount"
              rows={3}
            />
            {reasonRequired && !reasonOk && (
              <p className="text-xs text-destructive mt-1">Reason is required when overriding price.</p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={handleClear} className="sm:mr-auto">
            Clear override
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!validPrice || !reasonOk}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
