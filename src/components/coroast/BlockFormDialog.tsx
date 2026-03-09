import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CalendarIcon } from 'lucide-react';
import { format, addDays, getDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TimeSelect } from './TimeSelect';
import {
  LoringBlock, LoringBlockType, BLOCK_TYPE_LABELS,
  DAYS_OF_WEEK, DAY_LABELS, JS_DAY_TO_STRING,
} from './types';

interface BlockFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingBlock: LoringBlock | null;
  onSuccess: () => void;
}

const DAY_INDEX: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function getFirstOccurrence(startDate: Date, dayStr: string): Date {
  const target = DAY_INDEX[dayStr];
  const current = getDay(startDate);
  const diff = (target - current + 7) % 7;
  return diff === 0 ? startDate : addDays(startDate, diff);
}

function generateRecurringDates(startDate: Date, dayStr: string, endDate: Date | null): Date[] {
  const first = getFirstOccurrence(startDate, dayStr);
  const dates: Date[] = [];
  const maxDate = endDate || addDays(first, 12 * 7);
  let current = first;
  while (current <= maxDate) {
    dates.push(new Date(current));
    current = addDays(current, 7);
  }
  return dates;
}

export function BlockFormDialog({ open, onOpenChange, editingBlock, onSuccess }: BlockFormDialogProps) {
  const queryClient = useQueryClient();

  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');
  const [formBlockType, setFormBlockType] = useState<LoringBlockType>('INTERNAL_PRODUCTION');
  const [formNotes, setFormNotes] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDay, setRecurringDay] = useState('MON');
  const [recurringEndDate, setRecurringEndDate] = useState<Date | undefined>();
  const [editScope, setEditScope] = useState<'single' | 'future'>('single');

  const isEditing = !!editingBlock;
  const hasSeries = !!editingBlock?.recurring_series_id;

  useEffect(() => {
    if (open) {
      if (editingBlock) {
        setFormDate(new Date(editingBlock.block_date + 'T00:00:00'));
        setFormStartTime(editingBlock.start_time.slice(0, 5));
        setFormEndTime(editingBlock.end_time.slice(0, 5));
        setFormBlockType(editingBlock.block_type);
        setFormNotes(editingBlock.notes ?? '');
        setIsRecurring(false);
        setEditScope('single');
      } else {
        setFormDate(undefined);
        setFormStartTime('');
        setFormEndTime('');
        setFormBlockType('INTERNAL_PRODUCTION');
        setFormNotes('');
        setIsRecurring(false);
        setRecurringDay('MON');
        setRecurringEndDate(undefined);
        setEditScope('single');
      }
    }
  }, [open, editingBlock]);

  useEffect(() => {
    if (formDate && !isEditing) {
      setRecurringDay(JS_DAY_TO_STRING[getDay(formDate)]);
    }
  }, [formDate, isEditing]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!formDate && !(isEditing && hasSeries && editScope === 'future')) {
        throw new Error('Date required');
      }
      if (!formStartTime || !formEndTime) throw new Error('Start and end times required');
      if (formEndTime <= formStartTime) throw new Error('End time must be after start time');

      if (isEditing) {
        if (hasSeries && editScope === 'future') {
          const { error } = await (supabase
            .from('coroast_loring_blocks') as any)
            .update({
              start_time: formStartTime,
              end_time: formEndTime,
              block_type: formBlockType,
              notes: formNotes.trim() || null,
            })
            .eq('recurring_series_id', editingBlock!.recurring_series_id!)
            .gte('block_date', editingBlock!.block_date);
          if (error) throw error;
        } else {
          const updates: Record<string, any> = {
            block_date: format(formDate!, 'yyyy-MM-dd'),
            start_time: formStartTime,
            end_time: formEndTime,
            block_type: formBlockType,
            notes: formNotes.trim() || null,
          };
          if (hasSeries) {
            updates.recurring_series_id = null;
          }
          const { error } = await (supabase
            .from('coroast_loring_blocks') as any)
            .update(updates)
            .eq('id', editingBlock!.id);
          if (error) throw error;
        }
      } else if (isRecurring) {
        const dates = generateRecurringDates(formDate!, recurringDay, recurringEndDate ?? null);
        if (dates.length === 0) throw new Error('No dates generated for the selected day');
        const seriesId = crypto.randomUUID();
        const rows = dates.map(d => ({
          block_date: format(d, 'yyyy-MM-dd'),
          start_time: formStartTime,
          end_time: formEndTime,
          block_type: formBlockType,
          notes: formNotes.trim() || null,
          recurring_series_id: seriesId,
        }));
        const { error } = await (supabase
          .from('coroast_loring_blocks') as any)
          .insert(rows);
        if (error) throw error;
        toast.success(`Created ${dates.length} recurring blocks`);
        return;
      } else {
        const { error } = await supabase.from('coroast_loring_blocks').insert({
          block_date: format(formDate!, 'yyyy-MM-dd'),
          start_time: formStartTime,
          end_time: formEndTime,
          block_type: formBlockType,
          notes: formNotes.trim() || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (!isRecurring) toast.success(isEditing ? 'Block updated' : 'Block created');
      queryClient.invalidateQueries({ queryKey: ['coroast-loring-blocks'] });
      onSuccess();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      console.error(err);
      toast.error(err.message || 'Failed to save block');
    },
  });

  const handleSubmit = () => {
    if (!formDate && !(isEditing && hasSeries && editScope === 'future')) {
      toast.error('Date is required');
      return;
    }
    if (!formStartTime || !formEndTime) {
      toast.error('Start and end times are required');
      return;
    }
    if (formEndTime <= formStartTime) {
      toast.error('End time must be after start time');
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Block' : 'Add Unavailability Block'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Edit scope for series blocks */}
          {isEditing && hasSeries && (
            <div className="rounded-md border p-3 bg-muted/50">
              <Label className="text-sm font-medium">Apply changes to:</Label>
              <RadioGroup
                value={editScope}
                onValueChange={(v) => setEditScope(v as 'single' | 'future')}
                className="mt-2 space-y-1"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="single" id="scope-single" />
                  <Label htmlFor="scope-single" className="font-normal">This block only</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="future" id="scope-future" />
                  <Label htmlFor="scope-future" className="font-normal">All future blocks in this series</Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Date picker — hidden for "all future" edit */}
          {!(isEditing && hasSeries && editScope === 'future') && (
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal', !formDate && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formDate ? format(formDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formDate}
                    onSelect={setFormDate}
                    initialFocus
                    className={cn('p-3 pointer-events-auto')}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Time pickers */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Time *</Label>
              <TimeSelect value={formStartTime} onValueChange={setFormStartTime} placeholder="Start" />
            </div>
            <div>
              <Label>End Time *</Label>
              <TimeSelect value={formEndTime} onValueChange={setFormEndTime} placeholder="End" />
            </div>
          </div>

          {/* Block type */}
          <div>
            <Label>Block Type</Label>
            <Select value={formBlockType} onValueChange={(v) => setFormBlockType(v as LoringBlockType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BLOCK_TYPE_LABELS) as LoringBlockType[]).map((k) => (
                  <SelectItem key={k} value={k}>{BLOCK_TYPE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Recurring option (create mode only) */}
          {!isEditing && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={isRecurring} onCheckedChange={(c) => setIsRecurring(!!c)} />
                <span className="text-sm font-medium">Recurring weekly</span>
              </label>
              {isRecurring && (
                <div className="space-y-3 pl-4 border-l-2 border-muted">
                  <div>
                    <Label className="text-sm">Day of week</Label>
                    <div className="flex gap-1 mt-1">
                      {DAYS_OF_WEEK.map((d) => (
                        <Button
                          key={d}
                          type="button"
                          size="sm"
                          variant={recurringDay === d ? 'default' : 'outline'}
                          className="px-2 py-1 text-xs h-7"
                          onClick={() => setRecurringDay(d)}
                        >
                          {DAY_LABELS[d]}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm">End date (optional)</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn('w-full justify-start text-left font-normal', !recurringEndDate && 'text-muted-foreground')}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {recurringEndDate ? format(recurringEndDate, 'PPP') : '12 weeks (default)'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={recurringEndDate}
                          onSelect={setRecurringEndDate}
                          initialFocus
                          className={cn('p-3 pointer-events-auto')}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <Label htmlFor="blockNotes">Notes</Label>
            <Textarea
              id="blockNotes"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEditing ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
