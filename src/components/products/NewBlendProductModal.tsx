import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AlertCircle, Plus, Trash2, ExternalLink, Info, Loader2 } from 'lucide-react';
import { createOrReuseRoastGroup } from '@/lib/roastGroupCreation';
import { RoastGroupPreview } from './RoastGroupPreview';
import { PackagingVariantsSection, type PackagingVariantEntry } from './PackagingVariantsSection';
import { GramBasedSkuPreview, getResolvedSkus } from './GramBasedSkuPreview';

interface Client {
  id: string;
  account_name: string;
  account_code: string | null;
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
  const [, setSearchParams] = useSearchParams();
  
  // Step 1: Client
  const [clientId, setClientId] = useState('');
  
  // Step 2: Finished Good Name
  const [finishedGoodName, setFinishedGoodName] = useState('');
  
  // Blend components
  const [components, setComponents] = useState<BlendComponent[]>([
    { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
    { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
  ]);
  
  // Optional Cropster ref
  const [cropsterProfileRef, setCropsterProfileRef] = useState('');
  
  // Step 3: Packaging variants (new gram-based system)
  const [packagingVariants, setPackagingVariants] = useState<PackagingVariantEntry[]>([]);
  
  // Step 4: Price
  const [priceInput, setPriceInput] = useState('');
  
  // Step 5: Lifecycle
  const [lifecycle, setLifecycle] = useState<LifecycleType | null>(null);
  
  // Queries
  const { data: clients } = useQuery({
    queryKey: ['all-accounts-with-code'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('is_active', true)
        .order('account_name');
      if (error) throw error;
      return (data ?? []).map((a: any) => ({ id: a.id, account_name: a.account_name, client_code: a.account_name.substring(0, 4).toUpperCase() })) as Client[];
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
  
  // Existing roast group keys/codes for collision detection
  const existingRoastGroupKeys = useMemo(() => 
    new Set(roastGroups?.map(g => g.roast_group.toUpperCase()) ?? []),
    [roastGroups]
  );
  
  const existingRoastGroupCodes = useMemo(() => 
    new Set(roastGroups?.map(g => g.roast_group_code.toUpperCase()) ?? []),
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
  
  // Valid variants (with grams > 0)
  const validVariants = useMemo(() => 
    packagingVariants.filter(v => v.grams > 0),
    [packagingVariants]
  );
  
  const hasNoComponents = componentRoastGroups.length === 0;
  
  const canSave = useMemo(() => {
    if (!clientId) return false;
    if (!finishedGoodName.trim()) return false;
    if (hasNoComponents) return false;
    if (!allComponentsSelected) return false;
    if (!percentageValid) return false;
    if (validVariants.length === 0) return false;
    if (!lifecycle) return false;
    return true;
  }, [clientId, finishedGoodName, hasNoComponents, allComponentsSelected, percentageValid, validVariants, lifecycle]);
  
  // Reset form
  const resetForm = () => {
    setClientId('');
    setFinishedGoodName('');
    setCropsterProfileRef('');
    setComponents([
      { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
      { id: `comp-${++componentIdCounter}`, roastGroup: '', percentage: 50 },
    ]);
    setPackagingVariants([]);
    setPriceInput('');
    setLifecycle(null);
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
      if (!selectedClient) throw new Error('Client is required');
      
      // Build blend notes from components
      const blendNotes = `Blend components: ${components.map(c => {
        const rg = componentRoastGroups.find(g => g.roast_group === c.roastGroup);
        return `${rg?.display_name || c.roastGroup} (${c.percentage}%)`;
      }).join(', ')}`;
      
      // Create or reuse blend roast group (single attempt, no retries)
      const result = await createOrReuseRoastGroup({
        displayName: trimmedName,
        isBlend: true,
        blendName: trimmedName,
        cropsterProfileRef: cropsterProfileRef.trim() || null,
        notes: blendNotes,
      });
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      const finalRoastGroupKey = result.roastGroupKey;
      
      if (!result.created) {
        console.log(`[Blend] Reusing existing roast group: ${finalRoastGroupKey}`);
      }
      
      // Save blend components
      const componentInserts = components
        .filter(c => c.roastGroup)
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
        }
      }
      
      // Get resolved SKUs - for blends, use 'BLD' as origin
      const resolvedSkus = getResolvedSkus(
        selectedClient.client_code,
        undefined, // No origin for blends
        true, // Is a blend
        trimmedName, // Use the full FG name for blends
        validVariants,
        existingSkus ?? new Set()
      );
      
      // Create products
      const priceValue = priceInput.trim() === '' ? 0 : parseFloat(priceInput);
      const hasPrice = !isNaN(priceValue);
      
      const createdProducts: Array<{ id: string; sku: string; wasAdjusted: boolean }> = [];
      
      for (const skuData of resolvedSkus) {
        const { data: newProduct, error } = await supabase
          .from('products')
          .insert({
            account_id: clientId,
            product_name: trimmedName,
            sku: skuData.sku,
            roast_group: finalRoastGroupKey,
            packaging_type_id: skuData.packagingTypeId,
            grams_per_unit: skuData.grams,
            bag_size_g: skuData.grams,
            format: 'WHOLE_BEAN',
            grind_options: ['WHOLE_BEAN'],
            is_active: true,
            is_perennial: lifecycle === 'perennial',
          })
          .select('id, sku')
          .single();
        
        if (error) {
          if (error.code === '23505' && error.message?.toLowerCase().includes('sku')) {
            for (let i = 2; i <= 50; i++) {
              const fallbackSku = `${skuData.sku}-${i}`;
              const { data: retryProduct, error: retryError } = await supabase
                .from('products')
                .insert({
                  account_id: clientId,
                  product_name: trimmedName,
                  sku: fallbackSku,
                  roast_group: finalRoastGroupKey,
                  packaging_type_id: skuData.packagingTypeId,
                  grams_per_unit: skuData.grams,
                  bag_size_g: skuData.grams,
                  format: 'WHOLE_BEAN',
                  grind_options: ['WHOLE_BEAN'],
                  is_active: true,
                  is_perennial: lifecycle === 'perennial',
                })
                .select('id, sku')
                .single();
              
              if (!retryError) {
                createdProducts.push({ id: retryProduct.id, sku: retryProduct.sku, wasAdjusted: true });
                break;
              }
              if (retryError.code !== '23505') {
                throw retryError;
              }
            }
          } else {
            throw error;
          }
        } else {
          createdProducts.push({ id: newProduct.id, sku: newProduct.sku, wasAdjusted: skuData.wasAdjusted });
        }
      }
      
      const adjustedCount = createdProducts.filter(c => c.wasAdjusted).length;
      
      // Create prices
      if (hasPrice && createdProducts.length > 0) {
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
      
      return { 
        count: createdProducts.length, 
        name: trimmedName, 
        adjustedCount,
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
                    {c.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Step 2: Finished Good Name */}
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
              <div className={`text-xs font-medium ${percentageValid ? 'text-primary' : 'text-destructive'}`}>
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
                  {components.map((comp) => (
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
          
          {/* Step 4: Packaging Variants (new gram-based section) */}
          <PackagingVariantsSection
            selectedVariants={packagingVariants}
            onVariantsChange={setPackagingVariants}
            stepNumber={4}
          />
          
          {/* Roast Group Preview */}
          {finishedGoodName.trim() && (
            <RoastGroupPreview
              displayName={finishedGoodName.trim()}
              existingKeys={existingRoastGroupKeys}
              existingCodes={existingRoastGroupCodes}
            />
          )}
          
          {/* SKU Preview Section */}
          <GramBasedSkuPreview
            clientCode={selectedClient?.client_code ?? ''}
            isBlend={true}
            fgNameSuffix={finishedGoodName.trim()}
            variants={validVariants}
            existingSkus={existingSkus ?? new Set()}
          />
          
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
                `Create ${validVariants.length} Product${validVariants.length !== 1 ? 's' : ''}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
