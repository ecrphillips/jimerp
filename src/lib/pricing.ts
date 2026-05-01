/**
 * Layer 1C — Pricing engine.
 *
 * Pure helpers + async calculatePrice() that resolves entities from the DB
 * and runs the cost stack. Read-only — does not write to any table.
 *
 * Cost stack (per kg green → per kg roasted → per bag → tier-adjusted price)
 * is locked in the spec. See documented test cases at the bottom of this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

type PackagingVariant = Database['public']['Enums']['packaging_variant'];

// ---------- Inputs / Outputs ---------------------------------------------------

export type PricingGreenInput =
  | { lot_id: string }
  | { blend: Array<{ lot_id: string; ratio_pct: number }> };

export type PricingInputs = {
  green: PricingGreenInput;
  bag_size_g: number;
  packaging_variant: PackagingVariant;
  product_id?: string;
  account_id?: string;
  tier_id_override?: string;
  profile_id_override?: string;
};

export type PackagingCostSource = 'OVERRIDE' | 'LOOKUP' | 'MISSING';

export type PricingResult = {
  inputs: PricingInputs;

  profile: { id: string; name: string };
  tier: {
    id: string;
    name: string;
    markup_adjustment_type: string;
    markup_multiplier: number | null;
    per_kg_fee: number | null;
    target_margin_pct: number | null;
  } | null;

  // cost stack
  book_value_per_kg_green: number;
  financing_cost_per_kg_green: number;
  market_value_per_kg_green: number;
  carry_risk_premium_pct_used: number;
  derisked_cost_per_kg_green: number;
  marked_up_cost_per_kg_green: number;
  yield_loss_pct_used: number;
  roasted_cost_per_kg_from_green: number;
  process_cost_per_kg_roasted: number;
  overhead_per_kg_roasted: number;
  total_roasted_cost_per_kg: number;
  bag_size_kg: number;
  roasted_cost_per_bag: number;
  packaging_material_per_bag: number;
  packaging_labour_per_bag: number;
  packaging_material_source: PackagingCostSource;
  packaging_labour_source: PackagingCostSource;
  /** Sum of material + labour per bag. Kept for backward compatibility. */
  packaging_cost_per_bag: number;
  /** Worst of material/labour sources (OVERRIDE > LOOKUP > MISSING precedence kept simple as material's source for back-compat). */
  packaging_cost_source: PackagingCostSource;
  total_cost_per_bag: number;

  // pricing
  list_price_per_bag: number;
  final_price_per_bag: number;
  margin_dollars: number;
  margin_pct: number;

  warnings: string[];
};

// ---------- Pure helpers ------------------------------------------------------

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const ensureFinite = (v: number, label: string): number => {
  if (!Number.isFinite(v)) {
    throw new Error(`Pricing: ${label} resolved to a non-finite number (${v}).`);
  }
  return v;
};

export function computeFinancingCostPerKg(
  book_value_per_kg: number,
  apr_pct: number,
  days: number,
): number {
  const bv = Math.max(0, num(book_value_per_kg));
  const apr = Math.max(0, num(apr_pct));
  const d = Math.max(0, num(days));
  return ensureFinite(bv * (apr / 100) * (d / 365), 'financing_cost_per_kg');
}

export function computeMarketValuePerKg(
  book_value_per_kg: number,
  apr_pct: number,
  days: number,
): number {
  const bv = Math.max(0, num(book_value_per_kg));
  return ensureFinite(bv + computeFinancingCostPerKg(bv, apr_pct, days), 'market_value_per_kg');
}

export function computeDeriskedCostPerKg(
  market_value_per_kg: number,
  carry_risk_pct: number,
): number {
  const mv = Math.max(0, num(market_value_per_kg));
  const pct = Math.max(0, num(carry_risk_pct));
  return ensureFinite(mv * (1 + pct / 100), 'derisked_cost_per_kg');
}

export function computeMarkedUpCostPerKg(
  derisked_per_kg: number,
  multiplier: number,
): number {
  const d = Math.max(0, num(derisked_per_kg));
  const m = Math.max(0, num(multiplier, 1));
  return ensureFinite(d * m, 'marked_up_cost_per_kg');
}

