import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Copy, Pencil, Trash2, Printer, Check, Loader2 } from 'lucide-react';
import { OutputsPanel } from '@/components/unit-economics/OutputsPanel';
import { CostBreakdownChart } from '@/components/unit-economics/CostBreakdownChart';
import { ClientInputsPanel } from '@/components/client/numbers/ClientInputsPanel';
import { MSRPCard } from '@/components/client/numbers/MSRPCard';
import {
  DEFAULT_CLIENT_INPUTS, calculateClientUnitEconomics,
  type ClientUnitEconomicsInputs,
} from '@/lib/clientUnitEconomics';
import { unitLabel, unitLabelPlural } from '@/lib/unitEconomics';
import { formatCurrency } from '@/lib/currency';
import {
  useClientScenarios, useClientScenarioAutoSave, type ClientScenarioRow,
} from '@/hooks/useClientUnitEconomicsScenarios';
import { useClientPrefills, type ClientPrefills } from '@/lib/clientUnitEconomicsPrefill';

function seedFromPrefills(base: ClientUnitEconomicsInputs, prefills: ClientPrefills | undefined): ClientUnitEconomicsInputs {
  if (!prefills) return base;
  const topProduct = prefills.products[0];
  const pace = prefills.preferSeasonal && prefills.seasonalPaceKgPerMonth != null
    ? prefills.seasonalPaceKgPerMonth
    : prefills.currentPaceKgPerMonth;
  return {
    ...base,
    paceMode: prefills.preferSeasonal ? 'SEASONAL' : 'CURRENT',
    monthlyKg: pace > 0 ? Number(pace.toFixed(2)) : base.monthlyKg,
    productId: topProduct?.productId ?? null,
    productName: topProduct?.productName ?? null,
    bagSizeG: topProduct?.bagSizeG ?? base.bagSizeG,
    costPerBagFromUs: topProduct ? Number(topProduct.avgPricePerBag.toFixed(2)) : null,
  };
}

