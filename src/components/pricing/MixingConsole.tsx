/**
 * Mixing Console — per-product / per-variant cost lever override grid.
 *
 * Used in two places:
 *  1) Final step of product creation wizards (no product_id yet — values
 *     collected and persisted by the parent on save).
 *  2) Editable section on the product detail / edit dialog (with explicit Save).
 *
 * Pre-populates each cell with the account's tier-linked pricing_rules profile
 * values (or default profile if no tier). Editing a "linked" lever (green
 * markup, yield loss, process rate, overhead) updates that lever for ALL
 * variants simultaneously. Packaging material/labour and wiggle room are
 * always per-variant.
 *
 * Does NOT call calculatePrice() per keystroke — that requires a green lot and
 * many DB roundtrips. Instead replicates the cost-stack math locally using the
 * same pure helpers from src/lib/pricing.ts. A placeholder book value is used
 * for the preview so the console works at creation time before any lot is
 * linked.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link as LinkIcon, Unlink as UnlinkIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  computeFinancingCostPerKg,
  computeDeriskedCostPerKg,
  computeMarkedUpCostPerKg,
  computeRoastedCostFromGreen,
  computeTotalRoastedCostPerKg,
  applyTierAdjustment,
  type TierForAdjustment,
} from '@/lib/pricing';

export type VariantOverrideValues = {
  green_markup_multiplier_override: number | null;
  yield_loss_pct_override: number | null;
  process_rate_per_kg_override: number | null;
  overhead_per_kg_override: number | null;
  packaging_material_override: number | null;
  packaging_labour_override: number | null;
  wiggle_room_per_bag: number | null;
  wiggle_room_note: string | null;
};

export type MixingConsoleVariant = {
  key: string;
  label: string;
  bagSizeG: number;
  /** packaging_variant enum value, used to look up packaging_costs defaults */
  packagingVariant?: string | null;
};

export type MixingConsoleValue = Record<string, VariantOverrideValues>;

export interface MixingConsoleProps {
  accountId?: string | null;
  variants: MixingConsoleVariant[];
  value: MixingConsoleValue;
  onChange: (next: MixingConsoleValue) => void;
  /** Book value used for preview ($/kg green). Defaults to $12. */
  previewBookValuePerKg?: number;
  /** Source of the preview green value — controls "est." badge. */
  greenValueSource?: 'lots' | 'placeholder';
  /** Optional roast group label shown in the read-only Roast Group column. */
  roastGroupLabel?: string | null;
}

type PresetValues = {
  green_markup_multiplier: number;
  yield_loss_pct: number;
  process_rate_per_kg: number;
  overhead_per_kg: number;
  carry_risk_premium_pct: number;
  financing_apr_pct: number;
  financing_days: number;
  target_margin_pct: number;
  source: 'tier' | 'default';
  profileName: string;
  tier: TierForAdjustment | null;
};

const DEFAULT_BOOK_VALUE_PER_KG = 12;

const emptyOverride = (): VariantOverrideValues => ({
  green_markup_multiplier_override: null,
  yield_loss_pct_override: null,
  process_rate_per_kg_override: null,
  overhead_per_kg_override: null,
  packaging_material_override: null,
  packaging_labour_override: null,
  wiggle_room_per_bag: null,
  wiggle_room_note: null,
});

export function buildEmptyMixingConsoleValue(variants: MixingConsoleVariant[]): MixingConsoleValue {
  const out: MixingConsoleValue = {};
  for (const v of variants) out[v.key] = emptyOverride();
  return out;
}

