import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { calculatePrice } from '@/lib/pricing';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/currency';

export interface MixingConsoleVariant {
  key: string;
  label: string;
  bagSizeG: number;
  // Allow callers to attach additional metadata (e.g. packagingVariant)
  // without breaking the public contract.
  [extra: string]: any;
}

export interface MixingConsoleVariantValue {
  yield_loss_pct_override?: number | null;
  process_per_kg_green_override?: number | null;
  pkg_material_per_unit_override?: number | null;
  pkg_labour_per_unit_override?: number | null;
  adjustment_per_unit?: number | null;
  adjustment_note?: string | null;
  // Tolerate legacy override field names from older parent code.
  [extra: string]: any;
}

export interface MixingConsoleValue {
  [variantKey: string]: MixingConsoleVariantValue;
}

export interface PricingProfilePreset {
  yield_loss_pct: number;
  process_per_kg_green: number;
  pkg_labour_per_unit: number;
}

export interface MixingConsoleProps {
  roastGroupLabel?: string | null;
  greenMarketPerKg?: number | null;
  variants: MixingConsoleVariant[];
  value: MixingConsoleValue;
  onChange: (next: MixingConsoleValue) => void;
  preset?: PricingProfilePreset | null;
  pkgDefaults?: Record<number, { material: number; labour: number }>;
  // Tolerate extra props passed by older parent code (e.g. accountId).
  [extra: string]: any;
}

export function buildEmptyMixingConsoleValue(
  variants: MixingConsoleVariant[],
): MixingConsoleValue {
  const out: MixingConsoleValue = {};
  for (const v of variants) {
    out[v.key] = {
      yield_loss_pct_override: null,
      process_per_kg_green_override: null,
      pkg_material_per_unit_override: null,
      pkg_labour_per_unit_override: null,
      adjustment_per_unit: null,
      adjustment_note: null,
    };
  }
  return out;
}

/**
 * Strip values that equal the preset back to null, so inheritance from the
 * profile/packaging defaults stays intact when the preset itself changes.
 */
export function stripRedundantOverrides(
  value: MixingConsoleValue,
  variantsOrPreset: any,
  presetOrPkg: any,
  pkgOrVariants: any = {},
): MixingConsoleValue {
  // Accept arg order (value, variants, preset, pkgDefaults) OR legacy
  // (value, preset, pkgDefaults, variants) — wiring will be unified later.
  const variants: MixingConsoleVariant[] = Array.isArray(variantsOrPreset)
    ? variantsOrPreset
    : Array.isArray(pkgOrVariants)
      ? pkgOrVariants
      : [];
  const preset: PricingProfilePreset =
    !Array.isArray(variantsOrPreset) && variantsOrPreset
      ? variantsOrPreset
      : !Array.isArray(presetOrPkg) && presetOrPkg && 'yield_loss_pct' in presetOrPkg
        ? presetOrPkg
        : { yield_loss_pct: 0, process_per_kg_green: 0, pkg_labour_per_unit: 0 };
  const pkgDefaults: Record<number, { material: number; labour: number }> =
    !Array.isArray(presetOrPkg) && presetOrPkg && !('yield_loss_pct' in presetOrPkg)
      ? presetOrPkg
      : !Array.isArray(pkgOrVariants) && pkgOrVariants
        ? pkgOrVariants
        : {};

  const out: MixingConsoleValue = {};
  for (const v of variants) {
    const cur = value[v.key] ?? {
      yield_loss_pct_override: null,
      process_per_kg_green_override: null,
      pkg_material_per_unit_override: null,
      pkg_labour_per_unit_override: null,
      adjustment_per_unit: null,
      adjustment_note: null,
    };
    const pkgD = pkgDefaults[v.bagSizeG] ?? { material: 0, labour: preset.pkg_labour_per_unit };
    const adj = cur.adjustment_per_unit ?? 0;
    out[v.key] = {
      yield_loss_pct_override:
        cur.yield_loss_pct_override != null && cur.yield_loss_pct_override !== preset.yield_loss_pct
          ? cur.yield_loss_pct_override
          : null,
      process_per_kg_green_override:
        cur.process_per_kg_green_override != null &&
        cur.process_per_kg_green_override !== preset.process_per_kg_green
          ? cur.process_per_kg_green_override
          : null,
      pkg_material_per_unit_override:
        cur.pkg_material_per_unit_override != null &&
        cur.pkg_material_per_unit_override !== pkgD.material
          ? cur.pkg_material_per_unit_override
          : null,
      pkg_labour_per_unit_override:
        cur.pkg_labour_per_unit_override != null &&
        cur.pkg_labour_per_unit_override !== preset.pkg_labour_per_unit
          ? cur.pkg_labour_per_unit_override
          : null,
      adjustment_per_unit: adj === 0 ? null : adj,
      adjustment_note: adj === 0 ? null : (cur.adjustment_note?.trim() || null),
    };
  }
  return out;
}

