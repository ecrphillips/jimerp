import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  usePricingAssumptions,
  usePackSpeedBands,
  useSaveAssumptions,
  useSaveBandSpeed,
} from '@/hooks/usePricingAssumptions';
import {
  deriveBaseLabourRate,
  deriveLoadedLabourRate,
  deriveMachineCostPerGreenKg,
  deriveRoastLabourPerGreenKg,
  derivePackLabourPerUnit,
  deriveRoastedFromGreen,
  deriveGreenFromRoasted,
  validateBandCoverage,
  perKgToPerLb,
  type PricingAssumptions,
  type Derived,
} from '@/lib/pricingAssumptions';

/** Yield is illustrated off a round 1 kg so both directions read at a glance. */
const YIELD_SAMPLE_G = 1000;

type FieldKey = keyof PricingAssumptions;

/**
 * Every input is held as a string so an empty box stays empty rather than
 * collapsing to 0. Blank means "not set", and the derivations below refuse to
 * produce a number until every input they depend on has a value.
 */
type FormState = Record<FieldKey, string>;

const FIELD_KEYS: FieldKey[] = [
  'roast_throughput_green_kg_per_hr',
  'machine_running_cost_per_hr',
  'labour_salary_annual',
  'labour_weeks_per_year',
  'labour_hours_per_week',
  'labour_oncost_pct',
  'standard_yield_loss_pct',
  'green_financing_days',
  'green_financing_apr_pct',
];

const emptyForm = (): FormState =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, ''])) as FormState;

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const asAssumptions = (f: FormState): PricingAssumptions =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, toNum(f[k])])) as PricingAssumptions;

/** Money to four decimal places. The default for cost rates. */
const asMoney = (n: number): string => `$${n.toFixed(4)}`;

/** Whole grams, thousands-separated. Weights are not currency. */
const asGrams = (n: number): string => `${Math.round(n).toLocaleString('en-CA')} g`;

/**
 * Renders a derived value with the arithmetic that produced it, or "Not set".
 * `format` decides the unit — never assume currency, since some derivations
 * (yield) produce weights.
 */
