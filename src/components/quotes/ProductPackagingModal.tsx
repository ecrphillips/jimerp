import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PACKAGING_OPTIONS, type PackagingVariant } from '@/components/PackagingBadge';

export type ProductPackagingValue = {
  product_id: string | null;
  packaging_variant: PackagingVariant;
  bag_size_g: number;
  quantity_bags: number;
};

interface ProductPackagingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ProductPackagingValue;
  onSave: (v: ProductPackagingValue) => void;
  /** When set, filter products to those owned by this account. */
  accountIdFilter?: string | null;
}

const variantToGrams = (v: PackagingVariant): number => {
  const map: Record<PackagingVariant, number> = {
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
  return map[v];
};

export function ProductPackagingModal({
  open,
  onOpenChange,
  initial,
  onSave,
  accountIdFilter,
}: ProductPackagingModalProps) {
  const [mode, setMode] = useState<'existing' | 'custom'>(initial.product_id ? 'existing' : 'custom');
  const [productId, setProductId] = useState<string>(initial.product_id ?? '');
  const [variant, setVariant] = useState<PackagingVariant>(initial.packaging_variant);
  const [bagG, setBagG] = useState<number>(initial.bag_size_g);
  const [qty, setQty] = useState<number>(initial.quantity_bags);

  useEffect(() => {
    if (!open) return;
    setMode(initial.product_id ? 'existing' : 'custom');
    setProductId(initial.product_id ?? '');
    setVariant(initial.packaging_variant);
    setBagG(initial.bag_size_g);
    setQty(initial.quantity_bags);
  }, [open, initial]);

  const { data: products } = useQuery({
    queryKey: ['quote-products', accountIdFilter ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select('id, product_name, sku, packaging_variant, bag_size_g, account_id, accounts(account_name)')
        .eq('is_active', true)
        .order('product_name');
      if (accountIdFilter) q = q.eq('account_id', accountIdFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedProduct = useMemo(
    () => products?.find((p: any) => p.id === productId),
    [products, productId],
  );

  // When picking an existing product, sync variant/bag_size from product
  useEffect(() => {
    if (mode === 'existing' && selectedProduct) {
      const sp: any = selectedProduct;
      if (sp.packaging_variant) setVariant(sp.packaging_variant as PackagingVariant);
      if (sp.bag_size_g) setBagG(sp.bag_size_g);
    }
  }, [mode, selectedProduct]);

  const valid =
    qty > 0 &&
    bagG > 0 &&
    (mode === 'custom' || !!productId);

  const handleSave = () => {
    if (!valid) return;
    onSave({
      product_id: mode === 'existing' ? productId : null,
      packaging_variant: variant,
      bag_size_g: bagG,
      quantity_bags: qty,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Product / Packaging</DialogTitle>
          <DialogDescription>
            Pick an existing product or specify packaging manually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'existing' | 'custom')} className="flex gap-6">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="existing" id="pp-existing" />
              <Label htmlFor="pp-existing" className="font-normal cursor-pointer">Existing product</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="custom" id="pp-custom" />
              <Label htmlFor="pp-custom" className="font-normal cursor-pointer">Custom packaging</Label>
            </div>
          </RadioGroup>

          {mode === 'existing' && (
            <div>
              <Label>Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.product_name}</span>
                        <span className="text-muted-foreground text-xs">· {p.sku}</span>
                        {!accountIdFilter && p.accounts?.account_name && (
                          <span className="text-muted-foreground text-xs">
                            · {p.accounts.account_name}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!accountIdFilter && (
                <p className="text-xs text-muted-foreground mt-1">
                  Showing products from all accounts (prospect quote).
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Packaging variant</Label>
              <Select
                value={variant}
                onValueChange={(v) => {
                  setVariant(v as PackagingVariant);
                  setBagG(variantToGrams(v as PackagingVariant));
                }}
                disabled={mode === 'existing' && !!productId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PACKAGING_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Bag size (g)</Label>
              <Input
                type="number"
                value={bagG}
                onChange={(e) => setBagG(Number(e.target.value))}
                disabled={mode === 'existing' && !!productId}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Quantity (bags)</Label>
              <Input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!valid}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
