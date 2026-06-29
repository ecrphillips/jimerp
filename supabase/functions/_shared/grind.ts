// Shared grind-signal parser. Pure and dependency-free so it can be imported by
// BOTH the Shopify pull edge function (Deno) and the funk CSV import (Vite/browser)
// without the rule ever drifting between the two sources.
//
// THE RULE (failsafe — favours flagging a grind over missing one):
//   grind type = the text after the FINAL "/" in an order lineitem name.
//     - no "/" segment at all                -> needs_grind = false, label = null
//     - empty trailing segment               -> needs_grind = false, label = null
//     - "Whole Bean" / "Whole Beans" (ci)     -> needs_grind = false, label = null
//     - anything else                        -> needs_grind = true,  label = that exact text
//
// We split on the last "/" (trimming surrounding whitespace) so both
// "Name - 1 KG / Flat Bottom Drip" and "Name/Ground" parse correctly. Anything
// that is not whole bean is treated as needing a grind, so an unknown grind term
// can never slip through as whole bean.

export interface GrindSignal {
  needsGrind: boolean;
  grindLabel: string | null;
}

const WHOLE_BEAN_RE = /^whole\s+beans?$/i;

export function parseGrindSignal(lineItemName: string | null | undefined): GrindSignal {
  const none: GrindSignal = { needsGrind: false, grindLabel: null };
  if (!lineItemName) return none;

  const slash = lineItemName.lastIndexOf("/");
  if (slash < 0) return none;

  const segment = lineItemName.slice(slash + 1).trim();
  if (!segment) return none;
  if (WHOLE_BEAN_RE.test(segment)) return none;

  return { needsGrind: true, grindLabel: segment };
}

// --- Bundle-note grind summary --------------------------------------------------

export interface GrindSummaryItem {
  productName: string;
  grindLabel: string | null;
  qty: number;
}

// Stable marker so the summary line can be found and refreshed idempotently.
export const GRIND_NOTE_PREFIX = "GRIND:";

/**
 * Build a one-line grind summary, e.g.
 *   "GRIND: 2 × Heavy Hitter 1KG (Flat Bottom Drip), 1 × Dream Police 250G (French Press)"
 * Returns null when nothing needs grinding.
 */
export function buildGrindSummaryLine(items: GrindSummaryItem[]): string | null {
  const real = items.filter((i) => i.qty > 0 && i.grindLabel);
  if (real.length === 0) return null;
  const parts = real.map((i) => `${i.qty} × ${i.productName} (${i.grindLabel})`);
  return `${GRIND_NOTE_PREFIX} ${parts.join(", ")}`;
}

/**
 * Merge a grind summary into existing notes idempotently: any prior GRIND: line is
 * stripped first, then the fresh summary (if any) is appended. Re-running a pull
 * therefore refreshes the line rather than stacking duplicates.
 */
export function mergeGrindSummary(
  notes: string | null | undefined,
  summaryLine: string | null,
): string {
  const base = (notes ?? "")
    .split("\n")
    .filter((l) => !l.startsWith(GRIND_NOTE_PREFIX))
    .join("\n")
    .replace(/\n+$/, "");
  if (!summaryLine) return base;
  return base ? `${base}\n${summaryLine}` : summaryLine;
}
