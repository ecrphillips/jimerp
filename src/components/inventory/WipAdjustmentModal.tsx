import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { saveWipAdjustment, WIP_ADJUSTMENT_QUERY_KEYS, type WipAdjustmentReason } from '@/lib/wipAdjustments';

export type { WipAdjustmentReason };

const REASON_OPTIONS: { value: WipAdjustmentReason; label: string; helper: string }[] = [
  {
    value: 'OPENING_BALANCE',
    label: 'Opening balance',
    helper: 'Seeding the initial WIP for this roast group before tracked production began.',
  },
  {
    value: 'RECOUNT',
    label: 'Recount',
    helper: 'Physical recount revealed a discrepancy with the system value.',
  },
  {
    value: 'COUNT_ADJUSTMENT',
    label: 'Count adjustment',
    helper: 'General correction to bring the system value in line with reality.',
  },
  {
    value: 'LOSS',
    label: 'Loss',
    helper: 'Coffee lost (spillage, equipment, etc.). Reduces WIP.',
  },
  {
    value: 'CONTAMINATION',
    label: 'Contamination',
    helper: 'Coffee discarded due to contamination. Reduces WIP.',
  },
  {
    value: 'OTHER',
    label: 'Other',
    helper: 'Use the notes field to explain.',
  },
];

interface WipAdjustmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roastGroup: string;
  roastGroupDisplayName: string;
  currentBalanceKg: number;
}

export function WipAdjustmentModal({
  open,
  onOpenChange,
  roastGroup,
  roastGroupDisplayName,
  currentBalanceKg,
}: WipAdjustmentModalProps) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const [newBalanceStr, setNewBalanceStr] = useState('');
  const [reason, setReason] = useState<WipAdjustmentReason>('OPENING_BALANCE');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setNewBalanceStr(currentBalanceKg.toFixed(1));
      setReason(currentBalanceKg === 0 ? 'OPENING_BALANCE' : 'RECOUNT');
      setNotes('');
    }
  }, [open, currentBalanceKg]);

  const newBalance = parseFloat(newBalanceStr);
  const isValidNumber = !isNaN(newBalance) && newBalanceStr.trim() !== '';
  const delta = isValidNumber ? +(newBalance - currentBalanceKg).toFixed(4) : 0;
  const noChange = isValidNumber && delta === 0;

  const reasonHelper = useMemo(
    () => REASON_OPTIONS.find((r) => r.value === reason)?.helper ?? '',
    [reason],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!isValidNumber) throw new Error('Enter a valid number for the new balance.');
      if (delta === 0) throw new Error('No change to apply.');

      const prevStr = currentBalanceKg.toFixed(2);
      const newStr = newBalance.toFixed(2);
      const txNotes = notes.trim()
        ? `WIP adjustment (${reason}): ${prevStr} kg → ${newStr} kg — ${notes.trim()}`
        : `WIP adjustment (${reason}): ${prevStr} kg → ${newStr} kg`;

      await saveWipAdjustment({
        roastGroup,
        kgDelta: delta,
        reason,
        notes: txNotes,
        createdBy: authUser?.id ?? null,
      });
    },
    onSuccess: () => {
      toast.success(`WIP balance updated to ${newBalance.toFixed(1)} kg.`);
      for (const key of WIP_ADJUSTMENT_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      queryClient.invalidateQueries({ queryKey: ['roast-group-detail'] });
      queryClient.invalidateQueries({ queryKey: ['roast-group-inventory-levels'] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      console.error(err);
      toast.error(err.message || 'Failed to adjust WIP balance.');
    },
  });

  const changeColorClass =
    !isValidNumber || delta === 0
      ? 'text-muted-foreground'
      : delta > 0
        ? 'text-green-600 dark:text-green-400'
        : 'text-destructive';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust WIP — {roastGroupDisplayName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="new-balance">New WIP balance (kg)</Label>
            <Input
              id="new-balance"
              type="number"
              step="0.1"
              min="0"
              autoFocus
              value={newBalanceStr}
              onChange={(e) => setNewBalanceStr(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Enter the actual amount of WIP currently on hand for this roast group.
            </p>
          </div>

          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as WipAdjustmentReason)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{reasonHelper}</p>
          </div>

          <div>
            <Label htmlFor="adj-notes">Notes</Label>
            <Textarea
              id="adj-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Optional context — visible in the audit trail.
            </p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm font-mono space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current balance:</span>
              <span>{currentBalanceKg.toFixed(1)} kg</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">New balance:</span>
              <span>{isValidNumber ? `${newBalance.toFixed(1)} kg` : '—'}</span>
            </div>
            <div className={cn('flex justify-between font-bold', changeColorClass)}>
              <span>Change:</span>
              <span>
                {isValidNumber
                  ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg`
                  : '—'}
              </span>
            </div>
          </div>

          {noChange && (
            <p className="text-xs text-muted-foreground">No change to apply.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!isValidNumber || noChange || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
