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
import { AlertCircle, Plus, Trash2, ExternalLink, Info, Loader2, CheckCircle2 } from 'lucide-react';
import { PACKAGING_VARIANTS, type PackagingVariantValue } from '@/lib/skuGenerator';
import { generateShortCode, insertProductsWithUniqueSkus } from '@/lib/skuUtils';

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
  
  // Step 2: Single "Finished Good Name" (replaces blend name + suffix)
  const [finishedGoodName, setFinishedGoodName] = useState('');
  
  // Blend components
  const [components, setComponents] = useState<BlendComponent[]>([
    { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
    { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
  ]);
  
  // Optional Cropster ref
  const [cropsterProfileRef, setCropsterProfileRef] = useState('');
  
  // Step 3: Packaging variants
  const [selectedVariants, setSelectedVariants] = useState<Set<PackagingVariantValue>>(new Set());
  
  // Step 4: Price
  const [priceInput, setPriceInput] = useState('');
  
  // Step 5: Lifecycle
  const [lifecycle, setLifecycle] = useState<LifecycleType | null>(null);
  
  // Track adjusted SKUs after save
  const [adjustedSkus, setAdjustedSkus] = useState<string[]>([]);
  
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
  
  const { data: existingSkus } = useQuery({
    queryKey: ['existing-product-skus-set'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('sku');
      if (error) throw error;
      return new Set((data ?? []).map(p => p.sku?.toUpperCase().trim()).filter(Boolean));
    },
  });
  
  // Derived values
  const selectedClient = useMemo(() => 
    clients?.find(c => c.id === clientId), 
    [clients, clientId]
  );
  
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
  
  // Generate SKU previews (read-only, for display)
  const skuPreviews = useMemo(() => {
    if (!selectedClient || !finishedGoodName.trim()) return [];
    
    const productCode = generateShortCode(finishedGoodName.trim(), 6);
    
    return Array.from(selectedVariants).map(variantValue => {
      const variant = PACKAGING_VARIANTS.find(v => v.value === variantValue);
      if (!variant) return null;
      
      const baseSku = `${selectedClient.client_code}-${productCode}-${variant.code}`;
      
      return {
        variant: variantValue,
        label: variant.label,
        baseSku,
        bagSizeG: variant.bagSizeG,
      };
    }).filter(Boolean) as Array<{
      variant: PackagingVariantValue;
      label: string;
      baseSku: string;
      bagSizeG: number;
    }>;
  }, [selectedClient, finishedGoodName, selectedVariants]);
  
  const hasNoComponents = componentRoastGroups.length === 0;
  
  const canSave = useMemo(() => {
    if (!clientId) return false;
    if (!finishedGoodName.trim()) return false;
    if (hasNoComponents) return false;
    if (!allComponentsSelected) return false;
    if (!percentageValid) return false;
    if (selectedVariants.size === 0) return false;
    if (!lifecycle) return false;
    return true;
  }, [clientId, finishedGoodName, hasNoComponents, allComponentsSelected, percentageValid, selectedVariants, lifecycle]);
  
  // Reset form
  const resetForm = () => {
    setClientId('');
    setFinishedGoodName('');
    setCropsterProfileRef('');
    setComponents([
      { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
      { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
    ]);
    setSelectedVariants(new Set());
    setPriceInput('');
    setLifecycle(null);
    setAdjustedSkus([]);
  };
  
  // Component management
  const addComponent = () => {
    setComponents(prev => [...prev, { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 0 }]);
  };
  
  const removeComponent = (id: string) => {
    if (components.length <= 2) return;
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
      const trimmedName = finishedGoodName.trim();
      
      // Generate roast group key from FG name
      const roastGroupKey = trimmedName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      const roastGroupCode = generateShortCode(trimmedName, 6);
      
      // Try to create blend roast group with collision handling
      let finalRoastGroupKey = roastGroupKey;
      let rgSuccess = false;
      
      for (let attempt = 0; attempt < 50; attempt++) {
        const key = attempt === 0 ? roastGroupKey : `${roastGroupKey}_${attempt + 1}`;
        const code = attempt === 0 ? roastGroupCode : `${roastGroupCode}${attempt + 1}`.substring(0, 6);
        
        const { error: rgError } = await supabase
          .from('roast_groups')
          .insert({
            roast_group: key,
            roast_group_code: code,
            is_blend: true,
            origin: null,
            blend_name: trimmedName,
            display_name: trimmedName,
            standard_batch_kg: 20,
            expected_yield_loss_pct: 16,
            default_roaster: 'EITHER',
            is_active: true,
            cropster_profile_ref: cropsterProfileRef.trim() || null,
            notes: `Blend components: ${components.map(c => {
              const rg = componentRoastGroups.find(g => g.roast_group === c.roastGroup);
              return `${rg?.display_name || c.roastGroup} (${c.percentage}%)`;
            }).join(', ')}`,
          });
        
        if (!rgError) {
          finalRoastGroupKey = key;
          rgSuccess = true;
          break;
        }
        
        // If not a unique violation, throw
        if (rgError.code !== '23505') {
          throw rgError;
        }
        // Otherwise retry with suffix
      }
      
      if (!rgSuccess) {
        throw new Error('Could not create roast group after 50 attempts');
      }
      
      // Save blend components to roast_group_components table
      const componentInserts = components
        .filter(c => c.roastGroup) // Only include components with selected roast groups
        .map((c, idx) => ({
          parent_roast_group: finalRoastGroupKey,
          component_roast_group: c.roastGroup,
          pct: c.percentage,
          display_order: idx,
        }));
      
      if (componentInserts.length > 0) {
        const { error: componentsError } = await supabase
          .from('roast_group_components')
          .insert(componentInserts);
        
        if (componentsError) {
          console.error('Failed to save blend components:', componentsError);
          // Don't throw - the roast group was created, just log the error
        }
      }
      
      // Create products for each variant using auto-dedupe
      const priceValue = priceInput.trim() === '' ? 0 : parseFloat(priceInput);
      const hasPrice = !isNaN(priceValue);
      
      const productInserts = skuPreviews.map(preview => ({
        client_id: clientId,
        product_name: trimmedName,
        baseSku: preview.baseSku,
        roast_group: finalRoastGroupKey,
        packaging_variant: preview.variant,
        bag_size_g: preview.bagSizeG,
        format: 'WHOLE_BEAN',
        grind_options: ['WHOLE_BEAN'],
        is_active: true,
        is_perennial: lifecycle === 'perennial',
      }));
      
      const { created, errors } = await insertProductsWithUniqueSkus(supabase, productInserts);
      
      if (errors.length > 0) {
        console.error('Product creation errors:', errors);
        throw new Error(errors[0]);
      }
      
      // Track which SKUs were adjusted
      const adjusted = created.filter(c => c.wasAdjusted).map(c => c.sku);
      setAdjustedSkus(adjusted);
      
      // Create prices
      if (hasPrice && created.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const priceInserts = created.map(p => ({
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
      
      return { 
        count: created.length, 
        name: trimmedName, 
        adjustedCount: adjusted.length,
        adjustedSkus: adjusted,
      };
    },
    onSuccess: (result) => {
      let message = `Created ${result.count} product${result.count > 1 ? 's' : ''} for ${result.name}`;
      if (result.adjustedCount > 0) {
        message += ` (${result.adjustedCount} SKU${result.adjustedCount > 1 ? 's' : ''} auto-adjusted for uniqueness)`;
      }
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      queryClient.invalidateQueries({ queryKey: ['active-roast-groups-with-code'] });
      queryClient.invalidateQueries({ queryKey: ['existing-product-skus-set'] });
      resetForm();
      onOpenChange(false);
    },
    onError: (err: any) => {
      console.error('Save failed:', err);
      toast.error(err?.message || 'Failed to create blend products');
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
          
          {/* Step 2: Finished Good Name (simplified) */}
          <div>
            <Label htmlFor="fgName">2. Finished Good Name</Label>
            <Input
              id="fgName"
              placeholder="e.g. Technicolour Espresso, House Blend Filter"
              value={finishedGoodName}
              onChange={(e) => setFinishedGoodName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              This name appears on orders, pack lists, and shipping.
            </p>
          </div>
          
          {/* Step 3: Blend Components */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>3. Blend Components</Label>
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
          
          {/* Optional: Cropster Ref */}
          <div>
            <Label htmlFor="cropsterRef" className="text-muted-foreground">
              Cropster Profile Ref (optional)
            </Label>
            <Input
              id="cropsterRef"
              placeholder="e.g. R-1234 or profile name"
              value={cropsterProfileRef}
              onChange={(e) => setCropsterProfileRef(e.target.value)}
            />
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
            
            {/* SKU Previews (read-only) */}
            {skuPreviews.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs text-muted-foreground">SKU Preview (may be adjusted for uniqueness):</p>
                <div className="flex flex-wrap gap-2">
                  {skuPreviews.map(p => (
                    <Badge 
                      key={p.baseSku} 
                      variant="secondary"
                      className="font-mono text-xs"
                    >
                      {p.baseSku}
                    </Badge>
                  ))}
                </div>
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
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                `Create ${selectedVariants.size} Product${selectedVariants.size !== 1 ? 's' : ''}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
