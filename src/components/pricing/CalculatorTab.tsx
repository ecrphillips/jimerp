import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Plus, Trash2, Copy, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { PACKAGING_OPTIONS, type PackagingVariant } from '@/components/PackagingBadge';
import { calculatePrice, type PricingInputs, type PricingResult } from '@/lib/pricing';
import { formatMoney, formatPerKg } from '@/lib/formatMoney';
import { getCountryName } from '@/lib/coffeeOrigins';

type LotForLabel = {
  id: string;
  lot_number: string;
  book_value_per_kg: number | null;
  origin_country: string | null;
  producer: string | null;
};

/**
 * Lead label: "Origin — Producer", falling back to origin only,
 * then to lot_number if origin is also missing. Mirrors the labelling
 * approach used in GreenLotPickerModal.
 */
function lotLeadLabel(lot: LotForLabel): string {
  const originName = lot.origin_country
    ? getCountryName(lot.origin_country) || lot.origin_country
    : '';
  const producer = lot.producer?.trim() || '';
  if (originName && producer) return `${originName} — ${producer}`;
  if (originName) return originName;
  return lot.lot_number;
}

type GreenSourceMode = 'single' | 'blend';
type TierMode = 'account' | 'tier' | 'default';

type BlendRow = { lot_id: string; ratio_pct: number };

const variantToGrams = (v: PackagingVariant): number => {
  const map: Record<PackagingVariant, number> = {
    RETAIL_250G: 250,
    RETAIL_300G: 300,
    RETAIL_340G: 340,
    RETAIL_454G: 454,
    CROWLER_200G: 200,
    CROWLER_250G: 250,
    CAN_125G: 125,
    BULK_2LB: 907,
    BULK_1KG: 1000,
    BULK_5LB: 2268,
    BULK_2KG: 2000,
  };
  return map[v];
};