function DerivedValue({
  label,
  derived,
  missingHint,
  suffix,
  format = asMoney,
}: {
  label: string;
  derived: Derived | null;
  missingHint: string;
  suffix?: string;
  format?: (n: number) => string;
}) {
  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        {derived ? (
          <span className="font-mono font-semibold">
            {format(derived.value)}
            {suffix ? <span className="text-muted-foreground font-normal"> {suffix}</span> : null}
          </span>
        ) : (
          <span className="text-sm italic text-muted-foreground">Not set</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground font-mono">
        {derived ? derived.explanation : missingHint}
      </p>
    </div>
  );
}

function NumField({
  id,
  label,
  value,
  onChange,
  hint,
  step = '0.01',
  unit,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  step?: string;
  unit?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          step={step}
          value={value}
          placeholder="Not set"
          onChange={(e) => onChange(e.target.value)}
          className={unit ? 'pr-16' : undefined}
        />
        {unit ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function AssumptionsTab() {
  const { data: row, isLoading } = usePricingAssumptions();
  const { data: bands = [] } = usePackSpeedBands();
  const saveAssumptions = useSaveAssumptions();
  const saveBand = useSaveBandSpeed();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [bandDraft, setBandDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!row) return;
    setForm(
      Object.fromEntries(
        FIELD_KEYS.map((k) => [k, row[k] == null ? '' : String(row[k])]),
      ) as FormState,
    );
  }, [row]);

  useEffect(() => {
    setBandDraft(
      Object.fromEntries(
        bands.map((b) => [b.id, b.units_per_hour == null ? '' : String(b.units_per_hour)]),
      ),
    );
  }, [bands]);

  const set = (k: FieldKey) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  const a = asAssumptions(form);
  const baseLabour = deriveBaseLabourRate(a);
  const loadedLabour = deriveLoadedLabourRate(a);
  const machinePerKg = deriveMachineCostPerGreenKg(a);
  const roastLabourPerKg = deriveRoastLabourPerGreenKg(a);
  const roastedFromGreen = deriveRoastedFromGreen(a, YIELD_SAMPLE_G);
  const greenFromRoasted = deriveGreenFromRoasted(a, YIELD_SAMPLE_G);
  const coverageProblems = validateBandCoverage(bands);

  const onSave = () => {
    if (!row) return;
    saveAssumptions.mutate(
      { id: row.id, ...asAssumptions(form) },
      {
        onSuccess: () => toast.success('Assumptions saved'),
        onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
      },
    );
  };

  const onSaveBand = (id: string) => {
    saveBand.mutate(
      { id, units_per_hour: toNum(bandDraft[id] ?? '') },
      {
        onSuccess: () => toast.success('Packing speed saved'),
        onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
      },
    );
  };

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  if (!row) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No assumptions row found. The pricing assumptions migration has not been applied to this
          database yet.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          These rates feed every price the calculator produces. Each derived figure shows the
          arithmetic behind it. A blank field stays blank — it is never treated as zero, and
          anything depending on it reads “Not set” until you fill it in.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Roasting</CardTitle>
            <CardDescription>
              Throughput converts roaster hours into green kg. Everything charged per green kg
              divides by it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <NumField
              id="throughput"
              label="Roast throughput"
              unit="green kg/hr"
              value={form.roast_throughput_green_kg_per_hr}
              onChange={set('roast_throughput_green_kg_per_hr')}
              hint="Green kg through the roaster per hour — not roasted kg."
            />
            <NumField
              id="machine"
              label="Machine running cost"
              unit="$/hr"
              value={form.machine_running_cost_per_hr}
              onChange={set('machine_running_cost_per_hr')}
              hint="Gas, power and wear to run the roaster for an hour."
            />
            <DerivedValue
              label="Roaster running cost"
              derived={machinePerKg}
              suffix="/ green kg"
              missingHint="Needs machine running cost and throughput."
            />
            <DerivedValue
              label="Roast labour"
              derived={roastLabourPerKg}
              suffix="/ green kg"
              missingHint="Needs the loaded labour rate and throughput."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Labour</CardTitle>
            <CardDescription>
              The hourly rate is derived from these four figures, never entered directly, so it can
              always be explained and revisited.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <NumField
                id="salary"
                label="Salary"
                unit="$/yr"
                step="100"
                value={form.labour_salary_annual}
                onChange={set('labour_salary_annual')}
              />
              <NumField
                id="oncost"
                label="Oncosts"
                unit="%"
                step="0.1"
                value={form.labour_oncost_pct}
                onChange={set('labour_oncost_pct')}
                hint="Payroll taxes, benefits, cover."
              />
              <NumField
                id="weeks"
                label="Weeks worked"
                unit="wks/yr"
                step="0.5"
                value={form.labour_weeks_per_year}
                onChange={set('labour_weeks_per_year')}
              />
              <NumField
                id="hours"
                label="Hours"
                unit="hrs/wk"
                step="0.5"
                value={form.labour_hours_per_week}
                onChange={set('labour_hours_per_week')}
              />
            </div>
            <DerivedValue
              label="Base rate"
              derived={baseLabour}
              suffix="/ hr"
              missingHint="Needs salary, weeks per year and hours per week."
            />
            <DerivedValue
              label="Loaded rate (used in costing)"
              derived={loadedLabour}
              suffix="/ hr"
              missingHint="Needs the base rate and an oncost percentage."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Yield</CardTitle>
            <CardDescription>
              Converts finished roasted weight into the green weight consumed to make it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <NumField
              id="yield"
              label="Standard yield loss"
              unit="%"
              step="0.1"
              value={form.standard_yield_loss_pct}
              onChange={set('standard_yield_loss_pct')}
              hint="Set above true measured loss; the gap absorbs batch loss and overpacking."
            />
            <DerivedValue
              label="1 kg green produces"
              derived={roastedFromGreen}
              format={asGrams}
              missingHint="Needs a standard yield loss percentage."
            />
            <DerivedValue
              label="1 kg roasted consumes"
              derived={greenFromRoasted}
              format={asGrams}
              missingHint="Needs a standard yield loss percentage."
            />
            <p className="text-xs text-muted-foreground">
              Shown both ways off a round kilogram. Pricing uses the second direction — every
              per-green-kg cost multiplies by the green a finished unit consumes.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Green financing</CardTitle>
            <CardDescription>
              Carry cost on a green position. Used by green lot costing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <NumField
                id="findays"
                label="Financing period"
                unit="days"
                step="1"
                value={form.green_financing_days}
                onChange={set('green_financing_days')}
              />
              <NumField
                id="finapr"
                label="APR"
                unit="%"
                step="0.1"
                value={form.green_financing_apr_pct}
                onChange={set('green_financing_apr_pct')}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Packing speed</CardTitle>
          <CardDescription>
            Banded by finished unit weight rather than by packaging type, so a new product size
            slots into an existing band automatically. Speed divides into the loaded labour rate to
            give pack labour per unit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {coverageProblems.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {coverageProblems.map((p, i) => (
                    <li key={i}>{p.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2">Band</th>
                <th className="pb-2">Units per hour</th>
                <th className="pb-2">Pack labour per unit</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => {
                const draft = bandDraft[b.id] ?? '';
                const previewBand = { ...b, units_per_hour: toNum(draft) };
                const midpoint = b.max_g == null ? b.min_g + 1 : Math.floor((b.min_g + b.max_g) / 2);
                const perUnit = derivePackLabourPerUnit(a, [previewBand], Math.max(1, midpoint));
                const dirty = draft !== (b.units_per_hour == null ? '' : String(b.units_per_hour));
                return (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{b.label}</td>
                    <td className="py-2 w-40">
                      <Input
                        type="number"
                        step="1"
                        placeholder="Not set"
                        value={draft}
                        onChange={(e) =>
                          setBandDraft((p) => ({ ...p, [b.id]: e.target.value }))
                        }
                      />
                    </td>
                    <td className="py-2 font-mono">
                      {perUnit ? (
                        `$${perUnit.value.toFixed(4)}`
                      ) : (
                        <span className="italic text-muted-foreground not-italic">Not set</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!dirty || saveBand.isPending}
                        onClick={() => onSaveBand(b.id)}
                      >
                        Save
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loadedLabour && (
            <p className="text-xs text-muted-foreground">
              Pack labour per unit stays blank until the loaded labour rate is set above.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Last updated {format(new Date(row.updated_at), 'MMM d, yyyy h:mm a')}
          {loadedLabour ? (
            <>
              {' · '}Loaded labour ${loadedLabour.value.toFixed(2)}/hr
            </>
          ) : null}
          {roastLabourPerKg ? (
            <>
              {' · '}Roast labour ${perKgToPerLb(roastLabourPerKg.value).toFixed(4)}/green lb
            </>
          ) : null}
        </p>
        <Button onClick={onSave} disabled={saveAssumptions.isPending}>
          {saveAssumptions.isPending ? 'Saving…' : 'Save assumptions'}
        </Button>
      </div>
    </div>
  );
}

export default AssumptionsTab;
