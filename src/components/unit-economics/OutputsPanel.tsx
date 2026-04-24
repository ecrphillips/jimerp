import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { CostBreakdownChart } from './CostBreakdownChart';
import {
  type UnitEconomicsInputs,
  costPerUnit,
  marginAt,
  monthlyView,
  unitLabel,
  unitLabelPlural,
} from '@/lib/unitEconomics';
import { cn } from '@/lib/utils';

interface Props {
  inputs: UnitEconomicsInputs;
  onChannelSplitChange: (wholesalePct: number) => void;
}

export function OutputsPanel({ inputs, onChannelSplitChange }: Props) {
  const perUnit = costPerUnit(inputs);
  const ws = marginAt(inputs.wholesalePrice, perUnit.total);
  const rt = marginAt(inputs.retailPrice, perUnit.total);
  const mv = monthlyView(inputs, perUnit);

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const fmtBig = (n: number) =>
    `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Cost breakdown — per {unitLabel(inputs.displayUnit)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CostBreakdownChart inputs={inputs} perUnit={perUnit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Per-{unitLabel(inputs.displayUnit)} summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left pb-2 font-medium">Metric</th>
                <th className="text-right pb-2 font-medium">Wholesale</th>
                <th className="text-right pb-2 font-medium">Retail</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr className="border-b">
                <td className="py-2">Selling price</td>
                <td className="py-2 text-right">{fmt(ws.price)}</td>
                <td className="py-2 text-right">{fmt(rt.price)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2">Cost per {unitLabel(inputs.displayUnit)}</td>
                <td className="py-2 text-right">{fmt(perUnit.total)}</td>
                <td className="py-2 text-right">{fmt(perUnit.total)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2">Gross margin</td>
                <td className={cn('py-2 text-right font-medium', ws.margin >= 0 ? 'text-success' : 'text-destructive')}>
                  {fmt(ws.margin)}
                </td>
                <td className={cn('py-2 text-right font-medium', rt.margin >= 0 ? 'text-success' : 'text-destructive')}>
                  {fmt(rt.margin)}
                </td>
              </tr>
              <tr>
                <td className="py-2">Margin %</td>
                <td className={cn('py-2 text-right font-medium', ws.marginPct >= 0 ? 'text-success' : 'text-destructive')}>
                  {ws.marginPct.toFixed(1)}%
                </td>
                <td className={cn('py-2 text-right font-medium', rt.marginPct >= 0 ? 'text-success' : 'text-destructive')}>
                  {rt.marginPct.toFixed(1)}%
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Monthly view
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <Label>Channel split</Label>
              <span>{inputs.wholesalePct}% wholesale · {100 - inputs.wholesalePct}% retail</span>
            </div>
            <Slider
              value={[inputs.wholesalePct]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => onChannelSplitChange(v)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Monthly production cost" value={fmtBig(mv.productionCost)} />
            <Stat label="Revenue at price mix" value={fmtBig(mv.revenue)} />
            <Stat
              label="Gross profit"
              value={fmtBig(mv.grossProfit)}
              tone={mv.grossProfit >= 0 ? 'good' : 'bad'}
            />
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            {mv.breakEvenUnits == null ? (
              <span className="text-muted-foreground">
                Set your prices, volume, and overhead to see your break-even point.
              </span>
            ) : mv.breakEvenUnits === 0 ? (
              <span className="text-success font-medium">
                Every {unitLabel(inputs.displayUnit)} sold is profit at these prices.
              </span>
            ) : (
              <>
                You need to sell{' '}
                <span className="font-semibold tabular-nums">
                  {Math.ceil(mv.breakEvenUnits).toLocaleString('en-CA')}
                </span>{' '}
                {unitLabelPlural(inputs.displayUnit)}/month to cover all costs at these prices.
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(
        'text-lg font-semibold tabular-nums mt-1',
        tone === 'good' && 'text-success',
        tone === 'bad' && 'text-destructive',
      )}>
        {value}
      </p>
    </div>
  );
}
