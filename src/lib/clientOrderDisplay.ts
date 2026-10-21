// Client-facing order display rules shared by the client portal.
//
// plannedShipDate() is mirrored in supabase/functions/_shared/plannedShipDate.ts
// for the order confirmation email — keep the two in sync.

const TIMEZONE = 'America/Vancouver';

/** Prefix NewOrder writes into client_notes when the client picks "Soonest possible". */
export const SOONEST_NOTE_PREFIX = '[Requested: Soonest possible]';

/** Client edits to these statuses apply immediately (client_edit_order RPC). */
export const DIRECT_EDIT_STATUSES = ['DRAFT', 'SUBMITTED'];
/** Client edits to these statuses become change requests for staff review. */
export const CHANGE_REQUEST_STATUSES = ['CONFIRMED', 'IN_PRODUCTION', 'READY'];

/** Clients only see Pickup vs Delivered; courier vs our own delivery is internal. */
export function clientDeliveryLabel(method: string | null | undefined): string {
  return method === 'PICKUP' ? 'Pickup' : 'Delivered';
}

/** Strip the soonest marker so the client edits only their own words. */
export function stripSoonestPrefix(notes: string | null | undefined): string {
  if (!notes) return '';
  return notes.startsWith(SOONEST_NOTE_PREFIX)
    ? notes.slice(SOONEST_NOTE_PREFIX.length).trimStart()
    : notes;
}

export function withSoonestPrefix(notes: string): string {
  const trimmed = notes.trim();
  return trimmed ? `${SOONEST_NOTE_PREFIX} ${trimmed}` : SOONEST_NOTE_PREFIX;
}

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

/**
 * Planned ship date ("YYYY-MM-DD") from an order's work deadline.
 * AM and Noon deadlines ship the same day; PM deadlines (13:00 or later, Vancouver
 * time) ship the next business day (Friday PM → Monday).
 */
export function plannedShipDate(workDeadlineAt: string | null | undefined): string | null {
  if (!workDeadlineAt) return null;
  const instant = new Date(workDeadlineAt);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);

  // Same bucketing as WorkDeadlinePicker: hour < 12 = AM, 12 = Noon, later = PM.
  if (Number(parts.hour) <= 12) {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  return addBusinessDays(y, m, d, 1);
}
