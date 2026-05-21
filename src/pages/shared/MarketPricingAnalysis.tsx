import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { useLatestAudit } from '@/hooks/useMarketPriceAudit';
import { useAccountRetailPrices } from '@/hooks/useAccountRetailPrices';
import { median, percentileOf } from '@/lib/marketPricingStats';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DistributionDotPlot } from '@/components/market-pricing/DistributionDotPlot';
import { BagSizeScatter } from '@/components/market-pricing/BagSizeScatter';
import { TierBuckets } from '@/components/market-pricing/TierBuckets';
import { RankedTable } from '@/components/market-pricing/RankedTable';
import { OwnPriceControl, type OwnPrice } from '@/components/market-pricing/OwnPriceControl';

export default function MarketPricingAnalysis() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const accountId = previewAccountId ?? authUser?.accountId ?? null;

  const { data: audit, isLoading: loadingAudit } = useLatestAudit();
  const { data: ownProducts = [] } = useAccountRetailPrices(accountId);
  const [own, setOwn] = useState<OwnPrice | null>(null);

  const rows = audit?.rows ?? [];
  const ppgValues = useMemo(() => rows.map(r => r.price_per_g_cad).filter((v): v is number => v != null), [rows]);

  const med = median(ppgValues);
  const pct = own ? percentileOf(own.pricePerG, ppgValues) : null;

  if (loadingAudit) {
    return <div className="container mx-auto p-6 text-sm text-muted-foreground">Loading market data…</div>;
  }

  if (!audit) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Market pricing not available yet</CardTitle>
            <CardDescription>
              No published audit run is live. Check back after the next monthly scan.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Market pricing</h1>
          <p className="text-sm text-muted-foreground">
            Where your retail price sits in the Canadian specialty-coffee market — as of{' '}
            <strong>{format(parseISO(audit.run.run_date), 'MMM d, yyyy')}</strong>.
          </p>
        </div>
        <Badge variant="secondary">{rows.length} brands scanned</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your price</CardTitle>
          <CardDescription>
            {ownProducts.length > 0
              ? 'Pulled from your active products. Switch products to recompare.'
              : 'Enter a bag size + retail price to place yourself on the chart.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OwnPriceControl
            brandLabel="You"
            products={ownProducts}
            value={own}
            onChange={setOwn}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Your $/g"
          value={own ? `$${own.pricePerG.toFixed(4)}` : '—'}
          subtitle={own ? `${own.bagSizeG}g · $${own.unitPrice.toFixed(2)}` : 'pick a product'}
        />
        <StatCard
          label="Market median $/g"
          value={med != null ? `$${med.toFixed(4)}` : '—'}
          subtitle={`${ppgValues.length} brands`}
        />
        <StatCard
          label="Your percentile"
          value={pct != null ? `${Math.round(pct)}th` : '—'}
          subtitle={pct != null ? percentileSubtitle(pct) : 'pick a product'}
          accent={pct != null}
        />
      </div>

      <TierBuckets values={ppgValues} yourPpg={own?.pricePerG ?? null} />

      <Card>
        <CardHeader>
          <CardTitle>Price-per-gram distribution</CardTitle>
          <CardDescription>Each dot is a brand's smallest bag size, normalized to CAD per gram.</CardDescription>
        </CardHeader>
        <CardContent>
          <DistributionDotPlot rows={rows} yourPpg={own?.pricePerG ?? null} yourLabel={own?.productName} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Price vs bag size</CardTitle>
          <CardDescription>
            Bigger bags usually cost more per bag but less per gram. See where you land on both axes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BagSizeScatter
            rows={rows}
            yourBagSizeG={own?.bagSizeG ?? null}
            yourPriceCad={own?.unitPrice ?? null}
            yourLabel={own?.productName}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Full ranked list</CardTitle>
          <CardDescription>Click a column to sort. The arrow icon opens the retailer's page.</CardDescription>
        </CardHeader>
        <CardContent>
          <RankedTable
            rows={rows}
            you={
              own
                ? {
                    brand: own.brand,
                    product: own.productName,
                    bagSizeG: own.bagSizeG,
                    priceCad: own.unitPrice,
                    pricePerG: own.pricePerG,
                  }
                : null
            }
          />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Sourced from public retailer pages on {format(parseISO(audit.run.run_date), 'MMM d, yyyy')}.
        For internal benchmarking only.
      </p>
    </div>
  );
}

function StatCard({
  label, value, subtitle, accent,
}: { label: string; value: string; subtitle?: string; accent?: boolean }) {
  return (
    <Card className={accent ? 'border-primary' : undefined}>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-3xl font-semibold tabular-nums ${accent ? 'text-primary' : ''}`}>
          {value}
        </div>
        {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
      </CardContent>
    </Card>
  );
}

function percentileSubtitle(p: number): string {
  if (p >= 75) return 'Higher than 3/4 of brands';
  if (p >= 50) return 'Above the market median';
  if (p >= 25) return 'Below the median';
  return 'In the lowest quartile';
}
