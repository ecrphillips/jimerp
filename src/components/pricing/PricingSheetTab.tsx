import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Plus,
  Trash2,
  Info,
  FileSpreadsheet,
  Printer,
  Save,
  RotateCcw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePricingAssumptions, usePackSpeedBands } from '@/hooks/usePricingAssumptions';
import { useSessionState } from '@/hooks/useSessionState';
import { useWeightUnit, type WeightUnit } from '@/hooks/useWeightUnit';
import { usePackagingCosts } from '@/hooks/usePackagingCosts';
import { PACKAGING_OPTIONS, type PackagingVariant } from '@/components/PackagingBadge';
import { gramsForVariant } from '@/lib/packagingWeights';
import { downloadPricingWorkbook, type ExportLine } from '@/lib/pricingExport';
import { SaveToProductDialog } from '@/components/pricing/SaveToProductDialog';
import { GreenReferencePicker } from '@/components/pricing/GreenReferencePicker';
import { toast } from 'sonner';
import {
  perKgToPerLb,
  KG_PER_LB,
  type PricingAssumptions,
  type PackSpeedBand,
} from '@/lib/pricingAssumptions';
import {
  calculateLine,
  forecast,
  TIER_PRESETS,
  TIER_ORDER,
  type TierKey,
  type CostStackConfig,
  type CostLineKey,
  type GreenSource,
  type GreenBasis,
  type BlendComponent,
  type PricingLineResult,
  type VolumeCadence,
  type PriceBreak,
} from '@/lib/pricingEngine';

// ---------------------------------------------------------------------------
// Sheet state
// ---------------------------------------------------------------------------

interface BreakRow {
  id: string;
  minUnits: string;
  margin: string;
}

interface BlendRow {
  id: string;
  label: string;
  pct: string;
  price: string;
}

interface SheetLine {
  id: string;
  label: string;
  tier: TierKey;
  overrides: Partial<CostStackConfig>;
  greenMode: 'FLAT' | 'BLEND';
  /** Undefined follows the tier default. */
  greenBasis?: GreenBasis;
  greenPrice: string;
  greenBenchmark: string;
  blend: BlendRow[];
  variant: PackagingVariant | '';
  grams: string;
  packagingMaterial: string;
  units: string;
}

const newId = () => crypto.randomUUID();

const emptyLine = (n: number): SheetLine => ({
  id: newId(),
  label: `Line ${n}`,
  tier: 'T4_PRIVATE_LABEL',
  overrides: {},
  greenMode: 'FLAT',
  greenPrice: '',
  greenBenchmark: '',
  blend: [],
  variant: '',
  grams: '',
  packagingMaterial: '',
  units: '',
});

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const money = (n: number | null, dp = 2): string =>
  n == null ? '—' : `$${n.toFixed(dp)}`;

/**
 * Storage keys are versioned: a shape change in a later build must not try to
 * restore state it can no longer read. Bump the suffix when SheetLine changes.
 */
const KEY = {
  lines: 'jim.pricing-sheet.v1.lines',
  breaks: 'jim.pricing-sheet.v1.breaks',
  cadence: 'jim.pricing-sheet.v1.cadence',
  margin: 'jim.pricing-sheet.v1.margin',
} as const;

/** Convert once on toggle, trimmed so the result is comfortable to edit. */
const trimText = (n: number): string => String(Number(n.toFixed(4)));

const LINE_ORDER: CostLineKey[] = [
  'green',
  'roasterRunning',
  'roastLabour',
  'packagingMaterial',
  'packLabour',
  'downstreamServices',
];

// ---------------------------------------------------------------------------

