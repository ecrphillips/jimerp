import React, { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { WorkDeadlinePicker } from './WorkDeadlinePicker';

interface SetDeadlineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  currentStatus: string;
  onSuccess: () => void;
}

export function SetDeadlineModal({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  currentStatus,
  onSuccess,
}: SetDeadlineModalProps) {
  const [deadlineAt, setDeadlineAt] = useState<string | null>(null);
  const [confirmOrder, setConfirmOrder] = useState(currentStatus === 'SUBMITTED');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!deadlineAt) {
      toast.error('Please select both date and time');
      return;
    }

    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        work_deadline_at: deadlineAt,
      };

      if (confirmOrder && currentStatus === 'SUBMITTED') {
        updates.status = 'CONFIRMED';
      }

      const { error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId);

      if (error) throw error;

      toast.success(
        confirmOrder && currentStatus === 'SUBMITTED'
          ? 'Deadline set and order confirmed'
          : 'Deadline set'
      );
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to set deadline');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Reset state when modal opens
  React.useEffect(() => {
    if (open) {
      setDeadlineAt(null);
      setConfirmOrder(currentStatus === 'SUBMITTED');
    }
  }, [open, currentStatus]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Set Work Deadline for {orderNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Deadline Date & Time</label>
            <WorkDeadlinePicker
              value={deadlineAt}
              onChange={setDeadlineAt}
              showSaveButton={false}
            />
          </div>

          {currentStatus === 'SUBMITTED' && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="confirm-order"
                checked={confirmOrder}
                onCheckedChange={(checked) => setConfirmOrder(checked === true)}
              />
              <label
                htmlFor="confirm-order"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Confirm order now
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !deadlineAt}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
