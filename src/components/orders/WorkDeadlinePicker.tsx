import React, { useState, useEffect, useMemo } from 'react';
import { format, setHours, setMinutes, parseISO, isValid as isValidDate } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CalendarIcon, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const TIMEZONE = 'America/Vancouver';

// Time options from 08:00 to 16:00 in 1-hour increments
const TIME_OPTIONS = [
  { value: '08:00', label: '08:00' },
  { value: '09:00', label: '09:00' },
  { value: '10:00', label: '10:00' },
  { value: '11:00', label: '11:00' },
  { value: '12:00', label: '12:00' },
  { value: '13:00', label: '13:00' },
  { value: '14:00', label: '14:00' },
  { value: '15:00', label: '15:00' },
  { value: '16:00', label: '16:00' },
];

interface WorkDeadlinePickerProps {
  value: string | null; // ISO timestamptz string or null
  onChange: (value: string | null) => void;
  onSave?: () => void;
  showSaveButton?: boolean;
  isSaving?: boolean;
  compact?: boolean;
}

export function WorkDeadlinePicker({
  value,
  onChange,
  onSave,
  showSaveButton = true,
  isSaving = false,
  compact = false,
}: WorkDeadlinePickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string>('10:00');
  const [hasInteracted, setHasInteracted] = useState(false);

  // Parse incoming value to local date and time
  useEffect(() => {
    if (value) {
      try {
        const parsed = parseISO(value);
        if (isValidDate(parsed)) {
          // Convert to Vancouver timezone for display
          const zonedDate = toZonedTime(parsed, TIMEZONE);
          setSelectedDate(zonedDate);
          
          const hours = zonedDate.getHours().toString().padStart(2, '0');
          const minutes = zonedDate.getMinutes().toString().padStart(2, '0');
          const timeStr = `${hours}:${minutes}`;
          
          // Clamp to valid time options
          const validTime = TIME_OPTIONS.find(t => t.value === timeStr);
          setSelectedTime(validTime ? timeStr : '10:00');
        }
      } catch {
        // Invalid date, reset
        setSelectedDate(undefined);
        setSelectedTime('10:00');
      }
    } else {
      // No value - set defaults
      if (!hasInteracted) {
        setSelectedDate(undefined);
        setSelectedTime('10:00');
      }
    }
  }, [value, hasInteracted]);

  // Combine date and time into ISO string
  const combinedValue = useMemo(() => {
    if (!selectedDate || !selectedTime) return null;
    
    const [hours, minutes] = selectedTime.split(':').map(Number);
    const dateWithTime = setMinutes(setHours(selectedDate, hours), minutes);
    
    // Convert from Vancouver timezone to UTC for storage
    const utcDate = fromZonedTime(dateWithTime, TIMEZONE);
    return utcDate.toISOString();
  }, [selectedDate, selectedTime]);

  // Update parent when combined value changes
  useEffect(() => {
    if (hasInteracted && combinedValue !== value) {
      onChange(combinedValue);
    }
  }, [combinedValue, hasInteracted, onChange, value]);

  const handleDateSelect = (date: Date | undefined) => {
    setHasInteracted(true);
    setSelectedDate(date);
  };

  const handleTimeSelect = (time: string) => {
    setHasInteracted(true);
    setSelectedTime(time);
  };

  // Validation: both must be set
  const isComplete = selectedDate && selectedTime;
  const showValidation = hasInteracted && !isComplete;

  // Formatted display
  const displayText = useMemo(() => {
    if (!selectedDate || !selectedTime) return null;
    return `${format(selectedDate, 'EEE MMM d')}, ${selectedTime}`;
  }, [selectedDate, selectedTime]);

  return (
    <div className="space-y-2">
      <div className={cn("flex items-center gap-2", compact && "gap-1.5")}>
        {/* Date Picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size={compact ? "sm" : "default"}
              className={cn(
                'justify-start text-left font-normal',
                compact ? 'w-32 h-8 text-xs px-2' : 'w-36',
                !selectedDate && 'text-muted-foreground',
                showValidation && !selectedDate && 'border-destructive'
              )}
            >
              <CalendarIcon className={cn("mr-2", compact && "h-3 w-3 mr-1")} />
              {selectedDate ? format(selectedDate, 'MMM d') : 'Date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        {/* Time Select */}
        <Select value={selectedTime} onValueChange={handleTimeSelect}>
          <SelectTrigger 
            className={cn(
              compact ? 'w-20 h-8 text-xs px-2' : 'w-24',
              showValidation && !selectedTime && 'border-destructive'
            )}
          >
            <Clock className={cn("mr-1", compact ? "h-3 w-3" : "h-4 w-4")} />
            <SelectValue placeholder="Time" />
          </SelectTrigger>
          <SelectContent>
            {TIME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Save Button */}
        {showSaveButton && onSave && (
          <Button
            size={compact ? "sm" : "default"}
            variant="outline"
            onClick={onSave}
            disabled={isSaving || !isComplete}
            className={compact ? "h-8 px-2 text-xs" : ""}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>

      {/* Validation message */}
      {showValidation && (
        <p className="text-xs text-destructive">
          Please select both date and time
        </p>
      )}

      {/* Display readout */}
      {displayText && (
        <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
          Deadline: {displayText}
        </p>
      )}
    </div>
  );
}
