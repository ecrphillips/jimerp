export function isCaseLotType(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === 'case lot';
}

export function productFamilyName(name: string): string {
  return name.replace(/[\s\-]+\d+(?:\.\d+)?(?:g|kg|lb)(?:\s+[A-Za-z]+){0,3}$/i, '').trim();
}

export interface CaseLotVariant {
  id: string;
  product_name: string;
  account_id: string | null;
  client_id: string | null;
  roast_group: string | null;
  is_active: boolean;
  grams_per_unit: number | null;
  bag_size_g: number;
  case_lot_product_id?: string | null;
  packaging_type?: { name: string } | null;
}

export function caseLotChoices<T extends CaseLotVariant>(source: T, products: T[]): T[] {
  return products.filter(p => p.is_active && !p.case_lot_product_id && !isCaseLotType(p.packaging_type?.name)
    && (p.account_id ?? p.client_id) === (source.account_id ?? source.client_id)
    && productFamilyName(p.product_name) === productFamilyName(source.product_name)
    && p.roast_group === source.roast_group && (p.grams_per_unit ?? p.bag_size_g) > 0)
    .sort((a, b) => (a.grams_per_unit ?? a.bag_size_g) - (b.grams_per_unit ?? b.bag_size_g));
}

export function caseLotGrams(variantGrams: number, count: number): number {
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(variantGrams) || variantGrams <= 0) return 0;
  const total = variantGrams * count;
  return Number.isSafeInteger(total) && total <= 2147483647 ? total : 0;
}