export default function ClientMyNumbers() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const accountId = previewAccountId ?? authUser?.accountId ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const { data: scenarios = [], isLoading: loadingScenarios } = useClientScenarios(accountId);
  const { data: prefills } = useClientPrefills(accountId);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<ClientUnitEconomicsInputs>(DEFAULT_CLIENT_INPUTS);
  const [accountName, setAccountName] = useState<string>('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const baselineLoaded = useRef(false);
  const autoCreated = useRef(false);

  useEffect(() => {
    if (!accountId) return;
    supabase.from('accounts').select('account_name').eq('id', accountId).maybeSingle()
      .then(({ data }) => setAccountName(data?.account_name ?? ''));
  }, [accountId]);

  // Pick initial scenario from URL query, else newest, else create one
  useEffect(() => {
    if (!accountId || loadingScenarios) return;
    const fromUrl = searchParams.get('scenario');
    if (fromUrl && scenarios.some(s => s.id === fromUrl)) {
      setActiveId(fromUrl);
      return;
    }
    if (scenarios.length > 0) {
      setActiveId(scenarios[0].id);
      return;
    }
    if (autoCreated.current) return;
    autoCreated.current = true;
    (async () => {
      const seed = seedFromPrefills(DEFAULT_CLIENT_INPUTS, prefills);
      const { data, error } = await supabase
        .from('client_unit_economics_scenarios')
        .insert({
          account_id: accountId,
          name: 'My first scenario',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          inputs: seed as any,
          created_by: authUser?.id ?? '',
        })
        .select()
        .single();
      if (!error && data) {
        qc.invalidateQueries({ queryKey: ['client-ue-scenarios'] });
        setActiveId(data.id);
      }
    })();
  }, [accountId, loadingScenarios, scenarios, searchParams, prefills, authUser, qc]);

  // Load active scenario inputs
  useEffect(() => {
    if (!activeId) return;
    const s = scenarios.find(x => x.id === activeId);
    if (s) {
      setInputs({ ...DEFAULT_CLIENT_INPUTS, ...s.inputs });
      baselineLoaded.current = true;
      if (searchParams.get('scenario') !== activeId) {
        const next = new URLSearchParams(searchParams);
        next.set('scenario', activeId);
        setSearchParams(next, { replace: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, scenarios]);

  const saveStatus = useClientScenarioAutoSave(activeId, inputs, baselineLoaded.current);

  const activeScenario = useMemo<ClientScenarioRow | undefined>(
    () => scenarios.find(s => s.id === activeId),
    [scenarios, activeId],
  );

  const calc = useMemo(() => calculateClientUnitEconomics(inputs), [inputs]);

  // ----- Scenario actions -----

  const newScenario = async () => {
    if (!accountId) return;
    const seed = seedFromPrefills(DEFAULT_CLIENT_INPUTS, prefills);
    const { data, error } = await supabase
      .from('client_unit_economics_scenarios')
      .insert({
        account_id: accountId,
        name: `Scenario ${scenarios.length + 1}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputs: seed as any,
        created_by: authUser?.id ?? '',
      })
      .select().single();
    if (error) { toast.error('Could not create scenario'); return; }
    qc.invalidateQueries({ queryKey: ['client-ue-scenarios'] });
    setActiveId(data.id);
    toast.success('New scenario created');
  };

  const duplicateScenario = async () => {
    if (!activeScenario || !accountId) return;
    const { data, error } = await supabase
      .from('client_unit_economics_scenarios')
      .insert({
        account_id: accountId,
        name: `${activeScenario.name} (copy)`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputs: inputs as any,
        created_by: authUser?.id ?? '',
      })
      .select().single();
    if (error) { toast.error('Could not duplicate'); return; }
    qc.invalidateQueries({ queryKey: ['client-ue-scenarios'] });
    setActiveId(data.id);
    toast.success('Scenario duplicated');
  };

  const renameScenario = async () => {
    if (!activeScenario || !renameValue.trim()) return;
    const { error } = await supabase
      .from('client_unit_economics_scenarios')
      .update({ name: renameValue.trim() })
      .eq('id', activeScenario.id);
    if (error) { toast.error('Could not rename'); return; }
    qc.invalidateQueries({ queryKey: ['client-ue-scenarios'] });
    setRenameOpen(false);
    toast.success('Renamed');
  };

  const deleteScenario = async () => {
    if (!activeScenario) return;
    const { error } = await supabase
      .from('client_unit_economics_scenarios')
      .delete().eq('id', activeScenario.id);
    if (error) { toast.error('Could not delete'); return; }
    qc.invalidateQueries({ queryKey: ['client-ue-scenarios'] });
    setActiveId(null);
    setDeleteOpen(false);
    toast.success('Scenario deleted');
  };

  // ----- Print -----

  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${accountName || 'My Numbers'} — ${activeScenario?.name ?? 'Scenario'}`,
  });

  if (!accountId) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          You need to be linked to an account to use My Numbers.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Numbers</h1>
          <p className="text-sm text-muted-foreground">
            Model your unit economics on the coffee you buy from Home Island.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={activeId ?? ''} onValueChange={setActiveId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select scenario" />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={newScenario}>
            <Plus className="h-4 w-4 mr-1" /> New
          </Button>
          <Button variant="outline" size="sm" onClick={duplicateScenario} disabled={!activeScenario}>
            <Copy className="h-4 w-4 mr-1" /> Duplicate
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => { setRenameValue(activeScenario?.name ?? ''); setRenameOpen(true); }}
            disabled={!activeScenario}
          >
            <Pencil className="h-4 w-4 mr-1" /> Rename
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)} disabled={!activeScenario}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
          <Button
            size="sm"
            onClick={() => handlePrint()}
            style={{ backgroundColor: '#1B5E8C' }}
            className="text-white hover:opacity-90"
          >
            <Printer className="h-4 w-4 mr-1" /> Export PDF / Print
          </Button>
        </div>
      </div>

      {/* Save status */}
      <div className="text-xs text-muted-foreground h-4">
        {saveStatus === 'saving' && (
          <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>
        )}
        {saveStatus === 'saved' && (
          <span className="inline-flex items-center gap-1 text-success"><Check className="h-3 w-3" /> Saved</span>
        )}
        {saveStatus === 'error' && <span className="text-destructive">Couldn't save — try again</span>}
      </div>

      {/* Market pricing link */}
      <Link
        to="/portal/market-pricing"
        className="block rounded-lg border border-primary/50 bg-card p-4 hover:border-primary hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">See how your retail price compares to the regional market</div>
            <div className="text-xs text-muted-foreground">
              Where your $/g sits in the Canadian specialty-coffee spectrum, updated monthly.
            </div>
            <p className="text-xs text-muted-foreground italic mt-1">
              Retail price data shown here is what is publicly available from each retailers own web store.
            </p>
          </div>
          <div className="text-primary text-sm font-medium">View market →</div>
        </div>
      </Link>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <ClientInputsPanel inputs={inputs} onChange={setInputs} prefills={prefills} />
        </div>
        <div className="lg:col-span-3 space-y-4">
          <MSRPCard
            inputs={inputs}
            suggestedRetailPrice={calc.suggestedRetailPrice}
            totalCost={calc.perUnit.total}
            onTargetMarginChange={(v) => setInputs({ ...inputs, targetRetailMarginPct: v })}
            onApply={() => setInputs({ ...inputs, retailPrice: Number(calc.suggestedRetailPrice.toFixed(2)) })}
          />
          <OutputsPanel
            inputs={calc.engineInputs}
            onChannelSplitChange={(v) => setInputs({ ...inputs, wholesalePct: v })}
          />
        </div>
      </div>

      {/* Hidden print container */}
      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          <ClientPrintLayout
            accountName={accountName}
            scenarioName={activeScenario?.name ?? ''}
            inputs={inputs}
          />
        </div>
      </div>

      {/* Rename dialog */}
      <AlertDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename scenario</AlertDialogTitle>
          </AlertDialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={renameScenario}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this scenario?</AlertDialogTitle>
            <AlertDialogDescription>
              "{activeScenario?.name}" will be permanently removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteScenario} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ClientPrintLayout({
  accountName, scenarioName, inputs,
}: {
  accountName: string;
  scenarioName: string;
  inputs: ClientUnitEconomicsInputs;
}) {
  const calc = calculateClientUnitEconomics(inputs);
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  const fmt = (n: number) => formatCurrency(n);
  const fmtBig = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between border-b border-dashed py-1 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );

  return (
    <div className="p-8 bg-background text-foreground" style={{ width: '8.5in' }}>
      <header className="border-b pb-3 mb-4">
        <h1 className="text-2xl font-bold">{accountName || 'My Numbers'}</h1>
        <p className="text-sm text-muted-foreground">
          {scenarioName} · Generated {today}
        </p>
      </header>

      <section className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Assumptions</h2>
        <div className="grid grid-cols-2 gap-x-6">
          <div>
            <Row k="Display unit" v={inputs.displayUnit === 'BAG' ? `Bag (${inputs.bagSizeG}g)` : inputs.displayUnit} />
            <Row k="Product" v={inputs.productName ?? '—'} />
            <Row k="Cost per bag from us" v={inputs.costPerBagFromUs != null ? fmt(inputs.costPerBagFromUs) : '—'} />
            <Row k="Extra packaging /bag" v={inputs.extraPackagingPerBag != null ? fmt(inputs.extraPackagingPerBag) : '—'} />
            <Row k="Pace assumption" v={inputs.paceMode === 'SEASONAL' ? 'Same quarter last year' : 'Last 3 months'} />
          </div>
          <div>
            <Row k="Labour" v={inputs.includeLabour ? `${inputs.labourHoursPerBatch}h × $${inputs.labourRatePerHr}/h` : 'Excluded'} />
            <Row k="Monthly overhead" v={inputs.overheadMonthly != null ? fmtBig(inputs.overheadMonthly) : '—'} />
            <Row k="Monthly volume" v={inputs.monthlyKg != null ? `${inputs.monthlyKg} kg` : '—'} />
            <Row k="Wholesale price" v={inputs.wholesalePrice != null ? fmt(inputs.wholesalePrice) : '—'} />
            <Row k="Retail price" v={inputs.retailPrice != null ? fmt(inputs.retailPrice) : '—'} />
          </div>
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Cost breakdown</h2>
        <CostBreakdownChart inputs={calc.engineInputs} perUnit={calc.perUnit} />
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Suggested MSRP
        </h2>
        <div className="rounded border p-3 flex items-baseline justify-between">
          <span className="text-2xl font-bold tabular-nums">
            {calc.suggestedRetailPrice > 0 && Number.isFinite(calc.suggestedRetailPrice) ? fmt(calc.suggestedRetailPrice) : '—'}
          </span>
          <span className="text-xs text-muted-foreground">
            at {inputs.targetRetailMarginPct}% target retail margin
          </span>
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Per-{unitLabel(inputs.displayUnit)} results
        </h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left py-1 font-medium">Metric</th>
              <th className="text-right py-1 font-medium">Wholesale</th>
              <th className="text-right py-1 font-medium">Retail</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-b"><td className="py-1">Selling price</td><td className="text-right">{fmt(calc.wholesaleMargin.price)}</td><td className="text-right">{fmt(calc.retailMargin.price)}</td></tr>
            <tr className="border-b"><td className="py-1">Cost per {unitLabel(inputs.displayUnit)}</td><td className="text-right">{fmt(calc.perUnit.total)}</td><td className="text-right">{fmt(calc.perUnit.total)}</td></tr>
            <tr className="border-b"><td className="py-1">Gross margin</td><td className="text-right">{fmt(calc.wholesaleMargin.margin)}</td><td className="text-right">{fmt(calc.retailMargin.margin)}</td></tr>
            <tr><td className="py-1">Margin %</td><td className="text-right">{calc.wholesaleMargin.marginPct.toFixed(1)}%</td><td className="text-right">{calc.retailMargin.marginPct.toFixed(1)}%</td></tr>
          </tbody>
        </table>
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Monthly view</h2>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="border rounded p-2"><p className="text-muted-foreground">Production cost</p><p className="font-semibold tabular-nums">{fmtBig(calc.monthly.productionCost)}</p></div>
          <div className="border rounded p-2"><p className="text-muted-foreground">Revenue ({inputs.wholesalePct}/{100 - inputs.wholesalePct})</p><p className="font-semibold tabular-nums">{fmtBig(calc.monthly.revenue)}</p></div>
          <div className="border rounded p-2"><p className="text-muted-foreground">Gross profit</p><p className="font-semibold tabular-nums">{fmtBig(calc.monthly.grossProfit)}</p></div>
        </div>
        {calc.monthly.breakEvenUnits != null && calc.monthly.breakEvenUnits > 0 && (
          <p className="mt-2 text-xs">
            Break-even: <span className="font-semibold">{Math.ceil(calc.monthly.breakEvenUnits).toLocaleString('en-CA')}</span>{' '}
            {unitLabelPlural(inputs.displayUnit)}/month at this price mix.
          </p>
        )}
      </section>

      <footer className="border-t pt-2 mt-4 text-[10px] text-muted-foreground text-center">
        Prepared with Home Island Coffee Partners — homeislandcoffee.com
      </footer>
    </div>
  );
}
