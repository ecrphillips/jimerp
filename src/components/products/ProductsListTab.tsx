import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProductFormat, GrindOption } from '@/types/database';
import { PackagingBadge, PACKAGING_OPTIONS, type PackagingVariant } from '@/components/PackagingBadge';
import { ProductTypeChoiceModal } from './ProductTypeChoiceModal';
import { NewSingleOriginProductModal } from './NewSingleOriginProductModal';
import { NewBlendProductModal } from './NewBlendProductModal';
import { SafeDeleteModal } from '@/components/SafeDeleteModal';
import { RoastGroupRerouteModal } from './RoastGroupRerouteModal';
import { Trash2 } from 'lucide-react';

interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  format: ProductFormat;
  bag_size_g: number;
  grind_options: GrindOption[];
  is_active: boolean;
  is_perennial: boolean;
  client_id: string | null;
  account_id: string | null;
  packaging_variant: PackagingVariant | null;
  roast_group: string | null;
  client: { name: string } | null;
  account: { account_name: string } | null;
}

const FORMATS: ProductFormat[] = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER', 'OTHER'];
const GRINDS: GrindOption[] = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER'];

const VARIANT_BAG_SIZES: Record<string, number> = {
  RETAIL_250G: 250,
  RETAIL_300G: 300,
  RETAIL_340G: 340,
  RETAIL_454G: 454,
  CROWLER_200G: 200,
  CROWLER_250G: 250,
  CAN_125G: 125,
  BULK_2LB: 907,
  BULK_1KG: 1000,
  BULK_5LB: 2268,
  BULK_2KG: 2000,
};

