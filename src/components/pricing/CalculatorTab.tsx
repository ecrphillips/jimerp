import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { calculatePrice } from '@/lib/pricing';

const BAG_SIZES = [
  { label: '250g', value: 250 },
  { label: '500g', value: 500 },
  { label: '1kg', value: 1000 },
  { label: '2kg', value: 2000 },
  { label: '5lb (2,268g)', value: 2268 },
];

export function CalculatorTab() {
  const [greenPerKg, setGreenPerKg] = useState('15');
  const [yieldLoss, setYieldLoss] = useState('16');
  const [bagSize, setBagSize] = useState('340');
  const [processRate, setProcessRate] = useState('5');
  const [pkgMaterial, setPkgMaterial] = useState('1.50');
  const [pkgLabour, setPkgLabour] = useState('0.75');
  const [adjustment, setAdjustment] = useState('0');
  const [adjustmentNote, setAdjustmentNote] = useState('');

  const adjVal = Number(adjustment) || 0;
  const noteRequired = adjVal !== 0;
  const noteMissing = noteRequired && !adjustmentNote.trim();

  const { result, error } = useMemo(() => {
    try {
      const r = calculatePrice({
        green_market_per_kg: Number(greenPerKg) || 0,
        yield_loss_pct: Number(yieldLoss) || 0,
        process_per_kg_green: Number(processRate) || 0,
        pkg_material_per_unit: Number(pkgMaterial) || 0,
        pkg_labour_per_unit: Number(pkgLabour) || 0,
        adjustment_per_unit: adjVal,
        adjustment_note: adjustmentNote || null,
        bag_size_g: Number(bagSize) || 0,
      });
      return { result: r, error: null as string | null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'Invalid input' };
    }
  }, [greenPerKg, yieldLoss, bagSize, processRate, pkgMaterial, pkgLabour, adjVal, adjustmentNote]);

  const marginPct = (result?.margin_pct ?? 0) * 100;
  const marginColor =
    marginPct >= 30
      ? 'text-emerald-600'
      : marginPct >= 15
        ? 'text-amber-600'
        : 'text-destructive';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="green">Green $/kg (market value)</Label>
            <Input
              id="green"
              type="number"
              step="0.01"
              value={greenPerKg}
              onChange={(e) => setGreenPerKg(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="yield">Yield loss %</Label>
            <div className="relative">
              <Input
                id="yield"
                type="number"
                step="0.1"
                placeholder="e.g. 16"
                value={yieldLoss}
                onChange={(e) => setYieldLoss(e.target.value)}
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            </div>
          </div>

          <div>
            <Label htmlFor="bag">Bag size</Label>
            <Select value={bagSize} onValueChange={setBagSize}>
              <SelectTrigger id="bag">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAG_SIZES.map((b) => (
                  <SelectItem key={b.value} value={String(b.value)}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="process">Process $/kg green</Label>
            <Input
              id="process"
              type="number"
              step="0.01"
              value={processRate}
              onChange={(e) => setProcessRate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Charged per kg of green consumed
            </p>
          </div>

          <div>
            <Label htmlFor="mat">Pkg material $/unit</Label>
            <Input
              id="mat"
              type="number"
              step="0.01"
              value={pkgMaterial}
              onChange={(e) => setPkgMaterial(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="lab">Pkg labour $/unit</Label>
            <Input
              id="lab"
              type="number"
              step="0.01"
              value={pkgLabour}
              onChange={(e) => setPkgLabour(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="adj">Adjustment $/unit</Label>
            <Input
              id="adj"
              type="number"
              step="0.01"
              value={adjustment}
              onChange={(e) => setAdjustment(e.target.value)}
            />
          </div>

          {noteRequired && (
            <div>
              <Label htmlFor="adj-note">Adjustment note</Label>
              <Input
                id="adj-note"
                value={adjustmentNote}
                onChange={(e) => setAdjustmentNote(e.target.value)}
                placeholder="Required when adjustment ≠ 0"
                className={noteMissing ? 'border-destructive' : ''}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : result ? (
            <div className="space-y-2 font-mono text-sm">
              <Row label="Green consumed per unit" value={`${result.green_consumed_per_unit.toFixed(3)} kg`} />
              <Row label="Roasted coffee cost" value={`$${result.roasted_coffee_cost_per_unit.toFixed(2)}`} />
              <Row label="Process charge" value={`$${result.process_per_unit.toFixed(2)}`} />
              <Row label="Pkg material" value={`$${result.pkg_material_per_unit.toFixed(2)}`} />
              <Row label="Pkg labour" value={`$${result.pkg_labour_per_unit.toFixed(2)}`} />
              <Row label="Adjustment" value={`$${result.adjustment_per_unit.toFixed(2)}`} />
              <div className="border-t my-2" />
              <Row
                label="Price per unit"
                value={`$${result.price_per_unit.toFixed(2)}`}
                bold
              />
              <div className="border-t my-2" />
              <Row
                label="Cost (coffee + pkg material)"
                value={`$${result.cost_per_unit.toFixed(2)}`}
              />
              <div className="flex justify-between items-baseline">
                <span className="text-muted-foreground">Margin</span>
                <span className={`font-semibold ${marginColor}`}>
                  {marginPct.toFixed(1)}%
                </span>
              </div>

              <p className="text-xs text-muted-foreground pt-4 leading-relaxed">
                Green consumed = bag size ÷ (1 − yield loss%). Process charge = process $/kg × green
                consumed.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? 'font-semibold text-base' : ''}>{value}</span>
    </div>
  );
}
