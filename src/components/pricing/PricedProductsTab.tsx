import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Info } from 'lucide-react';
import { format } from 'date-fns';
import { useProductPricing } from '@/hooks/useProductPricing';
import { useProductOptions } from '@/hooks/useProductPricing';
import { usePricingAssumptions } from '@/hooks/usePricingAssumptions';
import { deriveLoadedLabourRate } from '@/lib/pricingAssumptions';
import { staleFields } from '@/lib/productPricingStaleness';
import { TIER_PRESETS, type TierKey } from '@/lib/pricingEngine';

const money = (n: number | null | undefined, dp = 2) =>
  n == null ? '—' : `$${Number(n).toFixed(dp)}`;

export function PricedProductsTab() {
  const { data: pricing = {}, isLoading } = useProductPricing();
  const { data: products = [] } = useProductOptions();
  const { data: assumptions } = usePricingAssumptions();

  const currentLabour = assumptions ? deriveLoadedLabourRate(assumptions)?.value ?? null : null;

  const rows = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return Object.values(pricing)
      .map((row) => {
        const stale = assumptions ? staleFields(row, assumptions) : [];
        return {
          row,
          product: byId.get(row.product_id),
          stale,
          labourStale: stale.includes('labour'),
          yieldStale: stale.includes('yield'),
        };
      })
      .sort((a, b) => (a.product?.product_name ?? '').localeCompare(b.product?.product_name ?? ''));
  }, [pricing, products, assumptions]);

  const staleCount = rows.filter((r) => r.stale.length > 0).length;

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Each product stores the whole build it was priced with, not just the price. That is what
          makes a superseded rate findable rather than something you have to remember.
        </AlertDescription>
      </Alert>

      {staleCount > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {staleCount} {staleCount === 1 ? 'product was' : 'products were'} priced on assumptions
            that have since changed. Re-price them on the Sheet tab, or leave them and know why.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Priced products</CardTitle>
          <CardDescription>
            {rows.length === 0
              ? 'Nothing priced yet. Build a line on the Sheet tab and save it to a product.'
              : `${rows.length} priced. Current loaded labour rate ${money(currentLabour)}/hr.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? null : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-3">Product</th>
                    <th className="pb-2 pr-3">Configuration</th>
                    <th className="pb-2 pr-3 text-right">Floor</th>
                    <th className="pb-2 pr-3 text-right">Price</th>
                    <th className="pb-2 pr-3 text-right">Margin $/green kg</th>
                    <th className="pb-2 pr-3 text-right">Labour $/hr used</th>
                    <th className="pb-2 pr-3 text-right">Yield used</th>
                    <th className="pb-2">Priced</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ row, product, labourStale, yieldStale }) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-medium">
                          {product?.product_name ?? 'Unknown product'}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {product?.client_name ?? 'No client'}
                          {row.grams_per_unit ? ` · ${row.grams_per_unit}g` : ''}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="block">
                          {TIER_PRESETS[row.tier as TierKey]?.label ?? row.tier}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          green on {row.green_basis === 'BENCHMARK' ? 'benchmark' : 'market value'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-destructive">
                        {money(row.cost_floor_per_unit)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {money(row.price_per_unit)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {money(row.margin_per_green_kg)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {money(row.assumed_loaded_labour_rate_per_hr)}
                        {labourStale && (
                          <Badge variant="destructive" className="ml-2">
                            stale
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {row.assumed_yield_loss_pct == null
                          ? '—'
                          : `${row.assumed_yield_loss_pct}%`}
                        {yieldStale && (
                          <Badge variant="destructive" className="ml-2">
                            stale
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {format(new Date(row.updated_at), 'MMM d, yyyy')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default PricedProductsTab;