export function PricingSheetTab() {
  const { data: assumptionsRow, isLoading: loadingAssumptions } = usePricingAssumptions();
  const { data: bands = [] } = usePackSpeedBands();
  const { data: packagingCosts = {} } = usePackagingCosts();

  const [lines, setLines, clearLines] = useSessionState<SheetLine[]>(KEY.lines, [
    emptyLine(1),
  ]);
  const [marginText, setMarginText, clearMargin] = useSessionState(KEY.margin, '');
  const [cadence, setCadence, clearCadence] = useSessionState<VolumeCadence>(
    KEY.cadence,
    'MONTHLY',
  );
  const [breaks, setBreaks, clearBreaks] = useSessionState<BreakRow[]>(KEY.breaks, []);

  const assumptions: PricingAssumptions | null = assumptionsRow ?? null;

  const w = useWeightUnit();

  const priceBreaks: PriceBreak[] = useMemo(
    () =>
      breaks.map((b) => {
        const n = toNum(b.margin);
        return {
          minUnitsPerPeriod: toNum(b.minUnits) ?? 0,
          marginPerGreenKg: n == null ? null : w.rateFromDisplay(n),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breaks, w.unit],
  );



  /**
   * Values are held in whichever unit is on screen, so nothing converts while
   * being typed — that round trip is what made the old per-pound box
   * unusable. Flipping the toggle converts what is already entered, once.
   */
  const switchUnit = (next: WeightUnit) => {
    if (next === w.unit) return;
    const toLb = next === 'LB';
    const rate = (t: string) => {
      const n = toNum(t);
      if (n == null) return t;
      return trimText(toLb ? n * KG_PER_LB : n / KG_PER_LB);
    };
    const weight = (t: string) => {
      const n = toNum(t);
      if (n == null) return t;
      return trimText(toLb ? n / KG_PER_LB : n * KG_PER_LB);
    };

    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        greenPrice: rate(l.greenPrice),
        greenBenchmark: rate(l.greenBenchmark),
        blend: l.blend.map((b) => ({ ...b, price: rate(b.price) })),
        // Only a weight-priced line counts volume in weight; a packaged line
        // counts bags, which are not affected by the unit at all.
        units: TIER_PRESETS[l.tier].config.packagingMaterial ? l.units : weight(l.units),
      })),
    );
    setBreaks((prev) => prev.map((b) => ({ ...b, margin: rate(b.margin) })));
    setMarginText(rate(marginText));
    w.setUnit(next);
  };

  // Everything on screen is in the displayed unit; the engine only ever sees
  // per green kg.
  const marginDisplay = toNum(marginText);
  const marginKg = marginDisplay == null ? null : w.rateFromDisplay(marginDisplay);

  const patch = (id: string, next: Partial<SheetLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...next } : l)));

  const addLine = () => setLines((prev) => [...prev, emptyLine(prev.length + 1)]);

  const duplicateLine = (id: string) =>
    setLines((prev) => {
      const src = prev.find((l) => l.id === id);
      if (!src) return prev;
      const copy: SheetLine = {
        ...src,
        id: newId(),
        label: `${src.label} copy`,
        blend: src.blend.map((b) => ({ ...b, id: newId() })),
      };
      const at = prev.findIndex((l) => l.id === id);
      return [...prev.slice(0, at + 1), copy, ...prev.slice(at + 1)];
    });

  const removeLine = (id: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.id !== id)));

  /** Variant selection prefills weight and material cost, both still editable. */
  const chooseVariant = (line: SheetLine, v: PackagingVariant) => {
    const grams = gramsForVariant(v);
    const cost = packagingCosts[v]?.material_cost_per_unit;
    patch(line.id, {
      variant: v,
      grams: grams == null ? line.grams : String(grams),
      packagingMaterial: cost == null ? line.packagingMaterial : String(cost),
    });
  };

  /** A rate typed in the displayed unit, as the per-kg the engine expects. */
  const asPerKg = (text: string): number | null => {
    const n = toNum(text);
    return n == null ? null : w.rateFromDisplay(n);
  };

  const buildGreen = (line: SheetLine): GreenSource => {
    if (line.greenMode === 'BLEND') {
      const components: BlendComponent[] = line.blend.map((b) => ({
        label: b.label || 'Component',
        pctOfBlend: toNum(b.pct) ?? 0,
        pricePerKg: asPerKg(b.price),
      }));
      return { kind: 'BLEND', components };
    }
    return { kind: 'FLAT', pricePerKg: asPerKg(line.greenPrice) };
  };

  const results = useMemo(() => {
    if (!assumptions) return new Map<string, PricingLineResult>();
    const out = new Map<string, PricingLineResult>();
    for (const line of lines) {
      out.set(
        line.id,
        calculateLine(
          {
            tier: line.tier,
            configOverrides: line.overrides,
            green: buildGreen(line),
            greenBenchmarkPerKg: asPerKg(line.greenBenchmark),
            greenBasis: line.greenBasis,
            gramsPerUnit: toNum(line.grams),
            packagingMaterialPerUnit: toNum(line.packagingMaterial),
            marginPerGreenKg: marginKg,
            priceBreaks,
            unitsPerPeriod: toNum(line.units),
          },
          assumptions,
          bands,
        ),
      );
    }
    return out;
  }, [lines, assumptions, bands, marginKg, priceBreaks, w.unit]);

  const totals = useMemo(() => {
    let greenKg = 0;
    let revenue = 0;
    let margin = 0;
    let cost = 0;
    let complete = true;

    for (const line of lines) {
      const r = results.get(line.id);
      const units = toNum(line.units);
      if (!r || units == null || units <= 0) continue;
      const f = forecast(r, { cadence, unitsPerPeriod: units });
      if (f.greenKgPerPeriod == null || f.revenuePerPeriod == null) {
        complete = false;
        continue;
      }
      greenKg += f.greenKgPerPeriod;
      revenue += f.revenuePerPeriod;
      margin += f.marginPerPeriod ?? 0;
      cost += f.costPerPeriod ?? 0;
    }
    return { greenKg, revenue, margin, cost, complete };
  }, [lines, results, cadence]);

  const [exporting, setExporting] = useState(false);

  const clearSheet = () => {
    clearLines();
    clearBreaks();
    clearCadence();
    clearMargin();
    toast.success('Sheet cleared');
  };

  const onExportExcel = async () => {
    if (!assumptions) return;
    setExporting(true);
    try {
      const exportLines: ExportLine[] = lines.map((line) => {
        const r = results.get(line.id);
        return {
          label: line.label,
          tierLabel: TIER_PRESETS[line.tier].label,
          includes: r?.config ?? TIER_PRESETS[line.tier].config,
          greenBasis: r?.greenBasis ?? TIER_PRESETS[line.tier].defaultGreenBasis,
          benchmarkPerKg: toNum(line.greenBenchmark),
          marketPerKg: r?.greenMarketValuePerKg ?? null,
          gramsPerUnit: toNum(line.grams),
          packagingMaterialPerUnit: toNum(line.packagingMaterial),
          servicesPerUnit: null,
          unitsPerPeriod: toNum(line.units),
        };
      });
      await downloadPricingWorkbook({
        assumptions,
        bands,
        lines: exportLines,
        marginPerGreenKg: marginKg,
        priceBreaks,
        cadence,
        generatedAt: new Date(),
      });
      toast.success('Workbook exported');
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setExporting(false);
    }
  };

  if (loadingAssumptions) return <p className="text-muted-foreground">Loading…</p>;

  if (!assumptions) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No pricing assumptions found. The pricing assumptions migration has not been applied to
          this database yet.
        </AlertDescription>
      </Alert>
    );
  }

  const assumptionsIncomplete =
    assumptions.roast_throughput_green_kg_per_hr == null ||
    assumptions.machine_running_cost_per_hr == null ||
    assumptions.standard_yield_loss_pct == null;

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground print:hidden">
        This sheet is kept while the browser tab stays open, so you can navigate away and come
        back. Closing the tab clears it — export before you go if you want to keep it.
      </p>

      {assumptionsIncomplete && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Some pricing assumptions are not set, so cost floors cannot be calculated. Fill them in
            on the{' '}
            <Link to="/accounts/pricing" className="underline font-medium">
              Assumptions tab
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {/* --- Margin dial + cadence ------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Margin</CardTitle>
          <CardDescription>
            Our fee, charged on every green kilogram consumed. Applies to every line below. Costs
            are the floor; this is the part that creates cash.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <Label htmlFor="margin">Margin per {w.greenSuffix}</Label>
              <Input
                id="margin"
                type="number"
                step="0.25"
                placeholder="Not set"
                value={marginText}
                onChange={(e) => setMarginText(e.target.value)}
              />
              {marginDisplay != null && (
                <p className="mt-1 text-xs text-muted-foreground font-mono">
                  {w.unit === 'LB'
                    ? `$${w.rateFromDisplay(marginDisplay).toFixed(4)} per green kg`
                    : `$${perKgToPerLb(marginDisplay).toFixed(4)} per green lb`}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="unit">Work in</Label>
              <Select value={w.unit} onValueChange={(v) => switchUnit(v as WeightUnit)}>
                <SelectTrigger id="unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LB">Pounds</SelectItem>
                  <SelectItem value="KG">Kilograms</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Converts what is already entered. Stored and exported in kg either way.
              </p>
            </div>
            <div>
              <Label htmlFor="cadence">Volume cadence</Label>
              <Select value={cadence} onValueChange={(v) => setCadence(v as VolumeCadence)}>
                <SelectTrigger id="cadence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="WEEKLY">Weekly (legacy accounts)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <VolumeBreaks
            rows={breaks}
            onChange={setBreaks}
            cadence={cadence}
            baseMargin={marginKg}
          />
        </CardContent>
      </Card>

      {/* --- Lines ----------------------------------------------------------- */}
      {lines.map((line, i) => (
        <LineCard
          key={line.id}
          line={line}
          index={i}
          result={results.get(line.id)}
          cadence={cadence}
          assumptions={assumptions}
          bands={bands}
          w={w}
          packagingCosts={packagingCosts}
          onPatch={(next) => patch(line.id, next)}
          onChooseVariant={(v) => chooseVariant(line, v)}
          onDuplicate={() => duplicateLine(line.id)}
          onRemove={() => removeLine(line.id)}
          canRemove={lines.length > 1}
        />
      ))}

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" onClick={addLine}>
          <Plus className="h-4 w-4 mr-1" /> Add line
        </Button>
        <div className="flex-1" />
        <Button variant="outline" onClick={onExportExcel} disabled={exporting}>
          <FileSpreadsheet className="h-4 w-4 mr-1" />
          {exporting ? 'Building…' : 'Export to Excel'}
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Print / Save as PDF
        </Button>
        <Button variant="ghost" onClick={clearSheet} title="Start a new sheet">
          <RotateCcw className="h-4 w-4 mr-1" /> Clear sheet
        </Button>
      </div>

      {/* --- Totals ----------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Sheet total</CardTitle>
          <CardDescription>
            Across every line with a volume set, per {cadence === 'MONTHLY' ? 'month' : 'week'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!totals.complete && (
            <Alert className="mb-4">
              <Info className="h-4 w-4" />
              <AlertDescription>
                Some lines are incomplete and are excluded from these totals.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat
              label="Green consumed"
              value={`${w.weightToDisplay(totals.greenKg).toFixed(1)} ${w.suffix}`}
            />
            <Stat label="Cost" value={money(totals.cost)} />
            <Stat label="Revenue" value={money(totals.revenue)} />
            <Stat label="Margin" value={money(totals.margin)} accent />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function VolumeBreaks({
  rows,
  onChange,
  cadence,
  baseMargin,
}: {
  rows: BreakRow[];
  onChange: (next: BreakRow[]) => void;
  cadence: VolumeCadence;
  baseMargin: number | null;
}) {
  const period = cadence === 'MONTHLY' ? 'month' : 'week';

  const add = () =>
    onChange([...rows, { id: newId(), minUnits: '', margin: '' }]);

  const patch = (id: string, next: Partial<BreakRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...next } : r)));

  return (
    <div className="mt-6 border-t pt-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Volume breaks</p>
        <p className="text-xs text-muted-foreground">
          A break lowers the margin at volume, never the cost floor — so the floor stays visible
          underneath and a discount can be checked against it. Each line takes the highest break its
          own volume reaches.
        </p>
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground">
            <span>From units per {period}</span>
            <span>Margin $/green kg</span>
            <span className="w-8" />
          </div>
          {rows.map((r) => {
            const margin = toNum(r.margin);
            const delta = margin != null && baseMargin != null ? margin - baseMargin : null;
            return (
              <div key={r.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <Input
                  type="number"
                  step="1"
                  placeholder="e.g. 500"
                  value={r.minUnits}
                  onChange={(e) => patch(r.id, { minUnits: e.target.value })}
                  className="h-8"
                />
                <div className="relative">
                  <Input
                    type="number"
                    step="0.25"
                    placeholder="Not set"
                    value={r.margin}
                    onChange={(e) => patch(r.id, { margin: e.target.value })}
                    className="h-8"
                  />
                  {delta != null && delta !== 0 && (
                    <span
                      className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs ${
                        delta < 0 ? 'text-muted-foreground' : 'text-destructive'
                      }`}
                    >
                      {delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(2)}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-8 px-0"
                  onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Add break
      </Button>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`font-mono text-lg font-semibold ${accent ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

interface LineCardProps {
  line: SheetLine;
  index: number;
  result: PricingLineResult | undefined;
  cadence: VolumeCadence;
  assumptions: PricingAssumptions;
  bands: PackSpeedBand[];
  w: ReturnType<typeof useWeightUnit>;
  packagingCosts: Record<string, { material_cost_per_unit: number }>;
  onPatch: (next: Partial<SheetLine>) => void;
  onChooseVariant: (v: PackagingVariant) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  canRemove: boolean;
}

function LineCard({
  line,
  result,
  cadence,
  assumptions,
  bands,
  w,
  packagingCosts,
  onPatch,
  onChooseVariant,
  onDuplicate,
  onRemove,
  canRemove,
}: LineCardProps) {
  const [showLines, setShowLines] = useState(true);
  const [saveOpen, setSaveOpen] = useState(false);
  const preset = TIER_PRESETS[line.tier];
  const config = result?.config;
  const basis = line.greenBasis ?? preset.defaultGreenBasis;
  const benchmark = toNum(line.greenBenchmark);
  // No per-unit cost line means there is no bag: the line is sold by weight.
  const weightPriced = result?.isWeightPriced ?? false;
  /** A canonical per-kg figure from the engine, shown in the chosen unit. */
  const asDisplayRate = (perKg: number | null) =>
    perKg == null ? null : w.rateToDisplay(perKg);
  const pkgReference = line.variant
    ? (packagingCosts[line.variant]?.material_cost_per_unit ?? null)
    : null;
  // Both sides in the displayed unit: benchmark as typed, market brought back
  // from the engine's canonical per kg.
  const market =
    result?.greenMarketValuePerKg == null ? null : w.rateToDisplay(result.greenMarketValuePerKg);
  const headroom = benchmark != null && market != null ? benchmark - market : null;
  const units = toNum(line.units);
  const f =
    result && units
      ? forecast(
          result,
          weightPriced
            ? { cadence, greenKgPerPeriod: w.weightFromDisplay(units) }
            : { cadence, unitsPerPeriod: units },
        )
      : null;

  const setBlend = (next: BlendRow[]) => onPatch({ blend: next });

  return (
    <Card data-line-card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-[12rem]">
            <Input
              value={line.label}
              onChange={(e) => onPatch({ label: e.target.value })}
              className="font-semibold text-base border-0 px-0 shadow-none focus-visible:ring-0"
              placeholder="Line name"
            />
            <CardDescription className="mt-1">{preset.description}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveOpen(true)}
              title="Save this price to a product"
              className="print:hidden"
            >
              <Save className="h-4 w-4 mr-1" /> Save to product
            </Button>
            <Button variant="ghost" size="sm" onClick={onDuplicate} title="Duplicate line">
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={!canRemove}
              title="Remove line"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ---- Inputs ---- */}
          <div className="space-y-4">
            <div>
              <Label htmlFor={`tier-${line.id}`}>Configuration</Label>
              <Select
                value={line.tier}
                onValueChange={(v) => onPatch({ tier: v as TierKey, overrides: {}, greenBasis: undefined })}
              >
                <SelectTrigger id={`tier-${line.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_ORDER.map((k) => (
                    <SelectItem key={k} value={k}>
                      {TIER_PRESETS[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {preset.ownsGreen ? 'We own the green.' : 'Client-supplied green.'} A configuration
                seeds the toggles — change any of them below.
              </p>
            </div>

            {config?.green && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label>Green</Label>
                  <Select
                    value={line.greenMode}
                    onValueChange={(v) => onPatch({ greenMode: v as 'FLAT' | 'BLEND' })}
                  >
                    <SelectTrigger className="w-36 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FLAT">Single coffee</SelectItem>
                      <SelectItem value="BLEND">Blend</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Price this line on</Label>
                  <Select
                    value={basis}
                    onValueChange={(v) => onPatch({ greenBasis: v as GreenBasis })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BENCHMARK">Benchmark ceiling</SelectItem>
                      <SelectItem value="MARKET">Market value, passed through</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {basis === 'BENCHMARK'
                      ? 'Priced on the ceiling, carried with headroom. Real coffee comes in under it.'
                      : 'Priced on the real coffee, lot by lot. A cheap lot is quoted cheap.'}
                  </p>
                </div>

                <GreenReferencePicker
                  toDisplay={w.rateToDisplay}
                  suffix={w.suffix}
                  onUseAsBenchmark={(v) => onPatch({ greenBenchmark: String(v.toFixed(2)) })}
                  onUseAsMarket={(v) =>
                    onPatch({ greenMode: 'FLAT', greenPrice: String(v.toFixed(2)) })
                  }
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`bench-${line.id}`} className="text-xs">
                      Benchmark $/{w.suffix}
                      {basis === 'BENCHMARK' && (
                        <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                          · prices this line
                        </span>
                      )}
                    </Label>
                    <Input
                      id={`bench-${line.id}`}
                      type="number"
                      step="0.01"
                      placeholder={basis === 'BENCHMARK' ? 'Not set' : 'Optional ceiling'}
                      value={line.greenBenchmark}
                      onChange={(e) => onPatch({ greenBenchmark: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`green-${line.id}`} className="text-xs">
                      Market value $/{w.suffix}
                      {basis === 'MARKET' && (
                        <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                          · prices this line
                        </span>
                      )}
                    </Label>
                    {line.greenMode === 'FLAT' ? (
                      <Input
                        id={`green-${line.id}`}
                        type="number"
                        step="0.01"
                        placeholder={basis === 'MARKET' ? 'Not set' : 'For comparison'}
                        value={line.greenPrice}
                        onChange={(e) => onPatch({ greenPrice: e.target.value })}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground pt-2">
                        {result?.greenMarketValuePerKg == null
                          ? 'From blend below'
                          : `$${result.greenMarketValuePerKg.toFixed(4)} from blend`}
                      </p>
                    )}
                  </div>
                </div>

                {line.greenMode === 'BLEND' && (
                  <BlendEditor rows={line.blend} onChange={setBlend} unitSuffix={w.suffix} />
                )}

                {headroom != null && (
                  <p className="text-xs font-mono text-muted-foreground">
                    Headroom {headroom >= 0 ? '' : '−'}${Math.abs(headroom).toFixed(2)}/{w.suffix}
                    {headroom >= 0 ? ' under the benchmark' : ' over the benchmark'}
                  </p>
                )}
              </div>
            )}

            {!weightPriced && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`variant-${line.id}`}>Packaging</Label>
                <Select
                  value={line.variant || undefined}
                  onValueChange={(v) => onChooseVariant(v as PackagingVariant)}
                >
                  <SelectTrigger id={`variant-${line.id}`}>
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PACKAGING_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`grams-${line.id}`}>Roasted per unit</Label>
                <div className="relative">
                  <Input
                    id={`grams-${line.id}`}
                    type="number"
                    step="1"
                    placeholder="Not set"
                    value={line.grams}
                    onChange={(e) => onPatch({ grams: e.target.value })}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    g
                  </span>
                </div>
              </div>
            </div>
            )}

            {config?.packagingMaterial && (
              <div>
                <Label htmlFor={`pkg-${line.id}`}>
                  Packaging material to bill back — $/unit
                </Label>
                <Input
                  id={`pkg-${line.id}`}
                  type="number"
                  step="0.01"
                  placeholder="Not set"
                  value={line.packagingMaterial}
                  onChange={(e) => onPatch({ packagingMaterial: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  What the bag, tin or can costs us, plus whatever markup recovers holding it.
                  This is the material we bill back; pack labour is separate and comes from
                  Assumptions.
                  {pkgReference != null && (
                    <>
                      {' '}
                      Prefilled from the packaging costs table at{' '}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => onPatch({ packagingMaterial: String(pkgReference) })}
                      >
                        ${pkgReference.toFixed(4)}
                      </button>
                      {' '}— override it for this quote, since every order buys packaging at a
                      different price.
                    </>
                  )}
                </p>
              </div>
            )}

            <div>
              <Label htmlFor={`units-${line.id}`}>
                {weightPriced ? `Green ${w.suffix}` : 'Units'} per{' '}
                {cadence === 'MONTHLY' ? 'month' : 'week'}
              </Label>
              <Input
                id={`units-${line.id}`}
                type="number"
                step="1"
                placeholder="Not set"
                value={line.units}
                onChange={(e) => onPatch({ units: e.target.value })}
              />
            </div>

            {config && (
              <ConfigToggles
                config={config}
                overrides={line.overrides}
                onChange={(next) => onPatch({ overrides: next })}
              />
            )}
          </div>

          {/* ---- Result ---- */}
          <div className="space-y-3">
            {result?.warnings.map((w, i) => (
              <Alert key={i} variant={w.kind === 'MISSING_INPUT' ? 'default' : 'destructive'}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-sm">{w.message}</AlertDescription>
              </Alert>
            ))}

            {result && (
              <Collapsible open={showLines} onOpenChange={setShowLines}>
                <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium py-1">
                  <span>Cost breakdown</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${showLines ? 'rotate-180' : ''}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  {LINE_ORDER.map((key) => {
                    const l = result.lines.find((x) => x.key === key)!;
                    if (!l.included) return null;
                    return (
                      <div key={key} className="rounded-md border bg-muted/40 p-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm">{l.label}</span>
                          <span className="font-mono text-sm font-semibold">
                            {l.perUnit == null ? (
                              <span className="italic font-normal text-muted-foreground">
                                Not set
                              </span>
                            ) : (
                              `$${l.perUnit.toFixed(4)}`
                            )}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {l.explanation}
                        </p>
                        <p className="text-xs text-muted-foreground/70">{l.source}</p>
                      </div>
                    );
                  })}
                  <p className="font-mono text-xs text-muted-foreground pt-1">
                    {result.greenKgExplanation}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}

            <div className="rounded-md border-2 p-3 space-y-2">
              {weightPriced ? (
                <>
                  <Row
                    label="Cost floor"
                    value={money(asDisplayRate(result?.costFloorPerGreenKg ?? null), 4)}
                    hint={`per ${w.greenSuffix}`}
                    tone="floor"
                  />
                  <Row
                    label="Margin"
                    value={money(asDisplayRate(result?.marginPerGreenKg ?? null), 4)}
                    hint={`per ${w.greenSuffix}`}
                  />
                  <div className="border-t pt-2">
                    <Row
                      label="Price"
                      value={money(asDisplayRate(result?.pricePerGreenKg ?? null), 2)}
                      hint={`per ${w.greenSuffix}`}
                      tone="price"
                      big
                    />
                  </div>
                  {result?.pricePerGreenKg != null && (
                    <p className="text-xs text-muted-foreground">
                      {w.unit === 'LB'
                        ? `${money(result.pricePerGreenKg, 2)} per green kg`
                        : `${money(perKgToPerLb(result.pricePerGreenKg), 2)} per green lb`}
                    </p>
                  )}
                </>
              ) : (
              <>
              <Row
                label="Cost floor"
                value={money(result?.costFloorPerUnit ?? null, 4)}
                hint="per unit"
                tone="floor"
              />
              <Row
                label="Margin"
                value={money(result?.marginPerUnit ?? null, 4)}
                hint="per unit"
              />
              {result?.appliedBreak && (
                <p className="text-xs text-muted-foreground">
                  Volume break at {result.appliedBreak.minUnitsPerPeriod} units:{' '}
                  <span className="font-mono">
                    ${w.rateToDisplay(Number(result.marginPerGreenKg)).toFixed(2)}/{w.greenSuffix}
                  </span>{' '}
                  instead of{' '}
                  <span className="font-mono">
                    ${w.rateToDisplay(Number(result.baseMarginPerGreenKg)).toFixed(2)}
                  </span>
                  .
                </p>
              )}
              <div className="border-t pt-2">
                <Row
                  label="Price"
                  value={money(result?.pricePerUnit ?? null, 2)}
                  hint="per unit"
                  tone="price"
                  big
                />
              </div>
              <div className="border-t pt-2 space-y-1">
                <Row
                  label="Cost floor"
                  value={money(asDisplayRate(result?.costFloorPerGreenKg ?? null), 4)}
                  hint={`per ${w.greenSuffix}`}
                  muted
                />
                <Row
                  label="Price"
                  value={money(asDisplayRate(result?.pricePerGreenKg ?? null), 4)}
                  hint={`per ${w.greenSuffix}`}
                  muted
                />
              </div>
              </>
              )}
            </div>

            {f && f.marginPerPeriod != null && (
              <div className="rounded-md border p-3 space-y-1">
                <Row
                  label={`Margin per ${cadence === 'MONTHLY' ? 'month' : 'week'}`}
                  value={money(f.marginPerPeriod)}
                  tone="price"
                />
                {cadence === 'WEEKLY' && (
                  <Row
                    label="Monthly equivalent"
                    value={money(f.marginPerMonth)}
                    muted
                  />
                )}
                <Row
                  label="Green consumed"
                  value={`${w.weightToDisplay(f.greenKgPerPeriod ?? 0).toFixed(1)} ${w.suffix}`}
                  muted
                />
              </div>
            )}
          </div>
        </div>
      </CardContent>

      <SaveToProductDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        lineLabel={line.label}
        result={result}
        assumptions={assumptions}
        bands={bands}
        benchmarkPerKg={benchmark}
        gramsPerUnit={toNum(line.grams)}
        packagingMaterialPerUnit={toNum(line.packagingMaterial)}
      />
    </Card>
  );
}

function Row({
  label,
  value,
  hint,
  tone,
  muted,
  big,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'floor' | 'price';
  muted?: boolean;
  big?: boolean;
}) {
  const colour =
    tone === 'floor'
      ? 'text-destructive'
      : tone === 'price'
        ? 'text-emerald-600 dark:text-emerald-400'
        : '';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-sm ${muted ? 'text-muted-foreground' : ''}`}>
        {label}
        {hint ? <span className="text-xs text-muted-foreground"> / {hint}</span> : null}
      </span>
      <span
        className={`font-mono font-semibold ${big ? 'text-lg' : 'text-sm'} ${muted ? 'text-muted-foreground' : colour}`}
      >
        {value}
      </span>
    </div>
  );
}

