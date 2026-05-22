import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Lock, Unlock } from 'lucide-react';
import { unitLabel, KG_PER_LB, G_PER_KG } from '@/lib/unitEconomics';
import type { ClientUnitEconomicsInputs } from '@/lib/clientUnitEconomics';
import { useLatestAudit } from '@/hooks/useMarketPriceAudit';
import { percentileOf } from '@/lib/marketPricingStats';

interface Props {
  inputs: ClientUnitEconomicsInputs;
  totalCost: number;                    // per displayUnit
  onChange: (retail: number, wholesale: number) => void;
}

/** Convert a price in the current displayUnit into CAD per gram (for market comparison). */
function toPricePerG(price: number, inputs: ClientUnitEconomicsInputs): number {
  if (!price || price <= 0) return 0;
  switch (inputs.displayUnit) {
    case 'BAG': return inputs.bagSizeG > 0 ? price / inputs.bagSizeG : 0;
    case 'KG':  return price / G_PER_KG;
    case 'LB':  return price / (KG_PER_LB * G_PER_KG);
  }
}

type Tier = { label: string; tone: 'muted' | 'value' | 'mid' | 'premium' | 'outlier' };
function tierFromPercentile(p: number | null): Tier | null {
  if (p == null) return null;
  if (p < 10)  return { label: 'Below market',  tone: 'outlier' };
  if (p < 33)  return { label: 'Value tier',    tone: 'value' };
  if (p < 67)  return { label: 'Mid-market',    tone: 'mid' };
  if (p <= 90) return { label: 'Premium tier',  tone: 'premium' };
  return { label: 'Outlier — high', tone: 'outlier' };
}

const toneClass: Record<Tier['tone'], string> = {
  muted:    'bg-muted text-muted-foreground',
  value:    'bg-emerald-100 text-emerald-900 border-emerald-200',
  mid:      'bg-sky-100 text-sky-900 border-sky-200',
  premium:  'bg-violet-100 text-violet-900 border-violet-200',
  outlier:  'bg-amber-100 text-amber-900 border-amber-200',
};

