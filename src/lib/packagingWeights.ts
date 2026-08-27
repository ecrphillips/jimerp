/**
 * Finished roasted weight, in grams, for each packaging variant.
 *
 * PackagingBadge carries these as display strings ("2lb", "5lb"); pricing needs
 * them as numbers, because weight decides both green consumed and which packing
 * speed band applies. Imperial variants are converted from pounds rather than
 * rounded by hand, so the arithmetic is traceable.
 */
import { KG_PER_LB, G_PER_KG } from './pricingAssumptions';
import type { PackagingVariant } from '@/components/PackagingBadge';

const lb = (pounds: number): number => Math.round(pounds * KG_PER_LB * G_PER_KG);

export const PACKAGING_GRAMS: Record<PackagingVariant, number> = {
  RETAIL_250G: 250,
  RETAIL_300G: 300,
  RETAIL_340G: 340,
  RETAIL_454G: 454,
  CROWLER_200G: 200,
  CROWLER_250G: 250,
  CAN_125G: 125,
  BULK_2LB: lb(2), // 907
  BULK_1KG: 1000,
  BULK_5LB: lb(5), // 2268
  BULK_2KG: 2000,
};

export function gramsForVariant(v: PackagingVariant | null | undefined): number | null {
  if (!v) return null;
  return PACKAGING_GRAMS[v] ?? null;
}
