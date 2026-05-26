import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TIER_RATES } from '@/components/bookings/bookingUtils';
import {
  type UnitEconomicsInputs,
  unitLabel,
  roastingCostPerKg,
  roastingOveragePerKg,
} from '@/lib/unitEconomics';
import {
  TIER_ORDER,
  computeCostAtAllTiers,
  findCheapestTier,
  computeStaticTierRanges,
} from '@/lib/unitEconomicsTierCompare';
import { cn } from '@/lib/utils';

interface Props {
  inputs: UnitEconomicsInputs;
}

export function TierComparePanel({ inputs }: Props) {
  const all = computeCostAtAllTiers(inputs);
  const cheapest = findCheapestTier(inputs);
  const current = inputs.tier;
  const ranges = computeStaticTierRanges();

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const fmtRoast = (n: number) => `$${n.toFixed(4)}`;
  const fmtKg = (n: number) => `${Math.round(n)}`;

  const rangeLabel = (tier: typeof TIER_ORDER[number]) => {
    const r = ranges[tier];
    if (r.maxKg == null) return `Best over ${fmtKg(r.minKg)} kg/mo`;
    if (r.minKg <= 0) return `Best under ${fmtKg(r.maxKg)} kg/mo`;
    return `Best ${fmtKg(r.minKg)}–${fmtKg(r.maxKg)} kg/mo`;
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tier comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="grid grid-cols-3 gap-2">
          {TIER_ORDER.map((tier) => {
            const isCheapest = tier === cheapest;
            const isCurrent = tier === current;
            const sum = all[tier];
            const label = TIER_RATES[tier]?.label ?? tier;
            return (
              <div
                key={tier}
                className={cn(
                  'rounded-md border p-3 flex flex-col gap-1.5 transition-colors',
                  isCheapest
                    ? 'border-success bg-success/5'
                    : 'border-border',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-semibold">{label}</span>
                  {isCheapest && (
                    <Badge variant="default" className="bg-success text-success-foreground text-[10px] px-1.5 py-0">
                      Best
                    </Badge>
                  )}
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Total /{unitLabel(inputs.displayUnit)}
                  </span>
                  <span className="text-base font-semibold tabular-nums">
                    {fmt(sum.perUnit.total)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-muted-foreground">Roast /kg</span>
                  <span className="text-xs tabular-nums">
                    {fmtRoast(inputs.forecastOverage ? roastingOveragePerKg(tier) : roastingCostPerKg(tier))}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {rangeLabel(tier)}
                </div>
                {isCurrent && (
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Your tier
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {current && cheapest !== current && (
          <p className="mt-3 text-xs text-muted-foreground">
            At your current inputs, <span className="font-semibold text-foreground">{TIER_RATES[cheapest]?.label}</span> tier would be cheapest per {unitLabel(inputs.displayUnit)}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
