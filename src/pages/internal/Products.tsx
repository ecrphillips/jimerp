import React, { useState } from 'react';
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
  client_id: string;
  packaging_variant: PackagingVariant | null;
  client: { name: string } | null;
}

const FORMATS: ProductFormat[] = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER', 'OTHER'];
const GRINDS: GrindOption[] = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER'];

export default function Products() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form state
  const [productName, setProductName] = useState('');
  const [sku, setSku] = useState('');
  const [format, setFormat] = useState<ProductFormat>('WHOLE_BEAN');
  const [bagSize, setBagSize] = useState(340);
  const [grindOptions, setGrindOptions] = useState<GrindOption[]>([]);
  const [clientId, setClientId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [packagingVariant, setPackagingVariant] = useState<PackagingVariant | null>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ['all-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, format, bag_size_g, grind_options, is_active, client_id, packaging_variant, client:clients(name)')
        .order('client_id')
        .order('product_name');

      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

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
        packaging_variant: packagingVariant,
      };

      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', editingProduct.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('products').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingProduct ? 'Product updated' : 'Product created');
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save product');
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
    setPackagingVariant(null);
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
    setPackagingVariant(p.packaging_variant);
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
        <Button onClick={openNew}>Add Product</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>All Products</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !products || products.length === 0 ? (
            <p className="text-muted-foreground">No products yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Client</th>
                  <th className="pb-2">SKU</th>
                  <th className="pb-2">Packaging</th>
                  <th className="pb-2">Format</th>
                  <th className="pb-2">Grinds</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
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
                ))}
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
            <div className="flex items-center gap-2">
              <Checkbox
                id="active"
                checked={isActive}
                onCheckedChange={(c) => setIsActive(!!c)}
              />
              <Label htmlFor="active">Active</Label>
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
