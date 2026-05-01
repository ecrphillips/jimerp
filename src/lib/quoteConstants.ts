/**
 * Quote Builder constants (Layer 2A).
 * Tweak these to change margin thresholds without hunting through component code.
 */

export const MARGIN_GREEN_MIN = 0.30; // ≥30% green
export const MARGIN_AMBER_MIN = 0.15; // 15–30% amber, <15% red

export type MarginColour = 'green' | 'amber' | 'red' | 'none';

export function marginColour(marginPct: number | null | undefined): MarginColour {
  if (marginPct == null || !Number.isFinite(marginPct)) return 'none';
  if (marginPct >= MARGIN_GREEN_MIN) return 'green';
  if (marginPct >= MARGIN_AMBER_MIN) return 'amber';
  return 'red';
}

export function marginClass(c: MarginColour): string {
  switch (c) {
    case 'green':
      return 'text-emerald-600 dark:text-emerald-400 font-semibold';
    case 'amber':
      return 'text-amber-600 dark:text-amber-400 font-semibold';
    case 'red':
      return 'text-destructive font-semibold';
    default:
      return 'text-muted-foreground';
  }
}
