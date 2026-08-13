import { supabase } from '@/integrations/supabase/client';
import { TIER_RATES, STORAGE_RATES } from '@/components/bookings/bookingUtils';

export type PricingFieldKey =
  | 'monthlyFee'
  | 'includedHours'
  | 'overageRate'
  | 'storageIncludedPallets'
  | 'storageOverageRate'
  | 'packagingBlocksIncluded'
  | 'packagingBlockRate';

export type PricingFieldSource = 'TIER_DEFAULT' | 'ACCOUNT_OVERRIDE';

export interface PricingField {
  value: number;
  /** The standard tier-default value for this field, regardless of source. */
  tierDefault: number;
  source: PricingFieldSource;
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface ResolvedAccountPricing {
  accountId: string;
  tier: string;
  tierLabel: string;
  monthlyFee: PricingField;
  includedHours: PricingField;
  overageRate: PricingField;
  storageIncludedPallets: PricingField;
  storageOverageRate: PricingField;
  packagingBlocksIncluded: PricingField;
  packagingBlockRate: PricingField;
}

export interface PricingFieldMeta {
  key: PricingFieldKey;
  accountColumn: string;
  auditField: string;
  label: string;
  isCurrency: boolean;
  isInteger: boolean;
  unit?: string;
}

// Single source of truth: resolver key ↔ accounts column ↔ audit changed_field ↔ display label.
export const PRICING_FIELDS: readonly PricingFieldMeta[] = [
  { key: 'monthlyFee',              accountColumn: 'coroast_custom_base_fee',                    auditField: 'monthly_fee',                label: 'Monthly Membership Fee',          isCurrency: true,  isInteger: false, unit: '/month' },
  { key: 'includedHours',           accountColumn: 'coroast_custom_included_hours',              auditField: 'included_hours',             label: 'Included Roasting Hours',         isCurrency: false, isInteger: false, unit: 'hr/month' },
  { key: 'overageRate',             accountColumn: 'coroast_custom_overage_rate',                auditField: 'overage_rate',               label: 'Overage Rate',                    isCurrency: true,  isInteger: false, unit: '/hr' },
  { key: 'storageIncludedPallets',  accountColumn: 'coroast_custom_included_pallets',            auditField: 'storage_included_pallets',   label: 'Storage Included',                isCurrency: false, isInteger: true,  unit: 'pallets' },
  { key: 'storageOverageRate',      accountColumn: 'coroast_custom_storage_rate',                auditField: 'storage_overage_rate',       label: 'Storage Overage Rate',            isCurrency: true,  isInteger: false, unit: '/pallet/month' },
  { key: 'packagingBlocksIncluded', accountColumn: 'coroast_custom_packaging_blocks_included',   auditField: 'packaging_blocks_included',  label: 'Packaging Blocks Included',       isCurrency: false, isInteger: true,  unit: 'blocks/month' },
  { key: 'packagingBlockRate',      accountColumn: 'coroast_custom_packaging_block_rate',        auditField: 'packaging_block_rate',       label: 'Packaging Block Rate',            isCurrency: true,  isInteger: false, unit: '/2-hr block' },
] as const;

/**
 * Global (master) co-roast tier rates as edited on the Co-Roasting Pricing
 * admin page. Stored in `app_settings` under this key; the bundled
 * CO_ROAST_TIER_DEFAULTS constants are only the fallback seed.
 */
export const TIER_RATES_SETTINGS_KEY = 'coroast_tier_rates';

export interface GlobalTierRate {
  base: number;
  includedHours: number;
  overageRate: number;
  includedPallets: number;
  storageRate: number;
  packagingBlocksIncluded: number;
  packagingBlockRate: number;
}

export type GlobalTierRates = Record<string, GlobalTierRate>;

function bundledTierRates(): GlobalTierRates {
  const out: GlobalTierRates = {};
  for (const tier of Object.keys(TIER_RATES)) {
    const t = TIER_RATES[tier];
    const s = STORAGE_RATES[tier] ?? STORAGE_RATES.MEMBER;
    out[tier] = {
      base: t.base,
      includedHours: t.includedHours,
      overageRate: t.overageRate,
      includedPallets: s.includedPallets,
      storageRate: s.ratePerPallet,
      packagingBlocksIncluded: t.packagingBlocksIncluded,
      packagingBlockRate: t.packagingBlockRate,
    };
  }
  return out;
}

export function mergeGlobalTierRates(raw: unknown): GlobalTierRates {
  const base = bundledTierRates();
  if (!raw || typeof raw !== 'object') return base;
  for (const [tier, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const partial = val as Partial<GlobalTierRate>;
    const current = base[tier] ?? base.MEMBER;
    base[tier] = {
      base: numOr(partial.base, current.base),
      includedHours: numOr(partial.includedHours, current.includedHours),
      overageRate: numOr(partial.overageRate, current.overageRate),
      includedPallets: numOr(partial.includedPallets, current.includedPallets),
      storageRate: numOr(partial.storageRate, current.storageRate),
      packagingBlocksIncluded: numOr(partial.packagingBlocksIncluded, current.packagingBlocksIncluded),
      packagingBlockRate: numOr(partial.packagingBlockRate, current.packagingBlockRate),
    };
  }
  return base;
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? fallback : n;
}

/**
 * Reads the master tier rates from app_settings. Fails soft to the bundled
 * defaults (e.g. if the caller's role cannot read app_settings).
 */
export async function fetchGlobalTierRates(): Promise<GlobalTierRates> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value_json')
      .eq('key', TIER_RATES_SETTINGS_KEY)
      .maybeSingle();
    if (error) throw error;
    return mergeGlobalTierRates(data?.value_json ?? null);
  } catch {
    return bundledTierRates();
  }
}

