import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { usePricingVisibility } from '@/hooks/usePricingVisibility';
import { useClientOrderableProducts, type ClientOrderableProduct } from '@/hooks/useClientOrderableProducts';
import { formatGramsLabel } from '@/components/GramPackagingBadge';
import { GreenDetailDialog } from '@/components/client/GreenDetailDialog';
import { ProductNotes } from '@/components/client/ProductNotes';
import { useAccountProductNotes } from '@/hooks/useAccountProductNotes';
import { ChevronRight, Leaf, MessageSquare, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductGroup {
  key: string;
  roastGroup: string | null;
  name: string;
  variants: ClientOrderableProduct[];
}

const titleCase = (v: string | null) =>
  v ? v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '—';

/**
 * One header per coffee (roast group); packaging variants live in the drawer.
 * Products without a roast group (allied items) stand alone.
 */
function groupProducts(products: ClientOrderableProduct[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  for (const p of products) {
    const key = p.roast_group ? `rg:${p.roast_group}` : `p:${p.id}`;
    const g = groups.get(key);
    if (g) g.variants.push(p);
    else groups.set(key, { key, roastGroup: p.roast_group, name: p.product_name, variants: [p] });
  }
  for (const g of groups.values()) {
    g.variants.sort((a, b) => (a.grams_per_unit ?? a.bag_size_g) - (b.grams_per_unit ?? b.bag_size_g));
    // Variants of one coffee usually share a name; if not, use the most common.
    const counts = new Map<string, number>();
    for (const v of g.variants) counts.set(v.product_name, (counts.get(v.product_name) ?? 0) + 1);
    g.name = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default function Products() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const { hidePricing } = usePricingVisibility();
  const effectiveAccountId = previewAccountId ?? authUser?.accountId;

  const { data: products = [], isLoading } = useClientOrderableProducts(effectiveAccountId);
  const { data: notes = [] } = useAccountProductNotes(effectiveAccountId);
  const groups = useMemo(() => groupProducts(products), [products]);

  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [greenFor, setGreenFor] = useState<ProductGroup | null>(null);

  const productIds = products.map((p) => p.id);
  const { data: priceData } = useQuery({
    queryKey: ['client-product-prices', productIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .in('product_id', productIds)
        .order('effective_date', { ascending: false });
      if (error) throw error;
      // First entry per product_id is the most recent.
      const priceMap: Record<string, number> = {};
      for (const row of data ?? []) {
        if (!(row.product_id in priceMap)) priceMap[row.product_id] = row.unit_price;
      }
      return priceMap;
    },
    enabled: productIds.length > 0,
  });

  const notesByRoastGroup = useMemo(() => {
    const map = new Map<string, typeof notes>();
    for (const n of notes) {
      const list = map.get(n.roast_group) ?? [];
      list.push(n);
      map.set(n.roast_group, list);
    }
    return map;
  }, [notes]);

  const setOpen = (key: string, open: boolean) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

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
          {isLoading ? (
            <p className="text-muted-foreground">Loading products…</p>
          ) : groups.length === 0 ? (
            <div className="py-8 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No products linked to your account yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">Contact your Home Island rep to get products added.</p>
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {groups.map((g) => {
                const isOpen = openKeys.has(g.key);
                const groupNotes = g.roastGroup ? notesByRoastGroup.get(g.roastGroup) ?? [] : [];
                return (
                  <Collapsible key={g.key} open={isOpen} onOpenChange={(o) => setOpen(g.key, o)}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-2 py-1 text-left"
                          aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${g.name}`}
                        >
                          <ChevronRight
                            className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-90')}
                          />
                          <span className="font-medium">{g.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {g.variants.length} {g.variants.length === 1 ? 'size' : 'sizes'}
                          </span>
                          {groupNotes.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <MessageSquare className="h-3 w-3" />
                              {groupNotes.length}
                            </span>
                          )}
                        </button>
                      </CollapsibleTrigger>
                      {g.roastGroup && effectiveAccountId && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto gap-1 px-1 text-green-700 hover:text-green-800"
                          onClick={() => setGreenFor(g)}
                        >
                          <Leaf className="h-3.5 w-3.5" />
                          Green detail
                        </Button>
                      )}
                    </div>

                    <CollapsibleContent>
                      <div className="space-y-4 px-3 pb-4 pl-9">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-muted-foreground">
                              <th className="pb-1 pr-4 font-medium">Size</th>
                              <th className="pb-1 pr-4 font-medium">Packaging</th>
                              <th className="pb-1 pr-4 font-medium">Format</th>
                              <th className="pb-1 pr-4 font-medium">SKU</th>
                              {!hidePricing && <th className="pb-1 text-right font-medium">Current Price</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {g.variants.map((p) => {
                              const price = priceData?.[p.id];
                              const grams = p.grams_per_unit ?? p.bag_size_g;
                              return (
                                <tr key={p.id} className="border-b last:border-0">
                                  <td className="py-2 pr-4">{grams ? formatGramsLabel(grams) : '—'}</td>
                                  <td className="py-2 pr-4 text-muted-foreground">
                                    {p.packaging_types?.name ?? titleCase(p.packaging_variant)}
                                  </td>
                                  <td className="py-2 pr-4 text-muted-foreground">{titleCase(p.format)}</td>
                                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{p.sku ?? '—'}</td>
                                  {!hidePricing && (
                                    <td className="py-2 text-right">
                                      {price != null ? `$${price.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        {g.roastGroup && effectiveAccountId && (
                          <div>
                            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Notes
                            </h4>
                            <ProductNotes
                              accountId={effectiveAccountId}
                              roastGroup={g.roastGroup}
                              notes={groupNotes}
                              hint="Visible to your team and to Home Island."
                            />
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {greenFor?.roastGroup && effectiveAccountId && (
        <GreenDetailDialog
          open={!!greenFor}
          onOpenChange={(o) => !o && setGreenFor(null)}
          accountId={effectiveAccountId}
          roastGroup={greenFor.roastGroup}
          productName={greenFor.name}
        />
      )}
    </div>
  );
}
