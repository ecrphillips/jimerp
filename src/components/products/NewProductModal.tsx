import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Check, AlertCircle } from 'lucide-react';
import { 
  generateProductCode, 
  generateRoastGroupCode, 
  buildSku, 
  PACKAGING_VARIANTS, 
  COMMON_ORIGINS,
  type PackagingVariantValue 
} from '@/lib/skuGenerator';

interface Client {
  id: string;
  name: string;
  client_code: string;
}

interface RoastGroup {
  roast_group: string;
  roast_group_code: string;
  is_blend: boolean;
  origin: string | null;
  blend_name: string | null;
  display_name: string | null;
}

interface NewProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RoastGroupMode = 'existing' | 'new';
type RoastGroupType = 'single_origin' | 'blend';
type LifecycleType = 'perennial' | 'seasonal';

export function NewProductModal({ open, onOpenChange }: NewProductModalProps) {
  const queryClient = useQueryClient();
  
  // Step 1: Client
  const [clientId, setClientId] = useState('');
  
  // Step 2: Roast Group
  const [roastGroupMode, setRoastGroupMode] = useState<RoastGroupMode>('existing');
  const [selectedRoastGroup, setSelectedRoastGroup] = useState('');
  
  // New roast group fields
  const [roastGroupType, setRoastGroupType] = useState<RoastGroupType>('single_origin');
  const [origin, setOrigin] = useState('');
  const [customOrigin, setCustomOrigin] = useState('');
  const [blendName, setBlendName] = useState('');
  const [newRoastGroupCode, setNewRoastGroupCode] = useState('');
  
  // Step 3: Product Name (suffix only)
  const [productSuffix, setProductSuffix] = useState('');
  
  // Step 4: Packaging variants
  const [selectedVariants, setSelectedVariants] = useState<Set<PackagingVariantValue>>(new Set());
  
  // Step 5: Price
  const [priceInput, setPriceInput] = useState('');
  
  // Step 6: Lifecycle
  const [lifecycle, setLifecycle] = useState<LifecycleType | null>(null);
  
  // Queries
  const { data: clients } = useQuery({
    queryKey: ['all-clients-with-code'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, client_code')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Client[];
    },
  });
  
  const { data: roastGroups } = useQuery({
    queryKey: ['active-roast-groups-with-code'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, roast_group_code, is_blend, origin, blend_name, display_name')
        .eq('is_active', true)
        .order('roast_group');
      if (error) throw error;
      return (data ?? []) as RoastGroup[];
    },
  });
  
  const { data: existingProducts } = useQuery({
    queryKey: ['existing-product-skus'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('sku, product_name');
      if (error) throw error;
      return data ?? [];
    },
  });
  
  // Derived values
  const selectedClient = useMemo(() => 
    clients?.find(c => c.id === clientId), 
    [clients, clientId]
  );
  
  const selectedRoastGroupData = useMemo(() => 
    roastGroups?.find(g => g.roast_group === selectedRoastGroup),
    [roastGroups, selectedRoastGroup]
  );
  
  const existingRoastGroupCodes = useMemo(() => 
    new Set(roastGroups?.map(g => g.roast_group_code) ?? []),
    [roastGroups]
  );
  
  const existingProductCodes = useMemo(() => {
    const codes = new Set<string>();
    existingProducts?.forEach(p => {
      if (p.sku) {
        const parts = p.sku.split('-');
        if (parts.length >= 3) {
          codes.add(parts[2]); // Product code is 3rd component
        }
      }
    });
    return codes;
  }, [existingProducts]);
  
  // Calculate roast group display name based on mode
  const roastGroupDisplayName = useMemo(() => {
    if (roastGroupMode === 'existing' && selectedRoastGroupData) {
      // Use display_name if set, otherwise fall back to formatted roast_group
      return selectedRoastGroupData.display_name?.trim() || selectedRoastGroupData.roast_group.replace(/_/g, ' ');
    }
    if (roastGroupMode === 'new') {
      if (roastGroupType === 'single_origin') {
        return origin === '__custom__' ? customOrigin : origin;
      }
      return blendName;
    }
    return '';
  }, [roastGroupMode, selectedRoastGroupData, roastGroupType, origin, customOrigin, blendName]);
  
  // Get the roast group code to use
  const effectiveRoastGroupCode = useMemo(() => {
    if (roastGroupMode === 'existing' && selectedRoastGroupData) {
      return selectedRoastGroupData.roast_group_code;
    }
    return newRoastGroupCode;
  }, [roastGroupMode, selectedRoastGroupData, newRoastGroupCode]);
  
  // Auto-suggest roast group code when creating new
  useEffect(() => {
    if (roastGroupMode === 'new') {
      const name = roastGroupType === 'single_origin' 
        ? (origin === '__custom__' ? customOrigin : origin)
        : blendName;
      if (name) {
        const suggested = generateRoastGroupCode(name, roastGroupType === 'blend', existingRoastGroupCodes);
        setNewRoastGroupCode(suggested);
      }
    }
  }, [roastGroupMode, roastGroupType, origin, customOrigin, blendName, existingRoastGroupCodes]);
  
  // Full product name
  const fullProductName = useMemo(() => {
    if (!roastGroupDisplayName || !productSuffix.trim()) return '';
    return `${roastGroupDisplayName} - ${productSuffix.trim()}`;
  }, [roastGroupDisplayName, productSuffix]);
  
  // Generate product code from suffix
  const productCode = useMemo(() => {
    if (!productSuffix.trim()) return '';
    return generateProductCode(productSuffix, existingProductCodes);
  }, [productSuffix, existingProductCodes]);
  
  // Generate SKU previews
  const skuPreviews = useMemo(() => {
    if (!selectedClient || !effectiveRoastGroupCode || !productCode) return [];
    
    return Array.from(selectedVariants).map(variantValue => {
      const variant = PACKAGING_VARIANTS.find(v => v.value === variantValue);
      if (!variant) return null;
      
      return {
        variant: variantValue,
        label: variant.label,
        sku: buildSku({
          clientCode: selectedClient.client_code,
          roastGroupCode: effectiveRoastGroupCode,
          productCode: productCode,
          variantCode: variant.code,
        }),
        bagSizeG: variant.bagSizeG,
      };
    }).filter(Boolean) as Array<{
      variant: PackagingVariantValue;
      label: string;
      sku: string;
      bagSizeG: number;
    }>;
  }, [selectedClient, effectiveRoastGroupCode, productCode, selectedVariants]);
  
  // Check for SKU collisions
  const skuCollisions = useMemo(() => {
    const existingSkus = new Set(existingProducts?.map(p => p.sku) ?? []);
    return skuPreviews.filter(p => existingSkus.has(p.sku));
  }, [skuPreviews, existingProducts]);
  
  // Validation
  const isRoastGroupCodeUnique = useMemo(() => {
    if (roastGroupMode === 'existing') return true;
    return !existingRoastGroupCodes.has(newRoastGroupCode);
  }, [roastGroupMode, newRoastGroupCode, existingRoastGroupCodes]);
  
  const canSave = useMemo(() => {
    if (!clientId) return false;
    if (roastGroupMode === 'existing' && !selectedRoastGroup) return false;
    if (roastGroupMode === 'new') {
      if (roastGroupType === 'single_origin' && !origin) return false;
      if (roastGroupType === 'single_origin' && origin === '__custom__' && !customOrigin.trim()) return false;
      if (roastGroupType === 'blend' && !blendName.trim()) return false;
      if (!newRoastGroupCode.trim()) return false;
      if (!isRoastGroupCodeUnique) return false;
    }
    if (!productSuffix.trim()) return false;
    if (selectedVariants.size === 0) return false;
    if (!lifecycle) return false;
    if (skuCollisions.length > 0) return false;
    return true;
  }, [clientId, roastGroupMode, selectedRoastGroup, roastGroupType, origin, customOrigin, blendName, newRoastGroupCode, isRoastGroupCodeUnique, productSuffix, selectedVariants, lifecycle, skuCollisions]);
  
  // Reset form
  const resetForm = () => {
    setClientId('');
    setRoastGroupMode('existing');
    setSelectedRoastGroup('');
    setRoastGroupType('single_origin');
    setOrigin('');
    setCustomOrigin('');
    setBlendName('');
    setNewRoastGroupCode('');
    setProductSuffix('');
    setSelectedVariants(new Set());
    setPriceInput('');
    setLifecycle(null);
  };
  
  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      let roastGroupName: string;
      let roastGroupCode: string;
      
      // Step 1: Create roast group if needed
      if (roastGroupMode === 'new') {
        const originValue = roastGroupType === 'single_origin' 
          ? (origin === '__custom__' ? customOrigin.trim() : origin)
          : null;
        const blendValue = roastGroupType === 'blend' ? blendName.trim() : null;
        
        roastGroupName = (originValue ?? blendValue ?? '').toUpperCase().replace(/\s+/g, '_');
        roastGroupCode = newRoastGroupCode.trim().toUpperCase();
        
        const { error: rgError } = await supabase
          .from('roast_groups')
          .insert({
            roast_group: roastGroupName,
            roast_group_code: roastGroupCode,
            is_blend: roastGroupType === 'blend',
            origin: originValue,
            blend_name: blendValue,
            standard_batch_kg: 20,
            expected_yield_loss_pct: 16,
            default_roaster: 'EITHER',
            is_active: true,
          });
        
        if (rgError) throw rgError;
      } else {
        roastGroupName = selectedRoastGroup;
        roastGroupCode = selectedRoastGroupData!.roast_group_code;
      }
      
      // Step 2: Create products for each variant
      // Treat blank price as 0.00 (not "no price")
      const priceValue = priceInput.trim() === '' ? 0 : parseFloat(priceInput);
      const hasPrice = !isNaN(priceValue);
      
      const productInserts = skuPreviews.map(preview => ({
        client_id: clientId,
        product_name: fullProductName,
        sku: preview.sku,
        roast_group: roastGroupName,
        packaging_variant: preview.variant as "RETAIL_250G" | "RETAIL_300G" | "RETAIL_340G" | "RETAIL_454G" | "CROWLER_200G" | "CROWLER_250G" | "CAN_125G" | "BULK_2LB" | "BULK_1KG" | "BULK_5LB" | "BULK_2KG",
        bag_size_g: preview.bagSizeG,
        format: 'WHOLE_BEAN' as const,
        grind_options: ['WHOLE_BEAN'] as ("WHOLE_BEAN" | "ESPRESSO" | "FILTER")[],
        is_active: true,
        is_perennial: lifecycle === 'perennial',
      }));
      
      const { data: createdProducts, error: prodError } = await supabase
        .from('products')
        .insert(productInserts)
        .select('id');
      
      if (prodError) throw prodError;
      
      // Step 3: Create prices if provided
      if (hasPrice && createdProducts) {
        const today = new Date().toISOString().split('T')[0];
        const priceInserts = createdProducts.map(p => ({
          product_id: p.id,
          unit_price: priceValue,
          currency: 'CAD',
          effective_date: today,
        }));
        
        const { error: priceError } = await supabase
          .from('price_list')
          .insert(priceInserts);
        
        if (priceError) {
          console.error('Price insert failed:', priceError);
          // Don't throw - products were created successfully
        }
      }
      
      return { count: productInserts.length, roastGroupDisplayName };
    },
    onSuccess: (result) => {
      toast.success(`Created ${result.count} product${result.count > 1 ? 's' : ''} under ${result.roastGroupDisplayName}`);
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      queryClient.invalidateQueries({ queryKey: ['active-roast-groups-with-code'] });
      queryClient.invalidateQueries({ queryKey: ['existing-product-skus'] });
      resetForm();
      onOpenChange(false);
    },
    onError: (err: any) => {
      console.error(err);
      if (err?.code === '23505') {
        toast.error('A product with this SKU already exists');
      } else {
        toast.error('Failed to create products');
      }
    },
  });
  
  const toggleVariant = (variant: PackagingVariantValue) => {
    setSelectedVariants(prev => {
      const next = new Set(prev);
      if (next.has(variant)) {
        next.delete(variant);
      } else {
        next.add(variant);
      }
      return next;
    });
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Product</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Step 1: Client */}
          <div>
            <Label htmlFor="client">1. Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="client">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {clients?.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.client_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Step 2: Roast Group */}
          <div className="space-y-3">
            <Label>2. Roast Group</Label>
            <RadioGroup 
              value={roastGroupMode} 
              onValueChange={(v) => setRoastGroupMode(v as RoastGroupMode)}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="existing" id="rg-existing" />
                <Label htmlFor="rg-existing" className="font-normal cursor-pointer">
                  Select existing
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="new" id="rg-new" />
                <Label htmlFor="rg-new" className="font-normal cursor-pointer">
                  Create new
                </Label>
              </div>
            </RadioGroup>
            
            {roastGroupMode === 'existing' && (
              <Select value={selectedRoastGroup || 'NONE'} onValueChange={(v) => setSelectedRoastGroup(v === 'NONE' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select roast group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Select roast group...</SelectItem>
                  {roastGroups?.map(g => (
                    <SelectItem key={g.roast_group} value={g.roast_group}>
                      {g.display_name?.trim() || g.roast_group.replace(/_/g, ' ')} ({g.roast_group_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            {roastGroupMode === 'new' && (
              <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                <div>
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <RadioGroup 
                    value={roastGroupType} 
                    onValueChange={(v) => setRoastGroupType(v as RoastGroupType)}
                    className="flex gap-4 mt-1"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="single_origin" id="type-so" />
                      <Label htmlFor="type-so" className="font-normal cursor-pointer">Single Origin</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="blend" id="type-blend" />
                      <Label htmlFor="type-blend" className="font-normal cursor-pointer">Blend</Label>
                    </div>
                  </RadioGroup>
                </div>
                
                {roastGroupType === 'single_origin' && (
                  <div>
                    <Label htmlFor="origin" className="text-xs text-muted-foreground">Origin</Label>
                    <Select value={origin || 'NONE'} onValueChange={(v) => setOrigin(v === 'NONE' ? '' : v)}>
                      <SelectTrigger id="origin">
                        <SelectValue placeholder="Select origin" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Select origin...</SelectItem>
                        {COMMON_ORIGINS.map(o => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                        <SelectItem value="__custom__">+ Add new origin</SelectItem>
                      </SelectContent>
                    </Select>
                    {origin === '__custom__' && (
                      <Input
                        className="mt-2"
                        placeholder="Enter origin name"
                        value={customOrigin}
                        onChange={(e) => setCustomOrigin(e.target.value)}
                      />
                    )}
                  </div>
                )}
                
                {roastGroupType === 'blend' && (
                  <div>
                    <Label htmlFor="blendName" className="text-xs text-muted-foreground">Blend Name</Label>
                    <Input
                      id="blendName"
                      placeholder="e.g. Medium Dark, House Blend"
                      value={blendName}
                      onChange={(e) => setBlendName(e.target.value)}
                    />
                  </div>
                )}
                
                <div>
                  <Label htmlFor="rgCode" className="text-xs text-muted-foreground">
                    Roast Group Code (3-6 chars, must be unique)
                  </Label>
                  <Input
                    id="rgCode"
                    placeholder="e.g. GUA, ETH, MDK"
                    value={newRoastGroupCode}
                    onChange={(e) => setNewRoastGroupCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6))}
                    className={!isRoastGroupCodeUnique ? 'border-destructive' : ''}
                  />
                  {!isRoastGroupCodeUnique && (
                    <p className="text-xs text-destructive mt-1">This code is already in use</p>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Step 3: Product Name */}
          <div>
            <Label>3. Finished Good Name</Label>
            <div className="flex items-center gap-2 mt-1">
              <div className="bg-muted px-3 py-2 rounded-l-md border border-r-0 text-sm font-medium min-w-[120px]">
                {roastGroupDisplayName || '(Roast Group)'}
              </div>
              <span className="text-muted-foreground">—</span>
              <Input
                placeholder="e.g. Hermanos, House Espresso"
                value={productSuffix}
                onChange={(e) => setProductSuffix(e.target.value)}
                className="flex-1"
              />
            </div>
            {fullProductName && (
              <p className="text-xs text-muted-foreground mt-1">
                Full name: <span className="font-medium">{fullProductName}</span>
              </p>
            )}
          </div>
          
          {/* Step 4: Packaging Variants */}
          <div>
            <Label>4. Packaging Variants (select all that apply)</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {PACKAGING_VARIANTS.map(v => (
                <label
                  key={v.value}
                  className={`flex items-center gap-2 p-2 border rounded-md cursor-pointer transition-colors ${
                    selectedVariants.has(v.value) 
                      ? 'bg-primary/10 border-primary' 
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <Checkbox
                    checked={selectedVariants.has(v.value)}
                    onCheckedChange={() => toggleVariant(v.value)}
                  />
                  <span className="text-sm">{v.label}</span>
                </label>
              ))}
            </div>
            
            {/* SKU Previews */}
            {skuPreviews.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs text-muted-foreground">Generated SKUs:</p>
                <div className="flex flex-wrap gap-2">
                  {skuPreviews.map(p => (
                    <Badge 
                      key={p.sku} 
                      variant={skuCollisions.some(c => c.sku === p.sku) ? 'destructive' : 'secondary'}
                      className="font-mono text-xs"
                    >
                      {p.sku}
                    </Badge>
                  ))}
                </div>
                {skuCollisions.length > 0 && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    Some SKUs already exist
                  </p>
                )}
              </div>
            )}
          </div>
          
          {/* Step 5: Price */}
          <div>
            <Label htmlFor="price">5. Initial Unit Price (CAD) — Optional</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 12.50"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Applied to all variants. Leave blank to set later.
            </p>
          </div>
          
          {/* Step 6: Lifecycle */}
          <div>
            <Label>6. Product Lifecycle</Label>
            <RadioGroup 
              value={lifecycle ?? ''} 
              onValueChange={(v) => setLifecycle(v as LifecycleType)}
              className="flex gap-6 mt-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="perennial" id="lc-perennial" />
                <Label htmlFor="lc-perennial" className="font-normal cursor-pointer">
                  Perennial
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="seasonal" id="lc-seasonal" />
                <Label htmlFor="lc-seasonal" className="font-normal cursor-pointer">
                  Seasonal
                </Label>
              </div>
            </RadioGroup>
            {!lifecycle && (
              <p className="text-xs text-destructive mt-1">Please select a lifecycle</p>
            )}
          </div>
          
          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>
              Cancel
            </Button>
            <Button 
              onClick={() => saveMutation.mutate()} 
              disabled={!canSave || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Creating…' : `Create ${selectedVariants.size} Product${selectedVariants.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
