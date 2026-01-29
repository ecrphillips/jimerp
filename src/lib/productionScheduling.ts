/**
 * Production Scheduling Utilities
 * 
 * All production logic operates in America/Vancouver timezone (Pacific Time).
 * DST-aware via date-fns-tz.
 * 
 * Key concepts:
 * - Production window: 08:00–16:00 local time, Mon-Fri only
 * - Required processing time: 2 hours 1 minute (hardcoded)
 * - work_start_at: When work must begin to meet the deadline
 * 
 * IMPORTANT: Use work_deadline_at field (timestamptz), NOT work_deadline (legacy text field)
 */

import { 
  format, 
  parseISO, 
  addDays, 
  subDays,
  subMinutes, 
  startOfDay, 
  setHours, 
  setMinutes,
  isBefore,
  isAfter,
  isEqual,
  differenceInMinutes,
  getDay,
  isWeekend,
  nextMonday,
} from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

// ========== CENTRALIZED CONFIG ==========
export const TIMEZONE = 'America/Vancouver';
export const PRODUCTION_WINDOW_START = 8; // 08:00
export const PRODUCTION_WINDOW_END = 16; // 16:00
export const REQUIRED_PROCESSING_MINUTES = 121; // 2 hours 1 minute
export const WORK_DAYS = [1, 2, 3, 4, 5]; // Mon-Fri (0=Sun, 6=Sat)
export const DEFAULT_NUDGE_HOUR = 10; // Default nudge target time

/**
 * Get the current time in Vancouver timezone
 */
