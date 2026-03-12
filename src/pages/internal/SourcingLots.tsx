import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Search, Check, FileText, AlertTriangle, CheckCircle2, Pencil } from 'lucide-react';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';

// ─── Types ─────────────────────────────────────────────────

interface LotRow {
  id: string;
  lot_number: string;
  contract_id: string;
  bags_released: number;
  bag_size_kg: number;
  kg_received: number | null;
  kg_on_hand: number;
  status: string;
  expected_delivery_date: string | null;
  received_date: string | null;
  carrier: string | null;
  warehouse_location: string | null;
  exceptions_noted: boolean;
  exceptions_notes: string | null;
  // cost fields
  fx_rate: number | null;
  invoice_amount_cad: number | null;
  carry_fees_cad: number | null;
  freight_cad: number | null;
  duties_cad: number | null;
  transaction_fees_cad: number | null;
  other_costs_cad: number | null;
  other_costs_description: string | null;
  invoice_is_usd: boolean;
  carry_fees_is_usd: boolean;
  freight_is_usd: boolean;
  book_value_per_kg: number | null;
  market_value_per_kg: number | null;
  importer_payment_terms_days: number | null;
  estimated_days_to_consume: number | null;
  financing_apr: number | null;
  // confirmations
  fx_rate_confirmed_by: string | null;
  fx_rate_confirmed_at: string | null;
  invoice_confirmed_by: string | null;
  invoice_confirmed_at: string | null;
  carry_fees_confirmed_by: string | null;
  carry_fees_confirmed_at: string | null;
  freight_confirmed_by: string | null;
  freight_confirmed_at: string | null;
  duties_confirmed_by: string | null;
  duties_confirmed_at: string | null;
  transaction_fees_confirmed_by: string | null;
  transaction_fees_confirmed_at: string | null;
  other_costs_confirmed_by: string | null;
  other_costs_confirmed_at: string | null;
  // lot-level timestamps
  created_at: string;
  updated_at: string;
}

interface ContractInfo {
  id: string;
  name: string;
  origin: string | null;
  region: string | null;
  producer: string | null;
  variety: string | null;
  crop_year: string | null;
  category: string;
}

interface LotNote {
  id: string;
  lot_id: string;
  note: string;
  created_by: string | null;
  created_at: string;
  author_name?: string;
}

// ─── Badges ────────────────────────────────────────────────

const LOT_STATUS_LABELS: Record<string, string> = {
  EN_ROUTE: 'En Route',
  RECEIVED: 'Received',
  COSTING_INCOMPLETE: 'Costing Incomplete',
  COSTING_COMPLETE: 'Costing Complete',
};

function LotStatusBadge({ status }: { status: string }) {
  const cls = status === 'EN_ROUTE'
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
    : status === 'COSTING_INCOMPLETE'
    ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
    : status === 'COSTING_COMPLETE'
    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    : 'bg-muted text-muted-foreground';
  return <Badge variant="outline" className={`${cls} border-0 text-xs`}>{LOT_STATUS_LABELS[status] || status}</Badge>;
}

// ─── Main Page ─────────────────────────────────────────────

