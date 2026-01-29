// SKU generation utilities for product creation

export interface SkuComponents {
  clientCode: string;
  originCode: string; // ISO 3166-1 alpha-3 or 'BLD' for blends
  fgNameCode: string; // 5-char finished good name code
  gramsSuffix: string; // 5-digit zero-padded grams
}

/**
 * ISO 3166-1 alpha-3 country codes for coffee origins
 */
export const ORIGIN_TO_ISO3: Record<string, string> = {
  'Brazil': 'BRA',
  'Colombia': 'COL',
  'Costa Rica': 'CRI',
  'Ecuador': 'ECU',
  'El Salvador': 'SLV',
  'Ethiopia': 'ETH',
  'Guatemala': 'GTM',
  'Honduras': 'HND',
  'Indonesia': 'IDN',
  'Kenya': 'KEN',
  'Mexico': 'MEX',
  'Nicaragua': 'NIC',
  'Panama': 'PAN',
  'Peru': 'PER',
  'Rwanda': 'RWA',
  'Sumatra': 'IDN', // Sumatra is Indonesia
  'Tanzania': 'TZA',
  'Uganda': 'UGA',
  'Vietnam': 'VNM',
  'Yemen': 'YEM',
  'Bolivia': 'BOL',
  'Burundi': 'BDI',
  'Cameroon': 'CMR',
  'China': 'CHN',
  'Congo': 'COD',
  'Cuba': 'CUB',
  'Dominican Republic': 'DOM',
  'Haiti': 'HTI',
  'India': 'IND',
  'Jamaica': 'JAM',
  'Laos': 'LAO',
  'Malawi': 'MWI',
  'Myanmar': 'MMR',
  'Nepal': 'NPL',
  'Papua New Guinea': 'PNG',
  'Philippines': 'PHL',
  'Thailand': 'THA',
  'Timor-Leste': 'TLS',
  'Venezuela': 'VEN',
  'Zambia': 'ZMB',
  'Zimbabwe': 'ZWE',
};

/**
 * Get ISO 3166-1 alpha-3 code for an origin
 * Returns first 3 letters uppercased if not found in mapping
 */
export function getOriginCode(origin: string): string {
  const trimmed = origin.trim();
  
  // Check exact match first
  if (ORIGIN_TO_ISO3[trimmed]) {
    return ORIGIN_TO_ISO3[trimmed];
  }
  
  // Check case-insensitive
  const lowerOrigin = trimmed.toLowerCase();
  for (const [key, code] of Object.entries(ORIGIN_TO_ISO3)) {
    if (key.toLowerCase() === lowerOrigin) {
      return code;
    }
  }
  
  // Fallback: first 3 letters, uppercased
  const cleaned = trimmed.toUpperCase().replace(/[^A-Z]/g, '');
  return cleaned.substring(0, 3).padEnd(3, 'X');
}

/**
 * Generate a 5-character FG name code from the user-entered name
 * Uses sliding window and padding for collision resolution
 */
export function generateFgNameCode(
  name: string,
  existingCodes: Set<string> = new Set()
): { code: string; wasAdjusted: boolean } {
  const cleaned = name.toUpperCase().replace(/[^A-Z]/g, '');
  
  if (cleaned.length === 0) {
    return { code: 'XXXXX', wasAdjusted: false };
  }
  
  // Pad short names with X
  const padded = cleaned.padEnd(5, 'X');
  
  // Try first 5 characters
  const baseCode = padded.substring(0, 5);
  if (!existingCodes.has(baseCode)) {
    return { code: baseCode, wasAdjusted: false };
  }
  
  // Try sliding window: letters 2-6, 3-7, etc.
  for (let start = 1; start <= cleaned.length - 5; start++) {
    const windowCode = cleaned.substring(start, start + 5);
    if (windowCode.length === 5 && !existingCodes.has(windowCode)) {
      return { code: windowCode, wasAdjusted: true };
    }
  }
  
  // Try last 5 characters
  if (cleaned.length >= 5) {
    const lastFive = cleaned.substring(cleaned.length - 5);
    if (!existingCodes.has(lastFive)) {
      return { code: lastFive, wasAdjusted: true };
    }
  }
  
  // Fallback: replace last char with digit (HERM1, HERM2, etc.)
  const prefix = baseCode.substring(0, 4);
  for (let n = 1; n <= 9; n++) {
    const numericCode = `${prefix}${n}`;
    if (!existingCodes.has(numericCode)) {
      return { code: numericCode, wasAdjusted: true };
    }
  }
  
  // Last resort: replace last 2 chars with digits
  const shortPrefix = baseCode.substring(0, 3);
  for (let n = 10; n <= 99; n++) {
    const numericCode = `${shortPrefix}${n}`;
    if (!existingCodes.has(numericCode)) {
      return { code: numericCode, wasAdjusted: true };
    }
  }
  
  // Absolute fallback
  return { code: `${shortPrefix}${Date.now() % 100}`.substring(0, 5), wasAdjusted: true };
}

/**
 * Build a complete SKU from components
 * Format: {CLIENT3}-{ORIGIN3orBLD}-{FGNAME5}-{GRAMS5}
 */
export function buildSku(components: SkuComponents): string {
  return `${components.clientCode}-${components.originCode}-${components.fgNameCode}-${components.gramsSuffix}`;
}

/**
 * Format grams as 5-digit zero-padded string
 */
export function formatGramsSuffix(grams: number): string {
  return String(grams).padStart(5, '0');
}

/**
 * Packaging variant configurations (legacy, kept for reference)
 */
export const PACKAGING_VARIANTS = [
  { value: 'CAN_125G', label: '125g can', code: '125', bagSizeG: 125 },
  { value: 'CROWLER_200G', label: '200g crowler', code: '200', bagSizeG: 200 },
  { value: 'RETAIL_250G', label: '250g bag', code: '250', bagSizeG: 250 },
  { value: 'CROWLER_250G', label: '250g crowler', code: '250C', bagSizeG: 250 },
  { value: 'RETAIL_300G', label: '300g bag', code: '300', bagSizeG: 300 },
  { value: 'RETAIL_340G', label: '340g bag', code: '340', bagSizeG: 340 },
  { value: 'RETAIL_454G', label: '454g bag', code: '454', bagSizeG: 454 },
  { value: 'BULK_2LB', label: '2LB bulk', code: '2LB', bagSizeG: 908 },
  { value: 'BULK_1KG', label: '1KG bulk', code: '1KG', bagSizeG: 1000 },
  { value: 'BULK_2KG', label: '2KG bulk', code: '2KG', bagSizeG: 2000 },
  { value: 'BULK_5LB', label: '5LB bulk', code: '5LB', bagSizeG: 2270 },
] as const;

export type PackagingVariantValue = typeof PACKAGING_VARIANTS[number]['value'];

/**
 * Common coffee origins for the dropdown
 */
export const COMMON_ORIGINS = [
  'Brazil',
  'Colombia',
  'Costa Rica',
  'Ecuador',
  'El Salvador',
  'Ethiopia',
  'Guatemala',
  'Honduras',
  'Indonesia',
  'Kenya',
  'Mexico',
  'Nicaragua',
  'Panama',
  'Peru',
  'Rwanda',
  'Sumatra',
  'Tanzania',
  'Uganda',
  'Vietnam',
  'Yemen',
] as const;
