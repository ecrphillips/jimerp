import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [confirmOrder, setConfirmOrder] = useState(currentStatus === 'SUBMITTED');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!date) {
      toast.error('Please select a deadline date');
      return;
    }

    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        work_deadline: format(date, 'yyyy-MM-dd'),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Set Work Deadline for {orderNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Deadline Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !date && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
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
          <Button onClick={handleSave} disabled={saving || !date}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
