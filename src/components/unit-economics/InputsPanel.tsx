import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { TIER_RATES } from '@/components/bookings/bookingUtils';
import {
  type UnitEconomicsInputs,
  type DisplayUnit,
  type GreenPriceUnit,
  type CoroastTier,
  roastingCostPerKg,
  roastingOveragePerKg,
  unitLabel,
} from '@/lib/unitEconomics';
import { findBestTierSavings } from '@/lib/unitEconomicsTierCompare';
import { TierComparePanel } from './TierComparePanel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  inputs: UnitEconomicsInputs;
  onChange: (next: UnitEconomicsInputs) => void;
  greenPrefilled: boolean;
  marketPricingPath?: string;
}

const BAG_PRESETS: Array<{ label: string; grams: number }> = [
  { label: '250g', grams: 250 },
  { label: '340g', grams: 340 },
  { label: '1kg', grams: 1000 },
  { label: '5lb', grams: 2268 },
];

function NumberField({
  value, onChange, placeholder, step = '0.01', min,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: string;
  min?: number;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? null : Number(v));
      }}
    />
  );
}

function HelpHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex" tabIndex={-1}>
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

export function InputsPanel({ inputs, onChange, greenPrefilled, marketPricingPath }: Props) {
  const set = <K extends keyof UnitEconomicsInputs>(k: K, v: UnitEconomicsInputs[K]) =>
    onChange({ ...inputs, [k]: v });

  const tier = inputs.tier;
  const tierData = tier ? TIER_RATES[tier] : null;
  const effectiveRate = roastingCostPerKg(tier);
  const overageRate = roastingOveragePerKg(tier);

  const SubBlock = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* HERO — costs framing anchor: bag size + display unit */}
      <Card className="border-2 border-primary/40 bg-primary/5 shadow-sm">
        <CardHeader className="py-5 px-6">
          <CardTitle className="text-lg font-bold">I want to see costs for…</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Set the bag size and the unit you want costs shown in. Everything below flows from this.
          </p>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-0 space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Bag size</Label>
            <div className="flex flex-wrap gap-2">
              {BAG_PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => set('bagSizeG', p.grams)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm cursor-pointer transition-colors',
                    inputs.bagSizeG === p.grams
                      ? 'border-primary bg-primary text-primary-foreground font-semibold'
                      : 'border-border bg-background hover:bg-accent',
                  )}
                >
                  {p.label}
                </button>
              ))}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">or</span>
                <div className="w-24">
                  <NumberField
                    value={inputs.bagSizeG}
                    onChange={(v) => set('bagSizeG', v ?? 340)}
                    step="1"
                    min={1}
                    placeholder="grams"
                  />
                </div>
                <span className="text-xs text-muted-foreground">g</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Show costs per</Label>
            <RadioGroup
              value={inputs.displayUnit}
              onValueChange={(v) => set('displayUnit', v as DisplayUnit)}
              className="grid grid-cols-3 gap-2"
            >
              {(['BAG', 'KG', 'LB'] as DisplayUnit[]).map(u => (
                <Label
                  key={u}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 cursor-pointer text-sm',
                    inputs.displayUnit === u
                      ? 'border-primary bg-primary text-primary-foreground font-semibold'
                      : 'border-border bg-background hover:bg-accent',
                  )}
                >
                  <RadioGroupItem value={u} className="sr-only" />
                  {u === 'BAG' ? 'Bag' : u === 'KG' ? 'Kilogram' : 'Pound'}
                </Label>
              ))}
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      {/* VOLUME */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-bold uppercase tracking-wide">Volume</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Monthly volume — kg roasted per month</Label>
            <NumberField
              value={inputs.monthlyKg}
              onChange={(v) => set('monthlyKg', v)}
              placeholder="e.g. 80"
            />
            <TierCrossoverHint inputs={inputs} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Co-roasting tier</Label>
            <Select
              value={inputs.tier ?? ''}
              onValueChange={(v) => set('tier', (v || null) as CoroastTier | null)}
            >
              <SelectTrigger><SelectValue placeholder="Select a tier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">{TIER_RATES.MEMBER?.label ?? 'Member'}</SelectItem>
                <SelectItem value="GROWTH">{TIER_RATES.GROWTH?.label ?? 'Growth'}</SelectItem>
                <SelectItem value="PRODUCTION">{TIER_RATES.PRODUCTION?.label ?? 'Production'}</SelectItem>
              </SelectContent>
            </Select>
            {tier && tierData ? (
              <div className="space-y-2 pt-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    Effective rate
                    <HelpHint
                      text={`Based on ${tierData.label} tier: $${tierData.base}/mo for ${tierData.includedHours} included hours. Roasting capacity is 40 kg/hour.`}
                    />
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    ${effectiveRate.toFixed(4)}/kg
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="ue-overage" className="text-xs cursor-pointer">
                      I'll exceed my included hours this month
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Use overage rate of ${overageRate.toFixed(4)}/kg
                    </p>
                  </div>
                  <Switch
                    id="ue-overage"
                    checked={inputs.forecastOverage}
                    onCheckedChange={(v) => set('forecastOverage', v)}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <TierComparePanel inputs={inputs} />
        </CardContent>
      </Card>

      {/* INPUT COSTS */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-bold uppercase tracking-wide">Input costs</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 space-y-4">
          <SubBlock title="Green coffee">
            <div className="space-y-1.5">
              <Label className="text-xs">Green price per {inputs.greenPriceUnit === 'KG' ? 'kg' : 'lb'}</Label>
              <div className="flex gap-2">
                <NumberField
                  value={inputs.greenPrice}
                  onChange={(v) => set('greenPrice', v)}
                  placeholder="e.g. 6.50"
                />
                <RadioGroup
                  value={inputs.greenPriceUnit}
                  onValueChange={(v) => set('greenPriceUnit', v as GreenPriceUnit)}
                  className="flex gap-1"
                >
                  {(['LB', 'KG'] as GreenPriceUnit[]).map(u => (
                    <Label
                      key={u}
                      className={cn(
                        'flex items-center justify-center rounded-md border px-3 text-xs cursor-pointer',
                        inputs.greenPriceUnit === u ? 'border-primary bg-primary/5 font-semibold' : 'border-border',
                      )}
                    >
                      <RadioGroupItem value={u} className="sr-only" />
                      /{u.toLowerCase()}
                    </Label>
                  ))}
                </RadioGroup>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {greenPrefilled && inputs.greenPrice != null
                  ? 'Pre-filled from your latest green coffee lot — adjust as needed.'
                  : "We don't have your green coffee data yet — enter it here."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Yield loss %</Label>
              <NumberField
                value={inputs.yieldLossPct}
                onChange={(v) => set('yieldLossPct', v ?? 0)}
                step="0.1"
                min={0}
              />
            </div>
          </SubBlock>

          <SubBlock title="Packaging">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                Packaging cost per bag
                <HelpHint text="Include bag, label, valve, tie, inserts — your full per-bag packaging cost." />
              </Label>
              <NumberField
                value={inputs.packagingPerBag}
                onChange={(v) => set('packagingPerBag', v)}
                placeholder="e.g. 0.85"
              />
              {inputs.displayUnit !== 'BAG' && (
                <p className="text-[11px] text-muted-foreground">
                  Packaging only applies when costs are shown per bag.
                </p>
              )}
            </div>
          </SubBlock>

          <SubBlock title="Labour">
            <div className="flex items-center justify-between">
              <Label htmlFor="ue-labour" className="text-xs cursor-pointer flex items-center gap-1.5">
                Include labour in my costs?
                <HelpHint text="If you pay someone to do roasting or packing, put their hourly rate here. If you do it all yourself and don't want to pay yourself on paper, leave it blank or off." />
              </Label>
              <Switch
                id="ue-labour"
                checked={inputs.includeLabour}
                onCheckedChange={(v) => set('includeLabour', v)}
              />
            </div>
            {inputs.includeLabour && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Roasting labour ($/hour)</Label>
                <NumberField
                  value={inputs.labourRatePerHour}
                  onChange={(v) => set('labourRatePerHour', v ?? 0)}
                  step="0.50"
                  min={0}
                  placeholder="e.g. 25"
                />
              </div>
            )}
          </SubBlock>

          <SubBlock title="Overhead">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                Monthly overhead $
                <HelpHint text="Rent, insurance, admin, utilities — anything that doesn't scale with volume. Most people just leave this blank — only fill it in if you want a fully-loaded cost picture." />
              </Label>
              <NumberField
                value={inputs.overheadMonthly}
                onChange={(v) => set('overheadMonthly', v)}
                placeholder="e.g. 500"
              />
            </div>
          </SubBlock>
        </CardContent>
      </Card>

      {/* PRICING */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-bold uppercase tracking-wide">Pricing</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 space-y-4">
          <PriceWithSlider
            label={`Wholesale price per ${unitLabel(inputs.displayUnit)}`}
            value={inputs.wholesalePrice}
            onChange={(v) => set('wholesalePrice', v)}
            maxRef={inputs.retailPrice ?? 30}
          />
          <PriceWithSlider
            label={`Retail price per ${unitLabel(inputs.displayUnit)}`}
            value={inputs.retailPrice}
            onChange={(v) => set('retailPrice', v)}
            maxRef={inputs.retailPrice ?? 30}
          />
          <div className="space-y-1.5">
            <Label className="text-xs">Wholesale % of channel mix</Label>
            <NumberField
              value={inputs.wholesalePct}
              onChange={(v) => set('wholesalePct', Math.min(100, Math.max(0, v ?? 0)))}
              step="1"
              min={0}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Target retail margin % (optional)</Label>
            <NumberField
              value={inputs.targetRetailMarginPct ?? null}
              onChange={(v) => set('targetRetailMarginPct', v)}
              step="1"
              min={0}
              placeholder="e.g. 35"
            />
          </div>

          {marketPricingPath && (
            <Button
              asChild
              variant="default"
              className="w-full justify-between"
            >
              <Link to={marketPricingPath}>
                <span>Compare to regional market pricing</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TierCrossoverHint({ inputs }: { inputs: UnitEconomicsInputs }) {
  if (!inputs.tier) return null;
  const monthlyKg = inputs.monthlyKg ?? 0;
  if (monthlyKg <= 0) return null;
  const xo = findBestTierSavings(inputs, inputs.tier);
  if (!xo || xo.monthlySavings <= 0) return null;
  const bestLabel = TIER_RATES[xo.bestTier]?.label ?? xo.bestTier;
  const savings = xo.monthlySavings.toLocaleString('en-CA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return (
    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
      At {monthlyKg}kg/mo you'd save ~${savings}/mo at <span className="font-semibold">{bestLabel}</span> tier
    </div>
  );
}

function PriceWithSlider({
  label, value, onChange, maxRef,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  maxRef: number;
}) {
  const max = Math.max(20, maxRef * 2);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-3">
        <div className="w-24">
          <NumberField value={value} onChange={onChange} step="0.25" min={0} placeholder="0.00" />
        </div>
        <Slider
          value={[value ?? 0]}
          min={0}
          max={max}
          step={0.25}
          onValueChange={([v]) => onChange(v)}
          className="flex-1"
        />
      </div>
    </div>
  );
}
