import { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { timeToMinutes, type BlockRow, type BookingRow } from './bookingUtils';

const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let h = 5; h <= 22; h++) {
  for (let m = 0; m < 60; m += 30) {
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h >= 12 ? 'PM' : 'AM';
    TIME_OPTIONS.push({ value, label: `${h12}:${String(m).padStart(2, '0')} ${ampm}` });
  }
}

/** Check if a 30-min slot starting at `slotMin` is blocked */
function isSlotBlocked(
  slotMin: number,
  dateStr: string,
  blocks: BlockRow[],
  bookings: BookingRow[],
): boolean {
  const slotEnd = slotMin + 30;
  for (const b of blocks) {
    if (b.block_date !== dateStr) continue;
    const bStart = timeToMinutes(b.start_time);
    const bEnd = timeToMinutes(b.end_time);
    if (slotMin < bEnd && slotEnd > bStart) return true;
  }
  for (const bk of bookings) {
    if (bk.booking_date !== dateStr) continue;
    if (bk.status === 'CANCELLED') continue;
    const bStart = timeToMinutes(bk.start_time);
    const bEnd = timeToMinutes(bk.end_time);
    if (slotMin < bEnd && slotEnd > bStart) return true;
  }
  return false;
}

/** For end-time mode: check if the range [startMin, candidateEndMin] overlaps anything */
function isRangeBlocked(
  startMin: number,
  endMin: number,
  dateStr: string,
  blocks: BlockRow[],
  bookings: BookingRow[],
): boolean {
  for (const b of blocks) {
    if (b.block_date !== dateStr) continue;
    const bStart = timeToMinutes(b.start_time);
    const bEnd = timeToMinutes(b.end_time);
    if (startMin < bEnd && endMin > bStart) return true;
  }
  for (const bk of bookings) {
    if (bk.booking_date !== dateStr) continue;
    if (bk.status === 'CANCELLED') continue;
    const bStart = timeToMinutes(bk.start_time);
    const bEnd = timeToMinutes(bk.end_time);
    if (startMin < bEnd && endMin > bStart) return true;
  }
  return false;
}

interface AvailabilityTimeSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  dateStr: string | null;
  blocks: BlockRow[];
  bookings: BookingRow[];
  /** If set, this is an end-time picker — check full range from startMin */
  startTimeForRange?: string;
  /** Whether current value is conflicted (red highlight on trigger) */
  isConflicted?: boolean;
}

export function AvailabilityTimeSelect({
  value,
  onValueChange,
  placeholder = 'Select time',
  dateStr,
  blocks,
  bookings,
  startTimeForRange,
  isConflicted,
}: AvailabilityTimeSelectProps) {
  const blockedSet = useMemo(() => {
    if (!dateStr) return new Set<string>();
    const set = new Set<string>();
    const startMin = startTimeForRange ? timeToMinutes(startTimeForRange) : null;

    for (const opt of TIME_OPTIONS) {
      const optMin = timeToMinutes(opt.value);
      if (startMin !== null) {
        // End-time mode: only show times after start, check full range
        if (optMin <= startMin) {
          set.add(opt.value);
        } else if (isRangeBlocked(startMin, optMin, dateStr, blocks, bookings)) {
          set.add(opt.value);
        }
      } else {
        // Start-time mode: check individual 30-min slot
        if (isSlotBlocked(optMin, dateStr, blocks, bookings)) {
          set.add(opt.value);
        }
      }
    }
    return set;
  }, [dateStr, blocks, bookings, startTimeForRange]);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={cn(isConflicted && 'border-destructive ring-1 ring-destructive')}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[200px]">
        {TIME_OPTIONS.map((opt) => {
          const blocked = blockedSet.has(opt.value);
          return (
            <SelectItem
              key={opt.value}
              value={opt.value}
              disabled={blocked}
              className={cn(blocked && 'opacity-50')}
            >
              <span className="flex items-center gap-2">
                {opt.label}
                {blocked && (
                  <span className="text-[10px] text-muted-foreground font-medium">Blocked</span>
                )}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
