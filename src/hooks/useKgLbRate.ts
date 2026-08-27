import { useState } from 'react';
import { perKgToPerLb, perLbToPerKg } from '@/lib/pricingAssumptions';

/**
 * A rate the operator can type in either $/kg or $/lb, with the two kept in step.
 *
 * Both boxes hold their own text rather than one deriving its value from the
 * other. A derived field re-formatted on every keystroke fights the person
 * typing: entering "5" round-trips through the other unit and snaps back to
 * "5.00", stranding the cursor so the decimals can never be typed. Editing one
 * field therefore rewrites the other, never itself.
 */

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Round for display without leaving trailing zeros to type around. */
export const trimNum = (n: number, dp = 4): string => String(Number(n.toFixed(dp)));

export interface KgLbRate {
  kgText: string;
  lbText: string;
  /** The rate in $/kg, or null while unset or mid-edit with no number yet. */
  perKg: number | null;
  setKg: (text: string) => void;
  setLb: (text: string) => void;
  reset: () => void;
}

export function useKgLbRate(initialKg = ''): KgLbRate {
  const [kgText, setKgText] = useState(initialKg);
  const [lbText, setLbText] = useState(() => {
    const n = toNum(initialKg);
    return n == null ? '' : trimNum(perKgToPerLb(n), 4);
  });

  const setKg = (text: string) => {
    setKgText(text);
    const n = toNum(text);
    setLbText(n == null ? '' : trimNum(perKgToPerLb(n), 4));
  };

  const setLb = (text: string) => {
    setLbText(text);
    const n = toNum(text);
    // Six places, because a pound figure converts to an untidy per-kg number
    // and rounding it hard would make the pair fail to round-trip.
    setKgText(n == null ? '' : trimNum(perLbToPerKg(n), 6));
  };

  const reset = () => {
    setKgText('');
    setLbText('');
  };

  return { kgText, lbText, perKg: toNum(kgText), setKg, setLb, reset };
}
