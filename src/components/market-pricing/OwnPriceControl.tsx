import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { AccountRetailProduct } from '@/hooks/useAccountRetailPrices';

export type OwnPrice = {
  source: 'product' | 'manual';
  productId: string | null;
  brand: string;
  productName: string;
  bagSizeG: number;
  unitPrice: number;
  pricePerG: number;
};

interface Props {
  brandLabel: string;
  products: AccountRetailProduct[];
  value: OwnPrice | null;
  onChange: (next: OwnPrice | null) => void;
}

export function OwnPriceControl({ brandLabel, products, value, onChange }: Props) {
  const [manualPrice, setManualPrice] = useState<string>('');
  const [manualBag, setManualBag] = useState<string>('340');

  // Auto-select the most-expensive product on first render if one exists.
  useEffect(() => {
    if (!value && products.length > 0) {
      const p = products[0];
      onChange({
        source: 'product',
        productId: p.productId,
        brand: brandLabel,
        productName: p.productName,
        bagSizeG: p.bagSizeG,
        unitPrice: p.unitPrice,
        pricePerG: p.pricePerG,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  const applyManual = (priceStr: string, bagStr: string) => {
    const price = Number(priceStr);
    const bag = Number(bagStr);
    if (!price || !bag || price <= 0 || bag <= 0) {
      onChange(null);
      return;
    }
    onChange({
      source: 'manual',
      productId: null,
      brand: brandLabel || 'You',
      productName: 'Manual entry',
      bagSizeG: bag,
      unitPrice: price,
      pricePerG: price / bag,
    });
  };

  if (products.length > 0) {
    const activeId = value?.source === 'product' ? value.productId : null;
    return (
      <div className="space-y-1.5 max-w-md">
        <Label>Your product to compare</Label>
        <Select
          value={activeId ?? ''}
          onValueChange={(id) => {
            const p = products.find(x => x.productId === id);
            if (!p) return;
            onChange({
              source: 'product',
              productId: p.productId,
              brand: brandLabel,
              productName: p.productName,
              bagSizeG: p.bagSizeG,
              unitPrice: p.unitPrice,
              pricePerG: p.pricePerG,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a product" />
          </SelectTrigger>
          <SelectContent>
            {products.map(p => (
              <SelectItem key={p.productId} value={p.productId}>
                {p.productName} — {p.bagSizeG}g · ${p.unitPrice.toFixed(2)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Fallback: no products on file. Manual entry.
  return (
    <div className="grid grid-cols-2 gap-3 max-w-md">
      <div className="space-y-1.5">
        <Label htmlFor="manual-bag">Bag size (g)</Label>
        <Input
          id="manual-bag"
          type="number"
          inputMode="numeric"
          value={manualBag}
          onChange={e => {
            setManualBag(e.target.value);
            applyManual(manualPrice, e.target.value);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="manual-price">Retail price CAD</Label>
        <Input
          id="manual-price"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={manualPrice}
          onChange={e => {
            setManualPrice(e.target.value);
            applyManual(e.target.value, manualBag);
          }}
        />
      </div>
    </div>
  );
}