export function computeRoastedCostFromGreen(
  green_per_kg: number,
  yield_loss_pct: number,
): number {
  const g = Math.max(0, num(green_per_kg));
  const y = num(yield_loss_pct);
  if (y >= 100) {
    throw new Error('Pricing: yield_loss_pct must be < 100');
  }
  const safeY = Math.max(0, y);
  return ensureFinite(g / (1 - safeY / 100), 'roasted_cost_from_green');
}

export function computeTotalRoastedCostPerKg(
  roasted_from_green: number,
  process: number,
  overhead: number,
): number {
  return ensureFinite(
    Math.max(0, num(roasted_from_green)) +
      Math.max(0, num(process)) +
      Math.max(0, num(overhead)),
    'total_roasted_cost_per_kg',
  );
}

export type TierForAdjustment = {
  markup_adjustment_type: string; // 'MULTIPLIER' | 'PER_KG_FEE' | 'MARGIN_TARGET'
  markup_multiplier: number | null;
  per_kg_fee: number | null;
  target_margin_pct: number | null;
};

/**
 * Apply tier adjustment to a per-bag total cost.
 * Returns { list, final } in CAD per bag.
 *
 * - MULTIPLIER: list = cost / (1 - profile_target_margin_pct/100); final = list * markup_multiplier
 * - PER_KG_FEE: final = cost + (per_kg_fee * bag_size_kg); list = final
 * - MARGIN_TARGET: final = cost / (1 - tier.target_margin_pct/100); list = final
 *
 * If no tier is provided, falls back to MULTIPLIER with multiplier=1 and
 * profile_target_margin_pct (i.e. raw list price at profile target margin).
 */
export function applyTierAdjustment(
  total_cost_per_bag: number,
  tier: TierForAdjustment | null,
  profile_target_margin_pct: number,
  bag_size_kg: number,
): { list: number; final: number } {
  const cost = Math.max(0, num(total_cost_per_bag));
  const profileMargin = Math.max(0, Math.min(99.9999, num(profile_target_margin_pct)));

  if (!tier) {
    const list = cost / (1 - profileMargin / 100);
    return { list: ensureFinite(list, 'list_price'), final: ensureFinite(list, 'final_price') };
  }

  const type = tier.markup_adjustment_type;

  if (type === 'PER_KG_FEE') {
    const fee = num(tier.per_kg_fee, 0);
    const final = cost + fee * Math.max(0, num(bag_size_kg));
    return { list: ensureFinite(final, 'list_price'), final: ensureFinite(final, 'final_price') };
  }

  if (type === 'MARGIN_TARGET') {
    const m = Math.max(0, Math.min(99.9999, num(tier.target_margin_pct, profileMargin)));
    const final = cost / (1 - m / 100);
    return { list: ensureFinite(final, 'list_price'), final: ensureFinite(final, 'final_price') };
  }

  // MULTIPLIER (default)
  const mult = num(tier.markup_multiplier, 1);
  const list = cost / (1 - profileMargin / 100);
  const final = list * mult;
  return { list: ensureFinite(list, 'list_price'), final: ensureFinite(final, 'final_price') };
}

// ---------- calculatePrice ----------------------------------------------------

type GreenLotRow = {
  id: string;
  lot_number: string;
  book_value_per_kg: number | null;
  carry_risk_premium_pct_override: number | null;
};

