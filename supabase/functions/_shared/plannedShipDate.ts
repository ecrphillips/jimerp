// Planned ship date from an order's work deadline. Mirror of plannedShipDate()
// in src/lib/clientOrderDisplay.ts (unit-tested there) — keep the two in sync.
//
// AM and Noon deadlines ship the same day; PM deadlines (13:00 or later,
// Vancouver time) ship the next business day (Friday PM → Monday).

const TIMEZONE = "America/Vancouver";

function addBusinessDays(y: number, m: number, d: number, days: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
}

/** Returns "YYYY-MM-DD", or null when there is no usable deadline. */
export function plannedShipDate(workDeadlineAt: string | null | undefined): string | null {
  if (!workDeadlineAt) return null;
  const instant = new Date(workDeadlineAt);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );

  // Same bucketing as WorkDeadlinePicker: hour < 12 = AM, 12 = Noon, later = PM.
  if (Number(parts.hour) <= 12) {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  return addBusinessDays(Number(parts.year), Number(parts.month), Number(parts.day), 1);
}