/** Hook: fetch tier preset values for an account (or default if no account/tier). */
export function useAccountPricingPreset(accountId?: string | null) {
  return useQuery({
    queryKey: ['mixing-console-preset', accountId ?? '__default__'],
    queryFn: async (): Promise<PresetValues> => {
      let tierId: string | null = null;
      if (accountId) {
        const { data: acc } = await supabase
          .from('accounts')
          .select('pricing_tier_id')
          .eq('id', accountId)
          .maybeSingle();
        tierId = acc?.pricing_tier_id ?? null;
      }

      let tier:
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
        const { data } = await supabase
          .from('pricing_tiers')
          .select('id, name, profile_id, markup_adjustment_type, markup_multiplier, per_kg_fee, target_margin_pct')
          .eq('id', tierId)
          .maybeSingle();
        tier = (data as any) ?? null;
      }

      let profileId = tier?.profile_id ?? null;
      let profileName = '';
      const source: 'tier' | 'default' = tier ? 'tier' : 'default';

      if (!profileId) {
        const { data } = await supabase
          .from('pricing_rule_profiles')
          .select('id, name')
          .eq('is_default', true)
          .maybeSingle();
        profileId = data?.id ?? null;
        profileName = data?.name ?? 'Default';
      } else {
        const { data } = await supabase
          .from('pricing_rule_profiles')
          .select('id, name')
          .eq('id', profileId)
          .maybeSingle();
        profileName = data?.name ?? '';
      }

      if (!profileId) {
        throw new Error('No default pricing profile configured.');
      }

      const { data: rules } = await supabase
        .from('pricing_rules')
        .select(
          'green_markup_multiplier, yield_loss_pct, process_rate_per_kg, overhead_per_kg, carry_risk_premium_pct, financing_apr_pct, financing_days, target_margin_pct',
        )
        .eq('profile_id', profileId)
        .maybeSingle();

      const r = rules ?? ({} as any);
      return {
        green_markup_multiplier: Number(r.green_markup_multiplier ?? 1),
        yield_loss_pct: Number(r.yield_loss_pct ?? 16),
        process_rate_per_kg: Number(r.process_rate_per_kg ?? 0),
        overhead_per_kg: Number(r.overhead_per_kg ?? 0),
        carry_risk_premium_pct: Number(r.carry_risk_premium_pct ?? 0),
        financing_apr_pct: Number(r.financing_apr_pct ?? 0),
        financing_days: Number(r.financing_days ?? 0),
        target_margin_pct: Number(r.target_margin_pct ?? 30),
        source,
        profileName,
        tier: tier
          ? {
              markup_adjustment_type: tier.markup_adjustment_type,
              markup_multiplier: tier.markup_multiplier,
              per_kg_fee: tier.per_kg_fee,
              target_margin_pct: tier.target_margin_pct,
            }
          : null,
      };
    },
    enabled: true,
    staleTime: 30_000,
  });
}

/** Fetch packaging cost defaults for a list of packaging variants. */
function usePackagingDefaults(variants: MixingConsoleVariant[]) {
  const keys = variants.map(v => v.packagingVariant).filter(Boolean) as string[];
  return useQuery({
    queryKey: ['mixing-console-packaging-defaults', keys.sort().join('|')],
    enabled: keys.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('packaging_costs')
        .select('packaging_variant, material_cost_per_unit, labour_cost_per_unit')
        .in('packaging_variant', keys as any);
      const map: Record<string, { material: number; labour: number }> = {};
      for (const row of data ?? []) {
        map[row.packaging_variant as string] = {
          material: Number(row.material_cost_per_unit ?? 0),
          labour: Number(row.labour_cost_per_unit ?? 0),
        };
      }
      return map;
    },
  });
}

/** Strip overrides that equal the preset (so we write null for inheritance). */
export function stripRedundantOverrides(
  values: MixingConsoleValue,
  preset: PresetValues,
  packagingDefaults: Record<string, { material: number; labour: number }>,
  variants: MixingConsoleVariant[],
): MixingConsoleValue {
  const out: MixingConsoleValue = {};
  for (const v of variants) {
    const cur = values[v.key] ?? emptyOverride();
    const pkgDef = (v.packagingVariant && packagingDefaults[v.packagingVariant]) || { material: 0, labour: 0 };
    const eq = (a: number | null, b: number) => a != null && Math.abs(a - b) < 1e-9;
    out[v.key] = {
      green_markup_multiplier_override: eq(cur.green_markup_multiplier_override, preset.green_markup_multiplier)
        ? null
        : cur.green_markup_multiplier_override,
      yield_loss_pct_override: eq(cur.yield_loss_pct_override, preset.yield_loss_pct)
        ? null
        : cur.yield_loss_pct_override,
      process_rate_per_kg_override: eq(cur.process_rate_per_kg_override, preset.process_rate_per_kg)
        ? null
        : cur.process_rate_per_kg_override,
      overhead_per_kg_override: eq(cur.overhead_per_kg_override, preset.overhead_per_kg)
        ? null
        : cur.overhead_per_kg_override,
      packaging_material_override: eq(cur.packaging_material_override, pkgDef.material)
        ? null
        : cur.packaging_material_override,
      packaging_labour_override: eq(cur.packaging_labour_override, pkgDef.labour)
        ? null
        : cur.packaging_labour_override,
      wiggle_room_per_bag: cur.wiggle_room_per_bag,
      wiggle_room_note: cur.wiggle_room_note,
    };
  }
  return out;
}

