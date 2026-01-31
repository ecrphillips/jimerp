import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Clock } from 'lucide-react';
import { parseISO, differenceInMinutes, differenceInHours, differenceInDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { TIMEZONE, getVancouverNow } from '@/lib/productionScheduling';
import { cn } from '@/lib/utils';

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
