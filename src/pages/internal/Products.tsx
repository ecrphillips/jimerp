import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProductFormat, GrindOption } from '@/types/database';
import { PackagingBadge, PACKAGING_OPTIONS, type PackagingVariant } from '@/components/PackagingBadge';

interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  format: ProductFormat;
  bag_size_g: number;
  grind_options: GrindOption[];
  is_active: boolean;
  is_perennial: boolean;
  client_id: string;
  packaging_variant: PackagingVariant | null;
  roast_group: string | null;
  client: { name: string } | null;
}

const FORMATS: ProductFormat[] = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER', 'OTHER'];
const GRINDS: GrindOption[] = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER'];

function getTodayVancouver(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // YYYY-MM-DD
}

export default function Products() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // Form state
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
        .select('id, product_name, sku, format, bag_size_g, grind_options, is_active, is_perennial, client_id, packaging_variant, roast_group, client:clients(name)')
        .order('client_id')
        .order('product_name');

      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  // Filter products based on showInactive toggle
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
        .from('clients')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch all prices to determine current price per product
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

  // Build map of product_id -> current price (most recent)
  const currentPrices = useMemo(() => {
    const priceMap: Record<string, number> = {};
    for (const p of allPrices ?? []) {
      if (!(p.product_id in priceMap)) {
        priceMap[p.product_id] = p.unit_price;
      }
    }
    return priceMap;
  }, [allPrices]);

  // Products with no price_list row
  const productsWithoutPrice = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => !(p.id in currentPrices));
  }, [products, currentPrices]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        product_name: productName,
        sku: sku || null,
        format,
        bag_size_g: bagSize,
        grind_options: grindOptions,
        client_id: clientId,
        is_active: isActive,
        is_perennial: isPerennial,
        packaging_variant: packagingVariant,
        roast_group: roastGroup || null,
      };

      let productId: string;

      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editingProduct.id);
        if (error) throw error;
        productId = editingProduct.id;
      } else {
        // Create product and get the new ID
        const { data: newProduct, error } = await supabase
          .from('products')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        productId = newProduct.id;
      }

      // If price is set (including 0), create a price_list entry
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
      toast.success(editingProduct ? 'Product updated' : 'Product created');
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save product');
    },
  });

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

  const openNew = () => {
    setEditingProduct(null);
    setProductName('');
    setSku('');
    setFormat('WHOLE_BEAN');
    setBagSize(340);
    setGrindOptions([]);
    setClientId(clients?.[0]?.id ?? '');
    setIsActive(true);
    setIsPerennial(false);
    setPackagingVariant(null);
    setPriceInput('');
    setRoastGroup('');
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setProductName(p.product_name);
    setSku(p.sku ?? '');
    setFormat(p.format);
    setBagSize(p.bag_size_g);
    setGrindOptions(p.grind_options ?? []);
    setClientId(p.client_id);
    setIsActive(p.is_active);
    setIsPerennial(p.is_perennial);
    setPackagingVariant(p.packaging_variant);
    setPriceInput('');
    setRoastGroup(p.roast_group ?? '');
    setDialogOpen(true);
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

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Products</h1>
        <div className="flex gap-2">
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
                  <th className="pb-2">Format</th>
                  <th className="pb-2">Grinds</th>
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
                      <td className="py-2">{p.client?.name ?? '—'}</td>
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
                      <td className="py-2">{p.format}</td>
                      <td className="py-2">{p.grind_options?.join(', ') || '—'}</td>
                      <td className="py-2">
                        <span className={p.is_active ? 'text-green-600' : 'text-muted-foreground'}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-2">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>Edit</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Edit Product' : 'New Product'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="client">Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="client">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
              <Label htmlFor="roastGroup">Roast Group (optional)</Label>
              <Input
                id="roastGroup"
                value={roastGroup}
                onChange={(e) => setRoastGroup(e.target.value)}
                placeholder="e.g. Matchstick Blend, Single Origin A"
              />
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
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !productName || !clientId}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
