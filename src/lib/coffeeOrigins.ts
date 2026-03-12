export interface CoffeeOriginCountry {
  code: string;
  name: string;
}

export const COFFEE_ORIGIN_COUNTRIES: CoffeeOriginCountry[] = [
  { code: 'BOL', name: 'Bolivia' },
  { code: 'BRA', name: 'Brazil' },
  { code: 'BDI', name: 'Burundi' },
  { code: 'CMR', name: 'Cameroon' },
  { code: 'COL', name: 'Colombia' },
  { code: 'CRI', name: 'Costa Rica' },
  { code: 'CUB', name: 'Cuba' },
  { code: 'COD', name: 'DR Congo' },
  { code: 'DOM', name: 'Dominican Republic' },
  { code: 'ECU', name: 'Ecuador' },
  { code: 'SLV', name: 'El Salvador' },
  { code: 'ETH', name: 'Ethiopia' },
  { code: 'GTM', name: 'Guatemala' },
  { code: 'HTI', name: 'Haiti' },
  { code: 'HND', name: 'Honduras' },
  { code: 'IND', name: 'India' },
  { code: 'IDN', name: 'Indonesia' },
  { code: 'JAM', name: 'Jamaica' },
  { code: 'KEN', name: 'Kenya' },
  { code: 'LAO', name: 'Laos' },
  { code: 'MEX', name: 'Mexico' },
  { code: 'NIC', name: 'Nicaragua' },
  { code: 'PAN', name: 'Panama' },
  { code: 'PNG', name: 'Papua New Guinea' },
  { code: 'PER', name: 'Peru' },
  { code: 'RWA', name: 'Rwanda' },
  { code: 'TZA', name: 'Tanzania' },
  { code: 'TTO', name: 'Trinidad and Tobago' },
  { code: 'UGA', name: 'Uganda' },
  { code: 'VNM', name: 'Vietnam' },
  { code: 'YEM', name: 'Yemen' },
];

export function getCountryName(code: string | null | undefined): string {
  if (!code) return '';
  return COFFEE_ORIGIN_COUNTRIES.find(c => c.code === code)?.name || code;
}

export function getCountryDisplayLabel(code: string): string {
  const country = COFFEE_ORIGIN_COUNTRIES.find(c => c.code === code);
  return country ? `${country.name} (${country.code})` : code;
}
