import { getCountryName } from '@/lib/coffeeOrigins';

export type LotForLabel = {
  id: string;
  lot_number: string;
  book_value_per_kg: number | null;
  origin_country: string | null;
  producer: string | null;
  lot_identifier: string | null;
};

export function lotLeadLabel(lot: LotForLabel): string {
  const ident = lot.lot_identifier?.trim() || '';
  if (ident) return ident;
  const originName = lot.origin_country
    ? getCountryName(lot.origin_country) || lot.origin_country
    : '';
  const producer = lot.producer?.trim() || '';
  if (originName && producer) return `${originName} — ${producer}`;
  if (producer) return producer;
  if (originName) return originName;
  return lot.lot_number;
}
