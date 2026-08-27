/**
 * Pricing engine — one cost stack, six configurations.
 *
 * The whole model is a single ladder of cost lines with a margin dial on top.
 * A tier is not a code path; it is a preset that decides which lines are
 * switched on. Clients sit in awkward spots between tiers, so every toggle
 * stays overridable after the preset is applied.
 *
 * Two rules carry the glass-box principle into the types themselves:
 *
 *  1. An unset input yields `null`, never `0`. If any *included* line is
 *     missing its rate, the cost floor is null rather than a number that
 *     quietly omits a cost. Callers render "Not set", never "$0.00".
 *
 *  2. The return value IS the display model. Every line reports its rate, its
 *     contribution, the arithmetic behind it, and where the number came from.
 *     Nothing about how a price was reached is left for the UI to reconstruct.
 *
 * Units: lines are priced either per green kg or per finished unit. That split
 * is the entire model. Kilograms are canonical; pounds are shown for reference.
 */
import Decimal from 'decimal.js';
import {
  G_PER_KG,
  KG_PER_LB,
  deriveGreenKgConsumed,
  deriveMachineCostPerGreenKg,
  deriveRoastLabourPerGreenKg,
  derivePackLabourPerUnit,
  type PricingAssumptions,
  type PackSpeedBand,
} from './pricingAssumptions';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Tier 1 (co-roasting) is absent by design: it already runs in the co-roasting
 * module with its own rates, hour ledger and billing periods, and is priced on
 * roaster time rather than on this stack.
 */
export type TierKey = 'T2_TOLL' | 'T3_TOLL_PLUS' | 'T4_PRIVATE_LABEL' | 'T5_CO_PACK' | 'T6_WHITE_GLOVE';

export interface CostStackConfig {
  green: boolean;
  roasterRunning: boolean;
  roastLabour: boolean;
  packagingMaterial: boolean;
  packLabour: boolean;
  downstreamServices: boolean;
}

export interface TierPreset {
  key: TierKey;
  label: string;
  /** True once we own the green — the capitalization line sits between T3 and T4. */
  ownsGreen: boolean;
  description: string;
  config: CostStackConfig;
}

const stack = (
  green: boolean,
  packaging: boolean,
  services: boolean,
): CostStackConfig => ({
  green,
  roasterRunning: true,
  roastLabour: true,
  packagingMaterial: packaging,
  packLabour: packaging,
  downstreamServices: services,
});

export const TIER_PRESETS: Record<TierKey, TierPreset> = {
  T2_TOLL: {
    key: 'T2_TOLL',
    label: 'Toll roasting',
    ownsGreen: false,
    description: 'Their green, our roaster and our hands. No packaging.',
    config: stack(false, false, false),
  },
  T3_TOLL_PLUS: {
    key: 'T3_TOLL_PLUS',
    label: 'Toll plus',
    ownsGreen: false,
    description: 'Toll roasting with downstream services. Packaging optional.',
    config: stack(false, false, true),
  },
  T4_PRIVATE_LABEL: {
    key: 'T4_PRIVATE_LABEL',
    label: 'Private label',
    ownsGreen: true,
    description: 'Finished product built from roasted coffee we already hold.',
    config: stack(true, true, false),
  },
  T5_CO_PACK: {
    key: 'T5_CO_PACK',
    label: 'Co-packing',
    ownsGreen: true,
    description: 'Same stack as private label, built from green components.',
    config: stack(true, true, false),
  },
  T6_WHITE_GLOVE: {
    key: 'T6_WHITE_GLOVE',
    label: 'White glove',
    ownsGreen: true,
    description: 'Full service. Green passed through at market value, lot by lot.',
    config: stack(true, true, true),
  },
};

export const TIER_ORDER: TierKey[] = [
  'T2_TOLL',
  'T3_TOLL_PLUS',
  'T4_PRIVATE_LABEL',
  'T5_CO_PACK',
  'T6_WHITE_GLOVE',
];

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface BlendComponent {
  label: string;
  /** Share of the blend, 0–100. Shares must total 100. */
  pctOfBlend: number;
  pricePerKg: number | null;
}

