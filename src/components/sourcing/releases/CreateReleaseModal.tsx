import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { CalendarIcon, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPerKg, formatPerLb, formatMoney } from '@/lib/formatMoney';
import { getCountryName } from '@/lib/coffeeOrigins';
import { allocatePoNumber, allocateLotNumbers } from '@/lib/lotNumberGenerator';
import {
  KG_PER_LB,
  Currency,
  SharedCostsJson,
  SHARED_COST_KEYS,
  SHARED_COST_LABELS,
  SharedCostKey,
  emptySharedCosts,
  totalSharedCostsUsd,
  bookValuePerKgUsd,
  bookValuePerLbUsd,
  priceUsdPerLbToUsdPerKg,
} from './releaseUtils';

interface Vendor { id: string; name: string; abbreviation: string | null; }

interface ContractRow {
  id: string;
  name: string;
  internal_contract_number: string | null;
  vendor_contract_number: string | null;
  lot_identifier: string | null;
  origin_country: string | null;
  origin: string | null;
  region: string | null;
  producer: string | null;
  variety: string | null;
  num_bags: number | null;
  bag_size_kg: number | null;
  contracted_price_per_kg: number | null;
  contracted_price_currency: string | null;
  vendor_id: string | null;
}

interface SelectedLine {
  contract_id: string;
  contract: ContractRow;
  bags_requested: number;
  arrival_status: 'EN_ROUTE' | 'RECEIVED';
  // Step 2 pricing
  price_amount: string;       // editable, original unit
  price_unit: string;         // e.g. "USD/lb", "USD/kg"
  line_notes: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (releaseId: string) => void;
}

function contractRef(c: ContractRow): string {
  return c.internal_contract_number || c.vendor_contract_number || c.name || '—';
}

function contractDescription(c: ContractRow): string {
  return [getCountryName(c.origin_country) || c.origin, c.region, c.producer, c.variety]
    .filter(Boolean)
    .join(' · ');
}

/** Convert an entered price + unit into USD/lb (best effort, no FX). */
function toUsdPerLb(amount: number, unit: string): number {
  if (!amount) return 0;
  switch (unit) {
    case 'USD/lb': return amount;
    case 'USD/kg': return amount / KG_PER_LB;
    case 'CAD/lb': return amount; // no FX context — store as-is
    case 'CAD/kg': return amount / KG_PER_LB;
    default: return amount;
  }
}

function deriveOriginalPrice(c: ContractRow): { amount: string; unit: string } {
  if (c.contracted_price_per_kg == null) return { amount: '', unit: 'USD/lb' };
  const cur = (c.contracted_price_currency || 'USD').toUpperCase();
  // Convert kg → lb so the user sees USD/lb by default
  const perLb = Number(c.contracted_price_per_kg) / KG_PER_LB;
  return { amount: perLb.toFixed(4), unit: `${cur}/lb` };
}

