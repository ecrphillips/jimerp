/**
 * Weight totals for an order's packed lines.
 *
 * A shipped order is described as bags, not kilograms: three 250g pouches and a
 * 1kg bag. Whoever writes the invoice — or books the courier — needs the total
 * weight without doing that multiplication in their head across a whole order,
 * so the drawer header summarises it.
 *
 * Grams are the authoritative unit (bag_size_g), and the sum is done in grams so
 * no line contributes floating-point drift before the final conversion to kg.
 */

export interface WeightBearingLine {
  quantity_units: number;
  product: { bag_size_g: number | null } | null;
}

/**
 * Total weight of an order's lines in kilograms.
 *
 * Lines whose product carries no bag size (or a nonsensical one) contribute
 * nothing rather than poisoning the total with a guess — a missing size must
 * read as "not counted", never as a phantom weight on an invoice.
 */
export function invoiceOrderWeightKg(lines: WeightBearingLine[]): number {
  const totalGrams = lines.reduce((sum, line) => {
    const bagSize = line.product?.bag_size_g;
    const quantity = Number(line.quantity_units);
    if (bagSize == null || !Number.isFinite(bagSize) || bagSize <= 0) return sum;
    if (!Number.isFinite(quantity) || quantity <= 0) return sum;
    return sum + quantity * bagSize;
  }, 0);

  // 4 dp: weights are carried to four decimals, and rounding here keeps the
  // displayed figure honest about what was actually summed.
  return Math.round((totalGrams / 1000) * 10000) / 10000;
}

/**
 * Weight label for a drawer header, e.g. "1.75 kg". Returns null when nothing
 * could be weighed, so the caller omits the figure instead of showing "0 kg"
 * for an order that plainly has bags in it.
 */
export function formatInvoiceWeight(
  totalKg: number,
  toDisplay: (kg: number) => number,
  suffix: string,
): string | null {
  if (!(totalKg > 0)) return null;
  return `${toDisplay(totalKg).toFixed(2)} ${suffix}`;
}
