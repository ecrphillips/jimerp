/**
 * Pricing assumptions — pure derivation helpers.
 *
 * Every rate the pricing calculator consumes is derived here from operator-set
 * inputs, never hardcoded. The central rule is null-propagation: if an input
 * has not been set, the derived value is `null`, not `0`. A missing rate must
 * surface as "not set" so nobody prices a product at accidentally-zero cost.
 *
 * Currency arithmetic uses decimal.js to avoid binary-float drift.
 */
import Decimal from 'decimal.js';

export const KG_PER_LB = 0.45359237;
export const G_PER_KG = 1000;

export interface PricingAssumptions {
  roast_throughput_green_kg_per_hr: number | null;
  machine_running_cost_per_hr: number | null;
  labour_salary_annual: number | null;
  labour_weeks_per_year: number | null;
  labour_hours_per_week: number | null;
  labour_oncost_pct: number | null;
  standard_yield_loss_pct: number | null;
  green_financing_days: number | null;
  green_financing_apr_pct: number | null;
}

export interface PackSpeedBand {
  id: string;
  label: string;
  min_g: number;
  max_g: number | null;
  units_per_hour: number | null;
  display_order: number;
}

/** A derived number plus the arithmetic that produced it, for on-screen display. */
export interface Derived {
  value: number;
  /** Human-readable derivation, e.g. "$75,000 / (49 wks x 37.5 hrs) = $40.82/hr". */
  explanation: string;
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Thousands-separated so derivation strings stay readable at a glance. */
const money = (d: Decimal): string =>
  `$${Number(d.toFixed(2)).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Base hourly labour rate before oncosts.
 * salary / (weeks per year x hours per week)
 */
export function deriveBaseLabourRate(a: PricingAssumptions): Derived | null {
  const { labour_salary_annual: salary, labour_weeks_per_year: weeks, labour_hours_per_week: hours } = a;
  if (!isNum(salary) || !isNum(weeks) || !isNum(hours)) return null;
  if (weeks <= 0 || hours <= 0) return null;

  const annualHours = new Decimal(weeks).times(hours);
  const rate = new Decimal(salary).div(annualHours);
  return {
    value: rate.toNumber(),
    explanation:
      `${money(new Decimal(salary))} / (${weeks} wks x ${hours} hrs) ` +
      `= ${annualHours.toFixed(1)} hrs/yr = ${money(rate)}/hr`,
  };
}

/** Loaded hourly labour rate: base rate plus oncosts. This is what costing uses. */
export function deriveLoadedLabourRate(a: PricingAssumptions): Derived | null {
  const base = deriveBaseLabourRate(a);
  if (!base) return null;
  const oncost = a.labour_oncost_pct;
  if (!isNum(oncost) || oncost < 0) return null;

  const loaded = new Decimal(base.value).times(new Decimal(1).plus(new Decimal(oncost).div(100)));
  return {
    value: loaded.toNumber(),
    explanation: `${base.explanation}, +${oncost}% oncosts = ${money(loaded)}/hr`,
  };
}

/** Roaster running cost expressed per green kg: $/hr / (green kg/hr). */
export function deriveMachineCostPerGreenKg(a: PricingAssumptions): Derived | null {
  const { machine_running_cost_per_hr: perHr, roast_throughput_green_kg_per_hr: tput } = a;
  if (!isNum(perHr) || !isNum(tput) || tput <= 0) return null;

  const perKg = new Decimal(perHr).div(tput);
  return {
    value: perKg.toNumber(),
    explanation: `${money(new Decimal(perHr))}/hr / ${tput} green kg/hr = $${perKg.toFixed(4)}/green kg`,
  };
}

/** Roast labour expressed per green kg: loaded $/hr / (green kg/hr). */
export function deriveRoastLabourPerGreenKg(a: PricingAssumptions): Derived | null {
  const loaded = deriveLoadedLabourRate(a);
  const tput = a.roast_throughput_green_kg_per_hr;
  if (!loaded || !isNum(tput) || tput <= 0) return null;

  const perKg = new Decimal(loaded.value).div(tput);
  return {
    value: perKg.toNumber(),
    explanation: `${money(new Decimal(loaded.value))}/hr / ${tput} green kg/hr = $${perKg.toFixed(4)}/green kg`,
  };
}

/**
 * The band a finished unit weight falls into.
 * Bands are inclusive of min_g and max_g; a null max_g is open ended.
 */
export function findPackSpeedBand(bands: PackSpeedBand[], grams: number): PackSpeedBand | null {
  if (!isNum(grams) || grams <= 0) return null;
  return (
    bands.find((b) => grams >= b.min_g && (b.max_g == null || grams <= b.max_g)) ?? null
  );
}

/** Pack labour per finished unit: loaded $/hr / (units per hour) for the matching band. */
export function derivePackLabourPerUnit(
  a: PricingAssumptions,
  bands: PackSpeedBand[],
  grams: number,
): Derived | null {
  const loaded = deriveLoadedLabourRate(a);
  if (!loaded) return null;

  const band = findPackSpeedBand(bands, grams);
  if (!band || !isNum(band.units_per_hour) || band.units_per_hour <= 0) return null;

  const perUnit = new Decimal(loaded.value).div(band.units_per_hour);
  return {
    value: perUnit.toNumber(),
    explanation:
      `${money(new Decimal(loaded.value))}/hr / ${band.units_per_hour} units/hr ` +
      `(${band.label}) = $${perUnit.toFixed(4)}/unit`,
  };
}

/** Grams, thousands-separated, rounded to whole grams. */
const grams = (n: number): string =>
  `${Math.round(n).toLocaleString('en-CA')} g`;

/**
 * Roasted weight produced by a given green weight: green x (1 - loss).
 * The forward direction — what comes out of the roaster.
 */
export function deriveRoastedFromGreen(
  a: PricingAssumptions,
  gramsGreen: number,
): Derived | null {
  const loss = a.standard_yield_loss_pct;
  if (!isNum(gramsGreen) || gramsGreen <= 0) return null;
  if (!isNum(loss) || loss < 0 || loss >= 100) return null;

  const retained = new Decimal(1).minus(new Decimal(loss).div(100));
  const roasted = new Decimal(gramsGreen).times(retained);
  return {
    value: roasted.toNumber(),
    explanation: `${grams(gramsGreen)} green x (1 - ${loss}%) = ${grams(roasted.toNumber())} roasted`,
  };
}

/**
 * Green weight consumed to produce a given roasted weight: roasted / (1 - loss).
 * The reverse direction — what has to go in. This is the one pricing uses,
 * because every per-green-kg cost multiplies by it.
 */
export function deriveGreenFromRoasted(
  a: PricingAssumptions,
  gramsRoasted: number,
): Derived | null {
  const loss = a.standard_yield_loss_pct;
  if (!isNum(gramsRoasted) || gramsRoasted <= 0) return null;
  if (!isNum(loss) || loss < 0 || loss >= 100) return null;

  const retained = new Decimal(1).minus(new Decimal(loss).div(100));
  const green = new Decimal(gramsRoasted).div(retained);
  return {
    value: green.toNumber(),
    explanation: `${grams(gramsRoasted)} roasted / (1 - ${loss}%) = ${grams(green.toNumber())} green`,
  };
}

/**
 * Green kg consumed to produce a finished unit — the quantity every
 * per-green-kg cost line multiplies by.
 *
 * Delegates to deriveGreenFromRoasted so the yield arithmetic exists in
 * exactly one place; this wrapper only changes the unit to kg.
 */
export function deriveGreenKgConsumed(
  a: PricingAssumptions,
  gramsRoasted: number,
): Derived | null {
  const inGrams = deriveGreenFromRoasted(a, gramsRoasted);
  if (!inGrams) return null;
  return {
    value: new Decimal(inGrams.value).div(G_PER_KG).toNumber(),
    explanation: inGrams.explanation,
  };
}

/** Convert $/green kg to $/green lb for reference display. */
export function perKgToPerLb(perKg: number): number {
  if (!isNum(perKg)) return 0;
  return new Decimal(perKg).times(KG_PER_LB).toNumber();
}

/** Convert $/green lb to $/green kg. */
export function perLbToPerKg(perLb: number): number {
  if (!isNum(perLb)) return 0;
  return new Decimal(perLb).div(KG_PER_LB).toNumber();
}

export interface BandCoverageProblem {
  kind: 'gap' | 'overlap' | 'unbounded-missing';
  message: string;
}

/**
 * Bands must tile the positive range with no gap and no overlap, otherwise a
 * product weight either matches nothing (priced at no pack labour) or matches
 * two bands (silently taking whichever sorts first). Both are the kind of
 * quiet wrongness this module exists to prevent, so surface them in the UI.
 */
export function validateBandCoverage(bands: PackSpeedBand[]): BandCoverageProblem[] {
  const problems: BandCoverageProblem[] = [];
  if (bands.length === 0) return problems;

  const sorted = [...bands].sort((x, y) => x.min_g - y.min_g);

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (cur.max_g == null) {
      problems.push({
        kind: 'overlap',
        message: `"${cur.label}" is open ended but "${next.label}" starts after it.`,
      });
      continue;
    }
    if (next.min_g <= cur.max_g) {
      problems.push({
        kind: 'overlap',
        message: `"${cur.label}" (to ${cur.max_g}g) overlaps "${next.label}" (from ${next.min_g}g).`,
      });
    } else if (next.min_g > cur.max_g + 1) {
      problems.push({
        kind: 'gap',
        message: `No band covers ${cur.max_g + 1}g to ${next.min_g - 1}g.`,
      });
    }
  }

  if (sorted[sorted.length - 1].max_g != null) {
    problems.push({
      kind: 'unbounded-missing',
      message: 'The heaviest band has an upper bound, so weights above it match no band.',
    });
  }

  return problems;
}
