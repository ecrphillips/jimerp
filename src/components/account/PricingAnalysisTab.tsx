/**
 * Pricing Analysis tab for the Account Detail page (ADMIN/OPS only).
 * Read-only analytical view: account health summary + per-product pricing table.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Wrench, AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { calculatePrice, type PricingResult } from '@/lib/pricing';
import { marginColour, marginClass } from '@/lib/quoteConstants';
import { formatPerKg } from '@/lib/formatMoney';

const COST_DRIFT_THRESHOLD = 0.10;

type ProductRow = {
  id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  packaging_variant: any;
  roast_group: string | null;
  pricing_overrides_updated_at: string | null;
  pricing_overrides_updated_by: string | null;
  created_at: string;
};

type GreenInfo = { marketValuePerKg: number | null; lotCount: number; representativeLotId: string | null };

async function resolveGreenForRoastGroup(roastGroup: string | null): Promise<GreenInfo> {
  if (!roastGroup) return { marketValuePerKg: null, lotCount: 0, representativeLotId: null };
  const { data, error } = await supabase
    .from('green_lot_roast_group_links')
    .select('pct_of_lot, lot_id, green_lots!green_lot_roast_group_links_lot_id_fkey(id, market_value_per_kg, book_value_per_kg)')
    .eq('roast_group', roastGroup);
  if (error) throw error;
  const rows = (data ?? []).filter((r: any) => r.green_lots);
  if (rows.length === 0) return { marketValuePerKg: null, lotCount: 0, representativeLotId: null };
  const usable = rows.filter((r: any) => {
    const v = r.green_lots?.market_value_per_kg ?? r.green_lots?.book_value_per_kg;
    return v != null && Number(v) > 0;
  });
  if (usable.length === 0) return { marketValuePerKg: null, lotCount: rows.length, representativeLotId: rows[0].lot_id };
  const totalPct = usable.reduce((a: number, r: any) => a + (Number(r.pct_of_lot) || 0), 0);
  const useEqual = totalPct <= 0;
  let market = 0;
  for (const r of usable) {
    const lot = r.green_lots;
    const mv = lot.market_value_per_kg != null ? Number(lot.market_value_per_kg) : Number(lot.book_value_per_kg);
    const w = useEqual ? 1 / usable.length : (Number(r.pct_of_lot) || 0) / totalPct;
    market += w * mv;
  }
  // Representative lot = highest pct (or first)
  const sorted = [...usable].sort((a: any, b: any) => (Number(b.pct_of_lot) || 0) - (Number(a.pct_of_lot) || 0));
  return { marketValuePerKg: market, lotCount: usable.length, representativeLotId: sorted[0].lot_id };
}

type AnalysisRow = {
  product: ProductRow;
  unitPrice: number | null;
  green: GreenInfo;
  pricing: PricingResult | null;
  pricingError: string | null;
};

export default function PricingAnalysisTab({ account }: { account: any }) {
  const navigate = useNavigate();
  const accountId = account.id;
  const [unitsPerSku, setUnitsPerSku] = useState<number>(100);

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['pricing-analysis-products', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, packaging_variant, roast_group, pricing_overrides_updated_at, pricing_overrides_updated_by, created_at')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  const productIds = useMemo(() => (products ?? []).map((p) => p.id), [products]);

  const { data: prices } = useQuery({
    queryKey: ['pricing-analysis-prices', accountId, productIds.join(',')],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .in('product_id', productIds)
        .order('effective_date', { ascending: false });
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const p of data ?? []) if (!(p.product_id in map)) map[p.product_id] = Number(p.unit_price);
      return map;
    },
  });

  const updatedByIds = useMemo(
    () => Array.from(new Set((products ?? []).map((p) => p.pricing_overrides_updated_by).filter(Boolean) as string[])),
    [products],
  );
  const { data: profilesByUser } = useQuery({
    queryKey: ['pricing-analysis-profiles', updatedByIds.join(',')],
    enabled: updatedByIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, name, email')
        .in('user_id', updatedByIds);
      if (error) throw error;
      const map: Record<string, { name: string | null; email: string | null }> = {};
      for (const p of data ?? []) map[p.user_id] = { name: (p as any).name, email: (p as any).email };
      return map;
    },
  });

  const { data: rows, isLoading: rowsLoading } = useQuery({
    queryKey: ['pricing-analysis-rows', accountId, productIds.join(','), prices ? Object.keys(prices).length : 0],
    enabled: productIds.length > 0 && !!prices,
    queryFn: async (): Promise<AnalysisRow[]> => {
      const out: AnalysisRow[] = [];
      for (const product of products ?? []) {
        const green = await resolveGreenForRoastGroup(product.roast_group);
        let pricing: PricingResult | null = null;
        let pricingError: string | null = null;
        if (green.representativeLotId && product.packaging_variant && product.bag_size_g) {
          try {
            pricing = await calculatePrice(supabase, {
              green: { lot_id: green.representativeLotId },
              bag_size_g: product.bag_size_g,
              packaging_variant: product.packaging_variant,
              product_id: product.id,
              account_id: accountId,
            });
          } catch (e: any) {
            pricingError = e?.message ?? String(e);
          }
        }
        out.push({
          product,
          unitPrice: prices?.[product.id] ?? null,
          green,
          pricing,
          pricingError,
        });
      }
      return out;
    },
  });

  // Summary metrics
  const activeProductCount = products?.length ?? 0;
  const flagsCount = useMemo(() => {
    if (!rows) return 0;
    let n = 0;
    for (const r of rows) {
      const ref = r.product.pricing_overrides_updated_at ?? r.product.created_at;
      if (!ref) continue;
      // Drift "flag" — without a stored snapshot, we mirror table logic:
      // anything with green data + a reference date and a non-trivial age counts as "review recommended" if margin moved.
      // Here we approximate: flag products where current green cost exists AND last priced > 30 days ago.
      const ageDays = (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24);
      if (r.green.marketValuePerKg != null && ageDays > 30) n += 1;
    }
    return n;
  }, [rows]);

  const fee = account.monthly_service_fee != null ? Number(account.monthly_service_fee) : null;
  const skuCount = account.managed_sku_count ?? null;
  const amortPerUnit = fee != null && fee > 0 && activeProductCount > 0 && unitsPerSku > 0
    ? fee / (activeProductCount * unitsPerSku)
    : null;

  if (productsLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SECTION 1 — Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <SummaryCard label="Active Products" value={String(activeProductCount)} subtitle={activeProductCount === 1 ? 'product' : 'products'} />
        <SummaryCard
          label="Monthly Service Fee"
          value={fee != null ? `$${fee.toFixed(2)}` : 'Not set'}
          subtitle={fee != null && skuCount ? `covers ${skuCount} SKU${skuCount === 1 ? '' : 's'}` : undefined}
          muted={fee == null}
        />
        <PlaceholderCard label="Revenue Contribution" subtitle="Available once order history is tracked in JIM" />
        <PlaceholderCard label="Capacity Commitment" subtitle="Available once labour costing is built out." />
        <SummaryCard
          label="Pricing Flags"
          value={String(flagsCount)}
          subtitle={flagsCount > 0 ? 'review recommended' : 'all products current'}
          badgeVariant={flagsCount > 0 ? 'destructive' : 'secondary'}
          asBadge
        />
      </div>

      {/* SECTION 2 — Product pricing table */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Product Pricing</CardTitle></CardHeader>
        <CardContent>
          {activeProductCount === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No active products found for this account.</p>
          ) : rowsLoading || !rows ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Roast group</TableHead>
                  <TableHead>Bag size</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Green $/kg</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead>Cost drift</TableHead>
                  <TableHead>Last priced</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const refDate = r.product.pricing_overrides_updated_at ?? r.product.created_at;
                  const updatedBy = r.product.pricing_overrides_updated_by
                    ? profilesByUser?.[r.product.pricing_overrides_updated_by]
                    : null;
                  const marginPct = r.pricing?.margin_pct ?? null;
                  const colour = marginColour(marginPct);
                  return (
                    <TableRow key={r.product.id}>
                      <TableCell>
                        <div className="font-medium">{r.product.product_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.product.sku ?? '—'}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.product.roast_group ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.product.bag_size_g}g</TableCell>
                      <TableCell className="text-right text-sm">
                        {r.unitPrice != null ? `$${r.unitPrice.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {r.green.marketValuePerKg != null
                          ? formatPerKg(r.green.marketValuePerKg)
                          : <span className="text-muted-foreground">No cost data</span>}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${marginClass(colour)}`}>
                        {marginPct != null ? `${(marginPct * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell>
                        <DriftCell row={r} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {refDate ? (
                          <>
                            <div>{formatDistanceToNow(new Date(refDate), { addSuffix: true })}</div>
                            {updatedBy && (
                              <div className="text-xs text-muted-foreground">
                                {updatedBy.name || updatedBy.email}
                              </div>
                            )}
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/products?edit=${r.product.id}&section=pricing`)}
                        >
                          Review pricing
                          <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* SECTION 3 — Service fee amortisation note */}
      {fee != null && fee > 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-sm space-y-2">
            <p>
              The <strong>${fee.toFixed(2)}/month</strong> service fee, spread across all{' '}
              <strong>{activeProductCount}</strong> active SKU{activeProductCount === 1 ? '' : 's'} for this account,
              adds an effective{' '}
              <strong>{amortPerUnit != null ? `$${amortPerUnit.toFixed(4)}/unit` : '—'}</strong> overhead at an assumed
              volume of{' '}
              <Input
                type="number"
                min={1}
                value={unitsPerSku}
                onChange={(e) => setUnitsPerSku(Math.max(1, Number(e.target.value) || 1))}
                className="inline-block w-24 h-7 mx-1 align-baseline"
              />{' '}
              units/month per SKU.
            </p>
            <p className="text-xs text-muted-foreground">
              This is an analytical overlay only and does not affect stored product prices.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label, value, subtitle, muted, badgeVariant, asBadge,
}: { label: string; value: string; subtitle?: string; muted?: boolean; badgeVariant?: 'default' | 'destructive' | 'secondary'; asBadge?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 space-y-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        {asBadge ? (
          <Badge variant={badgeVariant ?? 'secondary'} className="text-base px-3 py-1">{value}</Badge>
        ) : (
          <p className={`text-2xl font-semibold ${muted ? 'text-muted-foreground' : ''}`}>{value}</p>
        )}
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function PlaceholderCard({ label, subtitle }: { label: string; subtitle: string }) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardContent className="pt-4 pb-3 space-y-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" />
          <span className="text-sm">Under construction</span>
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function DriftCell({ row }: { row: AnalysisRow }) {
  const refDate = row.product.pricing_overrides_updated_at ?? row.product.created_at;
  if (!refDate) return <span className="text-muted-foreground text-sm">—</span>;
  if (row.green.marketValuePerKg == null || row.pricing == null) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  // Without a stored historical snapshot we cannot compute exact drift.
  // Surface a directional review prompt: green if current margin healthy, red if margin <15%.
  const m = row.pricing.margin_pct;
  const lowMargin = m < 0.15;
  return (
    <div className={`flex items-start gap-1.5 text-xs ${lowMargin ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>Green cost changed since last priced — review recommended</span>
    </div>
  );
}
