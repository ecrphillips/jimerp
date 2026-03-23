import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { formatPerKg } from '@/lib/formatMoney';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Search, Plus, Check, FileText, AlertTriangle, Copy, Mail, CalendarIcon, PackageCheck } from 'lucide-react';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';
import { COFFEE_ORIGIN_COUNTRIES, COMMON_ORIGINS, OTHER_ORIGINS, getCountryName, getCountryDisplayLabel } from '@/lib/coffeeOrigins';

type ContractStatus = 'ACTIVE' | 'DEPLETED' | 'CANCELLED';
type GreenCategory = 'BLENDER' | 'SINGLE_ORIGIN';
type PriceUnit = 'usd_kg' | 'usd_lb' | 'cad_kg';

interface Contract {
  id: string;
  vendor_id: string | null;
  name: string;
  origin: string | null;
  region: string | null;
  producer: string | null;
  variety: string | null;
  category: GreenCategory;
  status: ContractStatus;
  num_bags: number | null;
  bag_size_kg: number | null;
  total_kg: number | null;
  contracted_price_usd: number | null;
  contracted_price_per_kg: number | null;
  contracted_price_currency: string | null;
  warehouse_location: string | null;
  notes: string | null;
  sample_id: string | null;
  crop_year: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  internal_contract_number: string | null;
  vendor_contract_number: string | null;
  origin_country: string | null;
  lot_identifier: string | null;
}

interface Vendor {
  id: string;
  name: string;
  abbreviation: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

interface Lot {
  id: string;
  lot_number: string;
  contract_id: string;
  bags_released: number;
  bag_size_kg: number;
  status: string;
  expected_delivery_date: string | null;
  received_date: string | null;
  exceptions_noted: boolean;
  carrier: string | null;
  warehouse_location: string | null;
}

interface ContractNote {
  id: string;
  contract_id: string;
  note: string;
  created_by: string;
  created_at: string;
  author_name?: string;
}

interface ApprovedSample {
  id: string;
  name: string;
  origin: string | null;
  region: string | null;
  producer: string | null;
  variety: string | null;
  category: GreenCategory;
  crop_year: string | null;
  vendor_id: string | null;
  status: string;
}

const CATEGORY_LABELS: Record<GreenCategory, string> = { BLENDER: 'Blender', SINGLE_ORIGIN: 'Single Origin' };
const STATUS_LABELS: Record<ContractStatus, string> = { ACTIVE: 'Active', DEPLETED: 'Depleted', CANCELLED: 'Cancelled' };
const CROP_YEAR_OPTIONS = ['2023', '2023/2024', '2024', '2024/2025', '2025', '2025/2026', '2026', '2026/2027'];

function CategoryBadge({ category }: { category: GreenCategory }) {
  const cls = category === 'BLENDER'
    ? 'bg-muted text-muted-foreground'
    : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  return <Badge variant="outline" className={`${cls} border-0 text-xs`}>{CATEGORY_LABELS[category]}</Badge>;
}

function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const cls = status === 'ACTIVE'
    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    : status === 'DEPLETED'
    ? 'bg-muted text-muted-foreground'
    : 'bg-red-100 text-red-400 dark:bg-red-900/40 dark:text-red-300';
  return <Badge variant="outline" className={`${cls} border-0 text-xs`}>{STATUS_LABELS[status]}</Badge>;
}

function LotStatusBadge({ status }: { status: string }) {
  const cls = status === 'EN_ROUTE'
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
    : 'bg-muted text-muted-foreground';
  return <Badge variant="outline" className={`${cls} border-0 text-xs`}>{status === 'EN_ROUTE' ? 'En Route' : 'Received'}</Badge>;
}

function formatPrice(value: number | null, currency: string | null) {
  if (value == null) return '—';
  const cur = (currency === 'CAD' ? 'CAD' : 'USD') as 'CAD' | 'USD';
  return formatPerKg(value, cur);
}

// ─── Main Page ─────────────────────────────────────────────