function tierDefaultValue(
  tier: string,
  key: PricingFieldKey,
  globalRates?: GlobalTierRates,
): number {
  const rates = globalRates ?? bundledTierRates();
  const t = rates[tier] ?? rates.MEMBER;
  switch (key) {
    case 'monthlyFee': return t.base;
    case 'includedHours': return t.includedHours;
    case 'overageRate': return t.overageRate;
    case 'storageIncludedPallets': return t.includedPallets;
    case 'storageOverageRate': return t.storageRate;
    case 'packagingBlocksIncluded': return t.packagingBlocksIncluded;
    case 'packagingBlockRate': return t.packagingBlockRate;
  }
}

export function tierLabel(tier: string): string {
  return TIER_RATES[tier]?.label ?? TIER_RATES.MEMBER.label;
}

export interface AccountPricingRow {
  id: string;
  coroast_tier: string | null;
  coroast_custom_base_fee: number | null;
  coroast_custom_included_hours: number | null;
  coroast_custom_overage_rate: number | null;
  coroast_custom_included_pallets: number | null;
  coroast_custom_storage_rate: number | null;
  coroast_custom_packaging_blocks_included: number | null;
  coroast_custom_packaging_block_rate: number | null;
}

export interface PricingAuditRow {
  id: string;
  account_id: string;
  changed_field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

const ACCOUNT_PRICING_COLUMNS =
  'id, coroast_tier, ' +
  'coroast_custom_base_fee, coroast_custom_included_hours, coroast_custom_overage_rate, ' +
  'coroast_custom_included_pallets, coroast_custom_storage_rate, ' +
  'coroast_custom_packaging_blocks_included, coroast_custom_packaging_block_rate';

export function buildResolvedPricing(
  account: AccountPricingRow,
  latestAuditByField: Record<string, PricingAuditRow | undefined> = {},
  globalRates?: GlobalTierRates,
): ResolvedAccountPricing {
  const tier = account.coroast_tier ?? 'MEMBER';
  const fields: Partial<Record<PricingFieldKey, PricingField>> = {};

  for (const meta of PRICING_FIELDS) {
    const overrideRaw = (account as unknown as Record<string, number | null>)[meta.accountColumn];
    const tierDefault = tierDefaultValue(tier, meta.key, globalRates);
    if (overrideRaw != null) {
      const audit = latestAuditByField[meta.auditField];
      fields[meta.key] = {
        value: Number(overrideRaw),
        tierDefault,
        source: 'ACCOUNT_OVERRIDE',
        updatedAt: audit?.changed_at,
        updatedBy: audit?.changed_by ?? null,
      };
    } else {
      fields[meta.key] = {
        value: tierDefault,
        tierDefault,
        source: 'TIER_DEFAULT',
      };
    }
  }

  return {
    accountId: account.id,
    tier,
    tierLabel: tierLabel(tier),
    monthlyFee: fields.monthlyFee!,
    includedHours: fields.includedHours!,
    overageRate: fields.overageRate!,
    storageIncludedPallets: fields.storageIncludedPallets!,
    storageOverageRate: fields.storageOverageRate!,
    packagingBlocksIncluded: fields.packagingBlocksIncluded!,
    packagingBlockRate: fields.packagingBlockRate!,
  };
}

/**
 * Canonical read path for co-roasting account pricing.
 * Returns each rate tagged with its source (TIER_DEFAULT or ACCOUNT_OVERRIDE)
 * and the audit metadata for overridden fields.
 */
export async function resolveAccountPricing(accountId: string): Promise<ResolvedAccountPricing> {
  const globalRates = await fetchGlobalTierRates();
  const { data: account, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_PRICING_COLUMNS)
    .eq('id', accountId)
    .maybeSingle();

  if (error) throw error;
  if (!account) {
    throw new Error('Account row not found or not accessible');
  }

  const accountRow = account as unknown as AccountPricingRow;
  const overriddenFields = PRICING_FIELDS.filter(
    (m) => (accountRow as unknown as Record<string, number | null>)[m.accountColumn] != null,
  );

  const latestAuditByField: Record<string, PricingAuditRow> = {};
  if (overriddenFields.length > 0) {
    const { data: audits } = await supabase
      .from('coroast_account_pricing_audit')
      .select('*')
      .eq('account_id', accountId)
      .in('changed_field', overriddenFields.map((m) => m.auditField))
      .order('changed_at', { ascending: false });

    if (audits) {
      for (const row of audits as unknown as PricingAuditRow[]) {
        if (!latestAuditByField[row.changed_field]) {
          latestAuditByField[row.changed_field] = row;
        }
      }
    }
  }

  return buildResolvedPricing(accountRow, latestAuditByField, globalRates);
}

/**
 * Batch variant. Returns a Map keyed by account_id. Skips per-field audit metadata
 * (callers that need updatedAt should use resolveAccountPricing for single accounts).
 */
export async function resolveAccountPricingBatch(
  accountIds: string[],
): Promise<Map<string, ResolvedAccountPricing>> {
  const result = new Map<string, ResolvedAccountPricing>();
  if (accountIds.length === 0) return result;

  const globalRates = await fetchGlobalTierRates();
  const { data, error } = await supabase
    .from('accounts')
    .select(ACCOUNT_PRICING_COLUMNS)
    .in('id', accountIds);

  if (error) throw error;
  for (const row of (data ?? []) as unknown as AccountPricingRow[]) {
    result.set(row.id, buildResolvedPricing(row, {}, globalRates));
  }
  return result;
}

// ── Display helpers ─────────────────────────────────────────────────────────

export function formatPricingValue(meta: PricingFieldMeta, value: number): string {
  if (meta.isCurrency) {
    return `$${Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }
  if (meta.isInteger) {
    return `${Math.round(Number(value))}`;
  }
  return `${Number(value).toLocaleString()}`;
}

function formatAuditDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function parseAuditValue(meta: PricingFieldMeta, raw: string | null): string {
  if (raw == null || raw === '') return 'no override';
  const n = Number(raw);
  if (Number.isFinite(n)) return formatPricingValue(meta, n);
  return raw;
}

export function fieldLabelForAudit(auditField: string): string {
  return PRICING_FIELDS.find((m) => m.auditField === auditField)?.label ?? auditField;
}

export function formatAuditEntry(row: PricingAuditRow): string {
  const meta = PRICING_FIELDS.find((m) => m.auditField === row.changed_field);
  const label = meta?.label ?? row.changed_field;
  const date = formatAuditDate(row.changed_at);

  if (!meta) {
    return `${label} changed on ${date}`;
  }

  const oldVal = parseAuditValue(meta, row.old_value);
  const newVal = parseAuditValue(meta, row.new_value);

  if (row.old_value == null && row.new_value != null) {
    return `${label} set to ${newVal} on ${date}`;
  }
  if (row.old_value != null && row.new_value == null) {
    return `${label} reset to tier default (was ${oldVal}) on ${date}`;
  }
  return `${label} changed from ${oldVal} to ${newVal} on ${date}`;
}
