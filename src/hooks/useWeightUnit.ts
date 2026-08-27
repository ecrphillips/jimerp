import { useLocalState } from './useSessionState';
import { perKgToPerLb, perLbToPerKg, KG_PER_LB } from '@/lib/pricingAssumptions';

/**
 * Which weight unit prices are entered and read in.
 *
 * Kilograms remain canonical everywhere that matters — the engine, the export
 * and every stored figure are per green kg, and none of that changes. This is
 * about the person doing the quoting: working in the unit you think in removes
 * a conversion step from every judgement, and a judgement made through a
 * conversion is one made a little less confidently.
 *
 * Stored as a setting rather than with the sheet, so it survives the tab
 * closing and does not have to be chosen again each morning.
 */
export type WeightUnit = 'KG' | 'LB';

export const WEIGHT_UNIT_KEY = 'jim.pricing.weight-unit';

export interface WeightUnitState {
  unit: WeightUnit;
  setUnit: (u: WeightUnit) => void;
  /** "kg" or "lb", for labels. */
  suffix: string;
  /** "green kg" or "green lb". */
  greenSuffix: string;
  /** A canonical per-kg rate, in the displayed unit. */
  rateToDisplay: (perKg: number) => number;
  /** A rate typed in the displayed unit, back to canonical per kg. */
  rateFromDisplay: (perDisplay: number) => number;
  /** A canonical weight in kg, in the displayed unit. */
  weightToDisplay: (kg: number) => number;
  /** A weight typed in the displayed unit, back to kg. */
  weightFromDisplay: (display: number) => number;
}

export function useWeightUnit(): WeightUnitState {
  const [unit, setUnit] = useLocalState<WeightUnit>(WEIGHT_UNIT_KEY, 'KG');
  const isLb = unit === 'LB';

  return {
    unit,
    setUnit,
    suffix: isLb ? 'lb' : 'kg',
    greenSuffix: isLb ? 'green lb' : 'green kg',

    // A rate per kg is a *smaller* number per lb, since a pound is less coffee.
    rateToDisplay: (perKg) => (isLb ? perKgToPerLb(perKg) : perKg),
    rateFromDisplay: (perDisplay) => (isLb ? perLbToPerKg(perDisplay) : perDisplay),

    // A weight goes the other way: one kg is more than one pound.
    weightToDisplay: (kg) => (isLb ? kg / KG_PER_LB : kg),
    weightFromDisplay: (display) => (isLb ? display * KG_PER_LB : display),
  };
}