export function hasMixingConsoleErrors(value: MixingConsoleValue): boolean {
  for (const k of Object.keys(value)) {
    const row = value[k];
    const adj = row.adjustment_per_unit ?? 0;
    if (adj !== 0 && !(row.adjustment_note && row.adjustment_note.trim().length > 0)) {
      return true;
    }
  }
  return false;
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function fmtMoney(n: number): string {
  return formatCurrency(n);
}

function fmtDelta(delta: number, decimals = 2): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${Math.abs(delta).toFixed(decimals)}`;
}

interface LeverCellProps {
  value: number | null;
  preset: number;
  step?: string;
  suffix?: string;
  decimals?: number;
  onChange: (next: number | null) => void;
}

function LeverCell({ value, preset, step = '0.01', suffix, decimals = 2, onChange }: LeverCellProps) {
  const effective = value ?? preset;
  const isOverride = value != null && value !== preset;
  const delta = effective - preset;

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          type="number"
          step={step}
          value={effective}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange(null);
            } else {
              onChange(num(raw));
            }
          }}
          className={cn('h-8 text-sm', suffix && 'pr-7')}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {isOverride ? fmtDelta(delta, decimals) : `preset ${preset.toFixed(decimals)}`}
      </p>
    </div>
  );
}

export function MixingConsole({
  roastGroupLabel,
  greenMarketPerKg,
  variants,
  value,
  onChange,
  preset,
  pkgDefaults,
}: MixingConsoleProps) {
  const update = (key: string, patch: Partial<MixingConsoleVariantValue>) => {
    const cur = value[key] ?? {
      yield_loss_pct_override: null,
      process_per_kg_green_override: null,
      pkg_material_per_unit_override: null,
      pkg_labour_per_unit_override: null,
      adjustment_per_unit: null,
      adjustment_note: null,
    };
    onChange({ ...value, [key]: { ...cur, ...patch } });
  };

  const computed = useMemo(() => {
    const out: Record<string, ReturnType<typeof calculatePrice> | null> = {};
    for (const v of variants) {
      if (greenMarketPerKg == null) {
        out[v.key] = null;
        continue;
      }
      const row = value[v.key];
      const pkgD = pkgDefaults[v.bagSizeG] ?? { material: 0, labour: preset.pkg_labour_per_unit };
      try {
        out[v.key] = calculatePrice({
          green_market_per_kg: greenMarketPerKg,
          yield_loss_pct: row?.yield_loss_pct_override ?? preset.yield_loss_pct,
          process_per_kg_green: row?.process_per_kg_green_override ?? preset.process_per_kg_green,
          pkg_material_per_unit: row?.pkg_material_per_unit_override ?? pkgD.material,
          pkg_labour_per_unit: row?.pkg_labour_per_unit_override ?? preset.pkg_labour_per_unit,
          adjustment_per_unit: row?.adjustment_per_unit ?? 0,
          bag_size_g: v.bagSizeG,
        });
      } catch {
        out[v.key] = null;
      }
    }
    return out;
  }, [variants, value, greenMarketPerKg, preset, pkgDefaults]);

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Variant</th>
            <th className="px-3 py-2 text-left font-medium">Roast group</th>
            <th className="px-3 py-2 text-left font-medium">Green $/kg</th>
            <th className="px-3 py-2 text-left font-medium w-[110px]">Yield loss</th>
            <th className="px-3 py-2 text-left font-medium w-[120px]">Process $/kg green</th>
            <th className="px-3 py-2 text-left font-medium w-[110px]">Pkg material</th>
            <th className="px-3 py-2 text-left font-medium w-[110px]">Pkg labour</th>
            <th className="px-3 py-2 text-left font-medium w-[140px]">Adjustment</th>
            <th className="px-3 py-2 text-left font-medium w-[140px]">Live preview</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => {
            const row = value[v.key] ?? {
              yield_loss_pct_override: null,
              process_per_kg_green_override: null,
              pkg_material_per_unit_override: null,
              pkg_labour_per_unit_override: null,
              adjustment_per_unit: null,
              adjustment_note: null,
            };
            const pkgD = pkgDefaults[v.bagSizeG] ?? {
              material: 0,
              labour: preset.pkg_labour_per_unit,
            };
            const result = computed[v.key];
            const adj = row.adjustment_per_unit ?? 0;
            const adjNoteMissing = adj !== 0 && !(row.adjustment_note && row.adjustment_note.trim().length > 0);
            const margin = result ? result.margin_pct * 100 : null;
            const marginColor =
              margin == null
                ? ''
                : margin >= 30
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : margin >= 15
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-red-600 dark:text-red-400';

            return (
              <tr key={v.key} className="border-t align-top">
                <td className="px-3 py-2 font-medium">{v.label}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {roastGroupLabel ?? '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {greenMarketPerKg == null ? (
                    <span className="text-muted-foreground/70">No data</span>
                  ) : (
                    `$${greenMarketPerKg.toFixed(4)}`
                  )}
                </td>
                <td className="px-3 py-2">
                  <LeverCell
                    value={row.yield_loss_pct_override}
                    preset={preset.yield_loss_pct}
                    step="0.1"
                    suffix="%"
                    decimals={1}
                    onChange={(n) => update(v.key, { yield_loss_pct_override: n })}
                  />
                </td>
                <td className="px-3 py-2">
                  <LeverCell
                    value={row.process_per_kg_green_override}
                    preset={preset.process_per_kg_green}
                    step="0.01"
                    decimals={2}
                    onChange={(n) => update(v.key, { process_per_kg_green_override: n })}
                  />
                </td>
                <td className="px-3 py-2">
                  <LeverCell
                    value={row.pkg_material_per_unit_override}
                    preset={pkgD.material}
                    step="0.0001"
                    decimals={4}
                    onChange={(n) => update(v.key, { pkg_material_per_unit_override: n })}
                  />
                </td>
                <td className="px-3 py-2">
                  <LeverCell
                    value={row.pkg_labour_per_unit_override}
                    preset={preset.pkg_labour_per_unit}
                    step="0.0001"
                    decimals={4}
                    onChange={(n) => update(v.key, { pkg_labour_per_unit_override: n })}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="space-y-1">
                    <Input
                      type="number"
                      step="0.01"
                      value={row.adjustment_per_unit ?? 0}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = raw === '' ? 0 : num(raw);
                        update(v.key, { adjustment_per_unit: n });
                      }}
                      className="h-8 text-sm"
                    />
                    {adj !== 0 && (
                      <Input
                        placeholder="Note (required)"
                        value={row.adjustment_note ?? ''}
                        onChange={(e) => update(v.key, { adjustment_note: e.target.value })}
                        className={cn(
                          'h-7 text-xs',
                          adjNoteMissing && 'border-red-500 focus-visible:ring-red-500',
                        )}
                      />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {result == null ? (
                    <div className="space-y-0.5 text-muted-foreground">
                      <div>Cost: —</div>
                      <div>Price: —</div>
                      <div>Margin: —</div>
                    </div>
                  ) : (
                    <div className="space-y-0.5 text-xs">
                      <div className="text-muted-foreground">
                        Cost: {fmtMoney(result.cost_per_unit)}
                      </div>
                      <div className="font-medium">
                        Price: {fmtMoney(result.price_per_unit)}
                      </div>
                      <div className={cn('font-medium', marginColor)}>
                        Margin: {margin!.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Stub kept for backward compatibility; product wizard will replace this.
export function useAccountPricingPreset(..._args: any[]): {
  data: PricingProfilePreset | null;
  isLoading: boolean;
} {
  return { data: null, isLoading: false };
}

export default MixingConsole;
