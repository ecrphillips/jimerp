import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AlertCircle, Plus, Trash2, ExternalLink, Info } from 'lucide-react';
import { 
  generateProductCode, 
  generateRoastGroupCode, 
  buildSku, 
  PACKAGING_VARIANTS, 
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

interface BlendComponent {
  id: string;
  roastGroup: string;
  percentage: number;
}

interface NewBlendProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type LifecycleType = 'perennial' | 'seasonal';

let componentIdCounter = 0;

export function NewBlendProductModal({ open, onOpenChange }: NewBlendProductModalProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  
  // Step 1: Client
  const [clientId, setClientId] = useState('');
  
  // Step 2: Blend definition
  const [blendName, setBlendName] = useState('');
  const [newRoastGroupCode, setNewRoastGroupCode] = useState('');
  const [newCropsterProfileRef, setNewCropsterProfileRef] = useState('');
  const [components, setComponents] = useState<BlendComponent[]>([
    { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
    { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
  ]);
  
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
  
  // Filter to only single origin roast groups for component selection
  const componentRoastGroups = useMemo(() => 
    roastGroups?.filter(g => !g.is_blend) ?? [],
    [roastGroups]
  );
  
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
          codes.add(parts[2]);
        }
      }
    });
    return codes;
  }, [existingProducts]);
  
  // Auto-suggest roast group code when blend name changes
  useEffect(() => {
    if (blendName.trim()) {
      const suggested = generateRoastGroupCode(blendName, true, existingRoastGroupCodes);
      setNewRoastGroupCode(suggested);
    }
  }, [blendName, existingRoastGroupCodes]);
  
  // Component percentage total
  const totalPercentage = useMemo(() => 
    components.reduce((sum, c) => sum + (c.percentage || 0), 0),
    [components]
  );
  
  const percentageValid = totalPercentage === 100;
  
  // Check if all components have roast groups selected
  const allComponentsSelected = useMemo(() => 
    components.every(c => c.roastGroup),
    [components]
  );
  
  // Full product name
  const fullProductName = useMemo(() => {
    if (!blendName.trim() || !productSuffix.trim()) return '';
    return `${blendName.trim()} - ${productSuffix.trim()}`;
  }, [blendName, productSuffix]);
  
  // Generate product code from suffix
  const productCode = useMemo(() => {
    if (!productSuffix.trim()) return '';
    return generateProductCode(productSuffix, existingProductCodes);
  }, [productSuffix, existingProductCodes]);
  
  // Generate SKU previews
  const skuPreviews = useMemo(() => {
    if (!selectedClient || !newRoastGroupCode || !productCode) return [];
    
    return Array.from(selectedVariants).map(variantValue => {
      const variant = PACKAGING_VARIANTS.find(v => v.value === variantValue);
      if (!variant) return null;
      
      return {
        variant: variantValue,
        label: variant.label,
        sku: buildSku({
          clientCode: selectedClient.client_code,
          roastGroupCode: newRoastGroupCode,
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
  }, [selectedClient, newRoastGroupCode, productCode, selectedVariants]);
  
  // Check for SKU collisions
  const skuCollisions = useMemo(() => {
    const existingSkus = new Set(existingProducts?.map(p => p.sku) ?? []);
    return skuPreviews.filter(p => existingSkus.has(p.sku));
  }, [skuPreviews, existingProducts]);
  
  // Validation
  const isRoastGroupCodeUnique = !existingRoastGroupCodes.has(newRoastGroupCode);
  
  const hasNoComponents = componentRoastGroups.length === 0;
  
  const canSave = useMemo(() => {
    if (!clientId) return false;
    if (!blendName.trim()) return false;
    if (!newRoastGroupCode.trim()) return false;
    if (!isRoastGroupCodeUnique) return false;
    if (hasNoComponents) return false;
    if (!allComponentsSelected) return false;
    if (!percentageValid) return false;
    if (!productSuffix.trim()) return false;
    if (selectedVariants.size === 0) return false;
    if (!lifecycle) return false;
    if (skuCollisions.length > 0) return false;
    return true;
  }, [clientId, blendName, newRoastGroupCode, isRoastGroupCodeUnique, hasNoComponents, allComponentsSelected, percentageValid, productSuffix, selectedVariants, lifecycle, skuCollisions]);
  
  // Reset form
  const resetForm = () => {
    setClientId('');
    setBlendName('');
    setNewRoastGroupCode('');
    setNewCropsterProfileRef('');
    setComponents([
      { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
      { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
    ]);
    setProductSuffix('');
    setSelectedVariants(new Set());
    setPriceInput('');
    setLifecycle(null);
  };
  
  // Component management
  const addComponent = () => {
    setComponents(prev => [...prev, { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 0 }]);
  };
  
  const removeComponent = (id: string) => {
    if (components.length <= 2) return; // Minimum 2 components
    setComponents(prev => prev.filter(c => c.id !== id));
  };
  
  const updateComponent = (id: string, field: 'roastGroup' | 'percentage', value: string | number) => {
    setComponents(prev => prev.map(c => 
      c.id === id ? { ...c, [field]: value } : c
    ));
  };
  
  // Navigate to roast groups tab
  const goToRoastGroups = () => {
    onOpenChange(false);
    setSearchParams({ tab: 'roast-groups' });
  };
  
  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const roastGroupName = blendName.trim().toUpperCase().replace(/\s+/g, '_');
      const roastGroupCode = newRoastGroupCode.trim().toUpperCase();
      
      // Create blend roast group
      const { error: rgError } = await supabase
        .from('roast_groups')
        .insert({
          roast_group: roastGroupName,
          roast_group_code: roastGroupCode,
          is_blend: true,
          origin: null,
          blend_name: blendName.trim(),
          display_name: blendName.trim(),
          standard_batch_kg: 20,
          expected_yield_loss_pct: 16,
          default_roaster: 'EITHER',
          is_active: true,
          cropster_profile_ref: newCropsterProfileRef.trim() || null,
          // Note: blend components stored in notes for now (could be a separate table in future)
          notes: `Blend components: ${components.map(c => {
            const rg = componentRoastGroups.find(g => g.roast_group === c.roastGroup);
            return `${rg?.display_name || c.roastGroup} (${c.percentage}%)`;
          }).join(', ')}`,
        });
      
      if (rgError) throw rgError;
      
      // Create products for each variant
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
      
      // Create prices
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
        }
      }
      
      return { count: productInserts.length, blendName: blendName.trim() };
    },
    onSuccess: (result) => {
      toast.success(`Created ${result.count} product${result.count > 1 ? 's' : ''} for ${result.blendName}`);
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
        toast.error('Failed to create blend products');
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
  
  const getDisplayName = (rg: RoastGroup) => 
    rg.display_name?.trim() || rg.roast_group.replace(/_/g, ' ');
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Blend Product</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Guidance message */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Post-roast blends require roast groups for each component coffee. 
              {hasNoComponents && ' Create component roast groups first, then return here to build the blend.'}
            </AlertDescription>
          </Alert>
          
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
          
          {/* Step 2: Blend Definition */}
          <div className="space-y-4">
            <Label>2. Blend Definition</Label>
            
            <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
              <div>
                <Label htmlFor="blendName" className="text-xs text-muted-foreground">Blend Name</Label>
                <Input
                  id="blendName"
                  placeholder="e.g. House Espresso, Technicolour"
                  value={blendName}
                  onChange={(e) => setBlendName(e.target.value)}
                />
              </div>
              
              <div>
                <Label htmlFor="rgCode" className="text-xs text-muted-foreground">
                  Blend Code (3-6 chars, must be unique)
                </Label>
                <Input
                  id="rgCode"
                  placeholder="e.g. HSE, TCH"
                  value={newRoastGroupCode}
                  onChange={(e) => setNewRoastGroupCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6))}
                  className={!isRoastGroupCodeUnique ? 'border-destructive' : ''}
                />
                {!isRoastGroupCodeUnique && (
                  <p className="text-xs text-destructive mt-1">This code is already in use</p>
                )}
              </div>
              
              <div>
                <Label htmlFor="cropsterRef" className="text-xs text-muted-foreground">
                  Cropster Profile Ref (optional)
                </Label>
                <Input
                  id="cropsterRef"
                  placeholder="e.g. R-1234 or profile name"
                  value={newCropsterProfileRef}
                  onChange={(e) => setNewCropsterProfileRef(e.target.value)}
                />
              </div>
            </div>
            
            {/* Component roast groups */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Blend Components</Label>
                <div className={`text-xs font-medium ${percentageValid ? 'text-green-600' : 'text-destructive'}`}>
                  Total: {totalPercentage}%
                </div>
              </div>
              
              {hasNoComponents ? (
                <div className="border rounded-lg p-6 text-center space-y-3 bg-muted/20">
                  <p className="text-sm text-muted-foreground">
                    No single origin roast groups available.
                  </p>
                  <Button variant="outline" size="sm" onClick={goToRoastGroups}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Go to Roast Groups
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {components.map((comp, idx) => (
                      <div key={comp.id} className="flex items-center gap-2">
                        <Select 
                          value={comp.roastGroup || 'NONE'} 
                          onValueChange={(v) => updateComponent(comp.id, 'roastGroup', v === 'NONE' ? '' : v)}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select component..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">Select component...</SelectItem>
                            {componentRoastGroups.map(g => (
                              <SelectItem key={g.roast_group} value={g.roast_group}>
                                {getDisplayName(g)} ({g.roast_group_code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1 w-24">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={comp.percentage}
                            onChange={(e) => updateComponent(comp.id, 'percentage', parseInt(e.target.value) || 0)}
                            className="w-16 text-center"
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeComponent(comp.id)}
                          disabled={components.length <= 2}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addComponent}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Component
                  </Button>
                  
                  {!percentageValid && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Percentages must total exactly 100%
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* Step 3: Product Name */}
          <div>
            <Label>3. Finished Good Name</Label>
            <div className="flex items-center gap-2 mt-1">
              <div className="bg-muted px-3 py-2 rounded-l-md border border-r-0 text-sm font-medium min-w-[120px]">
                {blendName.trim() || '(Blend Name)'}
              </div>
              <span className="text-muted-foreground">—</span>
              <Input
                placeholder="e.g. Espresso, Filter Roast"
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
              Applied to all variants. Leave blank to default to $0.00.
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
