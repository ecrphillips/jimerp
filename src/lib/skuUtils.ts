// SKU utilities for auto-generating unique SKUs

/**
 * Generate a short code from a name (3-6 chars)
 */
export function generateShortCode(name: string, maxLength: number = 6): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === 0) return 'XXX';
  return cleaned.substring(0, maxLength).padEnd(3, 'X');
}

/**
 * Generate a base SKU from components
 */
export function generateBaseSku(
  clientCode: string,
  productName: string,
  variantCode: string
): string {
  const productCode = generateShortCode(productName, 6);
  return `${clientCode}-${productCode}-${variantCode}`;
}

/**
 * Generate a unique SKU with collision resolution.
 * Returns an array of unique SKUs for each variant.
 * 
 * @param clientCode - The client code (e.g., "FUN")
 * @param productName - The product name to derive code from
 * @param variantCodes - Array of variant codes (e.g., ["250", "5LB"])
 * @param existingSkus - Set of existing SKUs (case-insensitive check)
 * @returns Array of { variantCode, sku, wasAdjusted } objects
 */
export function generateUniqueSkus(
  clientCode: string,
  productName: string,
  variantCodes: string[],
  existingSkus: Set<string>
): Array<{ variantCode: string; sku: string; wasAdjusted: boolean }> {
  const results: Array<{ variantCode: string; sku: string; wasAdjusted: boolean }> = [];
  
  // Normalize existing SKUs to uppercase for case-insensitive comparison
  const normalizedExisting = new Set(
    Array.from(existingSkus).map(s => s?.toUpperCase().trim())
  );
  
  // Track SKUs we're generating in this batch to avoid self-collision
  const batchSkus = new Set<string>();
  
  for (const variantCode of variantCodes) {
    const baseSku = generateBaseSku(clientCode, productName, variantCode);
    let finalSku = baseSku;
    let wasAdjusted = false;
    
    // Check if base SKU exists
    if (normalizedExisting.has(baseSku.toUpperCase()) || batchSkus.has(baseSku.toUpperCase())) {
      wasAdjusted = true;
      
      // Try numeric suffixes: -2, -3, etc.
      let found = false;
      for (let i = 2; i <= 50; i++) {
        const candidate = `${baseSku}-${i}`;
        if (!normalizedExisting.has(candidate.toUpperCase()) && !batchSkus.has(candidate.toUpperCase())) {
          finalSku = candidate;
          found = true;
          break;
        }
      }
      
      // Fallback: random 4-char suffix
      if (!found) {
        const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        finalSku = `${baseSku}-${randomSuffix}`;
      }
    }
    
    batchSkus.add(finalSku.toUpperCase());
    results.push({ variantCode, sku: finalSku, wasAdjusted });
  }
  
  return results;
}

/**
 * Generate a unique SKU by trying insert and handling collision with retry.
 * This is for server-side (during mutation) use.
 */
export async function insertProductsWithUniqueSkus(
  supabase: any,
  products: Array<{
    client_id: string;
    product_name: string;
    baseSku: string;
    roast_group: string;
    packaging_variant: string;
    bag_size_g: number;
    format: string;
    grind_options: string[];
    is_active: boolean;
    is_perennial: boolean;
  }>,
  maxAttempts: number = 50
): Promise<{ 
  created: Array<{ id: string; sku: string; wasAdjusted: boolean }>; 
  errors: string[] 
}> {
  const created: Array<{ id: string; sku: string; wasAdjusted: boolean }> = [];
  const errors: string[] = [];
  
  for (const product of products) {
    let success = false;
    let wasAdjusted = false;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const sku = attempt === 0 ? product.baseSku : `${product.baseSku}-${attempt + 1}`;
      
      const { data, error } = await supabase
        .from('products')
        .insert({
          client_id: product.client_id,
          product_name: product.product_name,
          sku,
          roast_group: product.roast_group,
          packaging_variant: product.packaging_variant,
          bag_size_g: product.bag_size_g,
          format: product.format,
          grind_options: product.grind_options,
          is_active: product.is_active,
          is_perennial: product.is_perennial,
        })
        .select('id, sku')
        .single();
      
      if (!error) {
        created.push({ id: data.id, sku: data.sku, wasAdjusted });
        success = true;
        break;
      }
      
      // Check if it's a unique violation on SKU
      if (error.code === '23505' && error.message?.toLowerCase().includes('sku')) {
        wasAdjusted = true;
        continue; // Try next suffix
      }
      
      // Other error - don't retry
      errors.push(`Failed to create ${product.product_name}: ${error.message}`);
      break;
    }
    
    if (!success && errors.length === 0) {
      // Exhausted retries
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const fallbackSku = `${product.baseSku}-${randomSuffix}`;
      
      const { data, error } = await supabase
        .from('products')
        .insert({
          ...product,
          sku: fallbackSku,
        })
        .select('id, sku')
        .single();
      
      if (error) {
        errors.push(`Failed to create ${product.product_name}: ${error.message}`);
      } else {
        created.push({ id: data.id, sku: data.sku, wasAdjusted: true });
      }
    }
  }
  
  return { created, errors };
}

