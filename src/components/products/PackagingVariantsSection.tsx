import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, Package } from 'lucide-react';

interface PackagingType {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface PackagingVariantEntry {
  packagingTypeId: string;
  packagingTypeName: string;
  grams: number;
}

interface PackagingVariantsSectionProps {
  selectedVariants: PackagingVariantEntry[];
  onVariantsChange: (variants: PackagingVariantEntry[]) => void;
  stepNumber?: number;
}

// Common gram presets with helper buttons
const GRAM_PRESETS = [
  { label: '250g', grams: 250 },
  { label: '300g', grams: 300 },
  { label: '340g', grams: 340 },
  { label: '1 lb', grams: 454 },
  { label: '2 lb', grams: 908 },
  { label: '5 lb', grams: 2270 },
  { label: '1 kg', grams: 1000 },
];

/**
 * Format grams as a 5-digit zero-padded string for SKU suffix
 */
export function formatGramsSuffix(grams: number): string {
  return String(grams).padStart(5, '0');
}

export function PackagingVariantsSection({
  selectedVariants,
  onVariantsChange,
  stepNumber = 4,
}: PackagingVariantsSectionProps) {
  // Fetch packaging types
  const { data: packagingTypes, isLoading } = useQuery({
    queryKey: ['packaging-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaging_types')
        .select('id, name, display_order, is_active')
        .order('display_order');
      if (error) throw error;
      return (data ?? []) as PackagingType[];
    },
  });

  // Only show active types for selection (but inactive ones may still be visible on existing products)
  const activeTypes = useMemo(
    () => packagingTypes?.filter((t) => t.is_active) ?? [],
    [packagingTypes]
  );

  // Check if a type is selected
  const isTypeSelected = (typeId: string) =>
    selectedVariants.some((v) => v.packagingTypeId === typeId);

  // Get current grams for a type
  const getGramsForType = (typeId: string): number => {
    const variant = selectedVariants.find((v) => v.packagingTypeId === typeId);
    return variant?.grams ?? 0;
  };

  // Toggle a packaging type selection
  const toggleType = (type: PackagingType) => {
    if (isTypeSelected(type.id)) {
      // Remove it
      onVariantsChange(selectedVariants.filter((v) => v.packagingTypeId !== type.id));
    } else {
      // Add it with default 0 grams (user must specify)
      onVariantsChange([
        ...selectedVariants,
        { packagingTypeId: type.id, packagingTypeName: type.name, grams: 0 },
      ]);
    }
  };

  // Update grams for a type
  const updateGrams = (typeId: string, grams: number) => {
    onVariantsChange(
      selectedVariants.map((v) =>
        v.packagingTypeId === typeId ? { ...v, grams: Math.max(0, grams) } : v
      )
    );
  };

  // Check for validation errors
  const hasInvalidGrams = selectedVariants.some((v) => v.grams <= 0);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>{stepNumber}. Packaging Variants</Label>
        <p className="text-sm text-muted-foreground">Loading packaging types...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Label>{stepNumber}. Packaging Variants</Label>
      <p className="text-xs text-muted-foreground -mt-2">
        Select packaging types and specify grams per unit for each.
      </p>

      <div className="space-y-3">
        {activeTypes.map((type) => {
          const isSelected = isTypeSelected(type.id);
          const currentGrams = getGramsForType(type.id);

          return (
            <div
              key={type.id}
              className={`border rounded-lg p-3 transition-colors ${
                isSelected ? 'bg-primary/5 border-primary/50' : 'hover:bg-muted/30'
              }`}
            >
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleType(type)}
                />
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">{type.name}</span>
              </label>

              {isSelected && (
                <div className="mt-3 ml-7 space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground w-24">
                      Grams per unit:
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={currentGrams || ''}
                      onChange={(e) =>
                        updateGrams(type.id, parseInt(e.target.value) || 0)
                      }
                      placeholder="e.g. 340"
                      className="w-24 h-8 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">g</span>
                    {currentGrams <= 0 && (
                      <span className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Required
                      </span>
                    )}
                  </div>

                  {/* Quick preset buttons */}
                  <div className="flex flex-wrap gap-1">
                    {GRAM_PRESETS.map((preset) => (
                      <Button
                        key={preset.grams}
                        type="button"
                        variant={currentGrams === preset.grams ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => updateGrams(type.id, preset.grams)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedVariants.length > 0 && hasInvalidGrams && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          All selected variants must have grams greater than 0
        </p>
      )}

      {selectedVariants.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Select at least one packaging type to create products.
        </p>
      )}
    </div>
  );
}
