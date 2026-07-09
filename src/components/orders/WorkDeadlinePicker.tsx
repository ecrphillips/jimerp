import React, { useState, useEffect, useMemo, useRef } from 'react';
import { format, setHours, setMinutes, parseISO, isValid as isValidDate, startOfDay, isSameDay, isWeekend, nextMonday, isBefore, addDays } from 'date-fns';
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
import { CalendarIcon, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TIMEZONE } from '@/lib/productionScheduling';

// Coarse priority buckets within the production window.
// Simplifies the choice to AM / Noon / PM while still allowing a nudge
// up or down in priority within the same day. Noon is the default.
const TIME_AM = '08:00';
const TIME_NOON = '12:00';
const TIME_PM = '16:00';
const DEFAULT_TIME = TIME_NOON;

const TIME_OPTIONS = [
  { value: TIME_AM, label: 'AM' },
  { value: TIME_NOON, label: 'Noon' },
  { value: TIME_PM, label: 'PM' },
];

// Map an arbitrary stored hour back to its bucket.
function bucketFromHour(hour: number): string {
  if (hour < 12) return TIME_AM;
  if (hour === 12) return TIME_NOON;
  return TIME_PM;
}

/**
 * Normalize a Date to midnight in local browser time.
 * This ensures consistent comparison regardless of time component.
 */
function normalizeToLocalMidnight(date: Date): Date {
  return startOfDay(date);
}

/**
 * Create a "clean" local date for the calendar from a zoned date.
 * React-Day-Picker expects dates at midnight in local browser time.
 */
function toCalendarDate(zonedDate: Date): Date {
  // Extract the Vancouver date components and create a new Date at local midnight
  const year = zonedDate.getFullYear();
  const month = zonedDate.getMonth();
  const day = zonedDate.getDate();
  return new Date(year, month, day, 0, 0, 0, 0);
}

/**
 * Check if a date should be disabled in the calendar
 * Disables weekends and past dates
 */
function isDateDisabled(date: Date): boolean {
  const today = normalizeToLocalMidnight(new Date());
  // Disable past dates and weekends
  return isBefore(date, today) || isWeekend(date);
}

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
  // Use a "calendar date" (midnight local) for the picker, separate from time
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string>(DEFAULT_TIME);
  const [hasInteracted, setHasInteracted] = useState(false);

  // Track the last value we emitted to avoid re-syncing our own updates
  const lastEmittedValueRef = useRef<string | null>(null);
  // Mirror of hasInteracted read inside the sync effect WITHOUT making it a
  // dependency. If hasInteracted were a dep, the first interaction (false→true)
  // would re-run this effect while `value` still holds the OLD prop value,
  // clobbering the date the user just picked — which is what caused the
  // "first click doesn't register" bug.
  const hasInteractedRef = useRef(false);

  // Parse incoming value to local date and time
  // Only sync from prop if it's a genuinely new external value
  useEffect(() => {
    // Skip if this is the value we just emitted
    if (value === lastEmittedValueRef.current) {
      return;
    }

    if (value) {
      try {
        const parsed = parseISO(value);
        if (isValidDate(parsed)) {
          // Convert to Vancouver timezone for display
          const zonedDate = toZonedTime(parsed, TIMEZONE);
          
          // Create a clean calendar date (midnight local)
          const calendarDate = toCalendarDate(zonedDate);
          setSelectedDate(calendarDate);
          
          // Collapse the stored hour into an AM / Noon / PM bucket
          setSelectedTime(bucketFromHour(zonedDate.getHours()));
        }
      } catch {
        // Invalid date, reset
        setSelectedDate(undefined);
        setSelectedTime(DEFAULT_TIME);
      }
    } else {
      // No value - set defaults only if user hasn't interacted
      if (!hasInteractedRef.current) {
        setSelectedDate(undefined);
        setSelectedTime(DEFAULT_TIME);
      }
    }
  }, [value]);

  // Combine date and time into ISO string
  const combinedValue = useMemo(() => {
    if (!selectedDate || !selectedTime) return null;
    
    const [hours, minutes] = selectedTime.split(':').map(Number);
    
    // selectedDate is at midnight local time
    // Create the datetime with the selected time in Vancouver timezone
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const day = selectedDate.getDate();
    
    // Create a date representing the desired Vancouver time
    const dateWithTime = new Date(year, month, day, hours, minutes, 0, 0);
    
    // Convert from Vancouver timezone to UTC for storage
    const utcDate = fromZonedTime(dateWithTime, TIMEZONE);
    
    // DEV ASSERTION: Verify round-trip consistency
    if (process.env.NODE_ENV === 'development') {
      const roundTrip = toZonedTime(utcDate, TIMEZONE);
      const roundTripCalendar = toCalendarDate(roundTrip);
      if (!isSameDay(roundTripCalendar, selectedDate)) {
        console.error(
          '[WorkDeadlinePicker] Date round-trip mismatch!',
          { selectedDate, roundTripCalendar, utcDate: utcDate.toISOString() }
        );
      }
    }
    
    return utcDate.toISOString();
  }, [selectedDate, selectedTime]);

  // Update parent when combined value changes
  useEffect(() => {
    if (hasInteracted && combinedValue !== value) {
      // Track what we're emitting to avoid re-sync loop
      lastEmittedValueRef.current = combinedValue;
      onChange(combinedValue);
    }
  }, [combinedValue, hasInteracted, onChange, value]);

  const handleDateSelect = (date: Date | undefined) => {
    hasInteractedRef.current = true;
    setHasInteracted(true);
    if (date) {
      // Auto-bump weekend dates to next Monday
      let validDate = normalizeToLocalMidnight(date);
      if (isWeekend(validDate)) {
        validDate = nextMonday(validDate);
      }
      setSelectedDate(validDate);
    } else {
      setSelectedDate(undefined);
    }
  };

  const handleTimeSelect = (time: string) => {
    hasInteractedRef.current = true;
    setHasInteracted(true);
    setSelectedTime(time);
  };

  // Validation: both must be set
  const isComplete = selectedDate && selectedTime;
  const showValidation = hasInteracted && !isComplete;

  // Formatted display - use the calendar date components directly
  const displayText = useMemo(() => {
    if (!selectedDate || !selectedTime) return null;
    const timeLabel = TIME_OPTIONS.find(t => t.value === selectedTime)?.label ?? selectedTime;
    return `${format(selectedDate, 'EEE MMM d')}, ${timeLabel}`;
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
              disabled={isDateDisabled}
              initialFocus
              className="p-3 pointer-events-auto"
            />
            <p className="text-xs text-muted-foreground px-3 pb-2">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              Mon–Fri only (08:00–16:00 Pacific)
            </p>
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

/**
 * Test helper for date normalization logic.
 * Verifies that selecting tomorrow results in correct round-trip.
 */
export function testDateRoundTrip(localDate: Date, time: string = '10:00'): boolean {
  const [hours, minutes] = time.split(':').map(Number);
  const year = localDate.getFullYear();
  const month = localDate.getMonth();
  const day = localDate.getDate();
  
  const dateWithTime = new Date(year, month, day, hours, minutes, 0, 0);
  const utcDate = fromZonedTime(dateWithTime, TIMEZONE);
  const roundTrip = toZonedTime(utcDate, TIMEZONE);
  const roundTripCalendar = toCalendarDate(roundTrip);
  
  return isSameDay(roundTripCalendar, localDate);
}
