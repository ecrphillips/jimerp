// SKU generation utilities for product creation

export interface SkuComponents {
  clientCode: string;
  roastGroupCode: string;
  productCode: string;
  variantCode: string;
}

/**
 * Generate a product code from the product suffix (e.g., "Hermanos" -> "HER")
 * @param suffix The product suffix text
 * @param existingCodes Set of existing product codes to avoid collisions
 * @returns A unique 3-character product code
 */
export function generateProductCode(suffix: string, existingCodes: Set<string> = new Set()): string {
  // Clean and uppercase the suffix
  const cleaned = suffix.toUpperCase().replace(/[^A-Z]/g, '');
  
  if (cleaned.length === 0) {
    return 'XXX';
  }
  
  // Try first 3 characters
  const base = cleaned.substring(0, 3).padEnd(3, 'X');
  
  if (!existingCodes.has(base)) {
    return base;
  }
  
  // Try permutations using different character positions
  const chars = cleaned.split('');
  for (let i = 0; i < chars.length && i < 6; i++) {
    for (let j = i + 1; j < chars.length && j < 6; j++) {
      for (let k = j + 1; k < chars.length && k < 6; k++) {
        const code = `${chars[i]}${chars[j]}${chars[k]}`;
        if (!existingCodes.has(code)) {
          return code;
        }
      }
    }
  }
  
  // Fallback: append digit
  for (let n = 2; n <= 99; n++) {
    const code = `${base.substring(0, 2)}${n}`;
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  
  // Last resort
  return `${base.substring(0, 2)}${Date.now() % 100}`;
}

/**
 * Generate a roast group code from origin or blend name
 * @param name The origin name or blend name
 * @param isBlend Whether this is a blend
 * @param existingCodes Set of existing roast group codes to avoid collisions
 * @returns A unique 3-6 character roast group code
 */
export function generateRoastGroupCode(
  name: string, 
  isBlend: boolean,
  existingCodes: Set<string> = new Set()
): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z]/g, '');
  
  if (cleaned.length === 0) {
    return 'XXX';
  }
  
  let base: string;
  
  if (isBlend) {
    // For blends, try initials (e.g., "Medium Dark" -> "MD")
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      base = words.map(w => w[0]?.toUpperCase() ?? '').join('').substring(0, 4);
    } else {
      base = cleaned.substring(0, 3);
    }
  } else {
    // For single origin, use first 3 letters
    base = cleaned.substring(0, 3);
  }
  
  base = base.padEnd(3, 'X');
  
  if (!existingCodes.has(base)) {
    return base;
  }
  
  // Try appending more characters
  for (let len = 4; len <= 6; len++) {
    const extended = cleaned.substring(0, len);
    if (extended.length >= len && !existingCodes.has(extended)) {
      return extended;
    }
  }
  
  // Append digit
  for (let n = 2; n <= 99; n++) {
    const code = `${base}${n}`;
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  
  return `${base}${Date.now() % 100}`;
}

/**
 * Build a complete SKU from components
 */
export function buildSku(components: SkuComponents): string {
  return `${components.clientCode}-${components.roastGroupCode}-${components.productCode}-${components.variantCode}`;
}

/**
 * Packaging variant configurations
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