export default function SourcingLots() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

  // Fetch lots
  const { data: lots = [], isLoading } = useQuery({
    queryKey: ['green-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select('*')
        .order('received_date', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as LotRow[];
    },
  });

  // Fetch contracts for display
  const { data: contracts = [] } = useQuery({
    queryKey: ['green-contracts-for-lots'],
    queryFn: async () => {
      const { data, error } = await supabase.from('green_contracts').select('id, name, origin, region, producer, variety, crop_year, category');
      if (error) throw error;
      return (data ?? []) as ContractInfo[];
    },
  });
  const contractMap = useMemo(() => Object.fromEntries(contracts.map(c => [c.id, c])), [contracts]);

  // Sort: received DESC, then created_at DESC for en-route
  const sorted = useMemo(() => {
    return [...lots].sort((a, b) => {
      if (a.received_date && b.received_date) return b.received_date.localeCompare(a.received_date);
      if (a.received_date && !b.received_date) return -1;
      if (!a.received_date && b.received_date) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [lots]);

  const filtered = useMemo(() => {
    return sorted.filter(l => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const c = contractMap[l.contract_id];
        if (
          !l.lot_number.toLowerCase().includes(s) &&
          !(c?.name || '').toLowerCase().includes(s)
        ) return false;
      }
      return true;
    });
  }, [sorted, statusFilter, search, contractMap]);

  return (
    <div className="page-container space-y-6">
      <GreenCoffeeAlerts />

      <div className="page-header">
        <div>
          <h1 className="page-title">Lots</h1>
          <p className="text-sm text-muted-foreground">Green coffee inventory</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search lots…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {['ALL', 'EN_ROUTE', 'RECEIVED', 'COSTING_INCOMPLETE', 'COSTING_COMPLETE'].map(s => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
              {s === 'ALL' ? 'All' : LOT_STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{search || statusFilter !== 'ALL' ? 'No lots match your filters.' : 'No lots yet. Release coffee from a contract to create lots.'}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(lot => {
            const c = contractMap[lot.contract_id];
            const kgReceived = lot.bags_released * lot.bag_size_kg;
            return (
              <Card key={lot.id}>
                <CardContent className="p-4 space-y-2">
                  <p className="font-semibold text-base leading-tight">{lot.lot_number}</p>
                  {c && <p className="text-sm text-muted-foreground">{c.name}</p>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <LotStatusBadge status={lot.status} />
                    {lot.exceptions_noted && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                  </div>
                  <p className="text-sm">{lot.bags_released} bags · {kgReceived.toLocaleString()} kg</p>
                  {lot.status === 'EN_ROUTE' && lot.expected_delivery_date && (
                    <p className="text-xs text-muted-foreground">Arriving {format(new Date(lot.expected_delivery_date + 'T00:00:00'), 'MMM d, yyyy')}</p>
                  )}
                  {lot.status === 'COSTING_COMPLETE' && lot.book_value_per_kg != null && (
                    <p className="text-sm font-medium">CAD ${lot.book_value_per_kg.toFixed(4)}/kg</p>
                  )}
                  <div className="pt-1">
                    <Button variant="outline" size="sm" onClick={() => setSelectedLotId(lot.id)}>View</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <LotDetailPanel lotId={selectedLotId} onClose={() => setSelectedLotId(null)} contractMap={contractMap} />
    </div>
  );
}

// ─── Cost Field Component ──────────────────────────────────

interface CostFieldProps {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  onClearConfirmation: () => void;
  hasCurrencyToggle?: boolean;
  isUsd?: boolean;
  onToggleUsd?: (v: boolean) => void;
  fxRate: number | null;
  fxRateConfirmed: boolean;
  descriptionValue?: string;
  onDescriptionChange?: (v: string) => void;
}

function CostField({
  label, value, onChange, confirmedBy, confirmedAt, confirmedByName, onClearConfirmation,
  hasCurrencyToggle, isUsd, onToggleUsd, fxRate, fxRateConfirmed,
  descriptionValue, onDescriptionChange,
}: CostFieldProps) {
  const isConfirmed = !!confirmedAt;

  if (isConfirmed) {
    // USD fields: show the USD equivalent for display
    const displayVal = isUsd && fxRate ? value! / fxRate : value;
    const displayCurrency = isUsd ? 'USD' : 'CAD';
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-sm">{label}</Label>
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={onClearConfirmation}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        </div>
        <p className="text-sm font-medium">{displayCurrency} ${(displayVal ?? 0).toFixed(4)}</p>
        {isUsd && fxRate && <p className="text-xs text-muted-foreground">= CAD ${(value ?? 0).toFixed(4)} @ {fxRate.toFixed(4)}</p>}
        {descriptionValue && <p className="text-xs text-muted-foreground italic">{descriptionValue}</p>}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
          Confirmed by {confirmedByName || 'Unknown'} on {format(new Date(confirmedAt!), 'MMM d, yyyy')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="flex gap-2">
        <Input
          type="number"
          step="0.0001"
          placeholder="0.0000"
          value={value != null ? String(value) : ''}
          onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null)}
          className="flex-1"
        />
        {hasCurrencyToggle && onToggleUsd && (
          <div className="flex rounded-md border overflow-hidden shrink-0">
            <button
              type="button"
              className={`px-2 py-1 text-xs transition-colors ${!isUsd ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              onClick={() => onToggleUsd(false)}
            >CAD</button>
            <button
              type="button"
              className={`px-2 py-1 text-xs transition-colors ${isUsd ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              onClick={() => onToggleUsd(true)}
            >USD</button>
          </div>
        )}
      </div>
      {isUsd && !fxRateConfirmed && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Set FX rate first.</p>
      )}
      {onDescriptionChange !== undefined && (
        <Input placeholder="Description" value={descriptionValue || ''} onChange={(e) => onDescriptionChange!(e.target.value)} className="mt-1" />
      )}
    </div>
  );
}

// ─── Detail Panel ──────────────────────────────────────────

function LotDetailPanel({
  lotId,
  onClose,
  contractMap,
}: {
  lotId: string | null;
  onClose: () => void;
  contractMap: Record<string, ContractInfo>;
}) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const open = !!lotId;

  const { data: lot, refetch: refetchLot } = useQuery({
    queryKey: ['green-lot-detail', lotId],
    enabled: !!lotId,
    queryFn: async () => {
      const { data, error } = await supabase.from('green_lots').select('*').eq('id', lotId!).single();
      if (error) throw error;
      return data as unknown as LotRow;
    },
  });

  const contract = lot ? contractMap[lot.contract_id] : null;
  const kgReceived = lot ? lot.bags_released * lot.bag_size_kg : 0;

  // Roast group links
  const { data: rgLinks = [] } = useQuery({
    queryKey: ['lot-rg-links', lotId],
    enabled: !!lotId,
    queryFn: async () => {
      const { data, error } = await supabase.from('green_lot_roast_group_links').select('id, roast_group, pct_of_lot').eq('lot_id', lotId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Profile map for confirmed-by names
  const { data: profileMap = {} } = useQuery({
    queryKey: ['profiles-map'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, name');
      if (error) throw error;
      return Object.fromEntries((data ?? []).map(p => [p.user_id, p.name])) as Record<string, string>;
    },
    staleTime: 300000,
  });

  // Notes
  const { data: notes = [] } = useQuery({
    queryKey: ['lot-notes', lotId],
    enabled: !!lotId,
    queryFn: async () => {
      const { data, error } = await supabase.from('green_lot_notes').select('*').eq('lot_id', lotId!).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((n: any) => ({ ...n, author_name: profileMap[n.created_by] || 'Unknown' })) as LotNote[];
    },
  });

  // ─── Local cost state ────────────────────────────────────
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [invoiceAmt, setInvoiceAmt] = useState<number | null>(null);
  const [invoiceIsUsd, setInvoiceIsUsd] = useState(false);
  const [carryFees, setCarryFees] = useState<number | null>(null);
  const [carryFeesIsUsd, setCarryFeesIsUsd] = useState(false);
  const [freight, setFreight] = useState<number | null>(null);
  const [freightIsUsd, setFreightIsUsd] = useState(false);
  const [duties, setDuties] = useState<number | null>(null);
  const [txFees, setTxFees] = useState<number | null>(null);
  const [otherCosts, setOtherCosts] = useState<number | null>(null);
  const [otherCostsDesc, setOtherCostsDesc] = useState('');
  const [paymentTerms, setPaymentTerms] = useState<number | null>(null);
  const [estDaysConsume, setEstDaysConsume] = useState<number | null>(null);

  // Sync from DB
  useEffect(() => {
    if (lot) {
      setFxRate(lot.fx_rate);
      // For USD fields: reverse-convert from stored CAD to original USD for editing
      if (lot.invoice_is_usd && lot.fx_rate && lot.invoice_amount_cad != null) {
        setInvoiceAmt(lot.invoice_amount_cad / lot.fx_rate);
      } else {
        setInvoiceAmt(lot.invoice_amount_cad);
      }
      setInvoiceIsUsd(lot.invoice_is_usd);
      if (lot.carry_fees_is_usd && lot.fx_rate && lot.carry_fees_cad != null) {
        setCarryFees(lot.carry_fees_cad / lot.fx_rate);
      } else {
        setCarryFees(lot.carry_fees_cad);
      }
      setCarryFeesIsUsd(lot.carry_fees_is_usd);
      if (lot.freight_is_usd && lot.fx_rate && lot.freight_cad != null) {
        setFreight(lot.freight_cad / lot.fx_rate);
      } else {
        setFreight(lot.freight_cad);
      }
      setFreightIsUsd(lot.freight_is_usd);
      setDuties(lot.duties_cad);
      setTxFees(lot.transaction_fees_cad);
      setOtherCosts(lot.other_costs_cad);
      setOtherCostsDesc(lot.other_costs_description || '');
      setPaymentTerms(lot.importer_payment_terms_days);
      setEstDaysConsume(lot.estimated_days_to_consume);
    }
  }, [lot]);

  // Convert to CAD for storage
  const toCad = useCallback((val: number | null, isUsd: boolean, rate: number | null) => {
    if (val == null) return null;
    if (isUsd && rate) return val * rate;
    return val;
  }, []);

  // Save single field updates
  const fieldSaveMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase.from('green_lots').update(updates as any).eq('id', lotId!);
      if (error) throw error;
    },
    onSuccess: () => {
      refetchLot();
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
    },
    onError: () => toast.error('Failed to save'),
  });

  // Save financing fields on blur
  const saveFinancingField = (field: string, value: number | null) => {
    fieldSaveMutation.mutate({ [field]: value });
  };

  // Clear a confirmation
  const clearConfirmation = (fieldPrefix: string) => {
    const updates: Record<string, any> = {
      [`${fieldPrefix}_confirmed_by`]: null,
      [`${fieldPrefix}_confirmed_at`]: null,
    };
    // If lot was COSTING_COMPLETE, revert to COSTING_INCOMPLETE
    if (lot?.status === 'COSTING_COMPLETE') {
      updates.status = 'COSTING_INCOMPLETE';
    }
    fieldSaveMutation.mutate(updates);
    toast.info('Confirmation cleared — field unlocked for editing');
  };

  // Save cost field values (non-confirmation)
  const saveCostValues = useCallback(() => {
    if (!lotId) return;
    const updates: Record<string, any> = {
      fx_rate: fxRate,
      invoice_amount_cad: toCad(invoiceAmt, invoiceIsUsd, fxRate),
      invoice_is_usd: invoiceIsUsd,
      carry_fees_cad: toCad(carryFees, carryFeesIsUsd, fxRate),
      carry_fees_is_usd: carryFeesIsUsd,
      freight_cad: toCad(freight, freightIsUsd, fxRate),
      freight_is_usd: freightIsUsd,
      duties_cad: duties,
      transaction_fees_cad: txFees,
      other_costs_cad: otherCosts,
      other_costs_description: otherCostsDesc.trim() || null,
    };
    fieldSaveMutation.mutate(updates);
  }, [lotId, fxRate, invoiceAmt, invoiceIsUsd, carryFees, carryFeesIsUsd, freight, freightIsUsd, duties, txFees, otherCosts, otherCostsDesc, toCad, fieldSaveMutation]);

  // Confirm all unconfirmed fields
  const confirmCostsMutation = useMutation({
    mutationFn: async () => {
      if (!lot || !authUser) return;
      const now = new Date().toISOString();
      const uid = authUser.id;

      // First save current values
      const updates: Record<string, any> = {
        fx_rate: fxRate,
        invoice_amount_cad: toCad(invoiceAmt, invoiceIsUsd, fxRate),
        invoice_is_usd: invoiceIsUsd,
        carry_fees_cad: toCad(carryFees, carryFeesIsUsd, fxRate),
        carry_fees_is_usd: carryFeesIsUsd,
        freight_cad: toCad(freight, freightIsUsd, fxRate),
        freight_is_usd: freightIsUsd,
        duties_cad: duties,
        transaction_fees_cad: txFees,
        other_costs_cad: otherCosts,
        other_costs_description: otherCostsDesc.trim() || null,
      };

      // Confirm each field that has a value and is not yet confirmed
      if (fxRate != null && !lot.fx_rate_confirmed_at) {
        updates.fx_rate_confirmed_by = uid;
        updates.fx_rate_confirmed_at = now;
      }
      if (invoiceAmt != null && !lot.invoice_confirmed_at) {
        updates.invoice_confirmed_by = uid;
        updates.invoice_confirmed_at = now;
      }
      if (carryFees != null && !lot.carry_fees_confirmed_at) {
        updates.carry_fees_confirmed_by = uid;
        updates.carry_fees_confirmed_at = now;
      }
      if (freight != null && !lot.freight_confirmed_at) {
        updates.freight_confirmed_by = uid;
        updates.freight_confirmed_at = now;
      }
      if (duties != null && !lot.duties_confirmed_at) {
        updates.duties_confirmed_by = uid;
        updates.duties_confirmed_at = now;
      }
      if (txFees != null && !lot.transaction_fees_confirmed_at) {
        updates.transaction_fees_confirmed_by = uid;
        updates.transaction_fees_confirmed_at = now;
      }
      if (otherCosts != null && !lot.other_costs_confirmed_at) {
        updates.other_costs_confirmed_by = uid;
        updates.other_costs_confirmed_at = now;
      }

      // Check if all 7 fields will be confirmed after this
      const allConfirmedAfter =
        (fxRate != null) && (invoiceAmt != null) && (carryFees != null) &&
        (freight != null) && (duties != null) && (txFees != null) && (otherCosts != null);

      if (allConfirmedAfter) {
        // Compute book value
        const storedInvoice = toCad(invoiceAmt, invoiceIsUsd, fxRate) ?? 0;
        const storedCarry = toCad(carryFees, carryFeesIsUsd, fxRate) ?? 0;
        const storedFreight = toCad(freight, freightIsUsd, fxRate) ?? 0;
        const totalCosts = storedInvoice + storedCarry + storedFreight + (duties ?? 0) + (txFees ?? 0) + (otherCosts ?? 0);
        const bvPerKg = kgReceived > 0 ? totalCosts / kgReceived : 0;
        updates.book_value_per_kg = bvPerKg;
        updates.status = 'COSTING_COMPLETE';

        // Market value
        if (paymentTerms != null && estDaysConsume != null) {
          const avgDaysFinanced = (estDaysConsume - paymentTerms) / 2;
          const financingCostPerKg = bvPerKg * 0.12 * (avgDaysFinanced / 365);
          updates.market_value_per_kg = bvPerKg + financingCostPerKg;
        } else {
          updates.market_value_per_kg = bvPerKg;
        }
      }

      const { error } = await supabase.from('green_lots').update(updates as any).eq('id', lotId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Costs confirmed');
      refetchLot();
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-alerts-costing'] });
    },
    onError: () => toast.error('Failed to confirm costs'),
  });

  // Compute live summary
  const liveSummary = useMemo(() => {
    if (!lot) return null;
    const storedInvoice = toCad(invoiceAmt, invoiceIsUsd, fxRate);
    const storedCarry = toCad(carryFees, carryFeesIsUsd, fxRate);
    const storedFreight = toCad(freight, freightIsUsd, fxRate);

    const fields = [
      { label: 'Invoice Amount', cad: storedInvoice, confirmed: !!lot.invoice_confirmed_at },
      { label: 'Carry / Financing Fees', cad: storedCarry, confirmed: !!lot.carry_fees_confirmed_at },
      { label: 'Freight', cad: storedFreight, confirmed: !!lot.freight_confirmed_at },
      { label: 'Duties & Taxes', cad: duties, confirmed: !!lot.duties_confirmed_at },
      { label: 'Transaction Fees', cad: txFees, confirmed: !!lot.transaction_fees_confirmed_at },
      { label: 'Other Costs', cad: otherCosts, confirmed: !!lot.other_costs_confirmed_at },
    ];

    const totalCosts = fields.reduce((sum, f) => sum + (f.cad ?? 0), 0);
    const bvPerKg = kgReceived > 0 ? totalCosts / kgReceived : null;

    let financingCostPerKg: number | null = null;
    let mvPerKg: number | null = null;
    if (bvPerKg != null && paymentTerms != null && estDaysConsume != null) {
      const avgDaysFinanced = (estDaysConsume - paymentTerms) / 2;
      financingCostPerKg = bvPerKg * 0.12 * (avgDaysFinanced / 365);
      mvPerKg = bvPerKg + financingCostPerKg;
    }

    return { fields, totalCosts, bvPerKg, financingCostPerKg, mvPerKg };
  }, [lot, invoiceAmt, invoiceIsUsd, carryFees, carryFeesIsUsd, freight, freightIsUsd, duties, txFees, otherCosts, fxRate, kgReceived, paymentTerms, estDaysConsume, toCad]);

  // Has any unconfirmed field with a value
  const hasUnconfirmedWithValue = lot ? (
    (fxRate != null && !lot.fx_rate_confirmed_at) ||
    (invoiceAmt != null && !lot.invoice_confirmed_at) ||
    (carryFees != null && !lot.carry_fees_confirmed_at) ||
    (freight != null && !lot.freight_confirmed_at) ||
    (duties != null && !lot.duties_confirmed_at) ||
    (txFees != null && !lot.transaction_fees_confirmed_at) ||
    (otherCosts != null && !lot.other_costs_confirmed_at)
  ) : false;

  const allFieldsConfirmed = lot ? (
    !!lot.fx_rate_confirmed_at && !!lot.invoice_confirmed_at && !!lot.carry_fees_confirmed_at &&
    !!lot.freight_confirmed_at && !!lot.duties_confirmed_at && !!lot.transaction_fees_confirmed_at &&
    !!lot.other_costs_confirmed_at
  ) : false;

  // Notes
  const [noteText, setNoteText] = useState('');
  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('green_lot_notes').insert({ lot_id: lotId!, note: noteText.trim(), created_by: authUser!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lot-notes', lotId] });
      setNoteText('');
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  // Brief Me
  const [briefCopied, setBriefCopied] = useState(false);
  const handleBriefMe = async () => {
    if (!lot) return;
    const c = contract;
    const lines: string[] = [];
    lines.push(`Lot Number: ${lot.lot_number}`);
    lines.push(`Contract: ${c?.name || '—'}`);
    lines.push(`Origin: ${c?.origin || '—'}`);
    if (c?.region) lines.push(`Region: ${c.region}`);
    if (c?.producer) lines.push(`Producer: ${c.producer}`);
    if (c?.variety) lines.push(`Variety: ${c.variety}`);
    if (c?.crop_year) lines.push(`Crop Year: ${c.crop_year}`);
    lines.push(`Status: ${LOT_STATUS_LABELS[lot.status] || lot.status}`);
    lines.push(`Bags: ${lot.bags_released}`);
    lines.push(`Bag Size: ${lot.bag_size_kg} kg`);
    lines.push(`kg Received: ${kgReceived}`);
    if (lot.received_date) lines.push(`Received: ${format(new Date(lot.received_date + 'T00:00:00'), 'MMM d, yyyy')}`);
    if (lot.warehouse_location) lines.push(`Warehouse: ${lot.warehouse_location}`);
    if (lot.exceptions_noted) {
      lines.push(`Exceptions: Yes`);
      if (lot.exceptions_notes) lines.push(`Exception Notes: ${lot.exceptions_notes}`);
    }

    // Cost fields
    const confirmStamp = (by: string | null, at: string | null) => {
      if (!at) return ' (unconfirmed)';
      return ` (confirmed by ${profileMap[by || ''] || 'Unknown'} on ${format(new Date(at), 'MMM d, yyyy')})`;
    };
    if (lot.fx_rate != null) lines.push(`FX Rate: ${lot.fx_rate.toFixed(4)}${confirmStamp(lot.fx_rate_confirmed_by, lot.fx_rate_confirmed_at)}`);
    if (lot.invoice_amount_cad != null) lines.push(`Invoice: CAD $${lot.invoice_amount_cad.toFixed(4)}${confirmStamp(lot.invoice_confirmed_by, lot.invoice_confirmed_at)}`);
    if (lot.carry_fees_cad != null) lines.push(`Carry Fees: CAD $${lot.carry_fees_cad.toFixed(4)}${confirmStamp(lot.carry_fees_confirmed_by, lot.carry_fees_confirmed_at)}`);
    if (lot.freight_cad != null) lines.push(`Freight: CAD $${lot.freight_cad.toFixed(4)}${confirmStamp(lot.freight_confirmed_by, lot.freight_confirmed_at)}`);
    if (lot.duties_cad != null) lines.push(`Duties: CAD $${lot.duties_cad.toFixed(4)}${confirmStamp(lot.duties_confirmed_by, lot.duties_confirmed_at)}`);
    if (lot.transaction_fees_cad != null) lines.push(`Transaction Fees: CAD $${lot.transaction_fees_cad.toFixed(4)}${confirmStamp(lot.transaction_fees_confirmed_by, lot.transaction_fees_confirmed_at)}`);
    if (lot.other_costs_cad != null) lines.push(`Other Costs: CAD $${lot.other_costs_cad.toFixed(4)}${lot.other_costs_description ? ` (${lot.other_costs_description})` : ''}${confirmStamp(lot.other_costs_confirmed_by, lot.other_costs_confirmed_at)}`);
    if (lot.book_value_per_kg != null) lines.push(`Book Value: CAD $${lot.book_value_per_kg.toFixed(4)}/kg`);
    if (lot.market_value_per_kg != null) lines.push(`Market Value: CAD $${lot.market_value_per_kg.toFixed(4)}/kg`);
    if (lot.importer_payment_terms_days != null) lines.push(`Payment Terms: ${lot.importer_payment_terms_days} days`);
    if (lot.estimated_days_to_consume != null) lines.push(`Est. Days to Consume: ${lot.estimated_days_to_consume}`);

    // Notes
    const { data: allNotes } = await supabase.from('green_lot_notes').select('note, created_by, created_at').eq('lot_id', lotId!).order('created_at', { ascending: true });
    if (allNotes && allNotes.length > 0) {
      lines.push('', '--- Notes ---');
      for (const n of allNotes) {
        lines.push(`[${format(new Date(n.created_at), 'MMM d, yyyy')}] (${profileMap[n.created_by || ''] || 'Unknown'}) ${n.note}`);
      }
    }

    await navigator.clipboard.writeText(lines.join('\n'));
    setBriefCopied(true);
    toast.success('Lot brief copied to clipboard');
    setTimeout(() => setBriefCopied(false), 2000);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex-row items-center justify-between gap-2 pr-2">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg">{lot?.lot_number || 'Lot'}</SheetTitle>
            {lot && <LotStatusBadge status={lot.status} />}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={handleBriefMe}>
            {briefCopied ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            {briefCopied ? 'Copied' : 'Brief Me'}
          </Button>
        </SheetHeader>

        {lot && (
          <div className="space-y-6 pt-4">
            {/* SECTION 1 — LOT INFO */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Lot Info</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">Contract:</span> {contract?.name || '—'}</div>
                <div><span className="text-muted-foreground">Origin:</span> {contract?.origin || '—'}</div>
                <div><span className="text-muted-foreground">Region:</span> {contract?.region || '—'}</div>
                <div><span className="text-muted-foreground">Producer:</span> {contract?.producer || '—'}</div>
                <div><span className="text-muted-foreground">Variety:</span> {contract?.variety || '—'}</div>
                <div><span className="text-muted-foreground">Crop Year:</span> {contract?.crop_year || '—'}</div>
                <div><span className="text-muted-foreground">Warehouse:</span> {lot.warehouse_location || '—'}</div>
                <div><span className="text-muted-foreground">Bags:</span> {lot.bags_released}</div>
                <div><span className="text-muted-foreground">Bag Size:</span> {lot.bag_size_kg} kg</div>
                <div><span className="text-muted-foreground">kg Received:</span> {kgReceived.toLocaleString()}</div>
                <div><span className="text-muted-foreground">Received:</span> {lot.received_date ? format(new Date(lot.received_date + 'T00:00:00'), 'MMM d, yyyy') : '—'}</div>
                <div><span className="text-muted-foreground">Carrier:</span> {lot.carrier || '—'}</div>
              </div>

              {lot.exceptions_noted && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Arrived with exceptions</p>
                    {lot.exceptions_notes && <p className="text-sm text-muted-foreground mt-1">{lot.exceptions_notes}</p>}
                  </div>
                </div>
              )}

              {/* Roast Group Links */}
              <div>
                <Label className="text-sm text-muted-foreground">Linked Roast Groups</Label>
                {rgLinks.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {rgLinks.map(rg => (
                      <Badge key={rg.id} variant="outline" className="text-xs">{rg.roast_group}{rg.pct_of_lot ? ` (${rg.pct_of_lot}%)` : ''}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">No roast groups linked.</p>
                )}
              </div>

              {/* Financing Inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Importer Payment Terms (days)</Label>
                  <Input
                    type="number"
                    value={paymentTerms ?? ''}
                    onChange={(e) => setPaymentTerms(e.target.value ? parseInt(e.target.value) : null)}
                    onBlur={() => saveFinancingField('importer_payment_terms_days', paymentTerms)}
                    placeholder="—"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Est. Days to Consume</Label>
                  <Input
                    type="number"
                    value={estDaysConsume ?? ''}
                    onChange={(e) => setEstDaysConsume(e.target.value ? parseInt(e.target.value) : null)}
                    onBlur={() => saveFinancingField('estimated_days_to_consume', estDaysConsume)}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* SECTION 2 — COST CONFIRMATION */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Cost Confirmation</h3>

              {lot.status === 'COSTING_COMPLETE' && allFieldsConfirmed && (
                <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 px-4 py-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">Costing complete — all fields confirmed.</p>
                </div>
              )}

              {!allFieldsConfirmed && (
                <p className="text-xs text-muted-foreground">Enter all cost values, then click Confirm Costs to lock them. Confirmed fields can be individually edited — editing a field clears its confirmation.</p>
              )}

              <div className="space-y-4">
                {/* FX Rate */}
                <CostField
                  label="FX Rate (USD → CAD)"
                  value={fxRate}
                  onChange={setFxRate}
                  confirmedBy={lot.fx_rate_confirmed_by}
                  confirmedAt={lot.fx_rate_confirmed_at}
                  confirmedByName={profileMap[lot.fx_rate_confirmed_by || ''] || null}
                  onClearConfirmation={() => clearConfirmation('fx_rate')}
                  fxRate={fxRate}
                  fxRateConfirmed={!!lot.fx_rate_confirmed_at}
                />
                {/* Invoice */}
                <CostField
                  label="Invoice Amount"
                  value={invoiceAmt}
                  onChange={setInvoiceAmt}
                  confirmedBy={lot.invoice_confirmed_by}
                  confirmedAt={lot.invoice_confirmed_at}
                  confirmedByName={profileMap[lot.invoice_confirmed_by || ''] || null}
                  onClearConfirmation={() => clearConfirmation('invoice')}
                  hasCurrencyToggle
                  isUsd={invoiceIsUsd}
                  onToggleUsd={setInvoiceIsUsd}
                  fxRate={fxRate}
                  fxRateConfirmed={!!lot.fx_rate_confirmed_at}
                />
                {/* Carry Fees */}
                <CostField
                  label="Carry / Financing Fees"
                  value={carryFees}
                  onChange={setCarryFees}
                  confirmedBy={lot.carry_fees_confirmed_by}
                  confirmedAt={lot.carry_fees_confirmed_at}
                  confirmedByName={profileMap[lot.carry_fees_confirmed_by || ''] || null}
                  onClearConfirmation={() => clearConfirmation('carry_fees')}
                  hasCurrencyToggle
                  isUsd={carryFeesIsUsd}
                  onToggleUsd={setCarryFeesIsUsd}
                  fxRate={fxRate}
                  fxRateConfirmed={!!lot.fx_rate_confirmed_at}
                />
                {/* Freight */}
                <CostField
                  label="Freight"
                  value={freight}
                  onChange={setFreight}
                  confirmedBy={lot.freight_confirmed_by}
                  confirmedAt={lot.freight_confirmed_at}
                  confirmedByName={profileMap[lot.freight_confirmed_by || ''] || null}
                  onClearConfirmation={() => clearConfirmation('freight')}
                  hasCurrencyToggle
                  isUsd={freightIsUsd}
                  onToggleUsd={setFreightIsUsd}
                  fxRate={fxRate}
                  fxRateConfirmed={!!lot.fx_rate_confirmed_at}
                />
                {/* Duties */}
                <CostField
                  label="Duties & Taxes"
                  value={duties}
                  onChange={setDuties}
                  confirmedBy={lot.duties_confirmed_by}
                  confirmedAt={lot.duties_confirmed_at}
                  confirmedByName={profileMap[lot.duties_confirmed_by || ''] || null}
                  onClearConfirmation={() => clearConfirmation('duties')}
                  fxRate={fxRate}
                  fxRateConfirmed={!!lot.fx_rate_confirmed_at}
                />
                {/* Transaction Fees */}
                <CostField
                  label="Transaction Fees"
                  value={txFees}
                  onChange={setTxFees}
                  confirmedBy={lot.transaction_fees_confirmed_by}
                  confirmedAt={lot.transaction_fees_confirmed_at}
                  confirmedByName={profileMap[lot.transaction_fees_confirmed_by || ''] || null}
                  onClearConfirmation={() => clearConfirmation('transaction_fees')}
                  fxRate={fxRate}
                  fxRateConfirmed={!!lot.fx_rate_confirmed_at}
                />
                {/* Other Costs */}
                <CostField
                  label="Other Costs"
                  value={otherCosts}
                  onChange={setOtherCosts}
                  confirmedBy={lot.other_costs_confirmed_by}
                  confirmedAt={lot.other_costs_confirmed_at}
                  confirmedByName={profileMap[lot.other_costs_confirmed_by || ''] || null}
                  onClearConfirmation={() => clearConfirmation('other_costs')}
                  fxRate={fxRate}
                  fxRateConfirmed={!!lot.fx_rate_confirmed_at}
                  descriptionValue={otherCostsDesc}
                  onDescriptionChange={setOtherCostsDesc}
                />
              </div>

              {/* Confirm button */}
              {hasUnconfirmedWithValue && !allFieldsConfirmed && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={saveCostValues} disabled={fieldSaveMutation.isPending}>
                    Save Draft
                  </Button>
                  <Button onClick={() => confirmCostsMutation.mutate()} disabled={confirmCostsMutation.isPending}>
                    {confirmCostsMutation.isPending ? 'Confirming…' : 'Confirm Costs'}
                  </Button>
                </div>
              )}

              {/* Live Cost Summary */}
              {liveSummary && (
                <Card className="mt-4">
                  <CardContent className="p-4 space-y-2">
                    <h4 className="text-sm font-semibold">Cost Summary</h4>
                    {liveSummary.fields.map(f => (
                      <div key={f.label} className={`flex justify-between text-sm ${!f.confirmed && f.cad != null ? 'italic text-muted-foreground' : ''}`}>
                        <span>{f.label} {!f.confirmed && f.cad != null && <span className="text-xs">(pending)</span>}</span>
                        <span>{f.cad != null ? `CAD $${f.cad.toFixed(4)}` : '—'}</span>
                      </div>
                    ))}
                    <Separator className="my-2" />
                    <div className="flex justify-between text-sm font-medium">
                      <span>Total Costs (CAD)</span>
                      <span>CAD ${liveSummary.totalCosts.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>kg Received</span>
                      <span>{kgReceived.toLocaleString()}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between text-base font-bold">
                      <span>Book Value/kg</span>
                      <span>{liveSummary.bvPerKg != null ? `CAD $${liveSummary.bvPerKg.toFixed(4)}/kg` : '—'}</span>
                    </div>
                    {liveSummary.bvPerKg == null && (
                      <p className="text-xs text-muted-foreground">Confirm cost fields above to calculate.</p>
                    )}
                    {liveSummary.financingCostPerKg != null && (
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Financing Cost/kg</span>
                        <span>CAD ${liveSummary.financingCostPerKg.toFixed(4)}/kg</span>
                      </div>
                    )}
                    {liveSummary.mvPerKg != null && (
                      <div className="flex justify-between text-base font-bold">
                        <span>Market Value/kg</span>
                        <span>CAD ${liveSummary.mvPerKg.toFixed(4)}/kg</span>
                      </div>
                    )}
                    {liveSummary.mvPerKg == null && paymentTerms == null && (
                      <p className="text-xs text-muted-foreground">Set financing inputs to calculate market value.</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            <Separator />

            {/* SECTION 3 — NOTES FEED */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Notes</h3>
              <div className="space-y-3">
                {notes.map(n => (
                  <div key={n.id} className="text-sm border-l-2 border-muted pl-3 py-1">
                    <p>{n.note}</p>
                    <p className="text-xs text-muted-foreground mt-1">{n.author_name} · {format(new Date(n.created_at), 'MMM d, yyyy h:mm a')}</p>
                  </div>
                ))}
                {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
              </div>
              <div className="mt-4 flex gap-2">
                <Input placeholder="Add a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && noteText.trim()) addNoteMutation.mutate(); }} />
                <Button size="sm" disabled={!noteText.trim() || addNoteMutation.isPending} onClick={() => addNoteMutation.mutate()}>Add Note</Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
