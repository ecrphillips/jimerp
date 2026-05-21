import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { unitLabel } from '@/lib/unitEconomics';
import type { ClientUnitEconomicsInputs } from '@/lib/clientUnitEconomics';

interface Props {
  inputs: ClientUnitEconomicsInputs;
  suggestedRetailPrice: number;
  totalCost: number;
  onTargetMarginChange: (pct: number) => void;
  onApply: () => void;
}

export function MSRPCard({ inputs, suggestedRetailPrice, totalCost, onTargetMarginChange, onApply }: Props) {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const valid = totalCost > 0 && suggestedRetailPrice > 0 && Number.isFinite(suggestedRetailPrice);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Suggested MSRP — per {unitLabel(inputs.displayUnit)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-3xl font-bold tabular-nums">
            {valid ? fmt(suggestedRetailPrice) : '—'}
          </span>
          {valid && (
            <button
              type="button"
              onClick={onApply}
              className="text-xs text-primary hover:underline"
            >
              Use this as my retail price
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <Label>Target retail margin</Label>
            <span className="tabular-nums font-medium">{inputs.targetRetailMarginPct}%</span>
          </div>
          <Slider
            value={[inputs.targetRetailMarginPct]}
            min={30}
            max={70}
            step={1}
            onValueChange={([v]) => onTargetMarginChange(v)}
          />
        </div>

        <p className="text-[11px] text-muted-foreground">
          Starting point only — adjust based on your market, competition, and positioning.
        </p>
      </CardContent>
    </Card>
  );
}
