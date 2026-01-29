import React from 'react';
import { Package, Coffee, Archive } from 'lucide-react';

interface GramPackagingBadgeProps {
  packagingTypeName: string | null | undefined;
  gramsPerUnit: number | null | undefined;
  className?: string;
  showTypeName?: boolean;
}

/**
 * Format grams to a human-readable size label
 * - < 1000g: show as Xg (e.g. 300g, 454g)
 * - >= 1000g: show as X.Xkg or Xlb for common weights
 */
export function formatGramsLabel(grams: number): string {
  // Common lb conversions for display
  const lbConversions: Record<number, string> = {
    454: '1 lb',
    908: '2 lb',
    2270: '5 lb',
    4540: '10 lb',
  };
  
  if (lbConversions[grams]) {
    return lbConversions[grams];
  }
  
  // Common kg conversions
  if (grams === 1000) return '1 kg';
  if (grams === 2000) return '2 kg';
  if (grams === 5000) return '5 kg';
  
  // Default: show as grams
  return `${grams}g`;
}

/**
 * Get icon based on packaging type name
 */
function getPackagingIcon(typeName: string): React.ComponentType<{ className?: string }> {
  const lower = typeName.toLowerCase();
  if (lower.includes('can') || lower.includes('crowler')) {
    return Coffee;
  }
  if (lower.includes('bulk')) {
    return Archive;
  }
  return Package;
}

/**
 * Badge component for gram-based packaging
 * Displays packaging type icon + size label
 */
export const GramPackagingBadge: React.FC<GramPackagingBadgeProps> = ({ 
  packagingTypeName, 
  gramsPerUnit,
  className = '',
  showTypeName = true,
}) => {
  if (!packagingTypeName || !gramsPerUnit) return null;

  const IconComponent = getPackagingIcon(packagingTypeName);
  const sizeLabel = formatGramsLabel(gramsPerUnit);

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium border rounded bg-muted text-foreground print:bg-transparent print:border-foreground ${className}`}
    >
      <IconComponent className="w-3 h-3" />
      <span>{sizeLabel}</span>
      {showTypeName && (
        <span className="text-muted-foreground">{packagingTypeName}</span>
      )}
    </span>
  );
};

export default GramPackagingBadge;