export type GreenSource =
  | { kind: 'NONE' }
  | { kind: 'FLAT'; label?: string; pricePerKg: number | null }
  | { kind: 'BLEND'; components: BlendComponent[] };

export interface ServiceCharge {
  label: string;
  amountPerUnit: number | null;
}

export interface PricingLineInput {
  tier: TierKey;
  /** Overrides applied on top of the tier preset. */
  configOverrides?: Partial<CostStackConfig>;

  green: GreenSource;
  /** Ceiling to price against; a green price at or above it raises a warning. */
  greenBenchmarkPerKg?: number | null;

  /**
   * Finished roasted weight of one unit. Null prices the line per green kg
   * only — toll work has no bag, so there is no unit to divide into.
   */
  gramsPerUnit: number | null;

  packagingMaterialPerUnit: number | null;
  services?: ServiceCharge[];

  /** The dial. Expressed per green kg; pounds shown for reference. */
  marginPerGreenKg: number | null;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type LineBasis = 'PER_GREEN_KG' | 'PER_UNIT';

export type CostLineKey =
  | 'green'
  | 'roasterRunning'
  | 'roastLabour'
  | 'packagingMaterial'
  | 'packLabour'
  | 'downstreamServices';

export interface CostLine {
  key: CostLineKey;
  label: string;
  basis: LineBasis;
  /** Whether this configuration includes the line at all. */
  included: boolean;
  /** The rate in its own basis: $/green kg or $/unit. */
  rate: number | null;
  /** What the line contributes to one finished unit. */
  perUnit: number | null;
  /** What the line contributes per green kg. */
  perGreenKg: number | null;
  /** The arithmetic, for display. */
  explanation: string;
  /** Where the number came from, for display. */
  source: string;
}

export type WarningKind =
  | 'GREEN_AT_OR_OVER_BENCHMARK'
  | 'BLEND_SHARES_NOT_100'
  | 'MISSING_INPUT'
  | 'NEGATIVE_MARGIN';

export interface PricingWarning {
  kind: WarningKind;
  message: string;
}

export interface PricingLineResult {
  tier: TierPreset;
  config: CostStackConfig;
  lines: CostLine[];

  /** Green consumed by one finished unit; null when the line has no unit. */
  greenKgPerUnit: number | null;
  greenKgExplanation: string;

  costFloorPerUnit: number | null;
  costFloorPerGreenKg: number | null;

  marginPerUnit: number | null;
  marginPerGreenKg: number | null;
  marginPerGreenLb: number | null;

  pricePerUnit: number | null;
  pricePerGreenKg: number | null;