export default function SourcingContracts() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'ALL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<GreenCategory | 'ALL'>('ALL');
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ['green-contracts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_contracts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Contract[];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['green-vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('green_vendors').select('id, name, abbreviation, contact_name, contact_email, contact_phone').order('name');
      if (error) throw error;
      return data as Vendor[];
    },
  });
  const vendorMap = useMemo(() => Object.fromEntries(vendors.map(v => [v.id, v])), [vendors]);

  const { data: allLots = [] } = useQuery({
    queryKey: ['green-lots-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select('id, lot_number, contract_id, bags_released, bag_size_kg, status, expected_delivery_date, received_date, exceptions_noted, carrier, warehouse_location');
      if (error) throw error;
      return data as Lot[];
    },
  });

  const lotsByContract = useMemo(() => {
    const map: Record<string, Lot[]> = {};
    for (const l of allLots) {
      if (!map[l.contract_id]) map[l.contract_id] = [];
      map[l.contract_id].push(l);
    }
    return map;
  }, [allLots]);

  const filtered = useMemo(() => {
    return contracts.filter(c => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && c.category !== categoryFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const vendorName = c.vendor_id ? vendorMap[c.vendor_id]?.name || '' : '';
        if (!c.name.toLowerCase().includes(s) && !vendorName.toLowerCase().includes(s) && !(c.origin || '').toLowerCase().includes(s))
          return false;
      }
      return true;
    });
  }, [contracts, statusFilter, categoryFilter, search, vendorMap]);

  return (
    <div className="page-container space-y-6">
      <GreenCoffeeAlerts />

      <div className="page-header">
        <div>
          <h1 className="page-title">Contracts</h1>
          <p className="text-sm text-muted-foreground">Purchase commitments with vendors</p>
        </div>
        <Button onClick={() => setAddModalOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add Contract
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search contracts…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {(['ALL', 'ACTIVE', 'DEPLETED', 'CANCELLED'] as const).map(s => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
              {s === 'ALL' ? 'All' : STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['ALL', 'BLENDER', 'SINGLE_ORIGIN'] as const).map(c => (
            <Button key={c} variant={categoryFilter === c ? 'default' : 'outline'} size="sm" onClick={() => setCategoryFilter(c)}>
              {c === 'ALL' ? 'All' : CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{search || statusFilter !== 'ALL' || categoryFilter !== 'ALL' ? 'No contracts match your filters.' : 'No contracts yet. Add one to get started.'}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(c => (
            <ContractCard key={c.id} contract={c} vendor={c.vendor_id ? vendorMap[c.vendor_id] : null} lots={lotsByContract[c.id] || []} onView={() => setSelectedContractId(c.id)} />
          ))}
        </div>
      )}

      <ContractDetailPanel contractId={selectedContractId} onClose={() => setSelectedContractId(null)} vendors={vendors} vendorMap={vendorMap} lots={lotsByContract} />
      <AddContractModal open={addModalOpen} onOpenChange={setAddModalOpen} vendors={vendors} />
    </div>
  );
}

// ─── Contract Card ─────────────────────────────────────────

function ContractCard({ contract, vendor, lots, onView }: { contract: Contract; vendor: Vendor | null; lots: Lot[]; onView: () => void }) {
  const bagsReleased = lots.reduce((sum, l) => sum + l.bags_released, 0);
  const totalBags = contract.num_bags || 0;
  const enRouteLots = lots.filter(l => l.status === 'EN_ROUTE');
  const soonestArrival = enRouteLots.length > 0
    ? enRouteLots.reduce((min, l) => (!min || (l.expected_delivery_date && l.expected_delivery_date < min) ? l.expected_delivery_date : min), null as string | null)
    : null;
  const enRouteBags = enRouteLots.reduce((sum, l) => sum + l.bags_released, 0);

  return (
    <Card className={contract.status === 'CANCELLED' ? 'opacity-50' : ''}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-base leading-tight">{vendor?.name || <span className="text-muted-foreground">No vendor</span>}</p>
          {contract.internal_contract_number && (
            <span className="text-xs text-muted-foreground font-mono">{contract.internal_contract_number}</span>
          )}
        </div>
        {(contract.origin || contract.region) && (
          <p className="text-sm text-muted-foreground">{[contract.origin, contract.region].filter(Boolean).join(' — ')}</p>
        )}
         {contract.lot_identifier && (
           <p className="text-sm text-muted-foreground/80">{contract.lot_identifier}</p>
         )}
         <p className="text-sm">{contract.name}</p>
        {contract.producer && <p className="text-xs text-muted-foreground">{contract.producer}</p>}
        {contract.variety && <p className="text-xs text-muted-foreground italic">{contract.variety}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryBadge category={contract.category} />
          <ContractStatusBadge status={contract.status} />
          {contract.crop_year && <Badge variant="outline" className="text-xs">{contract.crop_year}</Badge>}
        </div>
        {totalBags > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{bagsReleased} of {totalBags} bags released</p>
            <Progress value={totalBags > 0 ? (bagsReleased / totalBags) * 100 : 0} className="h-1.5" />
          </div>
        )}
        {contract.contracted_price_per_kg != null && (
          <p className="text-sm font-medium">{formatPrice(contract.contracted_price_per_kg, contract.contracted_price_currency)}</p>
        )}
        {enRouteBags > 0 && soonestArrival && (
          <Badge variant="outline" className="bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 border-amber-200 dark:border-amber-800 text-xs">
            {enRouteBags} bags en route — arriving {format(new Date(soonestArrival + 'T00:00:00'), 'MMM d')}
          </Badge>
        )}
        <div className="pt-1">
          <Button variant="outline" size="sm" onClick={onView}>View</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Contract Detail Panel ─────────────────────────────────

function ContractDetailPanel({
  contractId,
  onClose,
  vendors,
  vendorMap,
  lots: lotsByContract,
}: {
  contractId: string | null;
  onClose: () => void;
  vendors: Vendor[];
  vendorMap: Record<string, Vendor>;
  lots: Record<string, Lot[]>;
}) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const open = !!contractId;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isAdmin = authUser?.role === 'ADMIN';

  const deleteContractMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('green_contracts').delete().eq('id', contractId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Contract deleted');
      queryClient.invalidateQueries({ queryKey: ['green-contracts'] });
      onClose();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete contract'),
  });

  const { data: contract } = useQuery({
    queryKey: ['green-contract', contractId],
    enabled: !!contractId,
    queryFn: async () => {
      const { data, error } = await supabase.from('green_contracts').select('*').eq('id', contractId!).single();
      if (error) throw error;
      return data as unknown as Contract;
    },
  });

  const contractLots = contractId ? (lotsByContract[contractId] || []) : [];
  const bagsReleased = contractLots.reduce((sum, l) => sum + l.bags_released, 0);

  const { data: notes = [] } = useQuery({
    queryKey: ['contract-notes', contractId],
    enabled: !!contractId,
    queryFn: async () => {
      const { data, error } = await supabase.from('green_contract_notes').select('*').eq('contract_id', contractId!).order('created_at', { ascending: false });
      if (error) throw error;
      const userIds = [...new Set((data ?? []).map((n: any) => n.created_by).filter(Boolean))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, name').in('user_id', userIds);
        if (profiles) profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.name]));
      }
      return (data ?? []).map((n: any) => ({ ...n, author_name: profileMap[n.created_by] || 'Unknown' })) as ContractNote[];
    },
  });

  const { data: linkedSample } = useQuery({
    queryKey: ['linked-sample', contract?.sample_id],
    enabled: !!contract?.sample_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('green_samples').select('id, name, origin, status').eq('id', contract!.sample_id!).single();
      if (error) throw error;
      return data;
    },
  });

  // Editable form
  const [form, setForm] = useState<Partial<Contract>>({});
  const [dirty, setDirty] = useState(false);
  const [priceUnit, setPriceUnit] = useState<PriceUnit>('usd_kg');
  const [priceInput, setPriceInput] = useState('');

  useEffect(() => {
    if (contract) {
      setForm({
        vendor_id: contract.vendor_id,
        origin: contract.origin,
        region: contract.region,
        name: contract.name,
        producer: contract.producer,
        variety: contract.variety,
        crop_year: contract.crop_year,
        category: contract.category,
        num_bags: contract.num_bags,
        bag_size_kg: contract.bag_size_kg,
        warehouse_location: contract.warehouse_location,
        notes: contract.notes,
        origin_country: contract.origin_country,
        vendor_contract_number: contract.vendor_contract_number,
        lot_identifier: contract.lot_identifier,
      });
      setPriceUnit(contract.contracted_price_currency === 'CAD' ? 'cad_kg' : 'usd_kg');
      setPriceInput(contract.contracted_price_per_kg != null ? String(contract.contracted_price_per_kg) : '');
      setDirty(false);
    }
  }, [contract]);

  const updateField = (key: string, value: any) => { setForm(prev => ({ ...prev, [key]: value })); setDirty(true); };
  const totalKg = (form.num_bags && form.bag_size_kg) ? form.num_bags * form.bag_size_kg : null;

  const getPriceForStorage = () => {
    const val = priceInput ? parseFloat(priceInput) : null;
    if (val == null || isNaN(val)) return { price: null, currency: 'USD' };
    if (priceUnit === 'usd_lb') return { price: val * 2.20462, currency: 'USD' };
    if (priceUnit === 'cad_kg') return { price: val, currency: 'CAD' };
    return { price: val, currency: 'USD' };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { price, currency } = getPriceForStorage();
      const { error } = await supabase.from('green_contracts').update({
        vendor_id: form.vendor_id || null,
        origin: form.origin?.trim() || null,
        region: (form as any).region?.trim() || null,
        name: (form.name || '').trim(),
        producer: form.producer?.trim() || null,
        variety: form.variety?.trim() || null,
        crop_year: (form as any).crop_year || null,
        category: form.category,
        num_bags: form.num_bags || null,
        bag_size_kg: form.bag_size_kg || null,
        total_kg: totalKg,
        contracted_price_per_kg: price,
        contracted_price_currency: currency,
        warehouse_location: (form as any).warehouse_location?.trim() || null,
        notes: form.notes?.trim() || null,
        origin_country: form.origin_country || null,
        vendor_contract_number: form.vendor_contract_number?.trim() || null,
        lot_identifier: (form as any).lot_identifier?.trim() || null,
      } as any).eq('id', contractId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Contract updated');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['green-contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['green-contracts'] });
    },
    onError: () => toast.error('Failed to update contract'),
  });

  // Status actions
  const statusMutation = useMutation({
    mutationFn: async (newStatus: ContractStatus) => {
      const { error } = await supabase.from('green_contracts').update({ status: newStatus }).eq('id', contractId!);
      if (error) throw error;
    },
    onSuccess: (_, newStatus) => {
      toast.success(`Contract marked as ${STATUS_LABELS[newStatus]}`);
      queryClient.invalidateQueries({ queryKey: ['green-contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['green-contracts'] });
    },
    onError: () => toast.error('Failed to update status'),
  });

  // Add note
  const [noteText, setNoteText] = useState('');
  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('green_contract_notes').insert({
        contract_id: contractId!,
        note: noteText.trim(),
        created_by: authUser!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-notes', contractId] });
      setNoteText('');
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  // Brief Me
  const [briefCopied, setBriefCopied] = useState(false);
  const handleBriefMe = async () => {
    if (!contract) return;
    const vendor = contract.vendor_id ? vendorMap[contract.vendor_id] : null;
    const lines: string[] = [];
    if (contract.internal_contract_number) lines.push(`Internal Contract #: ${contract.internal_contract_number}`);
    if (contract.vendor_contract_number) lines.push(`Vendor Contract #: ${contract.vendor_contract_number}`);
    if (contract.lot_identifier) lines.push(`Lot Identifier: ${contract.lot_identifier}`);
    if (vendor) {
      lines.push(`Vendor: ${vendor.name}`);
      if (vendor.contact_name) lines.push(`Contact: ${vendor.contact_name}`);
      if (vendor.contact_email) lines.push(`Email: ${vendor.contact_email}`);
    } else {
      lines.push('Vendor: Not set');
    }
    if (contract.origin_country) lines.push(`Origin Country: ${getCountryDisplayLabel(contract.origin_country)}`);
    lines.push(`Origin: ${contract.origin || '—'}`);
    lines.push(`Region: ${contract.region || '—'}`);
    lines.push(`Contract Name: ${contract.name}`);
    if (contract.producer) lines.push(`Producer: ${contract.producer}`);
    if (contract.variety) lines.push(`Variety: ${contract.variety}`);
    if (contract.crop_year) lines.push(`Crop Year: ${contract.crop_year}`);
    lines.push(`Category: ${CATEGORY_LABELS[contract.category]}`);
    lines.push(`Status: ${STATUS_LABELS[contract.status]}`);
    lines.push(`Price: ${formatPrice(contract.contracted_price_per_kg, contract.contracted_price_currency)}`);
    lines.push(`Bags: ${contract.num_bags || 0} total, ${bagsReleased} released, ${(contract.num_bags || 0) - bagsReleased} remaining`);
    const enRoute = contractLots.filter(l => l.status === 'EN_ROUTE').reduce((s, l) => s + l.bags_released, 0);
    lines.push(`En Route: ${enRoute} bags`);
    lines.push(`Warehouse: ${contract.warehouse_location || '—'}`);
    if (linkedSample) lines.push(`Linked Sample: ${linkedSample.name} (${linkedSample.status})`);

    const { data: allNotes } = await supabase.from('green_contract_notes').select('note, created_by, created_at').eq('contract_id', contractId!).order('created_at', { ascending: true });
    if (allNotes && allNotes.length > 0) {
      const userIds = [...new Set(allNotes.map(n => n.created_by).filter(Boolean))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, name').in('user_id', userIds);
        if (profiles) profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.name]));
      }
      lines.push('', '--- Notes ---');
      for (const n of allNotes) {
        lines.push(`[${format(new Date(n.created_at), 'MMM d, yyyy')}] (${profileMap[n.created_by] || 'Unknown'}) ${n.note}`);
      }
    }
    await navigator.clipboard.writeText(lines.join('\n'));
    setBriefCopied(true);
    toast.success('Contract brief copied to clipboard');
    setTimeout(() => setBriefCopied(false), 2000);
  };

  // Release Coffee modal
  const [releaseOpen, setReleaseOpen] = useState(false);

  // Receive lot modal (from panel)
  const [receiveLotId, setReceiveLotId] = useState<string | null>(null);
  const [receiveAsExpected, setReceiveAsExpected] = useState(true);
  const [exceptionsNotes, setExceptionsNotes] = useState('');

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!receiveLotId) return;
      const updateData: any = { status: 'RECEIVED', received_date: format(new Date(), 'yyyy-MM-dd') };
      if (!receiveAsExpected) { updateData.exceptions_noted = true; updateData.exceptions_notes = exceptionsNotes.trim(); }
      const { error } = await supabase.from('green_lots').update(updateData).eq('id', receiveLotId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lot marked as received');
      setReceiveLotId(null);
      setReceiveAsExpected(true);
      setExceptionsNotes('');
      queryClient.invalidateQueries({ queryKey: ['green-lots-all'] });
      queryClient.invalidateQueries({ queryKey: ['green-alerts-overdue'] });
      queryClient.invalidateQueries({ queryKey: ['green-alerts-costing'] });
    },
    onError: () => toast.error('Failed to update lot'),
  });

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) { setConfirmingDelete(false); onClose(); } }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="flex-row items-center justify-between gap-2 pr-2">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg">{contract?.name || 'Contract'}</SheetTitle>
              {contract && <ContractStatusBadge status={contract.status} />}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleBriefMe}>
                {briefCopied ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                {briefCopied ? 'Copied' : 'Brief Me'}
              </Button>
              {isAdmin && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </SheetHeader>

          {confirmingDelete ? (
            <div className="flex flex-col items-center gap-4 pt-12 text-center">
              <p className="text-lg font-semibold">Delete "{contract?.name}"?</p>
              <p className="text-sm text-muted-foreground">This cannot be undone.</p>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
                <Button variant="destructive" disabled={deleteContractMutation.isPending} onClick={() => deleteContractMutation.mutate()}>
                  {deleteContractMutation.isPending ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </div>
          ) : contract && (
            <div className="space-y-6 pt-4">
              {/* Editable fields */}
              <div className="space-y-4">
                <div>
                  <Label>Vendor</Label>
                  <Select value={form.vendor_id || '_none'} onValueChange={(v) => updateField('vendor_id', v === '_none' ? null : v)}>
                    <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Internal Contract Number — read-only */}
                {contract.internal_contract_number && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Internal Contract #</Label>
                    <div className="mt-1">
                      <Badge variant="outline" className="text-xs font-mono">{contract.internal_contract_number}</Badge>
                    </div>
                  </div>
                )}

                {/* Origin Country */}
                <div>
                  <Label>Origin Country</Label>
                  <Select value={form.origin_country || '_none'} onValueChange={(v) => updateField('origin_country', v === '_none' ? null : v)}>
                    <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                     <SelectContent>
                       <SelectItem value="_none">None</SelectItem>
                       <SelectGroup>
                         <SelectLabel>Common Origins</SelectLabel>
                         {COMMON_ORIGINS.map(c => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
                       </SelectGroup>
                       <SelectSeparator />
                       <SelectGroup>
                         <SelectLabel>Other Origins</SelectLabel>
                         {OTHER_ORIGINS.map(c => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
                       </SelectGroup>
                     </SelectContent>
                  </Select>
                </div>

                {/* Vendor Contract Number */}
                <div>
                  <Label>Vendor Contract #</Label>
                  <Input value={form.vendor_contract_number || ''} onChange={(e) => updateField('vendor_contract_number', e.target.value)} placeholder="Vendor's contract reference" />
                </div>

                {/* Lot Identifier */}
                <div>
                  <Label>Lot Identifier</Label>
                  <Input value={(form as any).lot_identifier || ''} onChange={(e) => updateField('lot_identifier', e.target.value)} placeholder="As it appears on bags, invoice, and delivery order" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Origin</Label>
                    <Input value={form.origin || ''} onChange={(e) => updateField('origin', e.target.value)} />
                  </div>
                  <div>
                    <Label>Region</Label>
                    <Input value={(form as any).region || ''} onChange={(e) => updateField('region', e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Name *</Label>
                  <Input value={form.name || ''} onChange={(e) => updateField('name', e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Producer</Label>
                    <Input value={form.producer || ''} onChange={(e) => updateField('producer', e.target.value)} />
                  </div>
                  <div>
                    <Label>Variety</Label>
                    <Input value={form.variety || ''} onChange={(e) => updateField('variety', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Crop Year</Label>
                    <Select value={(form as any).crop_year || '_none'} onValueChange={(v) => updateField('crop_year', v === '_none' ? null : v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">None</SelectItem>
                        {CROP_YEAR_OPTIONS.map(cy => <SelectItem key={cy} value={cy}>{cy}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Category *</Label>
                    <Select value={form.category || 'BLENDER'} onValueChange={(v) => updateField('category', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BLENDER">Blender</SelectItem>
                        <SelectItem value="SINGLE_ORIGIN">Single Origin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Price */}
                <div>
                  <Label>Contracted Price</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.0001"
                      value={priceInput}
                      onChange={(e) => { setPriceInput(e.target.value); setDirty(true); }}
                      placeholder="0.0000"
                      className="flex-1"
                    />
                    <div className="flex rounded-md border overflow-hidden shrink-0">
                      {(['usd_kg', 'usd_lb', 'cad_kg'] as PriceUnit[]).map(u => (
                        <button
                          key={u}
                          type="button"
                          className={`px-2 py-1 text-xs transition-colors ${priceUnit === u ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                          onClick={() => { setPriceUnit(u); setDirty(true); }}
                        >
                          {u === 'usd_kg' ? 'USD/kg' : u === 'usd_lb' ? 'USD/lb' : 'CAD/kg'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {contract.contracted_price_per_kg != null && (
                    <p className="text-xs text-muted-foreground mt-1">Stored: {formatPrice(contract.contracted_price_per_kg, contract.contracted_price_currency)}</p>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Bags</Label>
                    <Input type="number" value={form.num_bags ?? ''} onChange={(e) => updateField('num_bags', e.target.value ? parseInt(e.target.value) : null)} />
                  </div>
                  <div>
                    <Label>Bag Size (kg)</Label>
                    <Input type="number" step="0.1" value={form.bag_size_kg ?? ''} onChange={(e) => updateField('bag_size_kg', e.target.value ? parseFloat(e.target.value) : null)} />
                  </div>
                  <div>
                    <Label>Total kg</Label>
                    <Input value={totalKg != null ? totalKg.toFixed(1) : '—'} disabled />
                  </div>
                </div>
                <div>
                  <Label>Warehouse Location</Label>
                  <Input value={(form as any).warehouse_location || ''} onChange={(e) => updateField('warehouse_location', e.target.value)} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea value={form.notes || ''} onChange={(e) => updateField('notes', e.target.value)} rows={3} />
                </div>

                {dirty && (
                  <div className="flex justify-end">
                    <Button disabled={!(form.name || '').trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                      {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Linked Sample */}
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-2">Linked Sample</h3>
                {linkedSample ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{linkedSample.name}</Badge>
                    <span className="text-xs text-muted-foreground">{linkedSample.origin} · {linkedSample.status}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No linked sample</p>
                )}
              </div>

              {/* Lots */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Lots</h3>
                  <Button size="sm" className="gap-1.5" onClick={() => setReleaseOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Release Coffee
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{bagsReleased} of {contract.num_bags || 0} bags released</p>
                {contractLots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No lots released yet.</p>
                ) : (
                  <div className="space-y-2">
                    {contractLots.map(lot => (
                      <div key={lot.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{lot.lot_number}</span>
                            <LotStatusBadge status={lot.status} />
                            {lot.exceptions_noted && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {lot.bags_released} bags ·{' '}
                            {lot.status === 'EN_ROUTE' && lot.expected_delivery_date
                              ? `Arriving ${format(new Date(lot.expected_delivery_date + 'T00:00:00'), 'MMM d, yyyy')}`
                              : lot.received_date
                              ? `Received ${format(new Date(lot.received_date + 'T00:00:00'), 'MMM d, yyyy')}`
                              : ''}
                          </p>
                        </div>
                        {lot.status === 'EN_ROUTE' && (
                          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => {
                            setReceiveLotId(lot.id);
                            setReceiveAsExpected(true);
                            setExceptionsNotes('');
                          }}>
                            <PackageCheck className="h-3 w-3 mr-1" /> Mark Received
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status Actions */}
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-2">Status Actions</h3>
                <div className="flex gap-2">
                  {contract.status !== 'DEPLETED' && (
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate('DEPLETED')} disabled={statusMutation.isPending}>Mark as Depleted</Button>
                  )}
                  {contract.status !== 'CANCELLED' && (
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate('CANCELLED')} disabled={statusMutation.isPending}>Mark as Cancelled</Button>
                  )}
                  {contract.status !== 'ACTIVE' && (
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate('ACTIVE')} disabled={statusMutation.isPending}>Reset to Active</Button>
                  )}
                </div>
              </div>

              {/* Notes Feed */}
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-3">Notes</h3>
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

      {/* Release Coffee Modal */}
      {contract && (
        <ReleaseCoffeeModal
          open={releaseOpen}
          onOpenChange={setReleaseOpen}
          contract={contract}
          vendor={contract.vendor_id ? vendorMap[contract.vendor_id] : null}
          bagsReleased={bagsReleased}
          existingLotCount={contractLots.length}
        />
      )}

      {/* Receive Lot Modal */}
      <Dialog open={!!receiveLotId} onOpenChange={(o) => { if (!o) setReceiveLotId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Lot Received</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox id="recv-ok" checked={receiveAsExpected} onCheckedChange={(c) => setReceiveAsExpected(!!c)} />
              <Label htmlFor="recv-ok" className="mb-0">Everything arrived as expected</Label>
            </div>
            {!receiveAsExpected && (
              <div>
                <Label>Arrived with exceptions</Label>
                <Textarea value={exceptionsNotes} onChange={(e) => setExceptionsNotes(e.target.value)} placeholder="Describe the exceptions…" rows={3} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveLotId(null)}>Cancel</Button>
            <Button disabled={(!receiveAsExpected && !exceptionsNotes.trim()) || receiveMutation.isPending} onClick={() => receiveMutation.mutate()}>
              {receiveMutation.isPending ? 'Saving…' : 'Confirm Received'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Release Coffee Modal ──────────────────────────────────

function ReleaseCoffeeModal({
  open,
  onOpenChange,
  contract,
  vendor,
  bagsReleased,
  existingLotCount,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: Contract;
  vendor: Vendor | null;
  bagsReleased: number;
  existingLotCount: number;
}) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const remaining = (contract.num_bags || 0) - bagsReleased;

  const [lotIdentifier, setLotIdentifier] = useState('');
  const [bags, setBags] = useState('');
  const [expectedDate, setExpectedDate] = useState<Date | undefined>();
  const [carrier, setCarrier] = useState('');
  const [notes, setNotes] = useState('');
  const [msgCopied, setMsgCopied] = useState(false);
  const [poNumber, setPoNumber] = useState('');
  const [poLoading, setPoLoading] = useState(false);

  // Fetch PO number on modal open
  useEffect(() => {
    if (open) {
      setLotIdentifier(contract.lot_identifier ?? '');
      setBags('');
      setExpectedDate(undefined);
      setCarrier('');
      setNotes('');
      setMsgCopied(false);
      setPoNumber('');
      setPoLoading(true);

      // Fetch next PO sequence value
      (async () => {
        try {
          const { data, error } = await supabase.rpc('nextval_text' as any, { seq_name: 'po_number_seq' });
          if (error) {
            const nextNum = existingLotCount + 1;
            setPoNumber(`PO-${String(nextNum).padStart(3, '0')}`);
          } else {
            const seqVal = typeof data === 'number' ? data : parseInt(String(data));
            setPoNumber(`PO-${String(seqVal).padStart(3, '0')}`);
          }
        } catch {
          const nextNum = existingLotCount + 1;
          setPoNumber(`PO-${String(nextNum).padStart(3, '0')}`);
        } finally {
          setPoLoading(false);
        }
      })();
    }
  }, [open, existingLotCount, contract.lot_identifier]);

  // Compute lot number live: VENDOR_ABBR-ORIGIN-POXXX
  const computedLotNumber = useMemo(() => {
    const vendorAbbr = vendor?.abbreviation || '???';
    const country = contract.origin_country || '???';
    if (!poNumber) return '';
    return `${vendorAbbr}-${country}-${poNumber}`;
  }, [vendor?.abbreviation, contract.origin_country, poNumber]);

  const originCountryName = getCountryName(contract.origin_country);

  const vendorContractNum = contract.vendor_contract_number || '[vendor contract number not set]';

  const emailSubject = `Release Request — ${vendorContractNum} — ${lotIdentifier.trim() || '[lot identifier]'}`;

  const emailBody = `Hello,

Please release ${bags || '___'} bags of ${originCountryName || '[origin country]'} - ${contract.name} - ${lotIdentifier.trim() || '[lot identifier]'} from contract ${vendorContractNum}. Please confirm upon receipt and copy orders@homeislandcoffee.com on DO's to warehouse, and payments@homeislandcoffee.com with the invoice. Please include our PO ${poNumber} on all documents.

Thank you,
Home Island Coffee Partners`;

  const mailtoLink = vendor?.contact_email
    ? `mailto:${vendor.contact_email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
    : null;

  const createMutation = useMutation({
    mutationFn: async () => {
      const lotNumber = computedLotNumber || `${vendor?.abbreviation || '???'}-${contract.origin_country || '???'}-${poNumber}`;

      const { data: lot, error } = await supabase.from('green_lots').insert({
        lot_number: lotNumber,
        contract_id: contract.id,
        bags_released: parseInt(bags),
        bag_size_kg: contract.bag_size_kg || 0,
        status: 'EN_ROUTE' as any,
        expected_delivery_date: expectedDate ? format(expectedDate, 'yyyy-MM-dd') : null,
        carrier: carrier.trim() || null,
        warehouse_location: contract.warehouse_location || null,
        vendor_release_communicated_at: new Date().toISOString(),
        vendor_release_communicated_by: authUser!.id,
        kg_on_hand: 0,
        created_by: authUser!.id,
        lot_identifier: lotIdentifier.trim() || null,
        po_number: poNumber,
      } as any).select('id').single();
      if (error) throw error;

      if (notes.trim() && lot) {
        await supabase.from('green_lot_notes').insert({
          lot_id: lot.id,
          note: notes.trim(),
          created_by: authUser!.id,
        });
      }
    },
    onSuccess: () => {
      toast.success('Coffee released');
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['green-lots-all'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['green-contract'] });
    },
    onError: (err: any) => toast.error(`Failed to release coffee: ${err?.message || 'Unknown error'}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Release Coffee — {contract.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Lot Identifier</Label>
            <Input value={lotIdentifier} onChange={(e) => setLotIdentifier(e.target.value)} placeholder="As it appears on bags, invoice, and delivery order" />
            <p className="text-xs text-muted-foreground mt-1">As it appears on the bags, invoice, and delivery order.</p>
          </div>
          <div>
            <Label>Number of Bags *</Label>
            <Input type="number" value={bags} onChange={(e) => setBags(e.target.value)} placeholder={`${remaining} bags remaining`} />
            <p className="text-xs text-muted-foreground mt-1">{remaining} bags remaining unreleased</p>
          </div>
          <div>
            <Label>Expected Arrival Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {expectedDate ? format(expectedDate, 'MMM d, yyyy') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={expectedDate} onSelect={setExpectedDate} />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label>Carrier</Label>
            <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label>Internal Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" rows={2} />
          </div>

          {/* Auto-generated fields */}
          <div className="rounded-lg bg-muted/50 border p-4 space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Auto-generated</h4>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">PO Number</span>
              <Badge variant="outline" className="font-mono text-xs">{poLoading ? '…' : poNumber}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Lot Number</span>
              <Badge variant="outline" className="font-mono text-xs">{computedLotNumber || '…'}</Badge>
            </div>
          </div>

          {/* Vendor Contact Section */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold mb-2">Vendor Contact</h4>
            {vendor ? (
              <div className="space-y-1 text-sm text-muted-foreground mb-3">
                <p>{vendor.name}</p>
                {vendor.contact_name && <p>{vendor.contact_name}</p>}
                {vendor.contact_email && <p>{vendor.contact_email}</p>}
                {vendor.contact_phone && <p>{vendor.contact_phone}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-3">No vendor set</p>
            )}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2 mb-2">
              <p className="text-xs font-medium text-muted-foreground">Subject: {emailSubject}</p>
              <p className="text-sm whitespace-pre-wrap">{emailBody}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                const fullMsg = `Subject: ${emailSubject}\n\n${emailBody}`;
                await navigator.clipboard.writeText(fullMsg);
                setMsgCopied(true);
                toast.success('Message copied');
                setTimeout(() => setMsgCopied(false), 2000);
              }}>
                {msgCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {msgCopied ? 'Copied' : 'Copy'}
              </Button>
              {mailtoLink && (
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={mailtoLink}><Mail className="h-3.5 w-3.5" /> Open in Email</a>
                </Button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!bags || !parseInt(bags) || !expectedDate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Releasing…' : 'Release Coffee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Contract Modal ────────────────────────────────────

function AddContractModal({ open, onOpenChange, vendors }: { open: boolean; onOpenChange: (o: boolean) => void; vendors: Vendor[] }) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<GreenCategory>('BLENDER');
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [region, setRegion] = useState('');
  const [producer, setProducer] = useState('');
  const [variety, setVariety] = useState('');
  const [cropYear, setCropYear] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [priceUnit, setPriceUnit] = useState<PriceUnit>('usd_kg');
  const [numBags, setNumBags] = useState('');
  const [bagSize, setBagSize] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [notes, setNotes] = useState('');
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set());
  const [originCountry, setOriginCountry] = useState<string | null>(null);
  const [vendorContractNumber, setVendorContractNumber] = useState('');
  const [lotIdentifier, setLotIdentifier] = useState('');

  // Approved samples
  const { data: approvedSamples = [] } = useQuery({
    queryKey: ['approved-samples-for-contracts', category],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_samples')
        .select('id, name, origin, region, producer, variety, category, crop_year, vendor_id, status')
        .eq('status', 'APPROVED')
        .eq('category', category);
      if (error) throw error;
      return data as ApprovedSample[];
    },
  });

  const reset = () => {
    setName(''); setCategory('BLENDER'); setVendorId(null); setSampleId(null);
    setOrigin(''); setRegion(''); setProducer(''); setVariety('');
    setCropYear(null); setPriceInput(''); setPriceUnit('usd_kg');
    setNumBags(''); setBagSize(''); setWarehouse(''); setNotes('');
    setPrefilled(new Set()); setOriginCountry(null); setVendorContractNumber(''); setLotIdentifier('');
  };

  const handleSampleSelect = (id: string | null) => {
    setSampleId(id);
    if (!id) { setPrefilled(new Set()); return; }
    const sample = approvedSamples.find(s => s.id === id);
    if (!sample) return;
    const pf = new Set<string>();
    if (sample.origin) { setOrigin(sample.origin); pf.add('origin'); }
    if (sample.region) { setRegion(sample.region); pf.add('region'); }
    if (sample.name) { setName(sample.name); pf.add('name'); }
    if (sample.producer) { setProducer(sample.producer); pf.add('producer'); }
    if (sample.variety) { setVariety(sample.variety); pf.add('variety'); }
    if (sample.crop_year) { setCropYear(sample.crop_year); pf.add('crop_year'); }
    if (sample.vendor_id) { setVendorId(sample.vendor_id); pf.add('vendor_id'); }
    setCategory(sample.category);
    pf.add('category');
    setPrefilled(pf);
  };

  const totalKg = numBags && bagSize ? parseInt(numBags) * parseFloat(bagSize) : null;

  const getPriceForStorage = () => {
    const val = priceInput ? parseFloat(priceInput) : null;
    if (val == null || isNaN(val)) return { price: null, currency: 'USD' };
    if (priceUnit === 'usd_lb') return { price: val * 2.20462, currency: 'USD' };
    if (priceUnit === 'cad_kg') return { price: val, currency: 'CAD' };
    return { price: val, currency: 'USD' };
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      // First, get next internal contract number from sequence
      let internalNumber = '';
      try {
        const { data: seqData, error: seqError } = await supabase.rpc('nextval_text' as any, { seq_name: 'internal_contract_number_seq' });
        if (seqError || seqData == null) {
          // Fallback: count existing contracts
          const { count } = await supabase.from('green_contracts').select('id', { count: 'exact', head: true });
          internalNumber = `CO-${String((count || 0) + 1).padStart(3, '0')}`;
        } else {
          const seqVal = typeof seqData === 'number' ? seqData : parseInt(String(seqData));
          internalNumber = `CO-${String(seqVal).padStart(3, '0')}`;
        }
      } catch {
        const { count } = await supabase.from('green_contracts').select('id', { count: 'exact', head: true });
        internalNumber = `CO-${String((count || 0) + 1).padStart(3, '0')}`;
      }

      const { price, currency } = getPriceForStorage();
      const { data: contract, error } = await supabase.from('green_contracts').insert({
        name: name.trim(),
        category,
        vendor_id: vendorId || null,
        sample_id: sampleId || null,
        origin: origin.trim() || null,
        region: region.trim() || null,
        producer: producer.trim() || null,
        variety: variety.trim() || null,
        crop_year: cropYear || null,
        contracted_price_per_kg: price,
        contracted_price_currency: currency,
        num_bags: numBags ? parseInt(numBags) : null,
        bag_size_kg: bagSize ? parseFloat(bagSize) : null,
        total_kg: totalKg,
        warehouse_location: warehouse.trim() || null,
        status: 'ACTIVE',
        created_by: authUser!.id,
        internal_contract_number: internalNumber,
        vendor_contract_number: vendorContractNumber.trim() || null,
        origin_country: originCountry || null,
        lot_identifier: lotIdentifier.trim() || null,
      } as any).select('id').single();
      if (error) throw error;

      if (notes.trim() && contract) {
        await supabase.from('green_contract_notes').insert({
          contract_id: contract.id,
          note: notes.trim(),
          created_by: authUser!.id,
        });
      }
    },
    onSuccess: () => {
      toast.success('Contract created');
      queryClient.invalidateQueries({ queryKey: ['green-contracts'] });
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(`Failed to create contract: ${err?.message || 'Unknown error'}`),
  });

  const prefilledCls = (field: string) => prefilled.has(field) ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Contract</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Linked Sample</Label>
            <Select value={sampleId || '_none'} onValueChange={(v) => handleSampleSelect(v === '_none' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Select approved sample" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">None</SelectItem>
                {approvedSamples.map(s => <SelectItem key={s.id} value={s.id}>{s.name} — {s.origin || 'No origin'}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Vendor</Label>
            <div className="relative">
              <Select value={vendorId || '_none'} onValueChange={(v) => setVendorId(v === '_none' ? null : v)}>
                <SelectTrigger className={prefilledCls('vendor_id')}><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {prefilled.has('vendor_id') && <span className="absolute right-10 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 dark:text-blue-400">Pre-filled</span>}
            </div>
          </div>
          <div>
            <Label>Origin Country</Label>
            <Select value={originCountry || '_none'} onValueChange={(v) => setOriginCountry(v === '_none' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
               <SelectContent>
                 <SelectItem value="_none">None</SelectItem>
                 <SelectGroup>
                   <SelectLabel>Common Origins</SelectLabel>
                   {COMMON_ORIGINS.map(c => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
                 </SelectGroup>
                 <SelectSeparator />
                 <SelectGroup>
                   <SelectLabel>Other Origins</SelectLabel>
                   {OTHER_ORIGINS.map(c => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
                 </SelectGroup>
               </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Vendor Contract #</Label>
            <Input value={vendorContractNumber} onChange={(e) => setVendorContractNumber(e.target.value)} placeholder="Vendor's contract reference (optional)" />
          </div>
          <div>
            <Label>Lot Identifier</Label>
            <Input value={lotIdentifier} onChange={(e) => setLotIdentifier(e.target.value)} placeholder="As it appears on bags, invoice, and delivery order" />
          </div>
          <div>
            <Label>Name *</Label>
            <div className="relative">
              <Input value={name} onChange={(e) => setName(e.target.value)} className={prefilledCls('name')} />
              {prefilled.has('name') && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 dark:text-blue-400">Pre-filled</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Origin</Label>
              <div className="relative">
                <Input value={origin} onChange={(e) => setOrigin(e.target.value)} className={prefilledCls('origin')} />
                {prefilled.has('origin') && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 dark:text-blue-400">Pre-filled</span>}
              </div>
            </div>
            <div>
              <Label>Region</Label>
              <div className="relative">
                <Input value={region} onChange={(e) => setRegion(e.target.value)} className={prefilledCls('region')} />
                {prefilled.has('region') && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 dark:text-blue-400">Pre-filled</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Producer</Label>
              <div className="relative">
                <Input value={producer} onChange={(e) => setProducer(e.target.value)} className={prefilledCls('producer')} />
                {prefilled.has('producer') && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 dark:text-blue-400">Pre-filled</span>}
              </div>
            </div>
            <div>
              <Label>Variety</Label>
              <div className="relative">
                <Input value={variety} onChange={(e) => setVariety(e.target.value)} className={prefilledCls('variety')} />
                {prefilled.has('variety') && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 dark:text-blue-400">Pre-filled</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Crop Year</Label>
              <Select value={cropYear || '_none'} onValueChange={(v) => setCropYear(v === '_none' ? null : v)}>
                <SelectTrigger className={prefilledCls('crop_year')}><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {CROP_YEAR_OPTIONS.map(cy => <SelectItem key={cy} value={cy}>{cy}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as GreenCategory)}>
                <SelectTrigger className={prefilledCls('category')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BLENDER">Blender</SelectItem>
                  <SelectItem value="SINGLE_ORIGIN">Single Origin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Contracted Price</Label>
            <div className="flex gap-2">
              <Input type="number" step="0.0001" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} placeholder="0.0000" className="flex-1" />
              <div className="flex rounded-md border overflow-hidden shrink-0">
                {(['usd_kg', 'usd_lb', 'cad_kg'] as PriceUnit[]).map(u => (
                  <button key={u} type="button" className={`px-2 py-1 text-xs transition-colors ${priceUnit === u ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} onClick={() => setPriceUnit(u)}>
                    {u === 'usd_kg' ? 'USD/kg' : u === 'usd_lb' ? 'USD/lb' : 'CAD/kg'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Bags</Label>
              <Input type="number" value={numBags} onChange={(e) => setNumBags(e.target.value)} />
            </div>
            <div>
              <Label>Bag Size (kg)</Label>
              <Input type="number" step="0.1" value={bagSize} onChange={(e) => setBagSize(e.target.value)} />
            </div>
            <div>
              <Label>Total kg</Label>
              <Input value={totalKg != null ? totalKg.toFixed(1) : '—'} disabled />
            </div>
          </div>
          <div>
            <Label>Warehouse Location</Label>
            <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder="Where coffee rests at importer" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional first note…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Creating…' : 'Create Contract'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
