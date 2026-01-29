import React, { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, Package, Plus, X } from 'lucide-react';

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

  // Only show active types for selection
  const activeTypes = useMemo(
    () => packagingTypes?.filter((t) => t.is_active) ?? [],
    [packagingTypes]
  );

  // Check if a type has any variants
  const isTypeSelected = useCallback(
    (typeId: string) => selectedVariants.some((v) => v.packagingTypeId === typeId),
    [selectedVariants]
  );

  // Get all variants for a type
  const getVariantsForType = useCallback(
    (typeId: string) => selectedVariants.filter((v) => v.packagingTypeId === typeId),
    [selectedVariants]
  );

  // Check if a specific gram value exists for a type
  const hasGramsForType = useCallback(
    (typeId: string, grams: number) =>
      selectedVariants.some((v) => v.packagingTypeId === typeId && v.grams === grams),
    [selectedVariants]
  );

  // Toggle a packaging type selection (adds first row or removes all)
  const toggleType = useCallback(
    (type: PackagingType) => {
      if (isTypeSelected(type.id)) {
        // Remove all variants for this type
        onVariantsChange(selectedVariants.filter((v) => v.packagingTypeId !== type.id));
      } else {
        // Add first empty row
        onVariantsChange([
          ...selectedVariants,
          { packagingTypeId: type.id, packagingTypeName: type.name, grams: 0 },
        ]);
      }
    },
    [selectedVariants, onVariantsChange, isTypeSelected]
  );

  // Add a new size row for a type
  const addSizeRow = useCallback(
    (type: PackagingType, grams: number = 0) => {
      // Don't add duplicate grams (except 0 which is placeholder)
      if (grams > 0 && hasGramsForType(type.id, grams)) {
        return false; // Already exists
      }
      onVariantsChange([
        ...selectedVariants,
        { packagingTypeId: type.id, packagingTypeName: type.name, grams },
      ]);
      return true;
    },
    [selectedVariants, onVariantsChange, hasGramsForType]
  );

  // Remove a specific variant by type and grams
  const removeVariant = useCallback(
    (typeId: string, grams: number, index: number) => {
      // Find all variants for this type and remove the one at the specific index
      const typeVariants = selectedVariants.filter((v) => v.packagingTypeId === typeId);
      const otherVariants = selectedVariants.filter((v) => v.packagingTypeId !== typeId);
      
      // Remove the variant at the specified index within this type's variants
      const updatedTypeVariants = typeVariants.filter((_, i) => i !== index);
      
      onVariantsChange([...otherVariants, ...updatedTypeVariants]);
    },
    [selectedVariants, onVariantsChange]
  );

  // Update grams for a specific variant
  const updateGrams = useCallback(
    (typeId: string, oldGrams: number, newGrams: number, index: number) => {
      // Find the specific variant to update
      let typeIndex = 0;
      const updated = selectedVariants.map((v) => {
        if (v.packagingTypeId === typeId) {
          if (typeIndex === index) {
            typeIndex++;
            return { ...v, grams: Math.max(0, newGrams) };
          }
          typeIndex++;
        }
        return v;
      });
      onVariantsChange(updated);
    },
    [selectedVariants, onVariantsChange]
  );

  // Handle quick-pick click - adds new row with that gram value
  const handleQuickPick = useCallback(
    (type: PackagingType, grams: number) => {
      if (hasGramsForType(type.id, grams)) {
        // Already exists - could flash/highlight the existing one
        return;
      }
      // Check if there's an empty (0 grams) row to fill instead
      const emptyRowIndex = selectedVariants.findIndex(
        (v) => v.packagingTypeId === type.id && v.grams === 0
      );
      if (emptyRowIndex >= 0) {
        // Fill the empty row
        const updated = [...selectedVariants];
        updated[emptyRowIndex] = { ...updated[emptyRowIndex], grams };
        onVariantsChange(updated);
      } else {
        // Add new row
        addSizeRow(type, grams);
      }
    },
    [selectedVariants, hasGramsForType, addSizeRow, onVariantsChange]
  );

  // Check for validation errors
  const hasInvalidGrams = selectedVariants.some((v) => v.grams <= 0);

  // Check for duplicate grams within same type
  const hasDuplicates = useMemo(() => {
    const seen = new Map<string, Set<number>>();
    for (const v of selectedVariants) {
      if (v.grams <= 0) continue;
      if (!seen.has(v.packagingTypeId)) {
        seen.set(v.packagingTypeId, new Set());
      }
      const typeSet = seen.get(v.packagingTypeId)!;
      if (typeSet.has(v.grams)) {
        return true;
      }
      typeSet.add(v.grams);
    }
    return false;
  }, [selectedVariants]);

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
        Select packaging types and add sizes. Multiple sizes per type are supported.
      </p>

      <div className="space-y-3">
        {activeTypes.map((type) => {
          const isSelected = isTypeSelected(type.id);
          const typeVariants = getVariantsForType(type.id);

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
                {isSelected && typeVariants.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {typeVariants.filter((v) => v.grams > 0).length} size
                    {typeVariants.filter((v) => v.grams > 0).length !== 1 ? 's' : ''}
                  </span>
                )}
              </label>

              {isSelected && (
                <div className="mt-3 ml-7 space-y-3">
                  {/* Size rows */}
                  <div className="space-y-2">
                    {typeVariants.map((variant, index) => (
                      <div
                        key={`${variant.packagingTypeId}-${index}`}
                        className="flex items-center gap-2"
                      >
                        <Input
                          type="number"
                          min={1}
                          value={variant.grams || ''}
                          onChange={(e) =>
                            updateGrams(
                              type.id,
                              variant.grams,
                              parseInt(e.target.value) || 0,
                              index
                            )
                          }
                          placeholder="grams"
                          className="w-24 h-8 text-sm"
                        />
                        <span className="text-xs text-muted-foreground">g</span>
                        {variant.grams <= 0 && (
                          <span className="text-xs text-destructive flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Required
                          </span>
                        )}
                        {typeVariants.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeVariant(type.id, variant.grams, index)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Add another size button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => addSizeRow(type)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add another size
                  </Button>

                  {/* Quick preset buttons */}
                  <div className="flex flex-wrap gap-1">
                    {GRAM_PRESETS.map((preset) => {
                      const exists = hasGramsForType(type.id, preset.grams);
                      return (
                        <Button
                          key={preset.grams}
                          type="button"
                          variant={exists ? 'secondary' : 'outline'}
                          size="sm"
                          className={`h-6 px-2 text-xs ${
                            exists ? 'opacity-60' : ''
                          }`}
                          onClick={() => handleQuickPick(type, preset.grams)}
                          disabled={exists}
                        >
                          {preset.label}
                          {exists && ' ✓'}
                        </Button>
                      );
                    })}
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

      {hasDuplicates && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Duplicate gram values within the same packaging type are not allowed
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