  /** Labels of included lines whose inputs are unset. Non-empty means no floor. */
  incomplete: string[];
  warnings: PricingWarning[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const D = (v: number) => new Decimal(v);

const money = (n: number, dp = 4): string => `$${n.toFixed(dp)}`;

const LINE_LABELS: Record<CostLineKey, string> = {
  green: 'Green',
  roasterRunning: 'Roaster running cost',
  roastLabour: 'Roast labour',
  packagingMaterial: 'Packaging material',
  packLabour: 'Pack labour',
  downstreamServices: 'Downstream services',
};

const LINE_BASIS: Record<CostLineKey, LineBasis> = {
  green: 'PER_GREEN_KG',
  roasterRunning: 'PER_GREEN_KG',
  roastLabour: 'PER_GREEN_KG',
  packagingMaterial: 'PER_UNIT',
  packLabour: 'PER_UNIT',
  downstreamServices: 'PER_UNIT',
};

/**
 * Weighted green price across blend components.
 * Returns null if any component price is unset — a blend priced on a subset of
 * its components would understate cost.
 */
export function blendedGreenPricePerKg(
  components: BlendComponent[],
): { value: number; explanation: string } | null {
  if (components.length === 0) return null;
  if (components.some((c) => !isNum(c.pricePerKg))) return null;

  let total = new Decimal(0);
  const parts: string[] = [];
  for (const c of components) {
    const share = D(c.pctOfBlend).div(100);
    total = total.plus(share.times(c.pricePerKg as number));
    parts.push(`${c.pctOfBlend}% x ${money(c.pricePerKg as number, 2)}`);
  }
  return {
    value: total.toNumber(),
    explanation: `${parts.join(' + ')} = ${money(total.toNumber())}/green kg`,
  };
}

/** Blend shares must total 100, else the weighting silently misprices. */
export function blendSharesTotal(components: BlendComponent[]): number {
  return components.reduce((sum, c) => sum + (isNum(c.pctOfBlend) ? c.pctOfBlend : 0), 0);
}

function resolveGreen(green: GreenSource): {
  rate: number | null;
  explanation: string;
  source: string;
} {
  switch (green.kind) {
    case 'NONE':
      return {
        rate: null,
        explanation: 'Client-supplied green — no green cost in this stack.',
        source: 'Not applicable',
      };
    case 'FLAT':
      return isNum(green.pricePerKg)
        ? {
            rate: green.pricePerKg,
            explanation: `${money(green.pricePerKg)}/green kg`,
            source: green.label ?? 'Entered green value',
          }
        : {
            rate: null,
            explanation: 'Green value not set.',
            source: green.label ?? 'Entered green value',
          };
    case 'BLEND': {
      const blended = blendedGreenPricePerKg(green.components);
      return blended
        ? { rate: blended.value, explanation: blended.explanation, source: 'Weighted blend' }
        : {
            rate: null,
            explanation: 'One or more blend components have no green value.',
            source: 'Weighted blend',
          };
    }
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function calculateLine(
  input: PricingLineInput,
  assumptions: PricingAssumptions,
  bands: PackSpeedBand[],
): PricingLineResult {
  const tier = TIER_PRESETS[input.tier];
  const config: CostStackConfig = { ...tier.config, ...(input.configOverrides ?? {}) };

  const warnings: PricingWarning[] = [];

  // --- green consumed by one unit -----------------------------------------
  const greenKg = isNum(input.gramsPerUnit)
    ? deriveGreenKgConsumed(assumptions, input.gramsPerUnit)
    : null;
  const greenKgPerUnit = greenKg?.value ?? null;
  const greenKgExplanation =
    greenKg?.explanation ??
    (isNum(input.gramsPerUnit)
      ? 'Needs a standard yield loss percentage.'
      : 'No finished unit — priced per green kg only.');

  // --- assumption-derived rates -------------------------------------------
  const machine = deriveMachineCostPerGreenKg(assumptions);
  const roastLabour = deriveRoastLabourPerGreenKg(assumptions);
  const packLabour = isNum(input.gramsPerUnit)
    ? derivePackLabourPerUnit(assumptions, bands, input.gramsPerUnit)
    : null;

  const greenResolved = resolveGreen(config.green ? input.green : { kind: 'NONE' });

  if (input.green.kind === 'BLEND') {
    const total = blendSharesTotal(input.green.components);
    if (Math.abs(total - 100) > 0.001) {
      warnings.push({
        kind: 'BLEND_SHARES_NOT_100',
        message: `Blend shares total ${total}%, not 100%. The weighted green cost is wrong until they do.`,
      });
    }
  }

  if (
    config.green &&
    isNum(greenResolved.rate) &&
    isNum(input.greenBenchmarkPerKg) &&
    greenResolved.rate >= input.greenBenchmarkPerKg
  ) {
    warnings.push({
      kind: 'GREEN_AT_OR_OVER_BENCHMARK',
      message:
        `Green at ${money(greenResolved.rate, 2)}/kg has reached the ` +
        `${money(input.greenBenchmarkPerKg, 2)}/kg benchmark this product was priced against.`,
    });
  }

  // --- services -------------------------------------------------------------
  const services = input.services ?? [];
  const servicesRate = services.length === 0
    ? 0
    : services.some((s) => !isNum(s.amountPerUnit))
      ? null
      : services.reduce((sum, s) => sum + (s.amountPerUnit as number), 0);
  const servicesExplanation =
    services.length === 0
      ? 'No services added.'
      : servicesRate == null
        ? 'One or more services have no amount set.'
        : services.map((s) => `${s.label} ${money(s.amountPerUnit as number, 2)}`).join(' + ');

  // --- assemble the ladder --------------------------------------------------
  const raw: Array<{
    key: CostLineKey;
    rate: number | null;
    explanation: string;
    source: string;
  }> = [
    {
      key: 'green',
      rate: greenResolved.rate,
      explanation: greenResolved.explanation,
      source: greenResolved.source,
    },
    {
      key: 'roasterRunning',
      rate: machine?.value ?? null,
      explanation: machine?.explanation ?? 'Needs machine running cost and roast throughput.',
      source: 'Assumptions',
    },
    {
      key: 'roastLabour',
      rate: roastLabour?.value ?? null,
      explanation: roastLabour?.explanation ?? 'Needs the loaded labour rate and roast throughput.',
      source: 'Assumptions',
    },
    {
      key: 'packagingMaterial',
      rate: input.packagingMaterialPerUnit,
      explanation: isNum(input.packagingMaterialPerUnit)
        ? `${money(input.packagingMaterialPerUnit)}/unit`
        : 'Packaging cost not set.',
      source: 'Entered per exercise',
    },
    {
      key: 'packLabour',
      rate: packLabour?.value ?? null,
      explanation:
        packLabour?.explanation ??
        (isNum(input.gramsPerUnit)
          ? 'Needs the loaded labour rate and a packing speed for this weight band.'
          : 'No finished unit to pack.'),
      source: 'Assumptions — weight band',
    },
    {
      key: 'downstreamServices',
      rate: servicesRate,
      explanation: servicesExplanation,
      source: 'Entered per exercise',
    },
  ];

  const lines: CostLine[] = raw.map((r) => {
    const included = config[r.key];
    const basis = LINE_BASIS[r.key];

    let perUnit: number | null = null;
    let perGreenKg: number | null = null;

    if (included && isNum(r.rate)) {
      if (basis === 'PER_GREEN_KG') {
        perGreenKg = r.rate;
        perUnit = isNum(greenKgPerUnit) ? D(r.rate).times(greenKgPerUnit).toNumber() : null;
      } else {
        perUnit = r.rate;
        perGreenKg =
          isNum(greenKgPerUnit) && greenKgPerUnit > 0
            ? D(r.rate).div(greenKgPerUnit).toNumber()
            : null;
      }
    }

    return {
      key: r.key,
      label: LINE_LABELS[r.key],
      basis,
      included,
      rate: included ? r.rate : null,
      perUnit,
      perGreenKg,
      explanation: included ? r.explanation : 'Not included in this configuration.',
      source: included ? r.source : '—',
    };
  });

  // --- completeness ---------------------------------------------------------
  // An included line with no rate means there is no floor. Reporting a number
  // that silently drops a cost is the failure this whole module exists to stop.
  const incomplete = lines.filter((l) => l.included && l.rate == null).map((l) => l.label);

  for (const label of incomplete) {
    warnings.push({ kind: 'MISSING_INPUT', message: `${label} has no value set.` });
  }

  const hasUnit = isNum(greenKgPerUnit) && greenKgPerUnit > 0;
  const complete = incomplete.length === 0;

  // --- floor ----------------------------------------------------------------
  let costFloorPerUnit: number | null = null;
  let costFloorPerGreenKg: number | null = null;

  if (complete) {
    const perGreenKgLines = lines.filter((l) => l.included && l.basis === 'PER_GREEN_KG');
    const perUnitLines = lines.filter((l) => l.included && l.basis === 'PER_UNIT');

    const sumPerGreenKg = perGreenKgLines.reduce(
      (acc, l) => acc.plus(l.rate as number),
      new Decimal(0),
    );
    const sumPerUnit = perUnitLines.reduce((acc, l) => acc.plus(l.rate as number), new Decimal(0));

    if (hasUnit) {
      costFloorPerUnit = sumPerGreenKg.times(greenKgPerUnit as number).plus(sumPerUnit).toNumber();
      costFloorPerGreenKg = D(costFloorPerUnit).div(greenKgPerUnit as number).toNumber();
    } else if (perUnitLines.length === 0) {
      // Priced per green kg only, which is well defined so long as nothing in
      // the stack is charged per unit.
      costFloorPerGreenKg = sumPerGreenKg.toNumber();
    }
  }

  // --- margin and price -----------------------------------------------------
  const marginPerGreenKg = isNum(input.marginPerGreenKg) ? input.marginPerGreenKg : null;
  const marginPerGreenLb = isNum(marginPerGreenKg)
    ? D(marginPerGreenKg).times(KG_PER_LB).toNumber()
    : null;

  const marginPerUnit =
    isNum(marginPerGreenKg) && hasUnit
      ? D(marginPerGreenKg).times(greenKgPerUnit as number).toNumber()
      : null;

  let pricePerUnit: number | null = null;
  let pricePerGreenKg: number | null = null;

  if (isNum(costFloorPerUnit) && isNum(marginPerUnit)) {
    pricePerUnit = D(costFloorPerUnit).plus(marginPerUnit).toNumber();
  }
  if (isNum(costFloorPerGreenKg) && isNum(marginPerGreenKg)) {
    pricePerGreenKg = D(costFloorPerGreenKg).plus(marginPerGreenKg).toNumber();
  }

  if (isNum(marginPerGreenKg) && marginPerGreenKg < 0) {
    warnings.push({
      kind: 'NEGATIVE_MARGIN',
      message: 'Margin is negative — this line prices below its own cost floor.',
    });
  }

  return {
    tier,
    config,
    lines,
    greenKgPerUnit,
    greenKgExplanation,
    costFloorPerUnit,
    costFloorPerGreenKg,
    marginPerUnit,
    marginPerGreenKg,
    marginPerGreenLb,
    pricePerUnit,
    pricePerGreenKg,
    incomplete,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Forecasting
// ---------------------------------------------------------------------------

export type VolumeCadence = 'WEEKLY' | 'MONTHLY';

export interface VolumeForecast {
  cadence: VolumeCadence;
  /** Units per period, for lines priced per finished unit. */
  unitsPerPeriod: number | null;
}

export interface ForecastResult {
  greenKgPerPeriod: number | null;
  revenuePerPeriod: number | null;
  marginPerPeriod: number | null;
  costPerPeriod: number | null;
  /** Monthly equivalent, so weekly legacy accounts compare like for like. */
  marginPerMonth: number | null;
}

/** Weeks per month, averaged over a year. */
export const WEEKS_PER_MONTH = 52 / 12;

export function forecast(
  result: PricingLineResult,
  volume: VolumeForecast,
): ForecastResult {
  const units = volume.unitsPerPeriod;
  if (!isNum(units) || units <= 0) {
    return {
      greenKgPerPeriod: null,
      revenuePerPeriod: null,
      marginPerPeriod: null,
      costPerPeriod: null,
      marginPerMonth: null,
    };
  }

  const greenKgPerPeriod = isNum(result.greenKgPerUnit)
    ? D(result.greenKgPerUnit).times(units).toNumber()
    : null;

  const revenuePerPeriod = isNum(result.pricePerUnit)
    ? D(result.pricePerUnit).times(units).toNumber()
    : null;

  const marginPerPeriod = isNum(result.marginPerUnit)
    ? D(result.marginPerUnit).times(units).toNumber()
    : null;

  const costPerPeriod = isNum(result.costFloorPerUnit)
    ? D(result.costFloorPerUnit).times(units).toNumber()
    : null;

  const marginPerMonth = isNum(marginPerPeriod)
    ? volume.cadence === 'MONTHLY'
      ? marginPerPeriod
      : D(marginPerPeriod).times(WEEKS_PER_MONTH).toNumber()
    : null;

  return { greenKgPerPeriod, revenuePerPeriod, marginPerPeriod, costPerPeriod, marginPerMonth };
}

/** Convert a finished unit weight to kg, for display alongside grams. */
export function unitKg(gramsPerUnit: number): number {
  return D(gramsPerUnit).div(G_PER_KG).toNumber();
}
