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
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, Copy, Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPerKg, formatPerLb } from '@/lib/formatMoney';
import { getCountryName } from '@/lib/coffeeOrigins';
import { allocatePoNumber, allocateSingleLotNumber } from '@/lib/lotNumberGenerator';
import {
  KG_PER_LB,
  Currency,
  SharedCostsJson,
  SHARED_COST_KEYS,
  SHARED_COST_LABELS,
  SharedCostKey,
  SelectedLine,
  emptySharedCosts,
  totalSharedCostsUsd,
  bookValuePerKgUsd,
  bookValuePerLbUsd,
} from './releaseUtils';

// ─── Local types ─────────────────────────────────────────────────────────────

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

interface PurchaseLineRow {
  id: string;
  purchase_id: string;
  lot_id: string | null;
  lot_identifier: string | null;
  origin_country: string | null;
  region: string | null;
  producer: string | null;
  variety: string | null;
  bags: number | null;
  bag_size_kg: number | null;
  price_per_lb_usd: number | null;
  purchase: {
    id: string;
    vendor_id: string | null;
    invoice_number: string | null;
  } | null;
}

type Step1Tab = 'contracts' | 'purchases' | 'adhoc';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (releaseId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function contractRef(c: ContractRow): string {
  return c.internal_contract_number || c.vendor_contract_number || c.name || '—';
}

function contractDescription(c: ContractRow): string {
  return [getCountryName(c.origin_country) || c.origin, c.region, c.producer, c.variety]
    .filter(Boolean)
    .join(' · ');
}

function toUsdPerLb(amount: number, unit: string): number {
  if (!amount) return 0;
  switch (unit) {
    case 'USD/lb': return amount;
    case 'USD/kg': return amount / KG_PER_LB;
    case 'CAD/lb': return amount;
    case 'CAD/kg': return amount / KG_PER_LB;
    default: return amount;
  }
}

function defaultPriceFromContract(c: ContractRow): { amount: string; unit: string } {
  if (c.contracted_price_per_kg == null) return { amount: '', unit: 'USD/lb' };
  const cur = (c.contracted_price_currency || 'USD').toUpperCase();
  const perLb = Number(c.contracted_price_per_kg) / KG_PER_LB;
  return { amount: perLb.toFixed(4), unit: `${cur}/lb` };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CreateReleaseModal({ open, onOpenChange, onSuccess }: Props) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<1 | 2>(1);
  const [tab, setTab] = useState<Step1Tab>('contracts');

  // selected lines: keyed by unique key
  const [selected, setSelected] = useState<Record<string, SelectedLine>>({});

  // contract tab: filter by vendor
  const [contractVendorFilter, setContractVendorFilter] = useState('');
  const [contractSearch, setContractSearch] = useState('');

  // purchase tab
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [showAllPurchaseLines, setShowAllPurchaseLines] = useState(false);

  // ad-hoc tab form state
  const [adhocVendorId, setAdhocVendorId] = useState('');
  const [adhocLotId, setAdhocLotId] = useState('');
  const [adhocOrigin, setAdhocOrigin] = useState('');
  const [adhocRegion, setAdhocRegion] = useState('');
  const [adhocProducer, setAdhocProducer] = useState('');
  const [adhocVariety, setAdhocVariety] = useState('');
  const [adhocBags, setAdhocBags] = useState('');
  const [adhocBagSize, setAdhocBagSize] = useState('');
  const [adhocPriceAmount, setAdhocPriceAmount] = useState('');
  const [adhocPriceUnit, setAdhocPriceUnit] = useState('USD/lb');
  const [adhocNotes, setAdhocNotes] = useState('');

  // Step 2 state
  const [etaDate, setEtaDate] = useState<Date | undefined>();
  const [notes, setNotes] = useState('');
  const [markReceived, setMarkReceived] = useState(true);
  const [receivedDate, setReceivedDate] = useState<Date | undefined>(new Date());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [sharedCosts, setSharedCosts] = useState<SharedCostsJson>(emptySharedCosts('USD'));
  const [emailCopied, setEmailCopied] = useState(false);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setTab('contracts');
    setSelected({});
    setContractVendorFilter('');
    setContractSearch('');
    setPurchaseSearch('');
    setShowAllPurchaseLines(false);
    setAdhocVendorId('');
    setAdhocLotId('');
    setAdhocOrigin('');
    setAdhocRegion('');
    setAdhocProducer('');
    setAdhocVariety('');
    setAdhocBags('');
    setAdhocBagSize('');
    setAdhocPriceAmount('');
    setAdhocPriceUnit('USD/lb');
    setAdhocNotes('');
    setEtaDate(undefined);
    setNotes('');
    setMarkReceived(true);
    setReceivedDate(new Date());
    setInvoiceNumber('');
    setSharedCosts(emptySharedCosts('USD'));
    setEmailCopied(false);
  }, [open]);

  // ── Data loading ──────────────────────────────────────────────────────────

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

  const vendorMap = useMemo(() => {
    const m: Record<string, Vendor> = {};
    vendors.forEach(v => { m[v.id] = v; });
    return m;
  }, [vendors]);

  // All active contracts (all vendors)
  const { data: contracts = [], isLoading: loadingContracts } = useQuery({
    queryKey: ['green-contracts-for-release-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_contracts')
        .select('id, name, internal_contract_number, vendor_contract_number, lot_identifier, origin_country, origin, region, producer, variety, num_bags, bag_size_kg, contracted_price_per_kg, contracted_price_currency, vendor_id')
        .eq('status', 'ACTIVE')
        .order('name');
      if (error) throw error;
      return data as ContractRow[];
    },
    enabled: open && tab === 'contracts',
  });

  // Bags already released per contract
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

  // Purchase lines
  const { data: purchaseLines = [], isLoading: loadingPurchaseLines } = useQuery({
    queryKey: ['green-purchase-lines-for-release', showAllPurchaseLines],
    queryFn: async () => {
      let q = supabase
        .from('green_purchase_lines')
        .select('id, purchase_id, lot_id, lot_identifier, origin_country, region, producer, variety, bags, bag_size_kg, price_per_lb_usd, purchase:green_purchases(id, vendor_id, invoice_number)')
        .order('created_at', { ascending: false });
      if (!showAllPurchaseLines) {
        q = q.is('lot_id', null);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as PurchaseLineRow[];
    },
    enabled: open && tab === 'purchases',
  });

  // ── Line management ───────────────────────────────────────────────────────

  function bagsRemaining(c: ContractRow): number {
    return Math.max(0, (c.num_bags || 0) - (releasedByContract[c.id] || 0));
  }

  function toggleContract(c: ContractRow, checked: boolean) {
    const key = `contract:${c.id}`;
    setSelected(prev => {
      const next = { ...prev };
      if (checked) {
        const orig = defaultPriceFromContract(c);
        const vendor = c.vendor_id ? vendorMap[c.vendor_id] : null;
        next[key] = {
          key,
          source_type: 'CONTRACT',
          vendor_id: c.vendor_id,
          vendor_name: vendor?.name || '—',
          vendor_abbr: vendor?.abbreviation || null,
          contract_id: c.id,
          contract_name: c.name,
          internal_contract_number: c.internal_contract_number,
          vendor_contract_number: c.vendor_contract_number,
          purchase_line_id: null,
          purchase_id: null,
          existing_lot_id: null,
          lot_identifier: c.lot_identifier,
          origin_country: c.origin_country,
          region: c.region,
          producer: c.producer,
          variety: c.variety,
          bag_size_kg: Number(c.bag_size_kg || 0),
          bags_requested: bagsRemaining(c),
          price_amount: orig.amount,
          price_unit: orig.unit,
          line_notes: '',
        };
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function togglePurchaseLine(pl: PurchaseLineRow, checked: boolean) {
    const key = `purchase:${pl.id}`;
    const vendorId = pl.purchase?.vendor_id || null;
    const vendor = vendorId ? vendorMap[vendorId] : null;
    setSelected(prev => {
      const next = { ...prev };
      if (checked) {
        next[key] = {
          key,
          source_type: 'PURCHASE',
          vendor_id: vendorId,
          vendor_name: vendor?.name || '—',
          vendor_abbr: vendor?.abbreviation || null,
          contract_id: null,
          contract_name: null,
          internal_contract_number: null,
          vendor_contract_number: null,
          purchase_line_id: pl.id,
          purchase_id: pl.purchase_id,
          existing_lot_id: pl.lot_id || null,
          lot_identifier: pl.lot_identifier,
          origin_country: pl.origin_country,
          region: pl.region,
          producer: pl.producer,
          variety: pl.variety,
          bag_size_kg: Number(pl.bag_size_kg || 0),
          bags_requested: pl.bags || 0,
          price_amount: pl.price_per_lb_usd != null ? String(pl.price_per_lb_usd) : '',
          price_unit: 'USD/lb',
          line_notes: '',
        };
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function addAdhocLine() {
    const bags = parseInt(adhocBags) || 0;
    const bagSize = parseFloat(adhocBagSize) || 0;
    if (bags <= 0 || bagSize <= 0) {
      toast.error('Bags and bag size required for ad-hoc line');
      return;
    }
    const vendor = adhocVendorId ? vendorMap[adhocVendorId] : null;
    const key = `adhoc:${Date.now()}`;
    setSelected(prev => ({
      ...prev,
      [key]: {
        key,
        source_type: 'ADHOC',
        vendor_id: adhocVendorId || null,
        vendor_name: vendor?.name || '—',
        vendor_abbr: vendor?.abbreviation || null,
        contract_id: null,
        contract_name: null,
        internal_contract_number: null,
        vendor_contract_number: null,
        purchase_line_id: null,
        purchase_id: null,
        existing_lot_id: null,
        lot_identifier: adhocLotId.trim() || null,
        origin_country: adhocOrigin.trim() || null,
        region: adhocRegion.trim() || null,
        producer: adhocProducer.trim() || null,
        variety: adhocVariety.trim() || null,
        bag_size_kg: bagSize,
        bags_requested: bags,
        price_amount: adhocPriceAmount,
        price_unit: adhocPriceUnit,
        line_notes: adhocNotes,
      },
    }));
    // reset adhoc form
    setAdhocLotId('');
    setAdhocOrigin('');
    setAdhocRegion('');
    setAdhocProducer('');
    setAdhocVariety('');
    setAdhocBags('');
    setAdhocBagSize('');
    setAdhocPriceAmount('');
    setAdhocNotes('');
  }

  function removeLine(key: string) {
    setSelected(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function updateLine(key: string, patch: Partial<SelectedLine>) {
    setSelected(prev => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  const selectedList = useMemo(() => Object.values(selected), [selected]);
  const totalKgAll = selectedList.reduce((s, l) => s + l.bags_requested * l.bag_size_kg, 0);
  const totalSharedUsd = totalSharedCostsUsd(sharedCosts);

  // ── Validation ────────────────────────────────────────────────────────────

  function step1Valid(): boolean {
    if (selectedList.length === 0) return false;
    for (const l of selectedList) {
      if (!l.bags_requested || l.bags_requested <= 0) return false;
      if (l.source_type === 'CONTRACT') {
        const c = contracts.find(c => c.id === l.contract_id);
        if (c && l.bags_requested > bagsRemaining(c)) return false;
      }
    }
    return true;
  }

  // ── Email draft ───────────────────────────────────────────────────────────

  const emailBody = useMemo(() => {
    // Group by vendor
    const byVendor: Record<string, { name: string; lines: SelectedLine[] }> = {};
    for (const l of selectedList) {
      const vid = l.vendor_id || '_unknown';
      if (!byVendor[vid]) byVendor[vid] = { name: l.vendor_name, lines: [] };
      byVendor[vid].lines.push(l);
    }
    const userName = authUser?.profile?.name || authUser?.email || '';
    return Object.values(byVendor).map(({ name, lines }) => {
      const lineText = lines.map(l => {
        const ref = l.internal_contract_number || l.vendor_contract_number || l.lot_identifier || '—';
        const desc = [getCountryName(l.origin_country), l.region, l.producer, l.variety].filter(Boolean).join(' · ');
        return `- ${ref} | ${desc} | ${l.bags_requested} x ${l.bag_size_kg}kg`;
      }).join('\n');
      return `To: [${name} contact]

We'd like to request a release from the following:

${lineText}

Please let us know the expected ship date and invoice details.

Thanks,
${userName}`;
    }).join('\n\n---\n\n');
  }, [selectedList, authUser]);

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

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (step !== 2) throw new Error('Please complete Step 2 before saving.');

      // Compute release-level vendor: single vendor if all lines share one, else null
      const uniqueVendorIds = [...new Set(selectedList.map(l => l.vendor_id).filter(Boolean))];
      const releaseVendorId = uniqueVendorIds.length === 1 ? uniqueVendorIds[0]! : null;
      const primaryVendorAbbr = releaseVendorId ? (vendorMap[releaseVendorId]?.abbreviation || null) : null;

      // Allocate PO
      const po = await allocatePoNumber(primaryVendorAbbr);

      const status = invoiceNumber.trim() ? 'INVOICED' : 'PENDING';
      const arrival: 'RECEIVED' | 'EN_ROUTE' = markReceived ? 'RECEIVED' : 'EN_ROUTE';
      const etaStr = etaDate ? format(etaDate, 'yyyy-MM-dd') : null;
      const recStr = receivedDate ? format(receivedDate, 'yyyy-MM-dd') : null;

      // Insert release
      const { data: rel, error: relErr } = await supabase
        .from('green_releases')
        .insert({
          vendor_id: releaseVendorId,
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

      // Bucket totals for prorating into lot cost columns
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
        const totalKg = l.bags_requested * l.bag_size_kg;
        const kgShare = totalKgAll > 0 ? totalKg / totalKgAll : 0;

        const coffeeCostUsd = priceUsdPerLb > 0 ? priceUsdPerLb * KG_PER_LB * totalKg : null;
        const lotCarryUsd = bucketTotals.carry.usd * kgShare;
        const lotCarryCad = bucketTotals.carry.cad * kgShare;
        const lotFreightCad = (bucketTotals.freight.usd + bucketTotals.freight.cad) * kgShare;
        const lotDutiesCad = (bucketTotals.duties.usd + bucketTotals.duties.cad) * kgShare;
        const lotFeesCad = (bucketTotals.fees.usd + bucketTotals.fees.cad) * kgShare;
        const lotOtherCad = (bucketTotals.other.usd + bucketTotals.other.cad) * kgShare;
        const sharedShareUsdPerKg = totalKgAll > 0 ? totalSharedUsd / totalKgAll : 0;
        const bookPerKg = bookValuePerKgUsd(priceUsdPerLb, sharedShareUsdPerKg);

        const isReceived = arrival === 'RECEIVED';

        let lotId: string;

        if (l.source_type === 'PURCHASE' && l.existing_lot_id) {
          // Lot already exists from the purchase — link it to this release
          const { error: updateErr } = await supabase
            .from('green_lots')
            .update({
              release_id: releaseId,
              status: isReceived ? 'RECEIVED' : 'EN_ROUTE',
              kg_on_hand: isReceived ? totalKg : 0,
              kg_received: isReceived ? totalKg : null,
              received_date: isReceived ? recStr : null,
              expected_delivery_date: !isReceived ? etaStr : null,
              book_value_per_kg: bookPerKg > 0 ? bookPerKg : null,
              market_value_per_kg: bookPerKg > 0 ? bookPerKg : null,
            })
            .eq('id', l.existing_lot_id);
          if (updateErr) throw updateErr;
          lotId = l.existing_lot_id;
        } else {
          // Create a new lot
          const lotNumber = await allocateSingleLotNumber(po, l.origin_country, l.vendor_abbr);
          const { data: lot, error: lotErr } = await supabase
            .from('green_lots')
            .insert({
              lot_number: lotNumber,
              contract_id: l.contract_id,
              purchase_id: l.purchase_id,
              release_id: releaseId,
              lot_identifier: l.lot_identifier || null,
              bag_size_kg: l.bag_size_kg,
              bags_released: l.bags_requested,
              kg_on_hand: isReceived ? totalKg : 0,
              kg_received: isReceived ? totalKg : null,
              received_date: isReceived ? recStr : null,
              expected_delivery_date: !isReceived ? etaStr : null,
              status: isReceived ? 'RECEIVED' : 'EN_ROUTE',
              fx_rate: 1,
              invoice_amount_usd: coffeeCostUsd,
              invoice_amount_cad: coffeeCostUsd,
              invoice_is_usd: true,
              carry_fees_usd: lotCarryUsd > 0 ? lotCarryUsd : null,
              carry_fees_cad: (lotCarryUsd + lotCarryCad) > 0 ? (lotCarryUsd + lotCarryCad) : null,
              carry_fees_is_usd: lotCarryUsd >= lotCarryCad,
              freight_cad: lotFreightCad > 0 ? lotFreightCad : null,
              freight_is_usd: false,
              duties_cad: lotDutiesCad > 0 ? lotDutiesCad : null,
              transaction_fees_cad: lotFeesCad > 0 ? lotFeesCad : null,
              other_costs_cad: lotOtherCad > 0 ? lotOtherCad : null,
              book_value_per_kg: bookPerKg > 0 ? bookPerKg : null,
              market_value_per_kg: bookPerKg > 0 ? bookPerKg : null,
              costing_status: invoiceNumber.trim() ? 'COMPLETE' : 'INCOMPLETE',
              costing_complete: !!invoiceNumber.trim(),
              notes_internal: l.line_notes.trim() || null,
              created_by: authUser?.id || null,
            } as any)
            .select('id')
            .single();
          if (lotErr) throw lotErr;
          lotId = lot!.id;

          // If this was a PURCHASE line, update the purchase line's lot_id
          if (l.source_type === 'PURCHASE' && l.purchase_line_id) {
            await supabase
              .from('green_purchase_lines')
              .update({ lot_id: lotId })
              .eq('id', l.purchase_line_id);
          }
        }

        // Insert release line
        const { error: lineErr } = await supabase
          .from('green_release_lines')
          .insert({
            release_id: releaseId,
            contract_id: l.contract_id,
            lot_id: lotId,
            bags_requested: l.bags_requested,
            bag_size_kg: l.bag_size_kg,
            price_per_lb_usd: priceUsdPerLb || null,
            original_price: { amount: parseFloat(l.price_amount) || 0, unit: l.price_unit } as any,
            notes: l.line_notes.trim() || null,
            source_type: l.source_type,
            purchase_line_id: l.purchase_line_id || null,
            vendor_id: l.vendor_id || null,
            lot_identifier: l.lot_identifier || null,
            origin_country: l.origin_country || null,
            region: l.region || null,
            producer: l.producer || null,
            variety: l.variety || null,
          } as any);
        if (lineErr) throw lineErr;
      }

      return releaseId;
    },
    onSuccess: (releaseId) => {
      toast.success('Release saved');
      queryClient.invalidateQueries({ queryKey: ['green-releases'] });
      queryClient.invalidateQueries({ queryKey: ['green-release-lines'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-purchase-lines-for-release'] });
      onOpenChange(false);
      onSuccess?.(releaseId);
    },
    onError: (err: any) => {
      toast.error(`Save failed: ${err?.message || 'Unknown error'}`);
    },
  });

  // ── Filtered contract list ────────────────────────────────────────────────

  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
      if (contractVendorFilter && c.vendor_id !== contractVendorFilter) return false;
      if (contractSearch) {
        const q = contractSearch.toLowerCase();
        const haystack = [
          c.name, c.internal_contract_number, c.vendor_contract_number,
          c.lot_identifier, c.origin_country, c.region, c.producer, c.variety,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [contracts, contractVendorFilter, contractSearch]);

  const filteredPurchaseLines = useMemo(() => {
    return purchaseLines.filter(pl => {
      if (!purchaseSearch) return true;
      const q = purchaseSearch.toLowerCase();
      const vendorName = pl.purchase?.vendor_id ? (vendorMap[pl.purchase.vendor_id]?.name || '') : '';
      const haystack = [
        pl.lot_identifier, pl.origin_country, pl.region, pl.producer, pl.variety,
        pl.purchase?.invoice_number, vendorName,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [purchaseLines, purchaseSearch, vendorMap]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'New Release — Select Lines' : 'New Release — Details & Pricing'}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            {/* Tab switcher */}
            <div className="inline-flex rounded-md border border-input overflow-hidden">
              {(['contracts', 'purchases', 'adhoc'] as Step1Tab[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'px-4 py-1.5 text-sm font-medium transition-colors',
                    tab === t ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                  )}
                >
                  {t === 'contracts' ? 'Forward Contracts' : t === 'purchases' ? 'Spot Purchases' : 'Ad-hoc'}
                </button>
              ))}
            </div>

            {/* ── Forward Contracts tab ── */}
            {tab === 'contracts' && (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <Select value={contractVendorFilter || '__all__'} onValueChange={(v) => setContractVendorFilter(v === '__all__' ? '' : v)}>
                    <SelectTrigger className="h-9 w-48">
                      <SelectValue placeholder="All vendors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All vendors</SelectItem>
                      {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    value={contractSearch}
                    onChange={e => setContractSearch(e.target.value)}
                    placeholder="Search contracts…"
                    className="h-9 flex-1 min-w-40"
                  />
                </div>
                {loadingContracts ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : filteredContracts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active contracts match.</p>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Contract</TableHead>
                          <TableHead>Lot ID</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right">Bag Size</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right w-32">Bags</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredContracts.map(c => {
                          const key = `contract:${c.id}`;
                          const sel = selected[key];
                          const remaining = bagsRemaining(c);
                          const orig = defaultPriceFromContract(c);
                          const vendorName = c.vendor_id ? (vendorMap[c.vendor_id]?.name || '—') : '—';
                          return (
                            <TableRow key={c.id}>
                              <TableCell>
                                <Checkbox
                                  checked={!!sel}
                                  onCheckedChange={chk => toggleContract(c, !!chk)}
                                  disabled={remaining <= 0 && !sel}
                                />
                              </TableCell>
                              <TableCell className="text-sm">{vendorName}</TableCell>
                              <TableCell className="font-medium text-sm">{contractRef(c)}</TableCell>
                              <TableCell className="text-sm">{c.lot_identifier || '—'}</TableCell>
                              <TableCell className="text-sm">{contractDescription(c) || '—'}</TableCell>
                              <TableCell className="text-right text-sm">{remaining} / {c.num_bags || 0}</TableCell>
                              <TableCell className="text-right text-sm">{c.bag_size_kg ? `${c.bag_size_kg} kg` : '—'}</TableCell>
                              <TableCell className="text-right text-xs">{orig.amount ? `${orig.amount} ${orig.unit}` : '—'}</TableCell>
                              <TableCell className="text-right">
                                {sel ? (
                                  <Input
                                    type="number"
                                    min={1}
                                    max={remaining}
                                    value={sel.bags_requested}
                                    onChange={e => updateLine(key, { bags_requested: parseInt(e.target.value) || 0 })}
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

            {/* ── Spot Purchases tab ── */}
            {tab === 'purchases' && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Input
                    value={purchaseSearch}
                    onChange={e => setPurchaseSearch(e.target.value)}
                    placeholder="Search purchase lines…"
                    className="h-9 flex-1 min-w-40"
                  />
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={showAllPurchaseLines}
                      onCheckedChange={v => setShowAllPurchaseLines(!!v)}
                    />
                    Show lines with existing lots
                  </label>
                </div>
                {loadingPurchaseLines ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : filteredPurchaseLines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No purchase lines available.{!showAllPurchaseLines && ' Try enabling "Show lines with existing lots".'}
                  </p>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Lot ID</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Bags</TableHead>
                          <TableHead className="text-right">Bag Size</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPurchaseLines.map(pl => {
                          const key = `purchase:${pl.id}`;
                          const sel = selected[key];
                          const vendorId = pl.purchase?.vendor_id || null;
                          const vendorName = vendorId ? (vendorMap[vendorId]?.name || '—') : '—';
                          const desc = [getCountryName(pl.origin_country), pl.region, pl.producer, pl.variety].filter(Boolean).join(' · ');
                          return (
                            <TableRow key={pl.id}>
                              <TableCell>
                                <Checkbox
                                  checked={!!sel}
                                  onCheckedChange={chk => togglePurchaseLine(pl, !!chk)}
                                />
                              </TableCell>
                              <TableCell className="text-sm">{vendorName}</TableCell>
                              <TableCell className="text-sm font-mono">{pl.purchase?.invoice_number || '—'}</TableCell>
                              <TableCell className="text-sm">{pl.lot_identifier || '—'}</TableCell>
                              <TableCell className="text-sm">{desc || '—'}</TableCell>
                              <TableCell className="text-right text-sm">{pl.bags ?? '—'}</TableCell>
                              <TableCell className="text-right text-sm">{pl.bag_size_kg ? `${pl.bag_size_kg} kg` : '—'}</TableCell>
                              <TableCell className="text-right text-xs">{pl.price_per_lb_usd ? `${pl.price_per_lb_usd} USD/lb` : '—'}</TableCell>
                              <TableCell>
                                {pl.lot_id
                                  ? <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-700 border-blue-500/30">Has lot</Badge>
                                  : <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-500/30">No lot</Badge>}
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

            {/* ── Ad-hoc tab ── */}
            {tab === 'adhoc' && (
              <div className="border rounded-md p-4 space-y-3">
                <p className="text-sm font-semibold">Add ad-hoc line</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Vendor (optional)</Label>
                    <Select value={adhocVendorId} onValueChange={setAdhocVendorId}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select vendor…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No vendor</SelectItem>
                        {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Lot Identifier</Label>
                    <Input value={adhocLotId} onChange={e => setAdhocLotId(e.target.value)} className="h-9" placeholder="e.g. LOT-001" />
                  </div>
                  <div>
                    <Label className="text-xs">Origin Country (ISO-3)</Label>
                    <Input value={adhocOrigin} onChange={e => setAdhocOrigin(e.target.value)} className="h-9" placeholder="e.g. COL" />
                  </div>
                  <div>
                    <Label className="text-xs">Region</Label>
                    <Input value={adhocRegion} onChange={e => setAdhocRegion(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Producer</Label>
                    <Input value={adhocProducer} onChange={e => setAdhocProducer(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Variety</Label>
                    <Input value={adhocVariety} onChange={e => setAdhocVariety(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Bags <span className="text-destructive">*</span></Label>
                    <Input type="number" min={1} value={adhocBags} onChange={e => setAdhocBags(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Bag Size (kg) <span className="text-destructive">*</span></Label>
                    <Input type="number" min={1} step="0.1" value={adhocBagSize} onChange={e => setAdhocBagSize(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Price</Label>
                    <Input type="number" step="0.0001" value={adhocPriceAmount} onChange={e => setAdhocPriceAmount(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Unit</Label>
                    <Select value={adhocPriceUnit} onValueChange={setAdhocPriceUnit}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD/lb">USD/lb</SelectItem>
                        <SelectItem value="USD/kg">USD/kg</SelectItem>
                        <SelectItem value="CAD/lb">CAD/lb</SelectItem>
                        <SelectItem value="CAD/kg">CAD/kg</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Notes</Label>
                    <Input value={adhocNotes} onChange={e => setAdhocNotes(e.target.value)} className="h-9" />
                  </div>
                </div>
                <Button size="sm" onClick={addAdhocLine} className="gap-1.5">
                  <Plus className="h-4 w-4" /> Add Line
                </Button>
              </div>
            )}

            {/* ── Selected lines summary ── */}
            {selectedList.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-sm font-semibold">
                  Selected Lines ({selectedList.length})
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Bags</TableHead>
                      <TableHead className="text-right">Total kg</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedList.map(l => {
                      const desc = [getCountryName(l.origin_country), l.region, l.producer, l.variety].filter(Boolean).join(' · ');
                      const ref = l.internal_contract_number || l.vendor_contract_number || l.lot_identifier || '—';
                      return (
                        <TableRow key={l.key}>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {l.source_type === 'CONTRACT' ? 'Contract' : l.source_type === 'PURCHASE' ? 'Purchase' : 'Ad-hoc'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{l.vendor_name}</TableCell>
                          <TableCell className="text-sm">
                            <span className="font-medium">{ref}</span>
                            {desc && <span className="text-muted-foreground ml-1">· {desc}</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm">{l.bags_requested}</TableCell>
                          <TableCell className="text-right text-sm">{(l.bags_requested * l.bag_size_kg).toLocaleString()} kg</TableCell>
                          <TableCell>
                            <button type="button" onClick={() => removeLine(l.key)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <X className="h-4 w-4" />
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!step1Valid()}>
                Advance to Details &amp; Pricing
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            {/* Header */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Number (optional — sets status to Invoiced)</Label>
                <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-12345" />
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes…" />
              </div>
            </div>

            {/* Arrival status */}
            <div className="border rounded-md p-3 bg-muted/30 space-y-3">
              <p className="text-sm font-semibold">Before you save</p>
              <div className="space-y-2">
                <Label className="text-xs">Arrival status (applies to all lots)</Label>
                <div className="inline-flex rounded-md border border-input overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setMarkReceived(false)}
                    className={cn('px-3 py-1.5 text-xs font-medium transition-colors', !markReceived ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
                  >En Route</button>
                  <button
                    type="button"
                    onClick={() => setMarkReceived(true)}
                    className={cn('px-3 py-1.5 text-xs font-medium transition-colors', markReceived ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
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
                      <Calendar mode="single" selected={receivedDate} onSelect={setReceivedDate} initialFocus className="p-3 pointer-events-auto" />
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
                      <Calendar mode="single" selected={etaDate} onSelect={setEtaDate} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            {/* Per-line pricing */}
            <div className="space-y-3">
              <p className="text-sm font-semibold">Coffee Lines</p>
              {selectedList.map(l => {
                const totalKg = l.bags_requested * l.bag_size_kg;
                const desc = [getCountryName(l.origin_country), l.region, l.producer, l.variety].filter(Boolean).join(' · ');
                const ref = l.internal_contract_number || l.vendor_contract_number || l.lot_identifier || '—';
                return (
                  <Card key={l.key}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <p className="font-medium text-sm">{ref}</p>
                            <Badge variant="outline" className="text-xs">
                              {l.source_type === 'CONTRACT' ? 'Contract' : l.source_type === 'PURCHASE' ? 'Purchase' : 'Ad-hoc'}
                            </Badge>
                            <p className="text-xs text-muted-foreground">{l.vendor_name}</p>
                          </div>
                          {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-nowrap">
                          {l.bags_requested} bags × {l.bag_size_kg} kg = <span className="font-medium text-foreground">{totalKg.toLocaleString()} kg</span>
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div>
                          <Label className="text-xs">Price</Label>
                          <Input
                            type="number"
                            step="0.0001"
                            value={l.price_amount}
                            onChange={e => updateLine(l.key, { price_amount: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Unit</Label>
                          <Select value={l.price_unit} onValueChange={v => updateLine(l.key, { price_unit: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="USD/lb">USD/lb</SelectItem>
                              <SelectItem value="USD/kg">USD/kg</SelectItem>
                              <SelectItem value="CAD/lb">CAD/lb</SelectItem>
                              <SelectItem value="CAD/kg">CAD/kg</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Line Notes</Label>
                          <Input value={l.line_notes} onChange={e => updateLine(l.key, { line_notes: e.target.value })} className="h-9" />
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
              <p className="text-xs text-muted-foreground">Prorated across all lines by weight.</p>
              <div className="grid grid-cols-2 gap-3">
                {SHARED_COST_KEYS.map(key => (
                  <div key={key}>
                    <Label className="text-xs">{SHARED_COST_LABELS[key]}</Label>
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={sharedCosts[key]?.amount ?? 0}
                        onChange={e => setSharedCosts(prev => ({
                          ...prev,
                          [key]: { amount: parseFloat(e.target.value) || 0, currency: prev[key]?.currency || 'USD' },
                        }))}
                        className="h-9"
                      />
                      <Select
                        value={sharedCosts[key]?.currency || 'USD'}
                        onValueChange={v => setSharedCosts(prev => ({
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

            {/* Live book value */}
            {selectedList.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-sm font-semibold">Estimated Book Value (live)</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coffee</TableHead>
                      <TableHead>Vendor</TableHead>
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
                      const lineKg = l.bags_requested * l.bag_size_kg;
                      const sharedShare = totalKgAll > 0 ? totalSharedUsd / totalKgAll : 0;
                      const bookKg = bookValuePerKgUsd(priceUsdPerLb, sharedShare);
                      const bookLb = bookValuePerLbUsd(priceUsdPerLb, sharedShare);
                      const ref = l.internal_contract_number || l.vendor_contract_number || l.lot_identifier || '—';
                      return (
                        <TableRow key={l.key}>
                          <TableCell className="text-sm">{ref}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{l.vendor_name}</TableCell>
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
                <p className="text-sm font-semibold">Email Draft to Vendor(s)</p>
                <Button size="sm" variant="outline" onClick={copyEmail} className="gap-1.5">
                  {emailCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {emailCopied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <Textarea readOnly value={emailBody} rows={10} className="font-mono text-xs" />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button
                onClick={() => { if (step !== 2) return; saveMutation.mutate(); }}
                disabled={step !== 2 || saveMutation.isPending}
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
