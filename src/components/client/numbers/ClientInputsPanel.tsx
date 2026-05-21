import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { unitLabel, type DisplayUnit } from '@/lib/unitEconomics';
import type { ClientUnitEconomicsInputs, PaceMode } from '@/lib/clientUnitEconomics';
import type { ClientPrefills, ClientProductPrefill } from '@/lib/clientUnitEconomicsPrefill';
import { cn } from '@/lib/utils';

interface Props {
  inputs: ClientUnitEconomicsInputs;
  onChange: (next: ClientUnitEconomicsInputs) => void;
  prefills: ClientPrefills | undefined;
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

export function ClientInputsPanel({ inputs, onChange, prefills }: Props) {
  const set = <K extends keyof ClientUnitEconomicsInputs>(k: K, v: ClientUnitEconomicsInputs[K]) =>
    onChange({ ...inputs, [k]: v });

  const products: ClientProductPrefill[] = prefills?.products ?? [];
  const seasonalAvailable = prefills?.seasonalPaceKgPerMonth != null;
  const currentPace = prefills?.currentPaceKgPerMonth ?? 0;
  const seasonalPace = prefills?.seasonalPaceKgPerMonth ?? null;

  const handleProductChange = (productId: string) => {
    const p = products.find(x => x.productId === productId);
    if (!p) return;
    onChange({
      ...inputs,
      productId: p.productId,
      productName: p.productName,
      bagSizeG: p.bagSizeG,
      costPerBagFromUs: p.avgPricePerBag,
    });
  };

  const handlePaceChange = (mode: PaceMode) => {
    const next = mode === 'SEASONAL' && seasonalPace != null ? seasonalPace : currentPace;
    onChange({ ...inputs, paceMode: mode, monthlyKg: next > 0 ? Number(next.toFixed(2)) : inputs.monthlyKg });
  };

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

      {/* Product + cost from us */}
      <Section title="Your cost from Home Island">
        {products.length > 0 ? (
          <>
            {products.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Product</Label>
                <Select value={inputs.productId ?? ''} onValueChange={handleProductChange}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.productId} value={p.productId}>
                        {p.productName} ({p.bagSizeG}g · {p.bagsShipped90d} bags / 90d)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                Your cost per bag (from Home Island)
                <HelpHint text="Average price you paid for this product over the last 90 days. Adjust if your contract pricing differs." />
              </Label>
              <NumberField
                value={inputs.costPerBagFromUs}
                onChange={(v) => set('costPerBagFromUs', v)}
                placeholder="e.g. 12.50"
              />
              <p className="text-[11px] text-muted-foreground">
                Pre-filled from your recent orders — adjust as needed.
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs">Your cost per bag (from Home Island)</Label>
            <NumberField
              value={inputs.costPerBagFromUs}
              onChange={(v) => set('costPerBagFromUs', v)}
              placeholder="e.g. 12.50"
            />
            <p className="text-[11px] text-muted-foreground">
              No recent orders to pre-fill from — enter the price you pay per bag.
            </p>
          </div>
        )}
      </Section>

      <Section title="Volume">
        <div className="space-y-2">
          <Label className="text-xs">Pace assumption</Label>
          <RadioGroup
            value={inputs.paceMode}
            onValueChange={(v) => handlePaceChange(v as PaceMode)}
            className={cn('grid gap-2', seasonalAvailable ? 'grid-cols-2' : 'grid-cols-1')}
          >
            <Label
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 cursor-pointer text-xs',
                inputs.paceMode === 'CURRENT' ? 'border-primary bg-primary/5 font-semibold' : 'border-border',
              )}
            >
              <RadioGroupItem value="CURRENT" className="sr-only" />
              <span>Current pace (last 3 months)</span>
              <span className="text-[11px] text-muted-foreground font-normal">
                {currentPace > 0 ? `${currentPace.toFixed(1)} kg/mo` : 'No recent orders'}
              </span>
            </Label>
            {seasonalAvailable && (
              <Label
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 cursor-pointer text-xs',
                  inputs.paceMode === 'SEASONAL' ? 'border-primary bg-primary/5 font-semibold' : 'border-border',
                )}
              >
                <RadioGroupItem value="SEASONAL" className="sr-only" />
                <span>Seasonal pace (same quarter last year)</span>
                <span className="text-[11px] text-muted-foreground font-normal">
                  {seasonalPace!.toFixed(1)} kg/mo
                </span>
              </Label>
            )}
          </RadioGroup>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Kg roasted per month</Label>
          <NumberField
            value={inputs.monthlyKg}
            onChange={(v) => set('monthlyKg', v)}
            placeholder="e.g. 80"
          />
        </div>
      </Section>

      <Section title="Packaging (extras)" defaultOpen={false}>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            Extra packaging cost per bag
            <HelpHint text="Only your add-ons — custom labels, inserts, gift packaging. The bag itself is already in your cost from us." />
          </Label>
          <NumberField
            value={inputs.extraPackagingPerBag}
            onChange={(v) => set('extraPackagingPerBag', v)}
            placeholder="e.g. 0.45"
          />
          {inputs.displayUnit !== 'BAG' && (
            <p className="text-[11px] text-muted-foreground">
              Packaging only applies when costs are shown per bag.
            </p>
          )}
        </div>
      </Section>

      <Section title="Labour" defaultOpen={false}>
        <div className="flex items-center justify-between">
          <Label htmlFor="cli-labour" className="text-xs cursor-pointer">
            Include labour in my costs?
          </Label>
          <Switch
            id="cli-labour"
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

      <Section title="Overhead" defaultOpen={false}>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            Monthly overhead $
            <HelpHint text="Rent, insurance, staff, utilities — anything fixed that doesn't scale with volume." />
          </Label>
          <NumberField
            value={inputs.overheadMonthly}
            onChange={(v) => set('overheadMonthly', v)}
            placeholder="e.g. 2500"
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
