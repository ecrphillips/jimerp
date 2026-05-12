import { useMemo } from 'react';
import { format, parseISO, isValid, isBefore, isWeekend, startOfDay } from 'date-fns';
import { CalendarIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DatePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  minDate?: Date;
  disableWeekends?: boolean;
  placeholder?: string;
  compact?: boolean;
  id?: string;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  minDate,
  disableWeekends = true,
  placeholder = 'Select date',
  compact = false,
  id,
  className,
}: DatePickerProps) {
  const selected = useMemo(() => {
    if (!value) return undefined;
    const parsed = parseISO(value);
    return isValid(parsed) ? startOfDay(parsed) : undefined;
  }, [value]);

  const minNormalized = useMemo(
    () => startOfDay(minDate ?? new Date()),
    [minDate],
  );

  const isDisabled = (date: Date) => {
    if (isBefore(date, minNormalized)) return true;
    if (disableWeekends && isWeekend(date)) return true;
    return false;
  };

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      onChange(null);
      return;
    }
    onChange(format(date, 'yyyy-MM-dd'));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size={compact ? 'sm' : 'default'}
          className={cn(
            'justify-start text-left font-normal',
            compact ? 'h-8 text-xs px-2' : 'w-full',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className={cn('mr-2', compact && 'h-3 w-3 mr-1')} />
          {selected ? format(selected, 'EEE MMM d, yyyy') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          disabled={isDisabled}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
