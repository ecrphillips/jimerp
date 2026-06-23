import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { usePricingVisibility } from '@/hooks/usePricingVisibility';
import { Package } from 'lucide-react';

interface AllowedProduct {
  product_id: string;
  products: {
    id: string;
    product_name: string;
    sku: string | null;
    bag_size_g: number;
    format: string | null;
    packaging_variant: string | null;
  } | null;
}

export default function Products() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const { hidePricing } = usePricingVisibility();
  const effectiveAccountId = previewAccountId ?? authUser?.accountId;

  // Allowed-products list for this account. If no rows exist, the account is
  // unrestricted and can order all active products (same convention as
  // useClientOrderingConstraints).
  const { data: allowedProducts, isLoading: productsLoading } = useQuery({
    queryKey: ['client-allowed-products-list', effectiveAccountId],
    queryFn: async () => {
      const { data: allowed, error: allowedErr } = await supabase
        .from('client_allowed_products')
        .select('product_id, products(id, product_name, sku, bag_size_g, format, packaging_variant)')
        .eq('account_id', effectiveAccountId!);
      if (allowedErr) throw allowedErr;

      if (allowed && allowed.length > 0) {
        return (allowed as AllowedProduct[]);
      }

      // Fallback: unrestricted — show all active products for this account.
      const { data: all, error: allErr } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, format, packaging_variant')
        .eq('account_id', effectiveAccountId!)
        .eq('is_active', true)
        .order('product_name', { ascending: true });
      if (allErr) throw allErr;
      return ((all ?? []) as NonNullable<AllowedProduct['products']>[]).map(p => ({
        product_id: p.id,
        products: p,
      })) as AllowedProduct[];
    },
    enabled: !!effectiveAccountId,
  });

  // TODO: Wire price lookup. Fetches latest price per product from price_list.
  // Query pattern:
  //   supabase
  //     .from('price_list')
  //     .select('product_id, unit_price, effective_date')
  //     .in('product_id', productIds)
  //     .order('effective_date', { ascending: false })
  // Then deduplicate: first occurrence per product_id = current price.
  const productIds = (allowedProducts ?? [])
    .map(ap => ap.product_id)
    .filter(Boolean);

  const { data: priceData } = useQuery({
    queryKey: ['client-product-prices', productIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .in('product_id', productIds)
        .order('effective_date', { ascending: false });
      if (error) throw error;
      // Deduplicate: first entry per product_id is most recent
      const priceMap: Record<string, number> = {};
      for (const row of data ?? []) {
        if (!(row.product_id in priceMap)) {
          priceMap[row.product_id] = row.unit_price;
        }
      }
      return priceMap;
    },
    enabled: productIds.length > 0,
  });

  const formatBagSize = (grams: number) => {
    if (grams >= 1000) return `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 1)} kg`;
    return `${grams} g`;
  };

  const formatVariant = (variant: string | null) => {
    if (!variant) return '—';
    return variant.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const formatFormat = (fmt: string | null) => {
    if (!fmt) return '—';
    return fmt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const products = (allowedProducts ?? [])
    .map(ap => ap.products)
    .filter((p): p is NonNullable<AllowedProduct['products']> => !!p);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">My Products</h1>
        <p className="text-muted-foreground">Products available for your account to order</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Product Catalogue
          </CardTitle>
        </CardHeader>
        <CardContent>
          {productsLoading ? (
            <p className="text-muted-foreground">Loading products…</p>
          ) : products.length === 0 ? (
            <div className="py-8 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No products linked to your account yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">Contact your Home Island rep to get products added.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-4">Product</th>
                  <th className="pb-2 pr-4">SKU</th>
                  <th className="pb-2 pr-4">Bag Size</th>
                  <th className="pb-2 pr-4">Format</th>
                  <th className="pb-2 pr-4">Packaging</th>
                  {!hidePricing && <th className="pb-2 text-right">Current Price</th>}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const price = priceData?.[p.id];
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{p.product_name}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{p.sku ?? '—'}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatBagSize(p.bag_size_g)}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatFormat(p.format)}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatVariant(p.packaging_variant)}</td>
                      {!hidePricing && (
                        <td className="py-3 text-right">
                          {price != null
                            ? `$${price.toFixed(2)}`
                            : <span className="text-muted-foreground">—</span>
                          }
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
