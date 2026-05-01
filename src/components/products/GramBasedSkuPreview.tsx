import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatGramsSuffix, type PackagingVariantEntry } from './PackagingVariantsSection';
import { 
  buildSku, 
  generateFgNameCode, 
  getOriginCode,
  formatGramsSuffix as formatGrams 
} from '@/lib/skuGenerator';

interface GramBasedSkuPreviewProps {
  clientCode: string;
  /**
   * For single origin: the origin name (e.g., "Colombia")
   * For blends: pass "BLD" or undefined
   */
  origin?: string;
  /**
   * Whether this is a blend product
   */
  isBlend?: boolean;
  /**
   * Whether this is a perennial product. If true, origin segment is forced to "BLD".
   */
  isPerennial?: boolean;
  /**
   * The user-entered finished good name (just the suffix, e.g., "Hermanos")
   */
  fgNameSuffix: string;
  variants: PackagingVariantEntry[];
  existingSkus: Set<string>;
}

/**
 * Resolve the origin segment for a SKU according to the canonical rule:
 * - Perennial → "BLD" always
 * - Blend → "BLD"
 * - Single origin → ISO3 code; throws if not determinable
 */
export function resolveOriginSegment(
  isPerennial: boolean,
  isBlend: boolean,
  origin: string | undefined | null
): string {
  if (isPerennial) return 'BLD';
  if (isBlend) return 'BLD';
  if (!origin || !origin.trim()) {
    throw new Error('Origin not determinable from roast group; pick a different roast group or set the product as a blend.');
  }
  const code = getOriginCode(origin);
  if (!code || code === 'XXX') {
    throw new Error('Origin not determinable from roast group; pick a different roast group or set the product as a blend.');
  }
  return code;
}

interface SkuPreviewItem {
  packagingTypeId: string;
  packagingTypeName: string;
  grams: number;
  baseSku: string;
  finalSku: string;
  wasAdjusted: boolean;
}

/**
 * Resolves SKU collisions with numeric suffixes
 */
function resolveSkuCollision(
  baseSku: string,
  existingSkus: Set<string>,
  batchSkus: Set<string>
): { finalSku: string; wasAdjusted: boolean } {
  const normalized = baseSku.toUpperCase().trim();

  if (!existingSkus.has(normalized) && !batchSkus.has(normalized)) {
    return { finalSku: baseSku, wasAdjusted: false };
  }

  // Try numeric suffixes
  for (let i = 2; i <= 50; i++) {
    const candidate = `${baseSku}-${i}`;
    const candidateNormalized = candidate.toUpperCase().trim();
    if (!existingSkus.has(candidateNormalized) && !batchSkus.has(candidateNormalized)) {
      return { finalSku: candidate, wasAdjusted: true };
    }
  }

  // Fallback: random suffix
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return { finalSku: `${baseSku}-${randomSuffix}`, wasAdjusted: true };
}

