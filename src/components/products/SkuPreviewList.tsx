import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface SkuPreviewItem {
  variant: string;
  label: string;
  baseSku: string;
}

interface SkuPreviewListProps {
  /** The base SKU previews (before collision resolution) */
  skuPreviews: SkuPreviewItem[];
  /** Set of existing SKUs (case-insensitive, trimmed, uppercased) */
  existingSkus: Set<string>;
}

/**
 * Resolves SKU collisions and returns final SKUs that would be saved
 */
export function resolveSkuCollisions(
  baseSku: string,
  existingSkus: Set<string>,
  batchSkus: Set<string>
): { finalSku: string; wasAdjusted: boolean } {
  const normalized = baseSku.toUpperCase().trim();
  
  // Check if base SKU exists
  if (!existingSkus.has(normalized) && !batchSkus.has(normalized)) {
    return { finalSku: baseSku, wasAdjusted: false };
  }
  
  // Try numeric suffixes: -2, -3, etc.
  for (let i = 2; i <= 50; i++) {
    const candidate = `${baseSku}-${i}`;
    const candidateNormalized = candidate.toUpperCase().trim();
    if (!existingSkus.has(candidateNormalized) && !batchSkus.has(candidateNormalized)) {
      return { finalSku: candidate, wasAdjusted: true };
    }
  }
  
  // Fallback: random 4-char suffix (shouldn't happen in practice)
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return { finalSku: `${baseSku}-${randomSuffix}`, wasAdjusted: true };
}

/**
 * Preview list of SKUs that will be created, with collision resolution
 */
export function SkuPreviewList({ skuPreviews, existingSkus }: SkuPreviewListProps) {
  const resolvedSkus = useMemo(() => {
    const batchSkus = new Set<string>();
    const results: Array<{
      variant: string;
      label: string;
      baseSku: string;
      finalSku: string;
      wasAdjusted: boolean;
    }> = [];
    
    for (const preview of skuPreviews) {
      const { finalSku, wasAdjusted } = resolveSkuCollisions(
        preview.baseSku,
        existingSkus,
        batchSkus
      );
      batchSkus.add(finalSku.toUpperCase().trim());
      results.push({
        ...preview,
        finalSku,
        wasAdjusted,
      });
    }
    
    return results;
  }, [skuPreviews, existingSkus]);
  
  const hasAdjustments = resolvedSkus.some(s => s.wasAdjusted);
  
  if (skuPreviews.length === 0) {
    return (
      <div className="mt-4 p-4 border border-dashed rounded-lg bg-muted/20">
        <p className="text-sm text-muted-foreground text-center">
          Select packaging variants to preview SKUs
        </p>
      </div>
    );
  }
  
  return (
    <div className="mt-4 p-4 border rounded-lg bg-muted/20 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">SKU Preview</p>
        {hasAdjustments ? (
          <div className="flex items-center gap-1 text-xs text-warning">
            <AlertCircle className="h-3 w-3" />
            <span>Auto-adjusted for uniqueness</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3 w-3" />
            <span>All unique</span>
          </div>
        )}
      </div>
      
      <div className="space-y-1.5">
        {resolvedSkus.map((sku) => (
          <div 
            key={sku.variant} 
            className="flex items-center justify-between py-1"
          >
            <span className="text-xs text-muted-foreground">{sku.label}</span>
            <code className={`text-xs font-mono px-2 py-0.5 rounded ${
              sku.wasAdjusted 
                ? 'bg-warning/20 text-warning-foreground border border-warning/30' 
                : 'bg-muted'
            }`}>
              {sku.finalSku}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