type LinkedLever = 'green_markup' | 'yield_loss' | 'process_rate' | 'overhead';

const LEVER_FIELD: Record<LinkedLever, keyof VariantOverrideValues> = {
  green_markup: 'green_markup_multiplier_override',
  yield_loss: 'yield_loss_pct_override',
  process_rate: 'process_rate_per_kg_override',
  overhead: 'overhead_per_kg_override',
};

export function MixingConsole({
  accountId,
  variants,
  value,
  onChange,
  previewBookValuePerKg = DEFAULT_BOOK_VALUE_PER_KG,
}: MixingConsoleProps) {
  const presetQuery = useAccountPricingPreset(accountId);
  const packagingDefaultsQuery = usePackagingDefaults(variants);
  const preset = presetQuery.data;
  const pkgDefaults = packagingDefaultsQuery.data ?? {};

  const [linked, setLinked] = useState<Record<LinkedLever, boolean>>({
    green_markup: true,
    yield_loss: true,
    process_rate: true,
    overhead: true,
  });

  // Initialise empty cells with preset values on first preset load
  useEffect(() => {
    if (!preset) return;
    let changed = false;
    const next: MixingConsoleValue = { ...value };
    for (const v of variants) {
      const cur = next[v.key] ?? emptyOverride();
      const pkg = (v.packagingVariant && pkgDefaults[v.packagingVariant]) || { material: 0, labour: 0 };
      const updated: VariantOverrideValues = { ...cur };
      if (updated.green_markup_multiplier_override == null) {
        updated.green_markup_multiplier_override = preset.green_markup_multiplier;
        changed = true;
      }
      if (updated.yield_loss_pct_override == null) {
        updated.yield_loss_pct_override = preset.yield_loss_pct;
        changed = true;
      }
      if (updated.process_rate_per_kg_override == null) {
        updated.process_rate_per_kg_override = preset.process_rate_per_kg;
        changed = true;
      }
      if (updated.overhead_per_kg_override == null) {
        updated.overhead_per_kg_override = preset.overhead_per_kg;
        changed = true;
      }
      if (updated.packaging_material_override == null) {
        updated.packaging_material_override = pkg.material;
        changed = true;
      }
      if (updated.packaging_labour_override == null) {
        updated.packaging_labour_override = pkg.labour;
        changed = true;
      }
      next[v.key] = updated;
    }
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, packagingDefaultsQuery.data, variants.map(v => v.key).join('|')]);

  const updateCell = useCallback(
    (variantKey: string, field: keyof VariantOverrideValues, raw: string | number | null) => {
      const next: MixingConsoleValue = { ...value };
      const isNumeric =
        field !== 'wiggle_room_note';
      const parsed: number | null =
        raw === '' || raw == null
          ? null
          : isNumeric
            ? Number(raw)
            : (raw as any);

      // Linked lever propagation
      const linkedField = (Object.entries(LEVER_FIELD).find(([, f]) => f === field)?.[0] ?? null) as
        | LinkedLever
        | null;
      if (linkedField && linked[linkedField] && isNumeric) {
        for (const v of variants) {
          next[v.key] = { ...(next[v.key] ?? emptyOverride()), [field]: parsed } as VariantOverrideValues;
        }
      } else {
        next[variantKey] = {
          ...(next[variantKey] ?? emptyOverride()),
          [field]: field === 'wiggle_room_note' ? (raw === '' ? null : (raw as string)) : parsed,
        } as VariantOverrideValues;
      }
      onChange(next);
    },
    [value, onChange, linked, variants],
  );

  const toggleLink = (lever: LinkedLever) =>
    setLinked(prev => ({ ...prev, [lever]: !prev[lever] }));

  // Compute live preview for a row
  const computePreview = (v: MixingConsoleVariant, ov: VariantOverrideValues) => {
    if (!preset) return null;
    try {
      const greenMarkup = ov.green_markup_multiplier_override ?? preset.green_markup_multiplier;
      const yieldLoss = ov.yield_loss_pct_override ?? preset.yield_loss_pct;
      const processRate = ov.process_rate_per_kg_override ?? preset.process_rate_per_kg;
      const overhead = ov.overhead_per_kg_override ?? preset.overhead_per_kg;
      const pkgMat = ov.packaging_material_override ?? 0;
      const pkgLab = ov.packaging_labour_override ?? 0;
      const wiggle = ov.wiggle_room_per_bag ?? 0;

      const bookValue = previewBookValuePerKg;
      const financing = computeFinancingCostPerKg(bookValue, preset.financing_apr_pct, preset.financing_days);
      const market = bookValue + financing;
      const derisked = computeDeriskedCostPerKg(market, preset.carry_risk_premium_pct);
      const markedUp = computeMarkedUpCostPerKg(derisked, greenMarkup);
      const roastedFromGreen = computeRoastedCostFromGreen(markedUp, yieldLoss);
      const totalPerKg = computeTotalRoastedCostPerKg(roastedFromGreen, processRate, overhead);
      const bagKg = v.bagSizeG / 1000;
      const roastedPerBag = totalPerKg * bagKg;
      const totalCostPerBag = roastedPerBag + pkgMat + pkgLab;
      const adj = applyTierAdjustment(totalCostPerBag, preset.tier, preset.target_margin_pct, bagKg);
      const finalPrice = adj.final + wiggle;
      const margin = finalPrice > 0 ? ((finalPrice - totalCostPerBag) / finalPrice) * 100 : 0;
      return { cost: totalCostPerBag, price: finalPrice, margin };
    } catch {
      return null;
    }
  };

  if (presetQuery.isLoading) {
    return <div className="text-sm text-muted-foreground p-4">Loading pricing presets…</div>;
  }
  if (presetQuery.error || !preset) {
    return (
      <div className="text-sm text-destructive p-4">
        Could not load pricing presets: {(presetQuery.error as Error)?.message ?? 'unknown error'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Presets from{' '}
          <span className="font-medium">
            {preset.source === 'tier' ? `tier-linked profile "${preset.profileName}"` : `default profile "${preset.profileName}"`}
          </span>
          . Preview uses placeholder green cost ${previewBookValuePerKg.toFixed(2)}/kg.
        </div>
      </div>

      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-2 py-2 font-medium">Variant</th>
              <ColHeader label="Green Markup" lever="green_markup" linked={linked} onToggle={toggleLink} />
              <ColHeader label="Yield Loss %" lever="yield_loss" linked={linked} onToggle={toggleLink} />
              <ColHeader label="Process $/kg" lever="process_rate" linked={linked} onToggle={toggleLink} />
              <ColHeader label="Overhead $/kg" lever="overhead" linked={linked} onToggle={toggleLink} />
              <th className="px-2 py-2 font-medium">Pkg Material $/u</th>
              <th className="px-2 py-2 font-medium">Pkg Labour $/u</th>
              <th className="px-2 py-2 font-medium">Wiggle $/bag</th>
              <th className="px-2 py-2 font-medium">Wiggle Note</th>
              <th className="px-2 py-2 font-medium">Live Preview</th>
            </tr>
          </thead>
          <tbody>
            {variants.map(v => {
              const ov = value[v.key] ?? emptyOverride();
              const pkg = (v.packagingVariant && pkgDefaults[v.packagingVariant]) || { material: 0, labour: 0 };
              const preview = computePreview(v, ov);
              return (
                <tr key={v.key} className="border-t align-top">
                  <td className="px-2 py-2 font-medium whitespace-nowrap">{v.label}</td>
                  <NumCell
                    value={ov.green_markup_multiplier_override}
                    preset={preset.green_markup_multiplier}
                    step={0.1}
                    decimals={3}
                    onChange={x => updateCell(v.key, 'green_markup_multiplier_override', x)}
                  />
                  <NumCell
                    value={ov.yield_loss_pct_override}
                    preset={preset.yield_loss_pct}
                    step={0.1}
                    decimals={3}
                    onChange={x => updateCell(v.key, 'yield_loss_pct_override', x)}
                  />
                  <NumCell
                    value={ov.process_rate_per_kg_override}
                    preset={preset.process_rate_per_kg}
                    step={0.1}
                    decimals={2}
                    onChange={x => updateCell(v.key, 'process_rate_per_kg_override', x)}
                  />
                  <NumCell
                    value={ov.overhead_per_kg_override}
                    preset={preset.overhead_per_kg}
                    step={0.1}
                    decimals={2}
                    onChange={x => updateCell(v.key, 'overhead_per_kg_override', x)}
                  />
                  <NumCell
                    value={ov.packaging_material_override}
                    preset={pkg.material}
                    step={0.1}
                    decimals={2}
                    onChange={x => updateCell(v.key, 'packaging_material_override', x)}
                  />
                  <NumCell
                    value={ov.packaging_labour_override}
                    preset={pkg.labour}
                    step={0.1}
                    decimals={2}
                    onChange={x => updateCell(v.key, 'packaging_labour_override', x)}
                  />
                  <NumCell
                    value={ov.wiggle_room_per_bag}
                    preset={0}
                    step={0.1}
                    decimals={2}
                    onChange={x => updateCell(v.key, 'wiggle_room_per_bag', x)}
                    showDeltaWhenZero={false}
                  />
                  <td className="px-2 py-2 min-w-[160px]">
                    <Input
                      className="h-8 text-xs"
                      placeholder="Optional note (e.g. discount for old green)"
                      value={ov.wiggle_room_note ?? ''}
                      onChange={e => updateCell(v.key, 'wiggle_room_note', e.target.value)}
                    />
                    {ov.wiggle_room_per_bag != null && ov.wiggle_room_per_bag !== 0 && !ov.wiggle_room_note?.trim() && (
                      <div className="text-[10px] text-destructive mt-1">Note required when wiggle room is set</div>
                    )}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {preview ? (
                      <div className="text-[11px] leading-tight">
                        <div>Cost ${preview.cost.toFixed(2)}</div>
                        <div>Price ${preview.price.toFixed(2)}</div>
                        <div className={cn(
                          'font-medium',
                          preview.margin >= 30 && 'text-green-600',
                          preview.margin >= 15 && preview.margin < 30 && 'text-amber-600',
                          preview.margin < 15 && 'text-destructive',
                        )}>
                          {preview.margin.toFixed(1)}%
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColHeader({
  label,
  lever,
  linked,
  onToggle,
}: {
  label: string;
  lever: LinkedLever;
  linked: Record<LinkedLever, boolean>;
  onToggle: (l: LinkedLever) => void;
}) {
  const isLinked = linked[lever];
  return (
    <th className="px-2 py-2 font-medium">
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <button
          type="button"
          onClick={() => onToggle(lever)}
          className={cn(
            'inline-flex items-center justify-center rounded p-0.5 hover:bg-muted',
            isLinked ? 'text-primary' : 'text-muted-foreground',
          )}
          title={isLinked ? 'Linked across variants — click to unlink' : 'Unlinked — click to link'}
        >
          {isLinked ? <LinkIcon className="h-3 w-3" /> : <UnlinkIcon className="h-3 w-3" />}
        </button>
      </div>
    </th>
  );
}

function NumCell({
  value,
  preset,
  step,
  decimals,
  onChange,
  showDeltaWhenZero = true,
}: {
  value: number | null;
  preset: number;
  step: number;
  decimals: number;
  onChange: (v: number | null) => void;
  showDeltaWhenZero?: boolean;
}) {
  const display = value == null ? '' : String(value);
  const equalsPreset = value != null && Math.abs(value - preset) < 1e-9;
  const delta = value != null ? value - preset : 0;
  const showDelta = !equalsPreset && (preset !== 0 || showDeltaWhenZero);
  return (
    <td className="px-2 py-2 min-w-[100px]">
      <Input
        type="number"
        step={step}
        value={display}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="h-8 text-xs"
      />
      <div className="text-[10px] text-muted-foreground mt-0.5">
        {equalsPreset || value == null
          ? `preset ${preset.toFixed(decimals)}`
          : showDelta
            ? `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(decimals)}`
            : '—'}
      </div>
    </td>
  );
}
