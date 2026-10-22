/**
 * Variant ordering for product family drawers.
 *
 * Rule: within a product family drawer, variants read smallest to largest by
 * total volume. For an ordinary variant that is its bag weight; for a Case Lot
 * it is the whole case weight (units × component bag weight), which the
 * packaging-normalization trigger already stores on the case row.
 */

export interface VolumeSortableVariant {
  product_name: string;
  grams_per_unit: number | null;
  bag_size_g: number;
  packaging_type?: { name: string } | null;
}

/** Total product volume in grams: bag weight, or whole-case weight for cases. */
export function variantTotalVolumeGrams(p: VolumeSortableVariant): number {
  const grams = p.grams_per_unit ?? p.bag_size_g ?? 0;
  return Number.isFinite(grams) && grams > 0 ? grams : 0;
}

/** Smallest total volume first; ties fall back to packaging type, then name. */
export function sortVariantsByVolume<T extends VolumeSortableVariant>(variants: T[]): T[] {
  return [...variants].sort((a, b) =>
    variantTotalVolumeGrams(a) - variantTotalVolumeGrams(b)
    || (a.packaging_type?.name ?? '').localeCompare(b.packaging_type?.name ?? '')
    || a.product_name.localeCompare(b.product_name),
  );
}
