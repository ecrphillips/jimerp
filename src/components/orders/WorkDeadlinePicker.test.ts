import { describe, it, expect } from 'vitest';
import { addDays, startOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const TIMEZONE = 'America/Vancouver';

/**
 * Replicate the core logic from WorkDeadlinePicker to test date round-trips.
 */
function toCalendarDate(zonedDate: Date): Date {
  const year = zonedDate.getFullYear();
  const month = zonedDate.getMonth();
  const day = zonedDate.getDate();
  return new Date(year, month, day, 0, 0, 0, 0);
}

function simulateSelectAndSave(localDate: Date, time: string): { 
  isoString: string; 
  roundTripDate: Date;
  matches: boolean;
} {
  const [hours, minutes] = time.split(':').map(Number);
  const year = localDate.getFullYear();
  const month = localDate.getMonth();
  const day = localDate.getDate();
  
  // User selects date + time
  const dateWithTime = new Date(year, month, day, hours, minutes, 0, 0);
  
  // Convert to UTC for storage
  const utcDate = fromZonedTime(dateWithTime, TIMEZONE);
  const isoString = utcDate.toISOString();
  
  // Simulate reading it back
  const parsed = new Date(isoString);
  const zonedDate = toZonedTime(parsed, TIMEZONE);
  const roundTripDate = toCalendarDate(zonedDate);
  
  // Check if the day matches
  const matches = roundTripDate.getFullYear() === localDate.getFullYear() &&
                  roundTripDate.getMonth() === localDate.getMonth() &&
                  roundTripDate.getDate() === localDate.getDate();
  
  return { isoString, roundTripDate, matches };
}

describe('WorkDeadlinePicker date round-trip', () => {
  it('should correctly round-trip today', () => {
    const today = startOfDay(new Date());
    const result = simulateSelectAndSave(today, '10:00');
    expect(result.matches).toBe(true);
  });

  it('should correctly round-trip tomorrow', () => {
    const tomorrow = startOfDay(addDays(new Date(), 1));
    const result = simulateSelectAndSave(tomorrow, '10:00');
    expect(result.matches).toBe(true);
  });

  it('should correctly round-trip tomorrow at 08:00 (earliest time)', () => {
    const tomorrow = startOfDay(addDays(new Date(), 1));
    const result = simulateSelectAndSave(tomorrow, '08:00');
    expect(result.matches).toBe(true);
  });

  it('should correctly round-trip tomorrow at 16:00 (latest time)', () => {
    const tomorrow = startOfDay(addDays(new Date(), 1));
    const result = simulateSelectAndSave(tomorrow, '16:00');
    expect(result.matches).toBe(true);
  });

  it('should correctly round-trip day after tomorrow', () => {
    const dayAfter = startOfDay(addDays(new Date(), 2));
    const result = simulateSelectAndSave(dayAfter, '14:00');
    expect(result.matches).toBe(true);
  });

  it('should correctly round-trip a week from now', () => {
    const weekFromNow = startOfDay(addDays(new Date(), 7));
    const result = simulateSelectAndSave(weekFromNow, '12:00');
    expect(result.matches).toBe(true);
  });

  it('should correctly round-trip all time slots for tomorrow', () => {
    const tomorrow = startOfDay(addDays(new Date(), 1));
    const times = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];
    
    for (const time of times) {
      const result = simulateSelectAndSave(tomorrow, time);
      expect(result.matches).toBe(true);
    }
  });
});