function getTodayVancouver(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

export function ProductsListTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  
  // Product type choice + separate modals
  const [typeChoiceOpen, setTypeChoiceOpen] = useState(false);
  const [singleOriginModalOpen, setSingleOriginModalOpen] = useState(false);
  const [blendModalOpen, setBlendModalOpen] = useState(false);
  
  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{
    open_orders: number;
    completed_orders: number;
    cancelled_orders: number;
  } | null>(null);

  // Roast group reroute modal state
  const [showRerouteModal, setShowRerouteModal] = useState(false);
  const [pendingRerouteData, setPendingRerouteData] = useState<{
    productId: string;
    productName: string;
    currentRoastGroup: string | null;
    newRoastGroup: string | null;
    fullPayload: {
      product_name: string;
      sku: string | null;
      format: ProductFormat;
      bag_size_g: number;
      grind_options: GrindOption[];
      client_id: string | null;
      account_id: string | null;
      is_active: boolean;
      is_perennial: boolean;
      packaging_variant: PackagingVariant | null;
      roast_group: string | null;
    };
  } | null>(null);

  // Add Variant modal state
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [variantSource, setVariantSource] = useState<Product | null>(null);
  const [variantPackaging, setVariantPackaging] = useState<PackagingVariant | null>(null);
  const [variantPrice, setVariantPrice] = useState('');

  // Form state (for editing only now)
  const [productName, setProductName] = useState('');
  const [sku, setSku] = useState('');
  const [format, setFormat] = useState<ProductFormat>('WHOLE_BEAN');
  const [bagSize, setBagSize] = useState(340);
  const [grindOptions, setGrindOptions] = useState<GrindOption[]>([]);
  const [clientId, setClientId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [packagingVariant, setPackagingVariant] = useState<PackagingVariant | null>(null);
  const [priceInput, setPriceInput] = useState<string>('');
  const [isPerennial, setIsPerennial] = useState(false);
  const [roastGroup, setRoastGroup] = useState<string>('');

  const { data: products, isLoading } = useQuery({
    queryKey: ['all-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, format, bag_size_g, grind_options, is_active, is_perennial, client_id, account_id, packaging_variant, roast_group, client:clients(name), account:accounts(account_name)')
        .order('product_name');

      if (error) throw error;
      return (data ?? []) as unknown as Product[];
    },
  });

  const displayedProducts = useMemo(() => {
    if (!products) return [];
    return showInactive ? products : products.filter(p => p.is_active);
  }, [products, showInactive]);

  const inactiveCount = useMemo(() => {
    return products?.filter(p => !p.is_active).length ?? 0;
  }, [products]);

  const { data: clients } = useQuery({
    queryKey: ['all-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('is_active', true)
        .order('account_name');

      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: roastGroups } = useQuery({
    queryKey: ['active-roast-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group')
        .eq('is_active', true)
        .order('roast_group');

      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: allPrices } = useQuery({
    queryKey: ['all-prices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .order('effective_date', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });

  const currentPrices = useMemo(() => {
    const priceMap: Record<string, number> = {};
    for (const p of allPrices ?? []) {
      if (!(p.product_id in priceMap)) {
        priceMap[p.product_id] = p.unit_price;
      }
    }
    return priceMap;
  }, [allPrices]);

  const productsWithoutPrice = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => !(p.id in currentPrices));
  }, [products, currentPrices]);

  // Query sibling variants for the Add Variant dialog
  const { data: siblingVariants } = useQuery({
    queryKey: ['sibling-variants', variantSource?.roast_group, variantSource?.account_id],
    queryFn: async () => {
      if (!variantSource) return [];
      const query = supabase
        .from('products')
        .select('packaging_variant')
        .not('packaging_variant', 'is', null);

      if (variantSource.roast_group) {
        query.eq('roast_group', variantSource.roast_group);
      }
      if (variantSource.account_id) {
        query.eq('account_id', variantSource.account_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(d => d.packaging_variant).filter(Boolean) as string[];
    },
    enabled: variantDialogOpen && !!variantSource,
  });

  const availableVariants = useMemo(() => {
    const used = new Set(siblingVariants ?? []);
    return PACKAGING_OPTIONS.filter(opt => !used.has(opt.value));
  }, [siblingVariants]);

  // Actual save mutation (used after confirmation if needed)
  const executeSaveMutation = useMutation({
    mutationFn: async (payload: {
      product_name: string;
      sku: string | null;
      format: ProductFormat;
      bag_size_g: number;
      grind_options: GrindOption[];
      client_id: string | null;
      account_id: string | null;
      is_active: boolean;
      is_perennial: boolean;
      packaging_variant: PackagingVariant | null;
      roast_group: string | null;
    }) => {
      let productId: string;

      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editingProduct.id);
        if (error) throw error;
        productId = editingProduct.id;
      } else {
        const { data: newProduct, error } = await supabase
          .from('products')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        productId = newProduct.id;
      }

      const priceValue = parseFloat(priceInput);
      if (!isNaN(priceValue) && priceInput.trim() !== '') {
        const todayVancouver = getTodayVancouver();

        const { error: priceError } = await supabase
          .from('price_list')
          .insert({
            product_id: productId,
            unit_price: priceValue,
            currency: 'CAD',
            effective_date: todayVancouver,
          });
        if (priceError) {
          console.error('Failed to create price:', priceError);
          toast.error(editingProduct ? 'Product updated but failed to set price' : 'Product created but failed to set initial price');
          return;
        }
      }
    },
    onSuccess: () => {
      const wasReroute = pendingRerouteData !== null;
      toast.success(
        wasReroute 
          ? 'Product rerouted — roast demand recalculated' 
          : (editingProduct ? 'Product updated' : 'Product created')
      );
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
      queryClient.invalidateQueries({ queryKey: ['roast-demand'] });
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      closeDialog();
      setShowRerouteModal(false);
      setPendingRerouteData(null);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save product');
    },
  });

  // Handler that checks if roast group is changing
  const handleSave = useCallback(() => {
    const payload = {
      product_name: productName,
      sku: sku || null,
      format,
      bag_size_g: bagSize,
      grind_options: grindOptions,
      client_id: editingProduct?.client_id ?? null,
      account_id: clientId || null,
      is_active: isActive,
      is_perennial: isPerennial,
      packaging_variant: packagingVariant,
      roast_group: roastGroup || null,
    };

    // Check if we're editing and roast group is changing
    if (editingProduct) {
      const currentRG = editingProduct.roast_group || null;
      const newRG = roastGroup || null;
      
      if (currentRG !== newRG) {
        setPendingRerouteData({
          productId: editingProduct.id,
          productName: editingProduct.product_name,
          currentRoastGroup: currentRG,
          newRoastGroup: newRG,
          fullPayload: payload,
        });
        setShowRerouteModal(true);
        return;
      }
    }

    executeSaveMutation.mutate(payload);
  }, [
    editingProduct,
    productName,
    sku,
    format,
    bagSize,
    grindOptions,
    clientId,
    isActive,
    isPerennial,
    packagingVariant,
    roastGroup,
    executeSaveMutation,
  ]);

  // Handler for confirmed reroute
  const handleConfirmReroute = useCallback(() => {
    if (pendingRerouteData) {
      executeSaveMutation.mutate(pendingRerouteData.fullPayload);
    }
  }, [pendingRerouteData, executeSaveMutation]);

  const backfillMutation = useMutation({
    mutationFn: async () => {
      if (productsWithoutPrice.length === 0) {
        throw new Error('No products without price');
      }

      const todayVancouver = getTodayVancouver();
      const priceRows = productsWithoutPrice.map((p) => ({
        product_id: p.id,
        unit_price: 0,
        currency: 'CAD',
        effective_date: todayVancouver,
      }));

      const { error } = await supabase.from('price_list').insert(priceRows);
      if (error) throw error;

      return productsWithoutPrice.length;
    },
    onSuccess: (count) => {
      toast.success(`Set $0.00 price for ${count} product${count > 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to backfill prices');
    },
  });

  // Delete preflight mutation
  const deletePreflightMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { data, error } = await supabase.rpc('get_product_delete_preflight', {
        p_product_id: productId,
      });
      if (error) throw error;
      return data as {
        open_orders: number;
        completed_orders: number;
        cancelled_orders: number;
      };
    },
    onSuccess: (data, productId) => {
      const product = products?.find(p => p.id === productId);
      if (product) {
        setDeletingProduct(product);
        setDeleteCounts(data);
        setShowDeleteModal(true);
      }
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to check product references');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (force: boolean) => {
      if (!deletingProduct) throw new Error('No product selected');
      const { data, error } = await supabase.rpc('delete_product_safe', {
        p_product_id: deletingProduct.id,
        p_force: force,
      });
      if (error) throw error;
      return data as { deleted: boolean; message: string };
    },
    onSuccess: (data) => {
      if (data.deleted) {
        toast.success('Product deleted');
        queryClient.invalidateQueries({ queryKey: ['all-products'] });
        queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      }
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to delete product');
    },
  });

  // Set inactive mutation
  const setInactiveMutation = useMutation({
    mutationFn: async () => {
      if (!deletingProduct) throw new Error('No product selected');
      const { error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', deletingProduct.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Product set to inactive');
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to set product inactive');
    },
  });

  const PACKAGING_SUFFIXES = [
    '250g Retail', '300g Retail', '340g Retail', '454g Retail',
    '200g Crowler', '250g Crowler', '125g Can',
    '2lb Bulk', '1kg Bulk', '5lb Bulk', '2kg Bulk',
  ];

  const stripPackagingSuffix = (name: string) => {
    let result = name;
    for (const suffix of PACKAGING_SUFFIXES) {
      const re = new RegExp(`[\\s\\-]+${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      result = result.replace(re, '');
    }
    return result.trim();
  };

  const variantBaseName = variantSource ? stripPackagingSuffix(variantSource.product_name) : '';
  const variantLabel = variantPackaging ? PACKAGING_OPTIONS.find(o => o.value === variantPackaging)?.label ?? '' : '';
  const variantNewName = variantPackaging ? `${variantBaseName} ${variantLabel}` : '';

  // Add variant mutation
  const addVariantMutation = useMutation({
    mutationFn: async () => {
      if (!variantSource || !variantPackaging) throw new Error('Missing data');

      const bagSizeG = VARIANT_BAG_SIZES[variantPackaging] ?? 0;

      const { data: newProduct, error } = await supabase
        .from('products')
        .insert({
          account_id: variantSource.account_id,
          product_name: variantNewName,
          roast_group: variantSource.roast_group,
          packaging_variant: variantPackaging,
          bag_size_g: bagSizeG,
          format: variantSource.format as any,
          grind_options: variantSource.grind_options as any,
          is_perennial: variantSource.is_perennial,
          is_active: true,
        })
        .select('id')
        .single();
      if (error) throw error;

      const priceValue = parseFloat(variantPrice);
      if (!isNaN(priceValue) && variantPrice.trim() !== '') {
        await supabase.from('price_list').insert({
          product_id: newProduct.id,
          unit_price: priceValue,
          currency: 'CAD',
          effective_date: getTodayVancouver(),
        });
      }
    },
    onSuccess: () => {
      toast.success('Variant added');
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      setVariantDialogOpen(false);
      setVariantSource(null);
      setVariantPackaging(null);
      setVariantPrice('');
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to add variant');
    },
  });

  const openDeleteDialog = useCallback((p: Product) => {
    deletePreflightMutation.mutate(p.id);
  }, [deletePreflightMutation]);

  const openNew = () => {
    setTypeChoiceOpen(true);
  };
  
  const handleChooseSingleOrigin = () => {
    setTypeChoiceOpen(false);
    setSingleOriginModalOpen(true);
  };
  
  const handleChooseBlend = () => {
    setTypeChoiceOpen(false);
    setBlendModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setProductName(p.product_name);
    setSku(p.sku ?? '');
    setFormat(p.format);
    setBagSize(p.bag_size_g);
    setGrindOptions(p.grind_options ?? []);
    setClientId(p.account_id ?? p.client_id ?? '');
    setIsActive(p.is_active);
    setIsPerennial(p.is_perennial);
    setPackagingVariant(p.packaging_variant);
    setPriceInput('');
    setRoastGroup(p.roast_group ?? '');
    setDialogOpen(true);
  };

  const openAddVariant = (p: Product) => {
    setDialogOpen(false);
    setEditingProduct(null);
    setVariantSource(p);
    setVariantPackaging(null);
    setVariantPrice('');
    setVariantDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingProduct(null);
  };

  const toggleGrind = (g: GrindOption) => {
    setGrindOptions((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  };

  const getDisplayName = (p: Product) => p.account?.account_name ?? p.client?.name ?? 'Unknown';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {productsWithoutPrice.length > 0 && (
          <Button
            variant="outline"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
          >
            {backfillMutation.isPending
              ? 'Setting…'
              : `Set $0.00 for ${productsWithoutPrice.length} unpriced`}
          </Button>
        )}
        <Button onClick={openNew}>Add Product</Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Products</CardTitle>
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={showInactive}
                onCheckedChange={(checked) => setShowInactive(!!checked)}
              />
              Show inactive ({inactiveCount})
            </label>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : displayedProducts.length === 0 ? (
            <p className="text-muted-foreground">No products to display.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Client</th>
                  <th className="pb-2">SKU</th>
                  <th className="pb-2">Packaging</th>
                  <th className="pb-2">Current Price</th>
                  <th className="pb-2">Roast Group</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {displayedProducts.map((p) => {
                  const price = currentPrices[p.id];
                  const hasPrice = p.id in currentPrices;
                  return (
                    <tr key={p.id} className={`border-b last:border-0 ${!p.is_active ? 'opacity-60' : ''}`}>
                      <td className="py-2 font-medium">{p.product_name}</td>
                      <td className="py-2">{getDisplayName(p)}</td>
                      <td className="py-2">{p.sku || '—'}</td>
                      <td className="py-2">
                        {p.packaging_variant ? (
                          <PackagingBadge variant={p.packaging_variant} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        {hasPrice ? (
                          <span>${price.toFixed(2)}</span>
                        ) : (
                          <span className="text-destructive font-medium">No price set</span>
                        )}
                      </td>
                      <td className="py-2">
                        <span className="font-mono text-xs">{p.roast_group || '—'}</span>
                      </td>
                      <td className="py-2">
                        <span className={p.is_active ? 'text-green-600' : 'text-muted-foreground'}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>Edit</Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => openDeleteDialog(p)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Edit Product Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Edit Product' : 'New Product'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="client">Account</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="client">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="name">Product Name</Label>
              <Input id="name" value={productName} onChange={(e) => setProductName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sku">SKU (optional)</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="format">Format</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as ProductFormat)}>
                  <SelectTrigger id="format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bagSize">Bag Size (g)</Label>
                <Input
                  id="bagSize"
                  type="number"
                  value={bagSize}
                  onChange={(e) => setBagSize(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="packaging">Packaging Variant</Label>
              <Select
                value={packagingVariant ?? ''}
                onValueChange={(v) => setPackagingVariant(v as PackagingVariant)}
              >
                <SelectTrigger id="packaging">
                  <SelectValue placeholder="Select packaging" />
                </SelectTrigger>
                <SelectContent>
                  {PACKAGING_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="roastGroup">Roast Group</Label>
              <Select value={roastGroup || 'NONE'} onValueChange={(v) => setRoastGroup(v === 'NONE' ? '' : v)}>
                <SelectTrigger id="roastGroup">
                  <SelectValue placeholder="Select roast group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  {roastGroups?.map((g) => (
                    <SelectItem key={g.roast_group} value={g.roast_group}>
                      {g.roast_group}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Products sharing the same roast group are roasted together.
              </p>
            </div>
            <div>
              <Label>Grind Options</Label>
              <div className="mt-2 flex gap-4">
                {GRINDS.map((g) => (
                  <label key={g} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={grindOptions.includes(g)}
                      onCheckedChange={() => toggleGrind(g)}
                    />
                    {g}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="priceInput">
                {editingProduct ? 'Set New Price (CAD)' : 'Initial Unit Price (CAD)'}
              </Label>
              {editingProduct && editingProduct.id in currentPrices && (
                <p className="text-xs text-muted-foreground mb-1">
                  Current: ${currentPrices[editingProduct.id].toFixed(2)}
                </p>
              )}
              {editingProduct && !(editingProduct.id in currentPrices) && (
                <p className="text-xs text-destructive mb-1">
                  No price set — product cannot be ordered
                </p>
              )}
              <Input
                id="priceInput"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 12.50 or 0.00"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {editingProduct
                  ? 'Leave blank to keep current price. Enter a value to create a new price entry.'
                  : 'Leave blank to set later. $0.00 is allowed.'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="active"
                  checked={isActive}
                  onCheckedChange={(c) => setIsActive(!!c)}
                />
                <Label htmlFor="active">Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="perennial"
                  checked={isPerennial}
                  onCheckedChange={(c) => setIsPerennial(!!c)}
                />
                <Label htmlFor="perennial">Perennial</Label>
              </div>
            </div>
            <div className="flex justify-between pt-4">
              {editingProduct ? (
                <Button variant="secondary" onClick={() => openAddVariant(editingProduct)}>
                  Add Variant
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button onClick={handleSave} disabled={executeSaveMutation.isPending || !productName || !clientId}>
                  {executeSaveMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Variant Dialog */}
      <Dialog open={variantDialogOpen} onOpenChange={setVariantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Variant</DialogTitle>
          </DialogHeader>
          {variantSource && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 bg-muted/50 text-sm space-y-1">
                <p><span className="font-medium">Product:</span> {variantSource.product_name}</p>
                <p><span className="font-medium">Account:</span> {getDisplayName(variantSource)}</p>
              </div>

              {variantNewName && (
                <div className="rounded-md border border-dashed p-2 bg-muted/30 text-sm">
                  <span className="text-muted-foreground">New product name:</span>{' '}
                  <span className="font-medium">{variantNewName}</span>
                </div>
              )}

              <div>
                <Label>Packaging Variant</Label>
                <Select value={variantPackaging ?? ''} onValueChange={(v) => setVariantPackaging(v as PackagingVariant)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select packaging variant" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableVariants.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableVariants.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">All packaging variants are already in use.</p>
                )}
              </div>

              <div>
                <Label htmlFor="variantPrice">Unit Price (CAD, optional)</Label>
                <Input
                  id="variantPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 12.50"
                  value={variantPrice}
                  onChange={(e) => setVariantPrice(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setVariantDialogOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => addVariantMutation.mutate()}
                  disabled={addVariantMutation.isPending || !variantPackaging}
                >
                  {addVariantMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ProductTypeChoiceModal
        open={typeChoiceOpen}
        onOpenChange={setTypeChoiceOpen}
        onChooseSingleOrigin={handleChooseSingleOrigin}
        onChooseBlend={handleChooseBlend}
      />
      
      <NewSingleOriginProductModal
        open={singleOriginModalOpen}
        onOpenChange={setSingleOriginModalOpen}
      />
      
      <NewBlendProductModal
        open={blendModalOpen}
        onOpenChange={setBlendModalOpen}
      />

      {/* Safe Delete Modal */}
      <SafeDeleteModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        entityType="product"
        entityName={deletingProduct?.product_name ?? ''}
        counts={deleteCounts}
        isLoading={deleteMutation.isPending || setInactiveMutation.isPending}
        onSetInactive={() => setInactiveMutation.mutate()}
        onConfirmDelete={() => deleteMutation.mutate(true)}
      />

      {/* Roast Group Reroute Confirmation Modal */}
      <RoastGroupRerouteModal
        open={showRerouteModal}
        onOpenChange={(open) => {
          setShowRerouteModal(open);
          if (!open) setPendingRerouteData(null);
        }}
        productName={pendingRerouteData?.productName ?? ''}
        currentRoastGroup={pendingRerouteData?.currentRoastGroup ?? null}
        newRoastGroup={pendingRerouteData?.newRoastGroup ?? null}
        onConfirm={handleConfirmReroute}
        isPending={executeSaveMutation.isPending}
      />
    </div>
  );
}
