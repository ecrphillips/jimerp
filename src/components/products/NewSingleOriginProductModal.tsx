import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { COMMON_ORIGINS } from '@/lib/skuGenerator';
import { generateShortCode } from '@/lib/skuUtils';
import { RoastGroupPreview } from './RoastGroupPreview';
import { PackagingVariantsSection, type PackagingVariantEntry } from './PackagingVariantsSection';
import { GramBasedSkuPreview, getResolvedSkus } from './GramBasedSkuPreview';

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

interface NewSingleOriginProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RoastGroupMode = 'existing' | 'new';
type LifecycleType = 'perennial' | 'seasonal';

export function NewSingleOriginProductModal({ open, onOpenChange }: NewSingleOriginProductModalProps) {
  const queryClient = useQueryClient();
  
  // Step 1: Client
  const [clientId, setClientId] = useState('');
  
  // Step 2: Roast Group
  const [roastGroupMode, setRoastGroupMode] = useState<RoastGroupMode>('existing');
  const [selectedRoastGroup, setSelectedRoastGroup] = useState('');
  
  // New roast group fields
  const [origin, setOrigin] = useState('');
  const [customOrigin, setCustomOrigin] = useState('');
  const [cropsterProfileRef, setCropsterProfileRef] = useState('');
  
  // Step 3: Finished Good Name
  const [finishedGoodName, setFinishedGoodName] = useState('');
  
  // Step 4: Packaging variants (new gram-based system)
  const [packagingVariants, setPackagingVariants] = useState<PackagingVariantEntry[]>([]);
  
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
  
  // Fetch existing SKUs for collision detection
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
  
  // Fetch existing roast group keys/codes for collision detection
  const existingRoastGroupKeys = useMemo(() => 
    new Set(roastGroups?.map(g => g.roast_group.toUpperCase()) ?? []),
    [roastGroups]
  );
  
  const existingRoastGroupCodes = useMemo(() => 
    new Set(roastGroups?.map(g => g.roast_group_code.toUpperCase()) ?? []),
    [roastGroups]
  );
  
  // Filter to only single origin roast groups for selection
  const singleOriginRoastGroups = useMemo(() => 
    roastGroups?.filter(g => !g.is_blend) ?? [],
    [roastGroups]
  );
  
  // Derived values
  const selectedClient = useMemo(() => 
    clients?.find(c => c.id === clientId), 
    [clients, clientId]
  );
  
  // Get the origin prefix for new roast group mode
  const originPrefix = useMemo(() => {
    if (roastGroupMode !== 'new') return '';
    if (!origin) return '';
    return origin === '__custom__' ? customOrigin.trim() : origin;
  }, [roastGroupMode, origin, customOrigin]);
  
  // Full finished good display name (combines origin prefix + user input)
  const fullFinishedGoodName = useMemo(() => {
    const userPart = finishedGoodName.trim();
    if (!userPart) return '';
    
    if (roastGroupMode === 'new' && originPrefix) {
      return `${originPrefix} - ${userPart}`;
    }
    return userPart;
  }, [roastGroupMode, originPrefix, finishedGoodName]);

  // Product code for SKU generation
  const productCode = useMemo(() => {
    if (!fullFinishedGoodName) return '';
    return generateShortCode(fullFinishedGoodName, 6);
  }, [fullFinishedGoodName]);

  // Valid variants (with grams > 0)
  const validVariants = useMemo(() => 
    packagingVariants.filter(v => v.grams > 0),
    [packagingVariants]
  );
  
  const canSave = useMemo(() => {
    if (!clientId) return false;
    if (roastGroupMode === 'existing' && !selectedRoastGroup) return false;
    if (roastGroupMode === 'new') {
      if (!origin) return false;
      if (origin === '__custom__' && !customOrigin.trim()) return false;
    }
    if (!finishedGoodName.trim()) return false;
    if (validVariants.length === 0) return false;
    if (!lifecycle) return false;
    return true;
  }, [clientId, roastGroupMode, selectedRoastGroup, origin, customOrigin, finishedGoodName, validVariants, lifecycle]);
  
  // Reset form
  const resetForm = () => {
    setClientId('');
    setRoastGroupMode('existing');
    setSelectedRoastGroup('');
    setOrigin('');
    setCustomOrigin('');
    setCropsterProfileRef('');
    setFinishedGoodName('');
    setPackagingVariants([]);
    setPriceInput('');
    setLifecycle(null);
  };
  
  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const displayName = fullFinishedGoodName;
      if (!displayName) throw new Error('Product name is required');
      if (!selectedClient) throw new Error('Client is required');
      
      let roastGroupKey: string;
      
      // Create roast group if needed
      if (roastGroupMode === 'new') {
        const originValue = origin === '__custom__' ? customOrigin.trim() : origin;
        
        const baseKey = displayName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
        const baseCode = generateShortCode(displayName, 6);
        
        let rgSuccess = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          const key = attempt === 0 ? baseKey : `${baseKey}_${attempt + 1}`;
          const code = attempt === 0 ? baseCode : `${baseCode}${attempt + 1}`.substring(0, 6);
          
          const { error: rgError } = await supabase
            .from('roast_groups')
            .insert({
              roast_group: key,
              roast_group_code: code,
              is_blend: false,
              origin: originValue,
              blend_name: null,
              display_name: displayName,
              standard_batch_kg: 20,
              expected_yield_loss_pct: 16,
              default_roaster: 'EITHER',
              is_active: true,
              cropster_profile_ref: cropsterProfileRef.trim() || null,
            });
          
          if (!rgError) {
            roastGroupKey = key;
            rgSuccess = true;
            break;
          }
          
          if (rgError.code !== '23505') {
            throw rgError;
          }
        }
        
        if (!rgSuccess) {
          throw new Error('Could not create roast group after 50 attempts');
        }
      } else {
        roastGroupKey = selectedRoastGroup;
      }
      
      // Get resolved SKUs with collision handling
      const resolvedSkus = getResolvedSkus(
        selectedClient.client_code,
        productCode,
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
            client_id: clientId,
            product_name: displayName,
            sku: skuData.sku,
            roast_group: roastGroupKey!,
            packaging_type_id: skuData.packagingTypeId,
            grams_per_unit: skuData.grams,
            bag_size_g: skuData.grams, // Keep for backward compatibility
            format: 'WHOLE_BEAN',
            grind_options: ['WHOLE_BEAN'],
            is_active: true,
            is_perennial: lifecycle === 'perennial',
          })
          .select('id, sku')
          .single();
        
        if (error) {
          // If SKU collision at DB level, try with suffix
          if (error.code === '23505' && error.message?.toLowerCase().includes('sku')) {
            for (let i = 2; i <= 50; i++) {
              const fallbackSku = `${skuData.sku}-${i}`;
              const { data: retryProduct, error: retryError } = await supabase
                .from('products')
                .insert({
                  client_id: clientId,
                  product_name: displayName,
                  sku: fallbackSku,
                  roast_group: roastGroupKey!,
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
        name: displayName, 
        adjustedCount,
      };
    },
    onSuccess: (result) => {
      let message = `Created ${result.count} product${result.count > 1 ? 's' : ''}: ${result.name}`;
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
      toast.error(err?.message || 'Failed to create products');
    },
  });
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Single Origin Product</DialogTitle>
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
                  Create new roast group
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
                  {singleOriginRoastGroups.map(g => (
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
                
                <div>
                  <Label htmlFor="cropsterRef" className="text-xs text-muted-foreground">
                    Cropster Profile Ref (optional)
                  </Label>
                  <Input
                    id="cropsterRef"
                    placeholder="e.g. R-1234 or profile name"
                    value={cropsterProfileRef}
                    onChange={(e) => setCropsterProfileRef(e.target.value)}
                  />
                </div>
                
                {/* Roast Group Preview */}
                {fullFinishedGoodName && (
                  <RoastGroupPreview
                    displayName={fullFinishedGoodName}
                    existingKeys={existingRoastGroupKeys}
                    existingCodes={existingRoastGroupCodes}
                  />
                )}
              </div>
            )}
          </div>
          
          {/* Step 3: Finished Good Name */}
          <div>
            <Label htmlFor="fgName">3. Finished Good Name</Label>
            {roastGroupMode === 'new' && originPrefix ? (
              <div className="flex items-center gap-0">
                <div className="flex-shrink-0 px-3 py-2 bg-muted border border-r-0 rounded-l-md text-sm text-muted-foreground">
                  {originPrefix} -
                </div>
                <Input
                  id="fgName"
                  className="rounded-l-none"
                  placeholder="e.g. Hermanos, Santa Rosa, Yirgacheffe Natural"
                  value={finishedGoodName}
                  onChange={(e) => setFinishedGoodName(e.target.value)}
                />
              </div>
            ) : (
              <Input
                id="fgName"
                placeholder={roastGroupMode === 'existing' 
                  ? "e.g. Guatemala Huehuetenango, Ethiopia Yirgacheffe Natural"
                  : "Select an origin above first"}
                value={finishedGoodName}
                onChange={(e) => setFinishedGoodName(e.target.value)}
                disabled={roastGroupMode === 'new' && !originPrefix}
              />
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {fullFinishedGoodName 
                ? <>Full name: <span className="font-medium">{fullFinishedGoodName}</span></> 
                : 'This name appears on orders, pack lists, and shipping.'}
            </p>
          </div>
          
          {/* Step 4: Packaging Variants (new gram-based section) */}
          <PackagingVariantsSection
            selectedVariants={packagingVariants}
            onVariantsChange={setPackagingVariants}
            stepNumber={4}
          />
          
          {/* SKU Preview Section */}
          <GramBasedSkuPreview
            clientCode={selectedClient?.client_code ?? ''}
            productCode={productCode}
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