export function getVancouverNow(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

/**
 * Get the current date string (YYYY-MM-DD) in Vancouver timezone
 */
export function getVancouverDateString(daysOffset = 0): string {
  const now = getVancouverNow();
  const target = addDays(now, daysOffset);
  return format(target, 'yyyy-MM-dd');
}

/**
 * Get a specific time on a given date in Vancouver timezone
 */
function getVancouverTimeOnDate(date: Date, hours: number, minutes: number): Date {
  const dayStart = startOfDay(date);
  return setMinutes(setHours(dayStart, hours), minutes);
}

/**
 * Get the production window start (08:00) for a given date
 */
export function getProductionWindowStart(date: Date): Date {
  return getVancouverTimeOnDate(date, PRODUCTION_WINDOW_START, 0);
}

/**
 * Get the production window end (16:00) for a given date
 */
export function getProductionWindowEnd(date: Date): Date {
  return getVancouverTimeOnDate(date, PRODUCTION_WINDOW_END, 0);
}

/**
 * Check if a date is a business day (Mon-Fri)
 */
export function isBusinessDay(date: Date): boolean {
  return WORK_DAYS.includes(getDay(date));
}

/**
 * Get the next business day from a given date
 * If the given date is already a business day, returns it
 */
export function getNextBusinessDay(date: Date): Date {
  let result = date;
  while (!isBusinessDay(result)) {
    result = addDays(result, 1);
  }
  return result;
}

/**
 * Get the previous business day from a given date
 * If the given date is already a business day, returns it
 */
export function getPreviousBusinessDay(date: Date): Date {
  let result = date;
  while (!isBusinessDay(result)) {
    result = subDays(result, 1);
  }
  return result;
}

/**
 * Calculate work_start_at from work_deadline_at
 * 
 * Rules:
 * 1. theoretical_start = work_deadline_at - 2h1m
 * 2. Snap to production window:
 *    - If between 08:00–16:00 on a business day → use as-is
 *    - If before 08:00 → previous business day at 15:59
 *    - If after 16:00 → same day at 16:00 (or next business day if weekend)
 */
export function computeWorkStartAt(workDeadlineAt: string | null): Date | null {
  if (!workDeadlineAt) return null;
  
  try {
    const deadlineUtc = parseISO(workDeadlineAt);
    const deadlineVancouver = toZonedTime(deadlineUtc, TIMEZONE);
    
    // Step 1: Calculate theoretical start time
    const theoreticalStart = subMinutes(deadlineVancouver, REQUIRED_PROCESSING_MINUTES);
    
    // Step 2: Get the production window boundaries for that day
    let windowDate = theoreticalStart;
    
    // If weekend, find the appropriate business day
    if (!isBusinessDay(windowDate)) {
      // For snapping purposes, treat weekend theoretical starts as previous Friday
      windowDate = getPreviousBusinessDay(windowDate);
    }
    
    const windowStart = getProductionWindowStart(windowDate);
    const windowEnd = getProductionWindowEnd(windowDate);
    
    // Step 3: Snap to production window
    let workStartAt: Date;
    
    if (isBefore(theoreticalStart, windowStart)) {
      // Before 08:00 → previous business day at 15:59
      const previousBizDay = getPreviousBusinessDay(subDays(windowDate, 1));
      workStartAt = setMinutes(setHours(startOfDay(previousBizDay), 15), 59);
    } else if (isAfter(theoreticalStart, windowEnd)) {
      // After 16:00 → same business day at 16:00
      workStartAt = getProductionWindowEnd(windowDate);
    } else if (!isBusinessDay(theoreticalStart)) {
      // Weekend → snap to previous Friday at 15:59
      const previousBizDay = getPreviousBusinessDay(theoreticalStart);
      workStartAt = setMinutes(setHours(startOfDay(previousBizDay), 15), 59);
    } else {
      // Within window on a business day → use as-is
      workStartAt = theoreticalStart;
    }
    
    return workStartAt;
  } catch (err) {
    console.error('[productionScheduling] Failed to compute work_start_at:', err);
    return null;
  }
}

/**
 * Check if a work_start_at falls within a specific day's production window
 */
export function isWorkStartInWindow(
  workStartAt: Date | null, 
  windowDate: Date
): boolean {
  if (!workStartAt) return false;
  
  const windowStart = getProductionWindowStart(windowDate);
  const windowEnd = getProductionWindowEnd(windowDate);
  
  // Check if work_start_at is >= windowStart and <= windowEnd
  // Also check that it's the same calendar day
  const sameDay = format(workStartAt, 'yyyy-MM-dd') === format(windowDate, 'yyyy-MM-dd');
  
  return sameDay && (
    (isAfter(workStartAt, windowStart) || isEqual(workStartAt, windowStart)) &&
    (isBefore(workStartAt, windowEnd) || isEqual(workStartAt, windowEnd))
  );
}

/**
 * Determine which production day bucket an order falls into
 * Returns: 'today' | 'tomorrow' | 'future' | 'past' | null
 */
export function getProductionDayBucket(
  workDeadlineAt: string | null
): 'today' | 'tomorrow' | 'future' | 'past' | null {
  const workStartAt = computeWorkStartAt(workDeadlineAt);
  if (!workStartAt) return null;
  
  const now = getVancouverNow();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  
  // Check if work must start today
  if (isWorkStartInWindow(workStartAt, today)) {
    return 'today';
  }
  
  // Check if work must start tomorrow
  if (isWorkStartInWindow(workStartAt, tomorrow)) {
    return 'tomorrow';
  }
  
  // Check if it's in the past (before today's window start)
  const todayWindowStart = getProductionWindowStart(today);
  if (isBefore(workStartAt, todayWindowStart)) {
    return 'past'; // Should have started already - treat as urgent/today
  }
  
  // Future
  return 'future';
}

/**
 * Filter configuration for production views
 * Now based on work_start_at falling within production windows
 */
export interface WorkStartFilterConfig {
  mode: 'today' | 'tomorrow' | 'all';
  // For database filtering, we still need to provide datetime bounds
  // But these are now based on work_start_at logic
  todayWindowStart: string; // Today at 08:00 UTC equivalent
  todayWindowEnd: string;   // Today at 16:00 UTC equivalent
  tomorrowWindowStart: string;
  tomorrowWindowEnd: string;
}

/**
 * Generate filter configuration for production queries
 * 
 * Since work_start_at is computed client-side, we need to filter by
 * work_deadline_at bounds that would result in work_start_at falling
 * within the desired day's production window.
 * 
 * Key insight:
 * - For TODAY's work: deadline could be today or tomorrow morning
 *   (since work starting today at 15:59 could have deadline at tomorrow 10:00)
 * - For TOMORROW's work: deadline could be tomorrow or day after
 */
export function getWorkStartFilterConfig(): WorkStartFilterConfig {
  const now = getVancouverNow();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  
  // Today's production window
  const todayWindowStart = getProductionWindowStart(today);
  const todayWindowEnd = getProductionWindowEnd(today);
  
  // Tomorrow's production window  
  const tomorrowWindowStart = getProductionWindowStart(tomorrow);
  const tomorrowWindowEnd = getProductionWindowEnd(tomorrow);
  
  // Convert to UTC ISO strings for database queries
  return {
    mode: 'today' as const,
    todayWindowStart: fromZonedTime(todayWindowStart, TIMEZONE).toISOString(),
    todayWindowEnd: fromZonedTime(todayWindowEnd, TIMEZONE).toISOString(),
    tomorrowWindowStart: fromZonedTime(tomorrowWindowStart, TIMEZONE).toISOString(),
    tomorrowWindowEnd: fromZonedTime(tomorrowWindowEnd, TIMEZONE).toISOString(),
  };
}

/**
 * Client-side filter function to determine if an order belongs in a bucket
 * Use this after fetching orders to filter them correctly
 * 
 * IMPORTANT: This is the authoritative filter - all production views must use this
 */
export function filterOrderByWorkStart(
  workDeadlineAt: string | null,
  manuallyDeprioritized: boolean,
  targetBucket: 'today' | 'tomorrow' | 'all'
): boolean {
  // All mode - no filtering
  if (targetBucket === 'all') return true;
  
  // Manually deprioritized orders go to tomorrow
  if (manuallyDeprioritized) {
    return targetBucket === 'tomorrow';
  }
  
  const bucket = getProductionDayBucket(workDeadlineAt);
  
  if (targetBucket === 'today') {
    // Today includes: 'today', 'past' (overdue = urgent), and null (no deadline = needs attention)
    return bucket === 'today' || bucket === 'past' || bucket === null;
  }
  
  if (targetBucket === 'tomorrow') {
    return bucket === 'tomorrow';
  }
  
  return false;
}

/**
 * Format work_start_at for display
 */
export function formatWorkStartAt(workDeadlineAt: string | null): string | null {
  const workStartAt = computeWorkStartAt(workDeadlineAt);
  if (!workStartAt) return null;
  
  return format(workStartAt, 'EEE MMM d, HH:mm');
}

/**
 * Get urgency level based on how soon work must start
 */
export function getWorkStartUrgency(
  workDeadlineAt: string | null
): 'overdue' | 'urgent' | 'today' | 'tomorrow' | 'future' | null {
  const workStartAt = computeWorkStartAt(workDeadlineAt);
  if (!workStartAt) return null;
  
  const now = getVancouverNow();
  
  // Check if work should have already started
  if (isBefore(workStartAt, now)) {
    // How late are we?
    const minutesLate = differenceInMinutes(now, workStartAt);
    if (minutesLate > 60) {
      return 'overdue';
    }
    return 'urgent';
  }
  
  const bucket = getProductionDayBucket(workDeadlineAt);
  
  if (bucket === 'today') {
    // Check if within next 2 hours
    const minutesUntilStart = differenceInMinutes(workStartAt, now);
    if (minutesUntilStart <= 120) {
      return 'urgent';
    }
    return 'today';
  }
  
  if (bucket === 'tomorrow') return 'tomorrow';
  if (bucket === 'past') return 'overdue';
  
  return 'future';
}

/**
 * Get the work_deadline bounds that would result in work_start_at
 * falling within a specific day's production window.
 * 
 * This is for database filtering since we store work_deadline_at not work_start_at.
 * 
 * If work_start_at is in [08:00, 16:00], then work_deadline_at is in [10:01, 18:01]
 * (adding back the 2h1m processing time)
 * 
 * But we also need to account for snapping:
 * - Orders with theoretical_start before 08:00 snap to previous day 15:59
 *   So their deadlines would be earlier but they show up on the previous day
 * 
 * For simplicity, we fetch a wider range and filter client-side.
 */
export function getDeadlineBoundsForDay(
  targetDate: Date
): { minDeadline: string; maxDeadline: string } {
  // Work starting at 08:00 → deadline at 10:01
  // Work starting at 16:00 → deadline at 18:01
  // But also need to catch orders that snap from the next day
  
  // Conservative approach: fetch orders with deadlines from today 08:00 to tomorrow 18:00
  const dayStart = getProductionWindowStart(targetDate);
  const nextDay = addDays(targetDate, 1);
  const nextDayEnd = setMinutes(setHours(startOfDay(nextDay), 18), 1);
  
  return {
    minDeadline: fromZonedTime(dayStart, TIMEZONE).toISOString(),
    maxDeadline: fromZonedTime(nextDayEnd, TIMEZONE).toISOString(),
  };
}

// ========== NUDGE SCHEDULING ==========

export type NudgeDirection = 'earlier' | 'later';

/**
 * Calculate the new work_deadline_at for a nudge operation
 * 
 * Nudge later: Move to next business day at 10:00
 * Nudge earlier: Move to current business day at 15:00 (if still within window) 
 *                or previous business day at 15:00
 * 
 * Returns the new deadline as ISO string (UTC)
 */
export function computeNudgedDeadline(
  currentDeadline: string | null,
  direction: NudgeDirection
): string {
  const now = getVancouverNow();
  const today = startOfDay(now);
  
  let targetDate: Date;
  let targetHour: number;
  
  if (direction === 'later') {
    // Move to next business day at 10:00
    if (currentDeadline) {
      const currentUtc = parseISO(currentDeadline);
      const currentVancouver = toZonedTime(currentUtc, TIMEZONE);
      const currentDay = startOfDay(currentVancouver);
      // Next business day after current deadline's day
      targetDate = getNextBusinessDay(addDays(currentDay, 1));
    } else {
      // No current deadline - set to next business day
      targetDate = getNextBusinessDay(addDays(today, 1));
    }
    targetHour = DEFAULT_NUDGE_HOUR; // 10:00
  } else {
    // Nudge earlier
    const currentHour = now.getHours();
    
    if (isBusinessDay(today) && currentHour < PRODUCTION_WINDOW_END) {
      // Still within today's window - set to today at 15:00
      targetDate = today;
      targetHour = 15;
    } else {
      // After today's window or weekend - set to next business day at 10:00
      targetDate = getNextBusinessDay(today);
      targetHour = DEFAULT_NUDGE_HOUR;
    }
  }
  
  // Create the target datetime in Vancouver timezone
  const targetDatetime = setMinutes(setHours(targetDate, targetHour), 0);
  
  // Convert to UTC for storage
  const utcDatetime = fromZonedTime(targetDatetime, TIMEZONE);
  
  return utcDatetime.toISOString();
}

/**
 * Format nudge result for toast message
 */
export function formatNudgeResult(newDeadline: string): string {
  const utc = parseISO(newDeadline);
  const vancouver = toZonedTime(utc, TIMEZONE);
  return format(vancouver, "EEE MMM d, HH:mm");
}

// ========== DEV LOGGING ==========

/**
 * Log run sheet query details for debugging (dev only)
 */
export function logRunSheetQuery(
  label: string,
  orders: Array<{ work_deadline_at?: string | null; id: string }>,
  filterMode: 'today' | 'tomorrow' | 'all'
): void {
  if (process.env.NODE_ENV !== 'development') return;
  
  const now = getVancouverNow();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  
  const todayWindowStart = getProductionWindowStart(today);
  const todayWindowEnd = getProductionWindowEnd(today);
  const tomorrowWindowStart = getProductionWindowStart(tomorrow);
  const tomorrowWindowEnd = getProductionWindowEnd(tomorrow);
  
  const deadlines = orders
    .map(o => o.work_deadline_at)
    .filter((d): d is string => d !== null && d !== undefined)
    .sort();
  
  console.log(`[RunSheet:${label}] Filter mode: ${filterMode}`);
  console.log(`[RunSheet:${label}] Today's window: ${format(todayWindowStart, 'yyyy-MM-dd HH:mm')} to ${format(todayWindowEnd, 'HH:mm')}`);
  console.log(`[RunSheet:${label}] Tomorrow's window: ${format(tomorrowWindowStart, 'yyyy-MM-dd HH:mm')} to ${format(tomorrowWindowEnd, 'HH:mm')}`);
  console.log(`[RunSheet:${label}] Orders returned: ${orders.length}`);
  if (deadlines.length > 0) {
    const minDeadline = toZonedTime(parseISO(deadlines[0]), TIMEZONE);
    const maxDeadline = toZonedTime(parseISO(deadlines[deadlines.length - 1]), TIMEZONE);
    console.log(`[RunSheet:${label}] Deadline range: ${format(minDeadline, 'yyyy-MM-dd HH:mm')} to ${format(maxDeadline, 'yyyy-MM-dd HH:mm')}`);
  } else {
    console.log(`[RunSheet:${label}] No orders with work_deadline_at`);
  }
}

/**
 * Snap a date to the next valid business day if it falls on a weekend
 * Used by WorkDeadlinePicker to enforce Mon-Fri only
 */
export function snapToBusinessDay(date: Date): Date {
  if (isWeekend(date)) {
    return nextMonday(date);
  }
  return date;
}