export function CreateReleaseModal({ open, onOpenChange, onSuccess }: Props) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [vendorId, setVendorId] = useState('');
  const [selected, setSelected] = useState<Record<string, SelectedLine>>({});

  // Step 2 state
  const [etaDate, setEtaDate] = useState<Date | undefined>();
  const [notes, setNotes] = useState('');
  const [markReceived, setMarkReceived] = useState(true);
  const [receivedDate, setReceivedDate] = useState<Date | undefined>(new Date());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [sharedCosts, setSharedCosts] = useState<SharedCostsJson>(emptySharedCosts('USD'));
  const [emailCopied, setEmailCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setVendorId('');
    setSelected({});
    setEtaDate(undefined);
    setNotes('');
    setMarkReceived(true);
    setReceivedDate(new Date());
    setInvoiceNumber('');
    setSharedCosts(emptySharedCosts('USD'));
    setEmailCopied(false);
  }, [open]);

  // Load vendors
  const { data: vendors = [] } = useQuery({
    queryKey: ['green-vendors-active-for-release'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendors')
        .select('id, name, abbreviation')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as Vendor[];
    },
    enabled: open,
  });

  // Load active contracts for vendor
  const { data: contracts = [], isLoading: loadingContracts } = useQuery({
    queryKey: ['green-contracts-for-release', vendorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_contracts')
        .select('id, name, internal_contract_number, vendor_contract_number, lot_identifier, origin_country, origin, region, producer, variety, num_bags, bag_size_kg, contracted_price_per_kg, contracted_price_currency, vendor_id')
        .eq('vendor_id', vendorId)
        .eq('status', 'ACTIVE')
        .order('name');
      if (error) throw error;
      return data as ContractRow[];
    },
    enabled: open && !!vendorId,
  });

  // Bags already released per contract (from green_release_lines)
  const contractIds = contracts.map(c => c.id);
  const { data: releasedByContract = {} } = useQuery({
    queryKey: ['green-release-lines-by-contract', contractIds],
    queryFn: async () => {
      if (contractIds.length === 0) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from('green_release_lines')
        .select('contract_id, bags_requested')
        .in('contract_id', contractIds);
      if (error) throw error;
      const m: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        if (!r.contract_id) return;
        m[r.contract_id] = (m[r.contract_id] || 0) + (r.bags_requested || 0);
      });
      return m;
    },
    enabled: open && contractIds.length > 0,
  });

  function bagsRemaining(c: ContractRow): number {
    const total = c.num_bags || 0;
    const used = releasedByContract[c.id] || 0;
    return Math.max(0, total - used);
  }

  function toggleContract(c: ContractRow, checked: boolean) {
    setSelected(prev => {
      const next = { ...prev };
      if (checked) {
        const orig = deriveOriginalPrice(c);
        next[c.id] = {
          contract_id: c.id,
          contract: c,
          bags_requested: bagsRemaining(c),
          arrival_status: 'EN_ROUTE',
          price_amount: orig.amount,
          price_unit: orig.unit,
          line_notes: '',
        };
      } else {
        delete next[c.id];
      }
      return next;
    });
  }

  function updateLine(contractId: string, patch: Partial<SelectedLine>) {
    setSelected(prev => ({
      ...prev,
      [contractId]: { ...prev[contractId], ...patch },
    }));
  }

  const selectedList = useMemo(() => Object.values(selected), [selected]);
  const totalKgAll = selectedList.reduce((s, l) => s + l.bags_requested * Number(l.contract.bag_size_kg || 0), 0);
  const totalSharedUsd = totalSharedCostsUsd(sharedCosts);

  function step1Valid(): boolean {
    if (!vendorId) return false;
    if (selectedList.length === 0) return false;
    for (const l of selectedList) {
      if (!l.bags_requested || l.bags_requested <= 0) return false;
      if (l.bags_requested > bagsRemaining(l.contract)) return false;
    }
    return true;
  }

  // Build email draft
  const vendorName = vendors.find(v => v.id === vendorId)?.name || '';
  const emailBody = useMemo(() => {
    const lines = selectedList.map(l => {
      const ref = contractRef(l.contract);
      const desc = contractDescription(l.contract);
      return `- Contract: ${ref} | ${desc} | ${l.bags_requested} x ${l.contract.bag_size_kg}kg`;
    }).join('\n');
    const userName = authUser?.profile?.name || authUser?.email || '';
    return `Hi ${vendorName ? `[${vendorName} contact]` : '[vendor contact]'},

We'd like to request a release from the following contracts:

${lines}

Please let us know the expected ship date and invoice details at your convenience.

Thanks,
${userName}`;
  }, [selectedList, vendorName, authUser]);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(emailBody);
      setEmailCopied(true);
      toast.success('Email copied to clipboard');
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      toast.error('Could not copy — please copy manually');
    }
  }

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Defensive: never allow save unless user reached Step 2
      if (step !== 2) throw new Error('Please complete Step 2 before saving.');

      // 1. Allocate PO number for the release (atomic)
      const vendorAbbrForPo = vendors.find(v => v.id === vendorId)?.abbreviation || null;
      const po = await allocatePoNumber(vendorAbbrForPo);

      // 2. Insert release
      const status = invoiceNumber.trim() ? 'INVOICED' : 'PENDING';
      const arrival: 'RECEIVED' | 'EN_ROUTE' = markReceived ? 'RECEIVED' : 'EN_ROUTE';
      const etaStr = etaDate ? format(etaDate, 'yyyy-MM-dd') : null;
      const recStr = receivedDate ? format(receivedDate, 'yyyy-MM-dd') : null;

      const { data: rel, error: relErr } = await supabase
        .from('green_releases')
        .insert({
          vendor_id: vendorId,
          status,
          invoice_number: invoiceNumber.trim() || null,
          eta_date: arrival === 'EN_ROUTE' ? etaStr : null,
          received_date: arrival === 'RECEIVED' ? recStr : null,
          arrival_status: arrival,
          shared_costs: sharedCosts as any,
          notes: notes.trim() || null,
          po_number: po.poNumber,
          created_by: authUser?.id || null,
        } as any)
        .select('id')
        .single();
      if (relErr) throw relErr;
      const releaseId = rel!.id;

      // 2. Insert release lines + create lots
      // Per-kg shared cost share, prorated by weighted kg average across all lines.
      // Compute totals per shared cost bucket so we can map to the lot's
      // currency-specific cost columns (USD vs CAD).
      const bucketTotals = SHARED_COST_KEYS.reduce<Record<SharedCostKey, { usd: number; cad: number }>>((acc, k) => {
        const line = sharedCosts[k];
        const amt = Number(line?.amount) || 0;
        const cur = (line?.currency || 'USD') as Currency;
        acc[k] = { usd: cur === 'USD' ? amt : 0, cad: cur === 'CAD' ? amt : 0 };
        return acc;
      }, {} as any);

      for (const l of selectedList) {
        const priceAmount = parseFloat(l.price_amount) || 0;
        const priceUsdPerLb = toUsdPerLb(priceAmount, l.price_unit);
        const bagSize = Number(l.contract.bag_size_kg || 0);
        const totalKg = l.bags_requested * bagSize;

        // Weight share for proration (kg fraction of full release)
        const kgShare = totalKgAll > 0 ? totalKg / totalKgAll : 0;

        // Coffee cost (invoice) — total USD for this lot's coffee
        const coffeeCostUsd = priceUsdPerLb > 0 ? priceUsdPerLb * KG_PER_LB * totalKg : null;

        // Prorated shared costs by bucket (USD or CAD), per lot
        const lotCarryUsd = bucketTotals.carry.usd * kgShare;
        const lotCarryCad = bucketTotals.carry.cad * kgShare;
        const lotFreightCad = (bucketTotals.freight.usd + bucketTotals.freight.cad) * kgShare; // freight column is CAD only — fold any USD freight in (best-effort, no FX context)
        const lotDutiesCad = (bucketTotals.duties.usd + bucketTotals.duties.cad) * kgShare;
        const lotFeesCad = (bucketTotals.fees.usd + bucketTotals.fees.cad) * kgShare;
        const lotOtherCad = (bucketTotals.other.usd + bucketTotals.other.cad) * kgShare;

        // Book value (USD/kg) using the global per-kg shared share
        const sharedShareUsdPerKg = totalKgAll > 0 ? totalSharedUsd / totalKgAll : 0;
        const bookPerKg = bookValuePerKgUsd(priceUsdPerLb, sharedShareUsdPerKg);

        // Generate lot number under the just-allocated PO
        const lotNumber = await allocateSingleLotNumber(po, l.contract.origin_country);

        const isReceived = arrival === 'RECEIVED';

        // Create lot — arrival status is global (Step 2 toggle).
        // We store costs in both _usd columns AND mirror into _cad columns (with
        // _is_usd=true and fx_rate=1 placeholder) so the lot detail panel —
        // which back-converts from the *_cad columns — surfaces non-zero values
        // before any FX has been confirmed.
        const { data: lot, error: lotErr } = await supabase
          .from('green_lots')
          .insert({
            lot_number: lotNumber,
            contract_id: l.contract_id,
            release_id: releaseId,
            lot_identifier: l.contract.lot_identifier || null,
            bag_size_kg: bagSize,
            bags_released: l.bags_requested,
            kg_on_hand: isReceived ? totalKg : 0,
            kg_received: isReceived ? totalKg : null,
            received_date: isReceived ? recStr : null,
            expected_delivery_date: !isReceived ? etaStr : null,
            status: isReceived ? 'RECEIVED' : 'EN_ROUTE',
            // FX placeholder so mirrored *_cad values back-convert cleanly to original USD
            fx_rate: 1,
            // Coffee cost
            invoice_amount_usd: coffeeCostUsd,
            invoice_amount_cad: coffeeCostUsd,
            invoice_is_usd: true,
            // Prorated shared costs (mirror USD into CAD column with is_usd=true)
            carry_fees_usd: lotCarryUsd > 0 ? lotCarryUsd : null,
            carry_fees_cad: (lotCarryUsd + lotCarryCad) > 0 ? (lotCarryUsd + lotCarryCad) : null,
            carry_fees_is_usd: lotCarryUsd >= lotCarryCad,
            freight_cad: lotFreightCad > 0 ? lotFreightCad : null,
            freight_is_usd: false,
            duties_cad: lotDutiesCad > 0 ? lotDutiesCad : null,
            transaction_fees_cad: lotFeesCad > 0 ? lotFeesCad : null,
            other_costs_cad: lotOtherCad > 0 ? lotOtherCad : null,
            // Computed values
            book_value_per_kg: bookPerKg > 0 ? bookPerKg : null,
            market_value_per_kg: bookPerKg > 0 ? bookPerKg : null,
            costing_status: invoiceNumber.trim() ? 'COMPLETE' : 'INCOMPLETE',
            costing_complete: !!invoiceNumber.trim(),
            notes_internal: l.line_notes.trim() || null,
            created_by: authUser?.id || null,
          })
          .select('id')
          .single();
        if (lotErr) throw lotErr;

        // Insert release line
        const { error: lineErr } = await supabase
          .from('green_release_lines')
          .insert({
            release_id: releaseId,
            contract_id: l.contract_id,
            lot_id: lot!.id,
            bags_requested: l.bags_requested,
            bag_size_kg: bagSize,
            price_per_lb_usd: priceUsdPerLb || null,
            original_price: { amount: priceAmount, unit: l.price_unit } as any,
            notes: l.line_notes.trim() || null,
          });
        if (lineErr) throw lineErr;
      }

      return releaseId;
    },
    onSuccess: (releaseId) => {
      toast.success('Release saved');
      queryClient.invalidateQueries({ queryKey: ['green-releases'] });
      queryClient.invalidateQueries({ queryKey: ['green-release-lines'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      onOpenChange(false);
      onSuccess?.(releaseId);
    },
    onError: (err: any) => {
      toast.error(`Save failed: ${err?.message || 'Unknown error'}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step === 1 ? 'New Release — Select Contracts' : 'New Release — Details & Pricing'}</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={(v) => { setVendorId(v); setSelected({}); }}>
                <SelectTrigger><SelectValue placeholder="Select vendor…" /></SelectTrigger>
                <SelectContent>
                  {vendors.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {vendorId && (
              <div>
                <Label className="mb-2 block">Active Forward Contracts</Label>
                {loadingContracts ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : contracts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active contracts for this vendor.</p>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Contract</TableHead>
                          <TableHead>Vendor Contract #</TableHead>
                          <TableHead>Lot ID</TableHead>
                          <TableHead>Name / Description</TableHead>
                          <TableHead>Origin / Description</TableHead>
                          <TableHead className="text-right">Bags Remaining</TableHead>
                          <TableHead className="text-right">Bag Size</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right w-32">Bags Requested</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contracts.map(c => {
                          const sel = selected[c.id];
                          const remaining = bagsRemaining(c);
                          const orig = deriveOriginalPrice(c);
                          return (
                            <TableRow key={c.id}>
                              <TableCell>
                                <Checkbox
                                  checked={!!sel}
                                  onCheckedChange={(chk) => toggleContract(c, !!chk)}
                                  disabled={remaining <= 0 && !sel}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{contractRef(c)}</TableCell>
                              <TableCell className="text-sm">{c.vendor_contract_number || '—'}</TableCell>
                              <TableCell className="text-sm">{c.lot_identifier || '—'}</TableCell>
                              <TableCell className="text-sm">{c.name || '—'}</TableCell>
                              <TableCell className="text-sm">{contractDescription(c) || '—'}</TableCell>
                              <TableCell className="text-right">{remaining} / {c.num_bags || 0}</TableCell>
                              <TableCell className="text-right">{c.bag_size_kg ? `${c.bag_size_kg} kg` : '—'}</TableCell>
                              <TableCell className="text-right text-xs">
                                {orig.amount ? `${orig.amount} ${orig.unit}` : '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                {sel ? (
                                  <Input
                                    type="number"
                                    min={1}
                                    max={remaining}
                                    value={sel.bags_requested}
                                    onChange={(e) => updateLine(c.id, { bags_requested: parseInt(e.target.value) || 0 })}
                                    className={cn('h-8 text-right', sel.bags_requested > remaining && 'border-destructive')}
                                  />
                                ) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!step1Valid()}>Next</Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            {/* Header section */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Number (optional — sets status to Invoiced)</Label>
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-12345" />
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes…" />
              </div>
            </div>

            {/* Before you save */}
            <div className="border rounded-md p-3 bg-muted/30 space-y-3">
              <p className="text-sm font-semibold">Before you save</p>
              <div className="space-y-2">
                <Label className="text-xs">Arrival status (applies to all lots)</Label>
                <div className="inline-flex rounded-md border border-input overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setMarkReceived(false)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium transition-colors',
                      !markReceived ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                    )}
                  >En Route</button>
                  <button
                    type="button"
                    onClick={() => setMarkReceived(true)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium transition-colors',
                      markReceived ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                    )}
                  >Received</button>
                </div>
              </div>
              {markReceived ? (
                <div>
                  <Label className="text-xs">Received Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn('w-56 justify-start text-left font-normal', !receivedDate && 'text-muted-foreground')}>
                        <CalendarIcon className="mr-2 h-3 w-3" />
                        {receivedDate ? format(receivedDate, 'PPP') : 'Pick a date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={receivedDate} onSelect={setReceivedDate} initialFocus className={cn('p-3 pointer-events-auto')} />
                    </PopoverContent>
                  </Popover>
                </div>
              ) : (
                <div>
                  <Label className="text-xs">ETA Date (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn('w-56 justify-start text-left font-normal', !etaDate && 'text-muted-foreground')}>
                        <CalendarIcon className="mr-2 h-3 w-3" />
                        {etaDate ? format(etaDate, 'PPP') : 'Pick a date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={etaDate} onSelect={setEtaDate} initialFocus className={cn('p-3 pointer-events-auto')} />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            {/* Per-line pricing */}
            <div className="space-y-3">
              <p className="text-sm font-semibold">Coffee Lines</p>
              {selectedList.map(l => {
                const totalKg = l.bags_requested * Number(l.contract.bag_size_kg || 0);
                return (
                  <Card key={l.contract_id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <p className="font-medium text-sm">{contractRef(l.contract)}</p>
                            {l.contract.lot_identifier && (
                              <p className="text-xs text-muted-foreground"><span className="font-medium">Lot:</span> {l.contract.lot_identifier}</p>
                            )}
                            {l.contract.vendor_contract_number && (
                              <p className="text-xs text-muted-foreground"><span className="font-medium">Vendor #:</span> {l.contract.vendor_contract_number}</p>
                            )}
                            {l.contract.name && (
                              <p className="text-xs text-muted-foreground"><span className="font-medium">Name:</span> {l.contract.name}</p>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{contractDescription(l.contract) || '—'}</p>
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-nowrap">{l.bags_requested} bags × {l.contract.bag_size_kg} kg = <span className="font-medium text-foreground">{totalKg.toLocaleString()} kg</span></p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div>
                          <Label className="text-xs">Price</Label>
                          <Input
                            type="number"
                            step="0.0001"
                            value={l.price_amount}
                            onChange={(e) => updateLine(l.contract_id, { price_amount: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Unit</Label>
                          <Select value={l.price_unit} onValueChange={(v) => updateLine(l.contract_id, { price_unit: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="USD/lb">USD/lb</SelectItem>
                              <SelectItem value="USD/kg">USD/kg</SelectItem>
                              <SelectItem value="CAD/lb">CAD/lb</SelectItem>
                              <SelectItem value="CAD/kg">CAD/kg</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-1">
                          <Label className="text-xs">Line Notes</Label>
                          <Input value={l.line_notes} onChange={(e) => updateLine(l.contract_id, { line_notes: e.target.value })} className="h-9" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Shared costs */}
            <div className="border rounded-md p-3 space-y-2">
              <p className="text-sm font-semibold">Shared Costs</p>
              <div className="grid grid-cols-2 gap-3">
                {SHARED_COST_KEYS.map(key => (
                  <div key={key}>
                    <Label className="text-xs">{SHARED_COST_LABELS[key]}</Label>
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={sharedCosts[key]?.amount ?? 0}
                        onChange={(e) => setSharedCosts(prev => ({
                          ...prev,
                          [key]: { amount: parseFloat(e.target.value) || 0, currency: prev[key]?.currency || 'USD' },
                        }))}
                        className="h-9"
                      />
                      <Select
                        value={sharedCosts[key]?.currency || 'USD'}
                        onValueChange={(v) => setSharedCosts(prev => ({
                          ...prev,
                          [key]: { amount: prev[key]?.amount || 0, currency: v as Currency },
                        }))}
                      >
                        <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="CAD">CAD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live book value table */}
            {selectedList.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-sm font-semibold">Estimated Book Value (live)</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coffee</TableHead>
                      <TableHead className="text-right">Bags</TableHead>
                      <TableHead className="text-right">Total kg</TableHead>
                      <TableHead className="text-right">Coffee $/lb</TableHead>
                      <TableHead className="text-right">Shared $/kg</TableHead>
                      <TableHead className="text-right">Book $/kg</TableHead>
                      <TableHead className="text-right">Book $/lb</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedList.map(l => {
                      const priceUsdPerLb = toUsdPerLb(parseFloat(l.price_amount) || 0, l.price_unit);
                      const lineKg = l.bags_requested * Number(l.contract.bag_size_kg || 0);
                      const sharedShare = totalKgAll > 0 ? totalSharedUsd / totalKgAll : 0;
                      const bookKg = bookValuePerKgUsd(priceUsdPerLb, sharedShare);
                      const bookLb = bookValuePerLbUsd(priceUsdPerLb, sharedShare);
                      return (
                        <TableRow key={l.contract_id}>
                          <TableCell className="text-sm">{contractRef(l.contract)}</TableCell>
                          <TableCell className="text-right">{l.bags_requested}</TableCell>
                          <TableCell className="text-right">{lineKg.toLocaleString()} kg</TableCell>
                          <TableCell className="text-right">{formatPerLb(priceUsdPerLb, 'USD')}</TableCell>
                          <TableCell className="text-right">{formatPerKg(sharedShare, 'USD')}</TableCell>
                          <TableCell className="text-right font-medium">{formatPerKg(bookKg, 'USD')}</TableCell>
                          <TableCell className="text-right">{formatPerLb(bookLb, 'USD')}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Email draft */}
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Email Draft to Vendor</p>
                <Button size="sm" variant="outline" onClick={copyEmail} className="gap-1.5">
                  {emailCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {emailCopied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <Textarea readOnly value={emailBody} rows={8} className="font-mono text-xs" />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button
                onClick={() => {
                  if (step !== 2) return;
                  saveMutation.mutate();
                }}
                disabled={step !== 2 || saving || saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save Release'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
