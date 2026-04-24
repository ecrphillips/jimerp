import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { useState } from 'react';
import { TIER_RATES } from '@/components/bookings/bookingUtils';
import {
  type UnitEconomicsInputs,
  type DisplayUnit,
  type GreenPriceUnit,
  roastingCostPerKg,
  roastingOveragePerKg,
  unitLabel,
} from '@/lib/unitEconomics';
import { cn } from '@/lib/utils';

interface Props {
  inputs: UnitEconomicsInputs;
  onChange: (next: UnitEconomicsInputs) => void;
  greenPrefilled: boolean;
}

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

function Section({
  title, children, defaultOpen = true,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none flex flex-row items-center justify-between py-3 px-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </CardTitle>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0 space-y-3">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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

export function InputsPanel({ inputs, onChange, greenPrefilled }: Props) {
  const set = <K extends keyof UnitEconomicsInputs>(k: K, v: UnitEconomicsInputs[K]) =>
    onChange({ ...inputs, [k]: v });

  const tier = inputs.tier;
  const tierData = tier ? TIER_RATES[tier] : null;
  const effectiveRate = roastingCostPerKg(tier);
  const overageRate = roastingOveragePerKg(tier);

  return (
    <div className="space-y-3">
      {/* Display unit */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="text-sm font-semibold">I want to see costs per…</Label>
          <RadioGroup
            value={inputs.displayUnit}
            onValueChange={(v) => set('displayUnit', v as DisplayUnit)}
            className="grid grid-cols-3 gap-2"
          >
            {(['BAG', 'KG', 'LB'] as DisplayUnit[]).map(u => (
              <Label
                key={u}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md border px-3 py-2 cursor-pointer text-sm',
                  inputs.displayUnit === u ? 'border-primary bg-primary/5 font-semibold' : 'border-border',
                )}
              >
                <RadioGroupItem value={u} className="sr-only" />
                {u === 'BAG' ? 'Bag' : u === 'KG' ? 'Kilogram' : 'Pound'}
              </Label>
            ))}
          </RadioGroup>
          {inputs.displayUnit === 'BAG' && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bag size (grams)</Label>
              <NumberField
                value={inputs.bagSizeG}
                onChange={(v) => set('bagSizeG', v ?? 340)}
                step="1"
                min={1}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Section title="Green coffee">
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
      </Section>

      <Section title="Packaging">
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
      </Section>

      <Section title="Roasting cost (Home Island)">
        {tier && tierData ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                Effective rate
                <HelpHint
                  text={`Based on your ${tierData.label} tier: $${tierData.base}/mo for ${tierData.includedHours} included hours. Roasting capacity is 40 kg/hour.`}
                />
              </span>
              <span className="text-base font-semibold tabular-nums">
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
        ) : (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <span className="text-base">—</span>
            <p>Contact us to set up your tier so we can calculate your roasting cost automatically.</p>
          </div>
        )}
      </Section>

      <Section title="Labour">
        <div className="flex items-center justify-between">
          <Label htmlFor="ue-labour" className="text-xs cursor-pointer">
            Include labour in my costs?
          </Label>
          <Switch
            id="ue-labour"
            checked={inputs.includeLabour}
            onCheckedChange={(v) => set('includeLabour', v)}
          />
        </div>
        {inputs.includeLabour && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Hours per batch</Label>
              <NumberField
                value={inputs.labourHoursPerBatch}
                onChange={(v) => set('labourHoursPerBatch', v ?? 0)}
                step="0.1"
                min={0}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Rate $/hour</Label>
              <NumberField
                value={inputs.labourRatePerHr}
                onChange={(v) => set('labourRatePerHr', v ?? 0)}
                step="0.50"
                min={0}
              />
            </div>
          </div>
        )}
      </Section>

      <Section title="Overhead">
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            Monthly overhead $
            <HelpHint text="Rent, insurance, admin, utilities — anything that doesn't scale with volume." />
          </Label>
          <NumberField
            value={inputs.overheadMonthly}
            onChange={(v) => set('overheadMonthly', v)}
            placeholder="e.g. 500"
          />
        </div>
      </Section>

      <Section title="Volume">
        <div className="space-y-1.5">
          <Label className="text-xs">Kg roasted per month</Label>
          <NumberField
            value={inputs.monthlyKg}
            onChange={(v) => set('monthlyKg', v)}
            placeholder="e.g. 80"
          />
        </div>
      </Section>

      <Section title="Pricing">
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
      </Section>
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
