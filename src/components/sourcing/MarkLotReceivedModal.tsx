import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

interface MarkLotReceivedModalProps {
  lot: {
    id: string;
    lot_number: string;
    bags_released: number;
    bag_size_kg: number;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function MarkLotReceivedModal({ lot, open, onOpenChange }: MarkLotReceivedModalProps) {
  const queryClient = useQueryClient();
  const expectedKg = lot ? lot.bags_released * lot.bag_size_kg : 0;
  const today = todayLocalISO();

  const [receivedDate, setReceivedDate] = useState(today);
  const [kgOnHand, setKgOnHand] = useState<string>('');
  const [exceptionsNoted, setExceptionsNoted] = useState(false);
  const [exceptionNotes, setExceptionNotes] = useState('');

  // Reset state on open
  useEffect(() => {
    if (open && lot) {
      setReceivedDate(today);
      setKgOnHand(String(expectedKg));
      setExceptionsNoted(false);
      setExceptionNotes('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lot?.id]);

  const markReceivedMutation = useMutation({
    mutationFn: async () => {
      if (!lot) throw new Error('No lot');
      const kg = parseFloat(kgOnHand);
      const { error } = await supabase
        .from('green_lots')
        .update({
          status: 'RECEIVED',
          received_date: receivedDate,
          kg_on_hand: kg,
          exceptions_noted: exceptionsNoted,
          exceptions_notes: exceptionsNoted ? (exceptionNotes.trim() || null) : null,
        })
        .eq('id', lot.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Lot ${lot?.lot_number} marked received`);
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots-for-linking'] });
      queryClient.invalidateQueries({ queryKey: ['depletion-links'] });
      queryClient.invalidateQueries({ queryKey: ['green-lot-detail', lot?.id] });
      queryClient.invalidateQueries({ queryKey: ['coverage-calendar-lots'] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to mark lot as received');
    },
  });

  const kgNum = parseFloat(kgOnHand);
  const kgInvalid = isNaN(kgNum) || kgNum < 0;
  const dateInvalid = !receivedDate || receivedDate > today;
  const canSubmit = !kgInvalid && !dateInvalid && !markReceivedMutation.isPending;

  if (!lot) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {lot.lot_number} as received</DialogTitle>
          <DialogDescription>
            Confirm the arrival details. This updates the lot status and on-hand quantity.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="received-date">Received date</Label>
            <Input
              id="received-date"
              type="date"
              value={receivedDate}
              max={today}
              onChange={(e) => setReceivedDate(e.target.value)}
            />
            {dateInvalid && (
              <p className="text-xs text-destructive">Received date cannot be in the future.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kg-on-hand">Confirm kg received</Label>
            <Input
              id="kg-on-hand"
              type="number"
              step="0.1"
              min="0"
              value={kgOnHand}
              onChange={(e) => setKgOnHand(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Expected: {expectedKg.toLocaleString()} kg (from {lot.bags_released} bags × {lot.bag_size_kg} kg)
            </p>
            {kgInvalid && (
              <p className="text-xs text-destructive">Kg on hand must be 0 or greater.</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Checkbox
                id="exceptions-noted"
                checked={exceptionsNoted}
                onCheckedChange={(v) => setExceptionsNoted(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="exceptions-noted" className="text-sm font-normal leading-snug cursor-pointer">
                This lot arrived with exceptions (damaged bags, short count, quality issues, etc.)
              </Label>
            </div>

            {exceptionsNoted && (
              <div className="space-y-1.5 pl-6">
                <Textarea
                  value={exceptionNotes}
                  onChange={(e) => setExceptionNotes(e.target.value)}
                  placeholder="Describe the issue so the team has context for reconciliation…"
                  rows={3}
                />
                {!exceptionNotes.trim() && (
                  <p className="text-xs text-muted-foreground">
                    Consider adding a note for reconciliation later.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={markReceivedMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => markReceivedMutation.mutate()} disabled={!canSubmit}>
            {markReceivedMutation.isPending ? 'Saving…' : 'Mark as Received'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
