import { supabase } from '@/integrations/supabase/client';

export type BookingRuleKey =
  | 'bookingHorizonDays'
  | 'cancellationFreeHours'
  | 'minBookingDurationHours'
  | 'maxBookingDurationHours'
  | 'allowRecurringBookings';

export type BookingRuleSource = 'TIER_DEFAULT' | 'ACCOUNT_OVERRIDE';

export interface BookingRuleField<T = number | boolean> {
  value: T;
  source: BookingRuleSource;
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface ResolvedAccountBookingRules {
  accountId: string;
  tier: string;
  bookingHorizonDays: BookingRuleField<number>;
  cancellationFreeHours: BookingRuleField<number>;
  minBookingDurationHours: BookingRuleField<number>;
  maxBookingDurationHours: BookingRuleField<number>;
  allowRecurringBookings: BookingRuleField<boolean>;
  allowPastDatedBookings: BookingRuleField<boolean>;
}

export interface BookingRuleFieldMeta {
  key: BookingRuleKey;
  accountColumn: string;
  tierColumn: string;
  auditField: string;
  label: string;
  kind: 'integer' | 'numeric' | 'boolean';
  unit?: string;
}

export const BOOKING_RULE_FIELDS: readonly BookingRuleFieldMeta[] = [
  { key: 'bookingHorizonDays',      accountColumn: 'coroast_custom_booking_horizon_days',       tierColumn: 'booking_horizon_days',       auditField: 'booking_horizon_days',       label: 'Booking Horizon',          kind: 'integer', unit: 'days' },
  { key: 'cancellationFreeHours',   accountColumn: 'coroast_custom_cancellation_free_hours',    tierColumn: 'cancellation_free_hours',    auditField: 'cancellation_free_hours',    label: 'Free Cancellation Window', kind: 'integer', unit: 'hours' },
  { key: 'minBookingDurationHours', accountColumn: 'coroast_custom_min_booking_duration_hours', tierColumn: 'min_booking_duration_hours', auditField: 'min_booking_duration_hours', label: 'Min Booking Duration',     kind: 'numeric', unit: 'hours' },
  { key: 'maxBookingDurationHours', accountColumn: 'coroast_custom_max_booking_duration_hours', tierColumn: 'max_booking_duration_hours', auditField: 'max_booking_duration_hours', label: 'Max Booking Duration',     kind: 'numeric', unit: 'hours' },
  { key: 'allowRecurringBookings',  accountColumn: 'coroast_custom_allow_recurring_bookings',   tierColumn: 'allow_recurring_bookings',   auditField: 'allow_recurring_bookings',   label: 'Recurring Bookings',       kind: 'boolean' },
] as const;

// Defensive fallback used when the tier-rules row is missing (e.g. seed not applied,
// migration mid-deploy, or a brand-new tier value). These mirror the pre-Stage-1
// hardcoded values in BookingFormDialog.tsx / MemberSchedule.tsx.
export const BOOKING_RULE_FALLBACK = {
  MEMBER:     { booking_horizon_days: 28,  cancellation_free_hours: 48, min_booking_duration_hours: 0.5, max_booking_duration_hours: 8, allow_recurring_bookings: false, allow_past_dated_bookings: false },
  GROWTH:     { booking_horizon_days: 365, cancellation_free_hours: 48, min_booking_duration_hours: 0.5, max_booking_duration_hours: 8, allow_recurring_bookings: true,  allow_past_dated_bookings: false },
  PRODUCTION: { booking_horizon_days: 365, cancellation_free_hours: 48, min_booking_duration_hours: 0.5, max_booking_duration_hours: 8, allow_recurring_bookings: true,  allow_past_dated_bookings: false },
  ACCESS:     { booking_horizon_days: 28,  cancellation_free_hours: 48, min_booking_duration_hours: 0.5, max_booking_duration_hours: 8, allow_recurring_bookings: false, allow_past_dated_bookings: false },
} as const satisfies Record<string, TierBookingRulesRow>;

export interface TierBookingRulesRow {
  booking_horizon_days: number;
  cancellation_free_hours: number;
  min_booking_duration_hours: number;
  max_booking_duration_hours: number;
  allow_recurring_bookings: boolean;
  allow_past_dated_bookings: boolean;
}

export interface AccountBookingRulesRow {
  id: string;
  coroast_tier: string | null;
  coroast_custom_booking_horizon_days: number | null;
  coroast_custom_cancellation_free_hours: number | null;
  coroast_custom_min_booking_duration_hours: number | null;
  coroast_custom_max_booking_duration_hours: number | null;
  coroast_custom_allow_recurring_bookings: boolean | null;
}

export interface BookingRulesAuditRow {
  id: string;
  source: 'TIER' | 'ACCOUNT';
  tier: string | null;
  account_id: string | null;
  changed_field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

const ACCOUNT_BOOKING_COLUMNS =
  'id, coroast_tier, ' +
  'coroast_custom_booking_horizon_days, coroast_custom_cancellation_free_hours, ' +
  'coroast_custom_min_booking_duration_hours, coroast_custom_max_booking_duration_hours, ' +
  'coroast_custom_allow_recurring_bookings';

function tierRowOrFallback(tier: string, row: TierBookingRulesRow | null | undefined): TierBookingRulesRow {
  if (row) return row;
  if (typeof console !== 'undefined') {
    console.warn(`[coroastBookingRules] No tier rules row for tier=${tier}; using hardcoded fallback.`);
  }
  return BOOKING_RULE_FALLBACK[tier as keyof typeof BOOKING_RULE_FALLBACK] ?? BOOKING_RULE_FALLBACK.MEMBER;
}

export function buildResolvedBookingRules(
  account: AccountBookingRulesRow,
  tierRow: TierBookingRulesRow | null | undefined,
  latestAuditByField: Record<string, BookingRulesAuditRow | undefined> = {},
): ResolvedAccountBookingRules {
  const tier = account.coroast_tier ?? 'MEMBER';
  const tierEffective = tierRowOrFallback(tier, tierRow);

  function resolveNumeric(key: BookingRuleKey, accountVal: number | null): BookingRuleField<number> {
    const meta = BOOKING_RULE_FIELDS.find((m) => m.key === key)!;
    if (accountVal != null) {
      const audit = latestAuditByField[meta.auditField];
      return {
        value: Number(accountVal),
        source: 'ACCOUNT_OVERRIDE',
        updatedAt: audit?.changed_at,
        updatedBy: audit?.changed_by ?? null,
      };
    }
    return {
      value: Number((tierEffective as unknown as Record<string, number | boolean>)[meta.tierColumn]),
      source: 'TIER_DEFAULT',
    };
  }

  function resolveBoolean(key: BookingRuleKey, accountVal: boolean | null): BookingRuleField<boolean> {
    const meta = BOOKING_RULE_FIELDS.find((m) => m.key === key)!;
    if (accountVal != null) {
      const audit = latestAuditByField[meta.auditField];
      return {
        value: accountVal,
        source: 'ACCOUNT_OVERRIDE',
        updatedAt: audit?.changed_at,
        updatedBy: audit?.changed_by ?? null,
      };
    }
    return {
      value: Boolean((tierEffective as unknown as Record<string, number | boolean>)[meta.tierColumn]),
      source: 'TIER_DEFAULT',
    };
  }

  return {
    accountId: account.id,
    tier,
    bookingHorizonDays:      resolveNumeric('bookingHorizonDays',      account.coroast_custom_booking_horizon_days),
    cancellationFreeHours:   resolveNumeric('cancellationFreeHours',   account.coroast_custom_cancellation_free_hours),
    minBookingDurationHours: resolveNumeric('minBookingDurationHours', account.coroast_custom_min_booking_duration_hours),
    maxBookingDurationHours: resolveNumeric('maxBookingDurationHours', account.coroast_custom_max_booking_duration_hours),
    allowRecurringBookings:  resolveBoolean('allowRecurringBookings',  account.coroast_custom_allow_recurring_bookings),
    // allow_past_dated_bookings is admin-only (no per-account override column).
    allowPastDatedBookings: {
      value: Boolean(tierEffective.allow_past_dated_bookings),
      source: 'TIER_DEFAULT',
    },
  };
}

/**
 * Canonical read path for resolved co-roasting booking rules for an account.
 * Returns each rule tagged with its source (TIER_DEFAULT or ACCOUNT_OVERRIDE).
 * Falls back to hardcoded defaults (with warning) if the tier-rules row is missing.
 */
export async function resolveAccountBookingRules(accountId: string): Promise<ResolvedAccountBookingRules> {
  const { data: account, error: accountErr } = await supabase
    .from('accounts')
    .select(ACCOUNT_BOOKING_COLUMNS)
    .eq('id', accountId)
    .single();

  if (accountErr || !account) {
    throw accountErr ?? new Error('Account not found');
  }

  const accountRow = account as unknown as AccountBookingRulesRow;
  const tier = accountRow.coroast_tier ?? 'MEMBER';

  // Tables added in migration 20260512230749 — Supabase types not yet regenerated.
  // Cast the client to bypass stale generic constraints; the SQL columns are correct.
  const supabaseAny = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: unknown) => {
          eq?: (col: string, val: unknown) => unknown;
          maybeSingle?: () => Promise<{ data: unknown; error: unknown }>;
          in?: (col: string, vals: unknown[]) => { order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }> };
        };
      };
    };
  };

  const tierRes = await (
    supabaseAny.from('coroast_tier_booking_rules')
      .select('booking_horizon_days, cancellation_free_hours, min_booking_duration_hours, max_booking_duration_hours, allow_recurring_bookings, allow_past_dated_bookings')
      .eq('tier', tier) as unknown as { maybeSingle: () => Promise<{ data: TierBookingRulesRow | null; error: unknown }> }
  ).maybeSingle();
  const tierRow = tierRes.data;

  const overriddenFields = BOOKING_RULE_FIELDS.filter(
    (m) => (accountRow as unknown as Record<string, number | boolean | null>)[m.accountColumn] != null,
  );

  const latestAuditByField: Record<string, BookingRulesAuditRow> = {};
  if (overriddenFields.length > 0) {
    const auditQ = (
      supabaseAny.from('coroast_booking_rules_audit')
        .select('*')
        .eq('source', 'ACCOUNT') as unknown as {
          eq: (col: string, val: unknown) => {
            in: (col: string, vals: unknown[]) => {
              order: (col: string, opts: { ascending: boolean }) => Promise<{ data: BookingRulesAuditRow[] | null; error: unknown }>;
            };
          };
        }
    )
      .eq('account_id', accountId)
      .in('changed_field', overriddenFields.map((m) => m.auditField))
      .order('changed_at', { ascending: false });
    const { data: audits } = await auditQ;

    if (audits) {
      for (const row of audits) {
        if (!latestAuditByField[row.changed_field]) {
          latestAuditByField[row.changed_field] = row;
        }
      }
    }
  }

  return buildResolvedBookingRules(accountRow, tierRow, latestAuditByField);
}

