import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday,
  addMonths, subMonths,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { LoringBlock, BLOCK_TYPE_LABELS, BLOCK_TYPE_COLORS, formatTime } from './types';

interface BlockCalendarViewProps {
  blocks: LoringBlock[];
  onEditBlock: (block: LoringBlock) => void;
  onDeleteBlock: (block: LoringBlock) => void;
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function BlockCalendarView({ blocks, onEditBlock }: BlockCalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const start = startOfWeek(monthStart, { weekStartsOn: 1 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const blocksByDate = useMemo(() => {
    const map = new Map<string, LoringBlock[]>();
    blocks.forEach((b) => {
      const key = b.block_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    });
    return map;
  }, [blocks]);

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold text-lg">{format(currentMonth, 'MMMM yyyy')}</h3>
        <Button variant="outline" size="sm" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {WEEKDAY_HEADERS.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
        {calendarDays.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayBlocks = blocksByDate.get(dateStr) || [];
          const inMonth = isSameMonth(day, currentMonth);

          return (
            <div
              key={dateStr}
              className={cn(
                'bg-background min-h-[90px] p-1.5',
                !inMonth && 'opacity-40',
                isToday(day) && 'ring-1 ring-primary ring-inset',
              )}
            >
              <div className={cn(
                'text-xs font-medium mb-1',
                isToday(day) ? 'text-primary font-bold' : 'text-foreground',
              )}>
                {format(day, 'd')}
              </div>
              <div className="space-y-0.5">
                {dayBlocks.slice(0, 3).map((b) => (
                  <button
                    key={b.id}
                    onClick={() => onEditBlock(b)}
                    className={cn(
                      'w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded truncate flex items-center gap-0.5',
                      BLOCK_TYPE_COLORS[b.block_type],
                      'hover:opacity-80 transition-opacity cursor-pointer',
                    )}
                    title={`${BLOCK_TYPE_LABELS[b.block_type]}: ${formatTime(b.start_time)} – ${formatTime(b.end_time)}${b.notes ? ' — ' + b.notes : ''}`}
                  >
                    {b.recurring_series_id && <Repeat className="h-2.5 w-2.5 flex-shrink-0" />}
                    <span className="truncate">{formatTime(b.start_time)}</span>
                  </button>
                ))}
                {dayBlocks.length > 3 && (
                  <div className="text-[10px] text-muted-foreground pl-1">+{dayBlocks.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
