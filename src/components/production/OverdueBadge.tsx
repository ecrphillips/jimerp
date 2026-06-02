import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Clock, CalendarClock } from 'lucide-react';
import { parseISO, differenceInMinutes, differenceInHours, differenceInDays, startOfDay, differenceInCalendarDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { TIMEZONE, getVancouverNow } from '@/lib/productionScheduling';
import { cn } from '@/lib/utils';

export type DueBucket = 'today' | 'tomorrow' | 'later';

/**
 * Bucket a work deadline into today / tomorrow / later (Vancouver time).
 * Anything already past collapses into 'today' — it's due now, not noisy "LATE".
 */
export function getDueBucket(workDeadlineAt: string | null): DueBucket | null {
  if (!workDeadlineAt) return null;

  try {
    const now = getVancouverNow();
    const deadlineVancouver = toZonedTime(parseISO(workDeadlineAt), TIMEZONE);
    const days = differenceInCalendarDays(startOfDay(deadlineVancouver), startOfDay(now));

    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    return 'later';
  } catch {
    return null;
  }
}

interface OverdueBadgeProps {
  workDeadlineAt: string | null;
  className?: string;
  /** If true, shows just the badge. If false (default), also shows the deadline time */
  badgeOnly?: boolean;
}

/**
 * Check if an order is overdue based on work_deadline_at
 * An order is overdue if work_deadline_at < now (Pacific Time)
 */
export function isOrderOverdue(workDeadlineAt: string | null): boolean {
  if (!workDeadlineAt) return false;
  
  try {
    const deadlineUtc = parseISO(workDeadlineAt);
    const now = getVancouverNow();
    const deadlineVancouver = toZonedTime(deadlineUtc, TIMEZONE);
    
    return deadlineVancouver < now;
  } catch {
    return false;
  }
}

/**
 * Get formatted duration string for how long overdue
 */
export function getOverdueDuration(workDeadlineAt: string | null): string | null {
  if (!workDeadlineAt) return null;
  
  try {
    const deadlineUtc = parseISO(workDeadlineAt);
    const now = getVancouverNow();
    const deadlineVancouver = toZonedTime(deadlineUtc, TIMEZONE);
    
    if (deadlineVancouver >= now) return null;
    
    const minutesOverdue = differenceInMinutes(now, deadlineVancouver);
    
    if (minutesOverdue < 60) {
      return `${minutesOverdue}m overdue`;
    }
    
    const hoursOverdue = differenceInHours(now, deadlineVancouver);
    
    if (hoursOverdue < 24) {
      return `${hoursOverdue}h overdue`;
    }
    
    const daysOverdue = differenceInDays(now, deadlineVancouver);
    return `${daysOverdue}d overdue`;
  } catch {
    return null;
  }
}

/**
 * OverdueBadge - Visual indicator for late/overdue orders
 * 
 * Shows a prominent "LATE" badge in destructive colors when an order
 * has passed its work deadline but hasn't been shipped.
 */
export function OverdueBadge({ workDeadlineAt, className, badgeOnly = false }: OverdueBadgeProps) {
  const isOverdue = useMemo(() => isOrderOverdue(workDeadlineAt), [workDeadlineAt]);
  const overdueDuration = useMemo(() => getOverdueDuration(workDeadlineAt), [workDeadlineAt]);
  
  if (!isOverdue) return null;
  
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Badge 
        variant="destructive" 
        className="flex items-center gap-1 px-2 py-0.5 text-xs font-bold animate-pulse"
      >
        <AlertTriangle className="h-3 w-3" />
        LATE
      </Badge>
      {!badgeOnly && overdueDuration && (
        <span className="text-xs text-destructive font-medium flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {overdueDuration}
        </span>
      )}
    </div>
  );
}

/**
 * DueBadge - calm "Due today / tomorrow / later" cue.
 *
 * Replaces the noisy pulsing LATE badge. Today is emphasized (it needs action),
 * tomorrow is a soft heads-up, later is muted. No pulse, no "Xd overdue" string.
 */
export function DueBadge({ workDeadlineAt, className }: { workDeadlineAt: string | null; className?: string }) {
  const bucket = useMemo(() => getDueBucket(workDeadlineAt), [workDeadlineAt]);

  if (!bucket) return null;

  const styles: Record<DueBucket, { className: string; label: string }> = {
    today: {
      className: 'bg-destructive/10 text-destructive border-destructive/30',
      label: 'Due today',
    },
    tomorrow: {
      className: 'bg-amber-100 text-amber-800 border-amber-300',
      label: 'Due tomorrow',
    },
    later: {
      className: 'bg-muted text-muted-foreground border-border',
      label: 'Due later',
    },
  };

  const { className: badgeClass, label } = styles[bucket];

  return (
    <Badge variant="outline" className={cn('flex items-center gap-1 px-2 py-0.5 text-xs font-medium', badgeClass, className)}>
      <CalendarClock className="h-3 w-3" />
      {label}
    </Badge>
  );
}

/**
 * Inline variant - smaller, for use in table rows
 */
export function OverdueBadgeInline({ workDeadlineAt }: { workDeadlineAt: string | null }) {
  const isOverdue = useMemo(() => isOrderOverdue(workDeadlineAt), [workDeadlineAt]);
  const overdueDuration = useMemo(() => getOverdueDuration(workDeadlineAt), [workDeadlineAt]);
  
  if (!isOverdue) return null;
  
  return (
    <span className="inline-flex items-center gap-1 text-destructive font-medium text-xs">
      <AlertTriangle className="h-3 w-3" />
      {overdueDuration || 'LATE'}
    </span>
  );
}