const TOGGLE_LABELS: Record<CostLineKey, string> = {
  green: 'Green',
  roasterRunning: 'Roaster time',
  roastLabour: 'Roast labour',
  packagingMaterial: 'Packaging',
  packLabour: 'Pack labour',
  downstreamServices: 'Downstream services',
};

function ConfigToggles({
  config,
  overrides,
  onChange,
}: {
  config: CostStackConfig;
  overrides: Partial<CostStackConfig>;
  onChange: (next: Partial<CostStackConfig>) => void;
}) {
  const [open, setOpen] = useState(false);
  const changed = Object.keys(overrides).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between text-sm text-muted-foreground py-1">
        <span>
          Cost lines included{changed > 0 ? ` · ${changed} changed from the preset` : ''}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid grid-cols-2 gap-2 pt-2">
        {(Object.keys(TOGGLE_LABELS) as CostLineKey[]).map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={config[key]}
              onCheckedChange={(v) => onChange({ ...overrides, [key]: v === true })}
            />
            {TOGGLE_LABELS[key]}
          </label>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function BlendEditor({
  rows,
  onChange,
  unitSuffix,
}: {
  rows: BlendRow[];
  onChange: (next: BlendRow[]) => void;
  unitSuffix: string;
}) {
  const total = rows.reduce((s, r) => s + (toNum(r.pct) ?? 0), 0);
  const add = () =>
    onChange([...rows, { id: newId(), label: '', pct: '', price: '' }]);
  const patch = (id: string, next: Partial<BlendRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...next } : r)));

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[1fr_4.5rem_5.5rem_2rem] gap-2 items-center">
          <Input
            placeholder="Component"
            value={r.label}
            onChange={(e) => patch(r.id, { label: e.target.value })}
            className="h-8"
          />
          <Input
            type="number"
            placeholder="%"
            value={r.pct}
            onChange={(e) => patch(r.id, { pct: e.target.value })}
            className="h-8"
          />
          <Input
            type="number"
            step="0.01"
            placeholder={`$/${unitSuffix}`}
            value={r.price}
            onChange={(e) => patch(r.id, { price: e.target.value })}
            className="h-8"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Component
        </Button>
        {rows.length > 0 && (
          <span
            className={`text-xs font-mono ${Math.abs(total - 100) > 0.001 ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {total}% of 100%
          </span>
        )}
      </div>
    </div>
  );
}

export default PricingSheetTab;