export function GramBasedSkuPreview({
  clientCode,
  origin,
  isBlend = false,
  isPerennial = false,
  fgNameSuffix,
  variants,
  existingSkus,
}: GramBasedSkuPreviewProps) {
  const { resolvedSkus, originError } = useMemo(() => {
    if (!clientCode || !fgNameSuffix || variants.length === 0) {
      return { resolvedSkus: [] as SkuPreviewItem[], originError: null as string | null };
    }

    let originCode: string;
    try {
      originCode = resolveOriginSegment(isPerennial, isBlend, origin);
    } catch (err: any) {
      return { resolvedSkus: [] as SkuPreviewItem[], originError: err?.message ?? 'Origin not determinable' };
    }

    // Generate 5-char FG name code
    const { code: fgNameCode } = generateFgNameCode(fgNameSuffix);

    const batchSkus = new Set<string>();
    const results: SkuPreviewItem[] = [];

    for (const variant of variants) {
      if (variant.grams <= 0) continue;

      // SKU format: {CLIENT3}-{ORIGIN3orBLD}-{FGNAME5}-{GRAMS5}
      const gramsSuffix = formatGrams(variant.grams);
      const baseSku = buildSku({
        clientCode,
        originCode,
        fgNameCode,
        gramsSuffix,
      });

      const { finalSku, wasAdjusted } = resolveSkuCollision(
        baseSku,
        existingSkus,
        batchSkus
      );
      batchSkus.add(finalSku.toUpperCase().trim());

      results.push({
        packagingTypeId: variant.packagingTypeId,
        packagingTypeName: variant.packagingTypeName,
        grams: variant.grams,
        baseSku,
        finalSku,
        wasAdjusted,
      });
    }

    return { resolvedSkus: results, originError: null as string | null };
  }, [clientCode, origin, isBlend, isPerennial, fgNameSuffix, variants, existingSkus]);

  const hasAdjustments = resolvedSkus.some((s) => s.wasAdjusted);

  if (originError) {
    return (
      <div className="mt-4 p-4 border border-destructive/40 rounded-lg bg-destructive/5">
        <p className="text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {originError}
        </p>
      </div>
    );
  }

  if (variants.length === 0 || variants.every((v) => v.grams <= 0)) {
    return (
      <div className="mt-4 p-4 border border-dashed rounded-lg bg-muted/20">
        <p className="text-sm text-muted-foreground text-center">
          Select packaging variants with valid gram weights to preview SKUs
        </p>
      </div>
    );
  }

  if (!clientCode || !fgNameSuffix) {
    return (
      <div className="mt-4 p-4 border border-dashed rounded-lg bg-muted/20">
        <p className="text-sm text-muted-foreground text-center">
          Enter client and product name to preview SKUs
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 p-4 border rounded-lg bg-muted/20 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">SKU Preview</p>
        {hasAdjustments ? (
          <div className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            <span>Auto-adjusted for uniqueness</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-primary">
            <CheckCircle2 className="h-3 w-3" />
            <span>All unique</span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {resolvedSkus.map((sku) => (
          <div
            key={`${sku.packagingTypeId}-${sku.grams}`}
            className="flex items-center justify-between py-1"
          >
            <span className="text-xs text-muted-foreground">
              {sku.packagingTypeName} ({sku.grams}g)
            </span>
            <code
              className={`text-xs font-mono px-2 py-0.5 rounded ${
                sku.wasAdjusted
                  ? 'bg-destructive/10 text-destructive border border-destructive/30'
                  : 'bg-muted'
              }`}
            >
              {sku.finalSku}
            </code>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground pt-2 border-t">
        SKU format: <code className="bg-muted px-1 rounded">{'{CLIENT}'}-{'{ORIGIN/BLD}'}-{'{NAME}'}-{'{GRAMS}'}</code>
        <br />
        {isBlend ? (
          <span>BLD = Blend • Name = first 5 letters • Grams zero-padded to 5 digits</span>
        ) : (
          <span>Origin = ISO 3166-1 alpha-3 • Name = first 5 letters • Grams zero-padded to 5 digits</span>
        )}
      </p>
    </div>
  );
}

/**
 * Get the final resolved SKUs for saving.
 *
 * Throws if origin segment cannot be determined for a non-perennial, non-blend product.
 * Never produces "XXX" — always BLD, a real ISO3, or throws.
 */
export function getResolvedSkus(
  clientCode: string,
  origin: string | undefined,
  isBlend: boolean,
  fgNameSuffix: string,
  variants: PackagingVariantEntry[],
  existingSkus: Set<string>,
  isPerennial: boolean = false
): Array<{
  packagingTypeId: string;
  packagingTypeName: string;
  grams: number;
  sku: string;
  wasAdjusted: boolean;
}> {
  if (!clientCode || !fgNameSuffix || variants.length === 0) return [];

  // Determine origin code (throws if non-perennial single-origin can't resolve)
  const originCode = resolveOriginSegment(isPerennial, isBlend, origin);
  
  // Generate 5-char FG name code
  const { code: fgNameCode } = generateFgNameCode(fgNameSuffix);

  const batchSkus = new Set<string>();
  const results: Array<{
    packagingTypeId: string;
    packagingTypeName: string;
    grams: number;
    sku: string;
    wasAdjusted: boolean;
  }> = [];

  for (const variant of variants) {
    if (variant.grams <= 0) continue;

    const gramsSuffix = formatGrams(variant.grams);
    const baseSku = buildSku({
      clientCode,
      originCode,
      fgNameCode,
      gramsSuffix,
    });

    const { finalSku, wasAdjusted } = resolveSkuCollision(
      baseSku,
      existingSkus,
      batchSkus
    );
    batchSkus.add(finalSku.toUpperCase().trim());

    results.push({
      packagingTypeId: variant.packagingTypeId,
      packagingTypeName: variant.packagingTypeName,
      grams: variant.grams,
      sku: finalSku,
      wasAdjusted,
    });
  }

  return results;
}

/**
 * Resolves SKU collisions - exported for use in modals
 */
function resolveSkuCollisionExport(
  baseSku: string,
  existingSkus: Set<string>,
  batchSkus: Set<string>
): { finalSku: string; wasAdjusted: boolean } {
  return resolveSkuCollision(baseSku, existingSkus, batchSkus);
}

export { resolveSkuCollisionExport as resolveSkuCollision };