export function RetailPriceBuilder({ inputs, totalCost, onChange }: Props) {
  const unit = unitLabel(inputs.displayUnit);
  const targetRetail = inputs.retailPrice ?? 0;
  const targetWholesale = inputs.wholesalePrice ?? 0;

  const marginPct = (price: number) => (price > 0 && totalCost >= 0 ? ((price - totalCost) / price) * 100 : 0);

  // Dollar spread between retail and wholesale = gross margin available to the wholesaler.
  const targetSpread = Math.max(0, targetRetail - targetWholesale);

  // Working retail price — seeded from the target retail price.
  const [retail, setRetail] = useState<number>(targetRetail);
  const [lockSpread, setLockSpread] = useState<boolean>(true);
  const [lockedSpread, setLockedSpread] = useState<number>(targetSpread);

  // Re-seed working values when the underlying target changes (scenario switch, edit).
  useEffect(() => {
    setRetail(targetRetail);
    setLockedSpread(targetSpread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRetail, targetWholesale, totalCost]);

  /** Wholesale price = retail - locked dollar spread (clamped to >= 0). */
  const wholesaleFromSpread = (r: number): number => Math.max(0, r - lockedSpread);

  const wholesale = lockSpread ? wholesaleFromSpread(retail) : targetWholesale;

  const retailMargin = retail > 0 ? marginPct(retail) : null;
  const wholesaleMargin = wholesale > 0 ? marginPct(wholesale) : null;
  const retailVsTarget = retail - targetRetail;
  const wholesaleVsTarget = wholesale - targetWholesale;

  // Market positioning
  const { data: audit } = useLatestAudit();
  const ppgValues = useMemo(
    () => (audit?.rows ?? []).map(r => r.price_per_g_cad).filter((v): v is number => v != null),
    [audit],
  );
  const yourPpg = toPricePerG(retail, inputs);
  const percentile = useMemo(
    () => (yourPpg > 0 && ppgValues.length > 0 ? percentileOf(yourPpg, ppgValues) : null),
    [yourPpg, ppgValues],
  );
  const tier = tierFromPercentile(percentile);

  const sliderMin = Math.max(0, Math.min(totalCost, targetRetail * 0.5));
  const sliderMax = Math.max(targetRetail * 1.5, totalCost * 2.5, retail * 1.2, 5);
  const step = inputs.displayUnit === 'BAG' ? 0.25 : 0.10;

  const commit = (nextRetail: number) => {
    const nextWholesale = lockGap ? wholesaleFromGap(nextRetail) : targetWholesale;
    onChange(Number(nextRetail.toFixed(2)), Number(nextWholesale.toFixed(2)));
  };


  const fmt = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);
  const fmtPct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);
  const fmtDelta = (n: number) => (n === 0 ? '—' : `${n > 0 ? '+' : ''}$${n.toFixed(2)}`);

  const noTargets = targetRetail <= 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Retail Price Builder — per {unit}
          </CardTitle>
          {tier && (
            <Badge variant="outline" className={toneClass[tier.tone]}>
              {tier.label}{percentile != null ? ` · ${Math.round(percentile)}th` : ''}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {noTargets ? (
          <p className="text-xs text-muted-foreground">
            Set a target retail price in the Pricing section to start building.
          </p>
        ) : (
          <>
            {/* Working retail price */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-3xl font-bold tabular-nums">{fmt(retail)}</span>
                <div className="text-right text-[11px] text-muted-foreground">
                  <div>Target {fmt(targetRetail)}</div>
                  <div>{retailVsTarget === 0 ? 'at target' : `${fmtDelta(retailVsTarget)} vs target`}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-24">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step={step}
                    min={0}
                    value={retail || ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      setRetail(v);
                      commit(v);
                    }}
                  />
                </div>
                <Slider
                  value={[retail]}
                  min={sliderMin}
                  max={sliderMax}
                  step={step}
                  onValueChange={([v]) => setRetail(v)}
                  onValueCommit={([v]) => commit(v)}
                  className="flex-1"
                />
              </div>
            </div>

            {/* Margin comparison */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border p-3 space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Retail margin</div>
                <div className="text-xl font-semibold tabular-nums">{fmtPct(retailMargin)}</div>
                <div className="text-[11px] text-muted-foreground">
                  Cost {fmt(totalCost)} → Retail {fmt(retail)}
                </div>
              </div>
              <div className="rounded border p-3 space-y-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Wholesale margin left</div>
                <div className="text-xl font-semibold tabular-nums">{fmtPct(wholesaleMargin)}</div>
                <div className="text-[11px] text-muted-foreground">
                  Wholesale {fmt(wholesale)} {wholesaleVsTarget !== 0 && `(${fmtDelta(wholesaleVsTarget)})`}
                </div>
              </div>
            </div>

            {/* Lock gap */}
            <div className="flex items-center justify-between rounded border px-3 py-2">
              <div className="flex items-center gap-2">
                {lockGap ? <Lock className="h-3.5 w-3.5 text-primary" /> : <Unlock className="h-3.5 w-3.5 text-muted-foreground" />}
                <Label htmlFor="lock-gap" className="text-xs cursor-pointer">
                  Lock retail – wholesale margin gap at {lockedGapPct.toFixed(1)}%
                </Label>
              </div>
              <Switch
                id="lock-gap"
                checked={lockGap}
                onCheckedChange={(v) => {
                  if (v) {
                    const gap = Math.max(0, (retailMargin ?? 0) - (wholesaleMargin ?? 0));
                    setLockedGapPct(gap);
                  }
                  setLockGap(v);
                }}
              />
            </div>

            {/* Market context detail */}
            <p className="text-[11px] text-muted-foreground">
              {audit && percentile != null
                ? `Market context: your retail price sits at the ${Math.round(percentile)}th percentile of ${ppgValues.length} Canadian specialty brands (latest audit ${audit.run.run_date}).`
                : audit
                  ? 'Pick a positive retail price to see where it lands in the market.'
                  : 'Market audit not published yet — margin comparisons only.'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