// ── Display helpers ─────────────────────────────────────────────────────────

export function formatRuleValue(meta: BookingRuleFieldMeta, value: number | boolean): string {
  if (meta.kind === 'boolean') return value ? 'Yes' : 'No';
  if (meta.kind === 'integer') return `${Math.round(Number(value))}`;
  return `${Number(value)}`;
}

export function fieldLabelForAudit(auditField: string): string {
  return BOOKING_RULE_FIELDS.find((m) => m.auditField === auditField)?.label ?? auditField;
}

function formatAuditDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function parseAuditValue(meta: BookingRuleFieldMeta | undefined, raw: string | null): string {
  if (raw == null || raw === '') return 'no override';
  if (!meta) return raw;
  if (meta.kind === 'boolean') return raw === 'true' ? 'Yes' : 'No';
  const n = Number(raw);
  if (Number.isFinite(n)) return formatRuleValue(meta, n);
  return raw;
}

export function formatBookingRuleAuditEntry(row: BookingRulesAuditRow): string {
  const meta = BOOKING_RULE_FIELDS.find((m) => m.auditField === row.changed_field);
  const label = meta?.label ?? row.changed_field;
  const date = formatAuditDate(row.changed_at);
  const scope = row.source === 'TIER' ? `${row.tier} tier` : 'Account';

  const oldVal = parseAuditValue(meta, row.old_value);
  const newVal = parseAuditValue(meta, row.new_value);

  if (row.old_value == null && row.new_value != null) {
    return `${scope}: ${label} set to ${newVal} on ${date}`;
  }
  if (row.old_value != null && row.new_value == null) {
    return `${scope}: ${label} reset to tier default (was ${oldVal}) on ${date}`;
  }
  return `${scope}: ${label} changed from ${oldVal} to ${newVal} on ${date}`;
}
