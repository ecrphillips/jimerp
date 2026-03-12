export interface CoffeeOriginCountry {
  code: string;
  name: string;
}

export const COMMON_ORIGINS: CoffeeOriginCountry[] = [
  { code: 'BRA', name: 'Brazil' },
  { code: 'BDI', name: 'Burundi' },
  { code: 'COL', name: 'Colombia' },
  { code: 'CRI', name: 'Costa Rica' },
  { code: 'SLV', name: 'El Salvador' },
  { code: 'ETH', name: 'Ethiopia' },
  { code: 'GTM', name: 'Guatemala' },
  { code: 'HND', name: 'Honduras' },
  { code: 'IND', name: 'India' },
  { code: 'IDN', name: 'Indonesia' },
  { code: 'KEN', name: 'Kenya' },
  { code: 'MEX', name: 'Mexico' },
  { code: 'MMR', name: 'Myanmar' },
  { code: 'NIC', name: 'Nicaragua' },
  { code: 'PAN', name: 'Panama' },
  { code: 'PNG', name: 'Papua New Guinea' },
  { code: 'PER', name: 'Peru' },
  { code: 'RWA', name: 'Rwanda' },
  { code: 'UGA', name: 'Uganda' },
  { code: 'YEM', name: 'Yemen' },
];

export const OTHER_ORIGINS: CoffeeOriginCountry[] = [
  { code: 'BOL', name: 'Bolivia' },
  { code: 'CMR', name: 'Cameroon' },
  { code: 'CHN', name: 'China' },
  { code: 'CUB', name: 'Cuba' },
  { code: 'COD', name: 'DR Congo' },
  { code: 'DOM', name: 'Dominican Republic' },
  { code: 'ECU', name: 'Ecuador' },
  { code: 'HTI', name: 'Haiti' },
  { code: 'JAM', name: 'Jamaica' },
  { code: 'LAO', name: 'Laos' },
  { code: 'TZA', name: 'Tanzania' },
  { code: 'TTO', name: 'Trinidad and Tobago' },
  { code: 'VNM', name: 'Vietnam' },
];

export const COFFEE_ORIGIN_COUNTRIES: CoffeeOriginCountry[] = [...COMMON_ORIGINS, ...OTHER_ORIGINS];

export function getCountryName(code: string | null | undefined): string {
  if (!code) return '';
  return COFFEE_ORIGIN_COUNTRIES.find(c => c.code === code)?.name || code;
}

export function getCountryDisplayLabel(code: string): string {
  const country = COFFEE_ORIGIN_COUNTRIES.find(c => c.code === code);
  return country ? `${country.name} (${country.code})` : code;
}
