import { useState } from 'react';
import { perKgToPerLb, perLbToPerKg } from '@/lib/pricingAssumptions';
import { useSessionState } from './useSessionState';

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

/**
 * @param storageKey when given, both boxes survive navigation for the tab's
 * lifetime — a rate typed into a half-built sheet should not be lost to a
 * stray click on the sidebar.
 */
export function useKgLbRate(initialKg = '', storageKey?: string): KgLbRate {
  const initialLb = (() => {
    const n = toNum(initialKg);
    return n == null ? '' : trimNum(perKgToPerLb(n), 4);
  })();

  const plainKg = useState(initialKg);
  const plainLb = useState(initialLb);
  const storedKg = useSessionState(`${storageKey ?? 'kglb'}.kg`, initialKg);
  const storedLb = useSessionState(`${storageKey ?? 'kglb'}.lb`, initialLb);

  // Both hooks always run — calling one conditionally would break the rules of
  // hooks — and only the chosen pair is read from.
  const [kgText, setKgText] = storageKey ? storedKg : plainKg;
  const [lbText, setLbText] = storageKey ? storedLb : plainLb;

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
    if (storageKey) {
      // clear() resets to the initial value and forgets the stored one; writing
      // again afterwards would just put a value back over the key removed.
      storedKg[2]();
      storedLb[2]();
      return;
    }
    setKgText('');
    setLbText('');
  };

  return { kgText, lbText, perKg: toNum(kgText), setKg, setLb, reset };
}