export async function calculatePrice(
  supabase: SupabaseClient<Database>,
  inputs: PricingInputs,
): Promise<PricingResult> {
  const warnings: string[] = [];

  // 1) Collect lot ids
  const lotEntries: Array<{ lot_id: string; ratio_pct: number }> =
    'lot_id' in inputs.green
      ? [{ lot_id: inputs.green.lot_id, ratio_pct: 100 }]
      : [...inputs.green.blend];

  if (lotEntries.length === 0) {
    throw new Error('Pricing: no green lots provided.');
  }
  if ('blend' in inputs.green) {
    const sum = lotEntries.reduce((a, b) => a + num(b.ratio_pct), 0);
    if (Math.abs(sum - 100) > 0.001) {
      throw new Error(`Pricing: blend ratios must sum to 100 (got ${sum}).`);
    }
  }

  const lotIds = Array.from(new Set(lotEntries.map((e) => e.lot_id)));

  // 2) Resolve account → tier_id (if needed)
  let resolvedAccountTierId: string | null = null;
  if (!inputs.tier_id_override && inputs.account_id) {
    const { data: acc, error } = await supabase
      .from('accounts')
      .select('id, pricing_tier_id')
      .eq('id', inputs.account_id)
      .maybeSingle();
    if (error) throw new Error(`Pricing: account lookup failed — ${error.message}`);
    resolvedAccountTierId = acc?.pricing_tier_id ?? null;
  }

  // 3) Fire batch lookups in parallel
  const tierId = inputs.tier_id_override ?? resolvedAccountTierId ?? null;

  const [
    lotsRes,
    tierRes,
    defaultTierRes,
    packagingRes,
    productRes,
    overrideProfileRes,
    defaultProfileRes,
  ] = await Promise.all([
    supabase
      .from('green_lots')
      .select('id, lot_number, book_value_per_kg, carry_risk_premium_pct_override')
      .in('id', lotIds),
    tierId
      ? supabase
          .from('pricing_tiers')
          .select('id, name, profile_id, markup_adjustment_type, markup_multiplier, per_kg_fee, target_margin_pct')
          .eq('id', tierId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    !tierId
      ? supabase
          .from('pricing_tiers')
          .select('id, name, profile_id, markup_adjustment_type, markup_multiplier, per_kg_fee, target_margin_pct')
          .eq('is_default', true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('packaging_costs')
      .select('packaging_variant, material_cost_per_unit, labour_cost_per_unit')
      .eq('packaging_variant', inputs.packaging_variant)
      .maybeSingle(),
    inputs.product_id
      ? supabase
          .from('products')
          .select('id, packaging_material_override, packaging_labour_override')
          .eq('id', inputs.product_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    inputs.profile_id_override
      ? supabase
          .from('pricing_rule_profiles')
          .select('id, name')
          .eq('id', inputs.profile_id_override)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('pricing_rule_profiles')
      .select('id, name')
      .eq('is_default', true)
      .maybeSingle(),
  ]);

  if (lotsRes.error) throw new Error(`Pricing: lots lookup failed — ${lotsRes.error.message}`);
  const lots = (lotsRes.data ?? []) as GreenLotRow[];
  for (const id of lotIds) {
    if (!lots.find((l) => l.id === id)) {
      throw new Error(`Pricing: green lot ${id} not found.`);
    }
  }

  let resolvedTier:
    | {
        id: string;
        name: string;
        profile_id: string;
        markup_adjustment_type: string;
        markup_multiplier: number | null;
        per_kg_fee: number | null;
        target_margin_pct: number | null;
      }
    | null = null;

  if (tierId) {
    if (tierRes.error) throw new Error(`Pricing: tier lookup failed — ${tierRes.error.message}`);
    resolvedTier = (tierRes.data as typeof resolvedTier) ?? null;
    if (!resolvedTier) warnings.push(`Tier ${tierId} not found — falling back to default tier.`);
  }
  if (!resolvedTier) {
    if (defaultTierRes.error) {
      // not fatal — keep going and warn
      warnings.push(`Default tier lookup failed — ${defaultTierRes.error.message}`);
    }
    resolvedTier = (defaultTierRes.data as typeof resolvedTier) ?? null;
    if (!resolvedTier && (inputs.tier_id_override || inputs.account_id)) {
      warnings.push('No tier resolved — using profile target margin as list price.');
    } else if (!resolvedTier) {
      warnings.push('No default tier configured — using profile target margin as list price.');
    }
  }

  // Profile resolution
  let profile: { id: string; name: string } | null = null;
  if (inputs.profile_id_override) {
    if (overrideProfileRes.error)
      throw new Error(`Pricing: profile lookup failed — ${overrideProfileRes.error.message}`);
    profile = (overrideProfileRes.data as { id: string; name: string } | null) ?? null;
    if (!profile) throw new Error(`Pricing: profile ${inputs.profile_id_override} not found.`);
  } else if (resolvedTier) {
    const { data, error } = await supabase
      .from('pricing_rule_profiles')
      .select('id, name')
      .eq('id', resolvedTier.profile_id)
      .maybeSingle();
    if (error) throw new Error(`Pricing: tier profile lookup failed — ${error.message}`);
    profile = (data as { id: string; name: string } | null) ?? null;
  }
  if (!profile) {
    if (defaultProfileRes.error)
      throw new Error(`Pricing: default profile lookup failed — ${defaultProfileRes.error.message}`);
    profile = (defaultProfileRes.data as { id: string; name: string } | null) ?? null;
  }
  if (!profile) {
    throw new Error('Pricing: no pricing profile resolved (no override, no tier, no default).');
  }

  // Pricing rules for profile
  const { data: rules, error: rulesError } = await supabase
    .from('pricing_rules')
    .select(
      'carry_risk_premium_pct, financing_apr_pct, financing_days, green_markup_multiplier, overhead_per_kg, process_rate_per_kg, target_margin_pct, yield_loss_pct',
    )
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (rulesError) throw new Error(`Pricing: pricing_rules lookup failed — ${rulesError.message}`);
  if (!rules) throw new Error(`Pricing: no pricing_rules row for profile ${profile.id}.`);

  // 4) Compute weighted book value + weighted carry/risk premium
  let book_value_per_kg_green = 0;
  let weighted_carry_risk_pct = 0;
  for (const entry of lotEntries) {
    const lot = lots.find((l) => l.id === entry.lot_id)!;
    const w = num(entry.ratio_pct) / 100;
    const bv = lot.book_value_per_kg;
    if (bv == null) {
      warnings.push(`Lot ${lot.lot_number} has no book_value_per_kg — treated as 0.`);
    }
    book_value_per_kg_green += w * num(bv, 0);

    const lotPremium = lot.carry_risk_premium_pct_override;
    const effectivePremium = lotPremium != null ? num(lotPremium) : num(rules.carry_risk_premium_pct);
    weighted_carry_risk_pct += w * effectivePremium;
  }

  const carry_risk_premium_pct_used = weighted_carry_risk_pct;
  const yield_loss_pct_used = num(rules.yield_loss_pct);

  // 5) Cost stack
  const financing_cost_per_kg_green = computeFinancingCostPerKg(
    book_value_per_kg_green,
    num(rules.financing_apr_pct),
    num(rules.financing_days),
  );
  const market_value_per_kg_green = book_value_per_kg_green + financing_cost_per_kg_green;
  const derisked_cost_per_kg_green = computeDeriskedCostPerKg(
    market_value_per_kg_green,
    carry_risk_premium_pct_used,
  );
  const marked_up_cost_per_kg_green = computeMarkedUpCostPerKg(
    derisked_cost_per_kg_green,
    num(rules.green_markup_multiplier, 1),
  );
  const roasted_cost_per_kg_from_green = computeRoastedCostFromGreen(
    marked_up_cost_per_kg_green,
    yield_loss_pct_used,
  );
  const process_cost_per_kg_roasted = num(rules.process_rate_per_kg);
  const overhead_per_kg_roasted = num(rules.overhead_per_kg);
  const total_roasted_cost_per_kg = computeTotalRoastedCostPerKg(
    roasted_cost_per_kg_from_green,
    process_cost_per_kg_roasted,
    overhead_per_kg_roasted,
  );

  const bag_size_kg = Math.max(0, num(inputs.bag_size_g) / 1000);
  if (bag_size_kg <= 0) {
    throw new Error('Pricing: bag_size_g must be > 0.');
  }
  const roasted_cost_per_bag = total_roasted_cost_per_kg * bag_size_kg;

  // Packaging — material + labour resolved independently
  let packaging_material_per_bag = 0;
  let packaging_labour_per_bag = 0;
  let packaging_material_source: PackagingCostSource = 'MISSING';
  let packaging_labour_source: PackagingCostSource = 'MISSING';

  if (productRes.error) {
    warnings.push(`Product lookup failed — ${productRes.error.message}`);
  }
  if (packagingRes.error) {
    warnings.push(`Packaging cost lookup failed — ${packagingRes.error.message}`);
  }

  const productData = (productRes.data as {
    packaging_material_override: number | null;
    packaging_labour_override: number | null;
  } | null) ?? null;
  const packagingDefaults = (packagingRes.data as {
    material_cost_per_unit: number | null;
    labour_cost_per_unit: number | null;
  } | null) ?? null;

  // Material
  if (productData?.packaging_material_override != null) {
    packaging_material_per_bag = num(productData.packaging_material_override);
    packaging_material_source = 'OVERRIDE';
  } else if (packagingDefaults && packagingDefaults.material_cost_per_unit != null) {
    packaging_material_per_bag = num(packagingDefaults.material_cost_per_unit);
    packaging_material_source = 'LOOKUP';
  } else {
    warnings.push(
      `No packaging material cost configured for ${inputs.packaging_variant} — using $0.`,
    );
    packaging_material_source = 'MISSING';
  }

  // Labour
  if (productData?.packaging_labour_override != null) {
    packaging_labour_per_bag = num(productData.packaging_labour_override);
    packaging_labour_source = 'OVERRIDE';
  } else if (packagingDefaults && packagingDefaults.labour_cost_per_unit != null) {
    packaging_labour_per_bag = num(packagingDefaults.labour_cost_per_unit);
    packaging_labour_source = 'LOOKUP';
  } else {
    warnings.push(
      `No packaging labour cost configured for ${inputs.packaging_variant} — using $0.`,
    );
    packaging_labour_source = 'MISSING';
  }

  const packaging_cost_per_bag = packaging_material_per_bag + packaging_labour_per_bag;
  // Back-compat aggregate source: OVERRIDE if either is overridden, else LOOKUP if either lookup, else MISSING.
  const packaging_cost_source: PackagingCostSource =
    packaging_material_source === 'OVERRIDE' || packaging_labour_source === 'OVERRIDE'
      ? 'OVERRIDE'
      : packaging_material_source === 'LOOKUP' || packaging_labour_source === 'LOOKUP'
        ? 'LOOKUP'
        : 'MISSING';

  const total_cost_per_bag = roasted_cost_per_bag + packaging_cost_per_bag;

  // 6) Tier-adjusted price
  const { list, final } = applyTierAdjustment(
    total_cost_per_bag,
    resolvedTier
      ? {
          markup_adjustment_type: resolvedTier.markup_adjustment_type,
          markup_multiplier: resolvedTier.markup_multiplier,
          per_kg_fee: resolvedTier.per_kg_fee,
          target_margin_pct: resolvedTier.target_margin_pct,
        }
      : null,
    num(rules.target_margin_pct),
    bag_size_kg,
  );

  const margin_dollars = final - total_cost_per_bag;
  const margin_pct = final > 0 ? margin_dollars / final : 0;

  return {
    inputs,
    profile: { id: profile.id, name: profile.name },
    tier: resolvedTier
      ? {
          id: resolvedTier.id,
          name: resolvedTier.name,
          markup_adjustment_type: resolvedTier.markup_adjustment_type,
          markup_multiplier: resolvedTier.markup_multiplier,
          per_kg_fee: resolvedTier.per_kg_fee,
          target_margin_pct: resolvedTier.target_margin_pct,
        }
      : null,
    book_value_per_kg_green,
    financing_cost_per_kg_green,
    market_value_per_kg_green,
    carry_risk_premium_pct_used,
    derisked_cost_per_kg_green,
    marked_up_cost_per_kg_green,
    yield_loss_pct_used,
    roasted_cost_per_kg_from_green,
    process_cost_per_kg_roasted,
    overhead_per_kg_roasted,
    total_roasted_cost_per_kg,
    bag_size_kg,
    roasted_cost_per_bag,
    packaging_material_per_bag,
    packaging_labour_per_bag,
    packaging_material_source,
    packaging_labour_source,
    packaging_cost_per_bag,
    packaging_cost_source,
    total_cost_per_bag,
    list_price_per_bag: list,
    final_price_per_bag: final,
    margin_dollars,
    margin_pct,
    warnings,
  };
}
