import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatGramsSuffix, type PackagingVariantEntry } from './PackagingVariantsSection';

interface GramBasedSkuPreviewProps {
  clientCode: string;
  productCode: string;
  variants: PackagingVariantEntry[];
  existingSkus: Set<string>;
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
  productCode,
  variants,
  existingSkus,
}: GramBasedSkuPreviewProps) {
  const resolvedSkus = useMemo(() => {
    if (!clientCode || !productCode || variants.length === 0) return [];

    const batchSkus = new Set<string>();
    const results: SkuPreviewItem[] = [];

    for (const variant of variants) {
      if (variant.grams <= 0) continue;

      // SKU format: {CLIENT_CODE}-{PRODUCT_CODE}-{5-DIGIT-GRAMS}
      const gramsSuffix = formatGramsSuffix(variant.grams);
      const baseSku = `${clientCode}-${productCode}-${gramsSuffix}`;

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

    return results;
  }, [clientCode, productCode, variants, existingSkus]);

  const hasAdjustments = resolvedSkus.some((s) => s.wasAdjusted);

  if (variants.length === 0 || variants.every((v) => v.grams <= 0)) {
    return (
      <div className="mt-4 p-4 border border-dashed rounded-lg bg-muted/20">
        <p className="text-sm text-muted-foreground text-center">
          Select packaging variants with valid gram weights to preview SKUs
        </p>
      </div>
    );
  }

  if (!clientCode || !productCode) {
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
        SKU format: <code className="bg-muted px-1 rounded">{'{CLIENT}'}-{'{PRODUCT}'}-{'{GRAMS}'}</code>
        <br />
        Grams are zero-padded to 5 digits (e.g., 340g → 00340)
      </p>
    </div>
  );
}

/**
 * Get the final resolved SKUs for saving
 */
export function getResolvedSkus(
  clientCode: string,
  productCode: string,
  variants: PackagingVariantEntry[],
  existingSkus: Set<string>
): Array<{
  packagingTypeId: string;
  packagingTypeName: string;
  grams: number;
  sku: string;
  wasAdjusted: boolean;
}> {
  if (!clientCode || !productCode || variants.length === 0) return [];

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

    const gramsSuffix = formatGramsSuffix(variant.grams);
    const baseSku = `${clientCode}-${productCode}-${gramsSuffix}`;

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