export function CalculatorTab() {
  // ---- Data lookups ---------------------------------------------------------
  const { data: lots } = useQuery({
    queryKey: ['calc-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select(`
          id, lot_number, book_value_per_kg, status,
          green_contracts ( origin_country )
        `)
        .order('lot_number', { ascending: false });
      if (error) throw error;

      const rows = data ?? [];
      const lotIds = rows.map((r: any) => r.id);
      const producerByLot: Record<string, string | null> = {};
      const originByLot: Record<string, string | null> = {};
      if (lotIds.length > 0) {
        const { data: pls, error: plErr } = await supabase
          .from('green_purchase_lines')
          .select('lot_id, producer, origin_country')
          .in('lot_id', lotIds);
        if (plErr) throw plErr;
        (pls ?? []).forEach((pl: any) => {
          if (!pl.lot_id) return;
          if (pl.producer && !producerByLot[pl.lot_id]) producerByLot[pl.lot_id] = pl.producer;
          if (pl.origin_country && !originByLot[pl.lot_id]) originByLot[pl.lot_id] = pl.origin_country;
        });
      }

      return rows.map((r: any): LotForLabel & { status: string } => ({
        id: r.id,
        lot_number: r.lot_number,
        book_value_per_kg: r.book_value_per_kg,
        status: r.status,
        origin_country:
          originByLot[r.id] || r.green_contracts?.origin_country || null,
        producer: producerByLot[r.id] || null,
      }));
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ['calc-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, pricing_tier_id')
        .order('account_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: tiers } = useQuery({
    queryKey: ['calc-tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_tiers')
        .select('id, name, is_default')
        .order('display_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ['calc-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_rule_profiles')
        .select('id, name, is_default')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // ---- Form state -----------------------------------------------------------
  const [greenMode, setGreenMode] = useState<GreenSourceMode>('single');
  const [singleLotId, setSingleLotId] = useState<string>('');
  const [blend, setBlend] = useState<BlendRow[]>([
    { lot_id: '', ratio_pct: 50 },
    { lot_id: '', ratio_pct: 50 },
  ]);

  const [packagingVariant, setPackagingVariant] = useState<PackagingVariant>('RETAIL_340G');
  const [bagSizeG, setBagSizeG] = useState<number>(340);

  const [tierMode, setTierMode] = useState<TierMode>('default');
  const [accountId, setAccountId] = useState<string>('');
  const [tierId, setTierId] = useState<string>('');

  const [profileOverrideOn, setProfileOverrideOn] = useState(false);
  const [profileId, setProfileId] = useState<string>('');

  const [result, setResult] = useState<PricingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Auto-sync bag size when variant changes
  useEffect(() => {
    setBagSizeG(variantToGrams(packagingVariant));
  }, [packagingVariant]);

  // ---- Derived --------------------------------------------------------------
  const blendSum = useMemo(
    () => blend.reduce((a, b) => a + (Number(b.ratio_pct) || 0), 0),
    [blend],
  );
  const blendValid =
    greenMode !== 'blend' ||
    (Math.abs(blendSum - 100) < 0.001 && blend.every((b) => b.lot_id));

  const inputsReady =
    blendValid &&
    bagSizeG > 0 &&
    (greenMode === 'single' ? !!singleLotId : blend.length >= 2) &&
    (tierMode !== 'account' || !!accountId) &&
    (tierMode !== 'tier' || !!tierId) &&
    (!profileOverrideOn || !!profileId);

  // ---- Handlers -------------------------------------------------------------
  const handleAddBlendRow = () => setBlend((b) => [...b, { lot_id: '', ratio_pct: 0 }]);
  const handleRemoveBlendRow = (idx: number) =>
    setBlend((b) => (b.length <= 2 ? b : b.filter((_, i) => i !== idx)));
  const handleBlendChange = (idx: number, patch: Partial<BlendRow>) =>
    setBlend((b) => b.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const handleReset = () => {
    setGreenMode('single');
    setSingleLotId('');
    setBlend([
      { lot_id: '', ratio_pct: 50 },
      { lot_id: '', ratio_pct: 50 },
    ]);
    setPackagingVariant('RETAIL_340G');
    setBagSizeG(340);
    setTierMode('default');
    setAccountId('');
    setTierId('');
    setProfileOverrideOn(false);
    setProfileId('');
    setResult(null);
    setError(null);
  };

  const handleCalculate = async () => {
    setCalculating(true);
    setError(null);
    setResult(null);
    try {
      const greenInput =
        greenMode === 'single'
          ? { lot_id: singleLotId }
          : { blend: blend.map((b) => ({ lot_id: b.lot_id, ratio_pct: Number(b.ratio_pct) })) };

      const inputs: PricingInputs = {
        green: greenInput,
        bag_size_g: bagSizeG,
        packaging_variant: packagingVariant,
        account_id: tierMode === 'account' ? accountId : undefined,
        tier_id_override: tierMode === 'tier' ? tierId : undefined,
        profile_id_override: profileOverrideOn ? profileId : undefined,
      };

      const r = await calculatePrice(supabase, inputs);
      setResult(r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    } finally {
      setCalculating(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const text = breakdownAsText(result);
    navigator.clipboard.writeText(text).then(
      () => toast.success('Breakdown copied to clipboard'),
      () => toast.error('Could not copy to clipboard'),
    );
  };

  const accountName =
    tierMode === 'account' ? accounts?.find((a) => a.id === accountId)?.account_name : null;

  // ---- Render ---------------------------------------------------------------
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT: INPUTS */}
      <Card>
        <CardHeader>
          <CardTitle>Inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Green source */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Green source</Label>
            <RadioGroup
              value={greenMode}
              onValueChange={(v) => setGreenMode(v as GreenSourceMode)}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="single" id="green-single" />
                <Label htmlFor="green-single" className="font-normal cursor-pointer">
                  Single lot
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="blend" id="green-blend" />
                <Label htmlFor="green-blend" className="font-normal cursor-pointer">
                  Theoretical blend
                </Label>
              </div>
            </RadioGroup>

            {greenMode === 'single' ? (
              <Select value={singleLotId} onValueChange={setSingleLotId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a green lot" />
                </SelectTrigger>
                <SelectContent>
                  {lots?.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{lotLeadLabel(l)}</span>
                        <span className="text-muted-foreground text-xs">· {l.lot_number}</span>
                        <span className="text-muted-foreground text-xs">
                          · book{' '}
                          {l.book_value_per_kg != null
                            ? formatPerKg(Number(l.book_value_per_kg))
                            : 'n/a'}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-2">
                {blend.map((row, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <div className="flex-1">
                      <Select
                        value={row.lot_id}
                        onValueChange={(v) => handleBlendChange(idx, { lot_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select lot" />
                        </SelectTrigger>
                        <SelectContent>
                          {lots?.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              <span className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{lotLeadLabel(l)}</span>
                                <span className="text-muted-foreground text-xs">· {l.lot_number}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      className="w-24"
                      value={row.ratio_pct}
                      onChange={(e) =>
                        handleBlendChange(idx, { ratio_pct: Number(e.target.value) })
                      }
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveBlendRow(idx)}
                      disabled={blend.length <= 2}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex justify-between items-center">
                  <Button variant="outline" size="sm" onClick={handleAddBlendRow}>
                    <Plus className="h-4 w-4 mr-1" /> Add component
                  </Button>
                  <span
                    className={`text-sm font-mono ${
                      Math.abs(blendSum - 100) < 0.001
                        ? 'text-muted-foreground'
                        : 'text-destructive font-semibold'
                    }`}
                  >
                    Sum: {blendSum.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Product side */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Product</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="variant" className="text-xs text-muted-foreground">
                  Packaging variant
                </Label>
                <Select
                  value={packagingVariant}
                  onValueChange={(v) => setPackagingVariant(v as PackagingVariant)}
                >
                  <SelectTrigger id="variant">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PACKAGING_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bagsize" className="text-xs text-muted-foreground">
                  Bag size (g)
                </Label>
                <Input
                  id="bagsize"
                  type="number"
                  value={bagSizeG}
                  onChange={(e) => setBagSizeG(Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Tier section */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Account / Tier</Label>
            <RadioGroup
              value={tierMode}
              onValueChange={(v) => setTierMode(v as TierMode)}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="account" id="tm-account" />
                <Label htmlFor="tm-account" className="font-normal cursor-pointer">
                  Existing account
                </Label>
              </div>
              {tierMode === 'account' && (
                <div className="ml-6">
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <RadioGroupItem value="tier" id="tm-tier" />
                <Label htmlFor="tm-tier" className="font-normal cursor-pointer">
                  Specific tier
                </Label>
              </div>
              {tierMode === 'tier' && (
                <div className="ml-6">
                  <Select value={tierId} onValueChange={setTierId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      {tiers?.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.is_default ? ' (default)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <RadioGroupItem value="default" id="tm-default" />
                <Label htmlFor="tm-default" className="font-normal cursor-pointer">
                  Default tier
                </Label>
              </div>
            </RadioGroup>
          </div>

          <Separator />

          {/* Profile override */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="profile-override" className="text-sm font-semibold">
                Override profile
              </Label>
              <Switch
                id="profile-override"
                checked={profileOverrideOn}
                onCheckedChange={setProfileOverrideOn}
              />
            </div>
            {profileOverrideOn && (
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select pricing profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.is_default ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Separator />

          <Button
            className="w-full"
            disabled={!inputsReady || calculating}
            onClick={handleCalculate}
          >
            {calculating ? 'Calculating…' : 'Calculate'}
          </Button>
          {!blendValid && greenMode === 'blend' && (
            <p className="text-xs text-destructive">
              Blend ratios must sum to exactly 100% and every row must have a lot selected.
            </p>
          )}
        </CardContent>
      </Card>

      {/* RIGHT: RESULTS */}
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-sm text-destructive p-3 border border-destructive/40 rounded bg-destructive/5">
              {error}
            </div>
          ) : !result ? (
            <p className="text-sm text-muted-foreground">
              Choose inputs and click Calculate.
            </p>
          ) : (
            <ResultsView result={result} accountName={accountName} onCopy={handleCopy} onReset={handleReset} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Results view -----------------------------------------------------

function ResultsView({
  result,
  accountName,
  onCopy,
  onReset,
}: {
  result: PricingResult;
  accountName: string | null | undefined;
  onCopy: () => void;
  onReset: () => void;
}) {
  const headerLine = [
    accountName,
    result.tier?.name ?? 'No tier',
    result.profile.name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{headerLine}</p>

      {/* Big number block */}
      <div className="grid grid-cols-3 gap-3">
        <BigNumber label="Final price / bag" value={formatMoney(result.final_price_per_bag)} />
        <BigNumber label="List price / bag" value={formatMoney(result.list_price_per_bag)} muted />
        <BigNumber
          label="Margin"
          value={`${(result.margin_pct * 100).toFixed(1)}%`}
          sub={formatMoney(result.margin_dollars)}
        />
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="border border-yellow-500/50 bg-yellow-500/5 rounded p-3 space-y-1">
          <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Warnings
          </div>
          <ul className="text-xs text-yellow-700 dark:text-yellow-400 list-disc pl-5 space-y-0.5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Cost breakdown table */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Cost stack</h3>
        <div className="border rounded text-sm overflow-hidden">
          <BreakdownRow n={1} label="Book Value / kg green" value={formatPerKg(result.book_value_per_kg_green)} />
          <BreakdownRow n={2} label="Financing Cost / kg green" value={formatPerKg(result.financing_cost_per_kg_green)} />
          <BreakdownRow n={3} label="Market Value / kg green" value={formatPerKg(result.market_value_per_kg_green)} />
          <BreakdownRow n={4} label="Carry / risk premium %" value={`${result.carry_risk_premium_pct_used.toFixed(2)}%`} />
          <BreakdownRow n={5} label="De-risked green cost / kg" value={formatPerKg(result.derisked_cost_per_kg_green)} />
          <BreakdownRow n={6} label="Marked-up green cost / kg" value={formatPerKg(result.marked_up_cost_per_kg_green)} />
          <BreakdownRow n={7} label={`Roasted cost from green / kg-roasted (${result.yield_loss_pct_used.toFixed(1)}% yield loss)`} value={formatPerKg(result.roasted_cost_per_kg_from_green)} />
          <BreakdownRow n={8} label="Process cost / kg-roasted" value={formatPerKg(result.process_cost_per_kg_roasted)} />
          <BreakdownRow n={9} label="Overhead / kg-roasted" value={formatPerKg(result.overhead_per_kg_roasted)} />
          <BreakdownRow n={10} label="Total roasted cost / kg" value={formatPerKg(result.total_roasted_cost_per_kg)} bold />
          <BreakdownRow n={11} label="Bag size" value={`${result.bag_size_kg.toFixed(4)} kg`} />
          <BreakdownRow n={12} label="Roasted cost / bag" value={formatMoney(result.roasted_cost_per_bag)} />
          <BreakdownRow
            n={13}
            label={`Packaging cost / bag (${packagingSourceLabel(result.packaging_cost_source)})`}
            value={formatMoney(result.packaging_cost_per_bag)}
          />
          <BreakdownRow n={14} label="Total cost / bag" value={formatMoney(result.total_cost_per_bag)} bold />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="h-4 w-4 mr-1" /> Copy breakdown as text
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-4 w-4 mr-1" /> Reset inputs
        </Button>
      </div>
    </div>
  );
}

function BigNumber({
  label,
  value,
  sub,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div className={`border rounded p-3 ${muted ? 'bg-muted/30' : 'bg-card'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tracking-tight mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownRow({
  n,
  label,
  value,
  bold,
}: {
  n: number;
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between items-center px-3 py-2 border-b last:border-b-0 ${
        bold ? 'bg-muted/40 font-semibold' : ''
      }`}
    >
      <span className="text-sm">
        <span className="text-xs text-muted-foreground font-mono mr-2">{n.toString().padStart(2, '0')}</span>
        {label}
      </span>
      <span className="text-sm font-mono">{value}</span>
    </div>
  );
}

function packagingSourceLabel(s: 'OVERRIDE' | 'LOOKUP' | 'MISSING') {
  if (s === 'OVERRIDE') return 'product override';
  if (s === 'LOOKUP') return 'from packaging costs';
  return 'missing — using $0';
}

function breakdownAsText(r: PricingResult): string {
  const lines = [
    `Pricing breakdown — ${r.profile.name}${r.tier ? ` · ${r.tier.name}` : ''}`,
    '',
    `01  Book Value / kg green             ${formatPerKg(r.book_value_per_kg_green)}`,
    `02  Financing cost / kg green         ${formatPerKg(r.financing_cost_per_kg_green)}`,
    `03  Market Value / kg green           ${formatPerKg(r.market_value_per_kg_green)}`,
    `04  Carry / risk premium              ${r.carry_risk_premium_pct_used.toFixed(2)}%`,
    `05  De-risked green cost / kg         ${formatPerKg(r.derisked_cost_per_kg_green)}`,
    `06  Marked-up green cost / kg         ${formatPerKg(r.marked_up_cost_per_kg_green)}`,
    `07  Roasted from green / kg-roasted   ${formatPerKg(r.roasted_cost_per_kg_from_green)}  (yield loss ${r.yield_loss_pct_used.toFixed(1)}%)`,
    `08  Process / kg-roasted              ${formatPerKg(r.process_cost_per_kg_roasted)}`,
    `09  Overhead / kg-roasted             ${formatPerKg(r.overhead_per_kg_roasted)}`,
    `10  Total roasted cost / kg           ${formatPerKg(r.total_roasted_cost_per_kg)}`,
    `11  Bag size                          ${r.bag_size_kg.toFixed(4)} kg`,
    `12  Roasted cost / bag                ${formatMoney(r.roasted_cost_per_bag)}`,
    `13  Packaging / bag                   ${formatMoney(r.packaging_cost_per_bag)}  (${packagingSourceLabel(r.packaging_cost_source)})`,
    `14  Total cost / bag                  ${formatMoney(r.total_cost_per_bag)}`,
    '',
    `List price / bag:   ${formatMoney(r.list_price_per_bag)}`,
    `Final price / bag:  ${formatMoney(r.final_price_per_bag)}`,
    `Margin:             ${formatMoney(r.margin_dollars)} (${(r.margin_pct * 100).toFixed(1)}%)`,
  ];
  if (r.warnings.length) {
    lines.push('', 'Warnings:');
    for (const w of r.warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n');
}
