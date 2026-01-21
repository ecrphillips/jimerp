import React from 'react';
import { Package, Coffee, Archive } from 'lucide-react';

export type PackagingVariant =
  | 'RETAIL_250G'
  | 'RETAIL_300G'
  | 'RETAIL_340G'
  | 'RETAIL_454G'
  | 'CROWLER_200G'
  | 'CROWLER_250G'
  | 'CAN_125G'
  | 'BULK_2LB'
  | 'BULK_1KG'
  | 'BULK_5LB'
  | 'BULK_2KG';

interface PackagingBadgeProps {
  variant: PackagingVariant | null | undefined;
  className?: string;
}

const PACKAGING_CONFIG: Record<PackagingVariant, { type: string; weight: string; icon: 'package' | 'can' | 'bulk' }> = {
  RETAIL_250G: { type: 'RETAIL', weight: '250g', icon: 'package' },
  RETAIL_300G: { type: 'RETAIL', weight: '300g', icon: 'package' },
  RETAIL_340G: { type: 'RETAIL', weight: '340g', icon: 'package' },
  RETAIL_454G: { type: 'RETAIL', weight: '454g', icon: 'package' },
  CROWLER_200G: { type: 'CROWLER', weight: '200g', icon: 'can' },
  CROWLER_250G: { type: 'CROWLER', weight: '250g', icon: 'can' },
  CAN_125G: { type: 'CAN', weight: '125g', icon: 'can' },
  BULK_2LB: { type: 'BULK', weight: '2lb', icon: 'bulk' },
  BULK_1KG: { type: 'BULK', weight: '1kg', icon: 'bulk' },
  BULK_5LB: { type: 'BULK', weight: '5lb', icon: 'bulk' },
  BULK_2KG: { type: 'BULK', weight: '2kg', icon: 'bulk' },
};

export const PACKAGING_OPTIONS: { value: PackagingVariant; label: string }[] = [
  { value: 'RETAIL_250G', label: 'Retail bag – 250g' },
  { value: 'RETAIL_300G', label: 'Retail bag – 300g' },
  { value: 'RETAIL_340G', label: 'Retail bag – 340g' },
  { value: 'RETAIL_454G', label: 'Retail bag – 454g' },
  { value: 'CROWLER_200G', label: 'Crowler can – 200g' },
  { value: 'CROWLER_250G', label: 'Crowler can – 250g' },
  { value: 'CAN_125G', label: 'Can – 125g' },
  { value: 'BULK_2LB', label: 'Bulk – 2lb' },
  { value: 'BULK_1KG', label: 'Bulk – 1kg' },
  { value: 'BULK_5LB', label: 'Bulk – 5lb' },
  { value: 'BULK_2KG', label: 'Bulk – 2kg' },
];

const IconComponent: React.FC<{ icon: 'package' | 'can' | 'bulk'; className?: string }> = ({ icon, className }) => {
  switch (icon) {
    case 'package':
      return <Package className={className} />;
    case 'can':
      return <Coffee className={className} />;
    case 'bulk':
      return <Archive className={className} />;
  }
};

export const PackagingBadge: React.FC<PackagingBadgeProps> = ({ variant, className = '' }) => {
  if (!variant) return null;

  const config = PACKAGING_CONFIG[variant];
  if (!config) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium border rounded bg-muted text-foreground print:bg-transparent print:border-foreground ${className}`}
    >
      <IconComponent icon={config.icon} className="w-3 h-3" />
      <span>{config.weight}</span>
      <span className="uppercase">{config.type}</span>
    </span>
  );
};

export default PackagingBadge;
