import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { createOrReuseRoastGroup } from '@/lib/roastGroupCreation';
import {
  ShoppingCart, Package, Coffee, Boxes, UserPlus,
  ArrowLeft, Search, CalendarIcon, Loader2, Check, ExternalLink,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenNewRoastGroup: () => void;
}

type WizardFlow = null | 'product' | 'lot' | 'prospect';

const PACKAGING_OPTIONS = [
  { value: 'RETAIL_250G', label: '250g Retail', grams: 250 },
  { value: 'RETAIL_300G', label: '300g Retail', grams: 300 },
  { value: 'RETAIL_340G', label: '340g Retail', grams: 340 },
  { value: 'RETAIL_454G', label: '454g Retail', grams: 454 },
  { value: 'CROWLER_200G', label: '200g Crowler', grams: 200 },
  { value: 'CROWLER_250G', label: '250g Crowler', grams: 250 },
  { value: 'CAN_125G', label: '125g Can', grams: 125 },
  { value: 'BULK_2LB', label: '2lb Bulk', grams: 907 },
  { value: 'BULK_1KG', label: '1kg Bulk', grams: 1000 },
  { value: 'BULK_5LB', label: '5lb Bulk', grams: 2268 },
  { value: 'BULK_2KG', label: '2kg Bulk', grams: 2000 },
] as const;

const STREAM_OPTIONS = [
  { value: 'CO_ROAST', label: 'Co-Roast' },
  { value: 'CONTRACT', label: 'Contract Manufacturing' },
  { value: 'BOTH', label: 'Both' },
  { value: 'INDUSTRY_CONTACT', label: 'Industry Contact' },
];

// ─── Helpers ───────────────────────────────────────
function StepIndicator({ step, total }: { step: number; total: number }) {
  return <p className="text-xs text-muted-foreground mb-4">Step {step} of {total}</p>;
}

// ─── Main Component ────────────────────────────────

export function QuickCreateWizard({ open, onOpenChange, onOpenNewRoastGroup }: Props) {
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  // flow state
  const [flow, setFlow] = useState<WizardFlow>(null);
  const [step, setStep] = useState(0);

  // ── Product wizard state ──
  const [pClientId, setPClientId] = useState('');
  const [pClientName, setPClientName] = useState('');
  const [pProductName, setPProductName] = useState('');
  const [pVariants, setPVariants] = useState<{ variant: string; price: string }[]>([]);
  const [pNewVariant, setPNewVariant] = useState('');
  const [pNewPrice, setPNewPrice] = useState('');
  const [pRoastGroupMode, setPRoastGroupMode] = useState<'existing' | 'new' | 'skip'>('existing');
  const [pExistingRG, setPExistingRG] = useState('');
  const [pNewRGName, setPNewRGName] = useState('');
  const [pNewRGBlend, setPNewRGBlend] = useState(false);
  const [pNewRGOrigin, setPNewRGOrigin] = useState('');
  const [pLotId, setPLotId] = useState('');
  const [pSaving, setPSaving] = useState(false);
  const [pResult, setPResult] = useState<any>(null);
  const [pClientSearch, setPClientSearch] = useState('');

  // ── Green Lot wizard state ──
  const [gContractId, setGContractId] = useState('');
  const [gContract, setGContract] = useState<any>(null);
  const [gBags, setGBags] = useState('');
  const [gExpectedDate, setGExpectedDate] = useState<Date | undefined>();
  const [gCarrier, setGCarrier] = useState('');
  const [gLotIdentifier, setGLotIdentifier] = useState('');
  const [gSaving, setGSaving] = useState(false);
  const [gResult, setGResult] = useState<any>(null);
  const [gContractSearch, setGContractSearch] = useState('');

  // ── Prospect wizard state ──
  const [prName, setPrName] = useState('');
  const [prContact, setPrContact] = useState('');
  const [prEmail, setPrEmail] = useState('');
  const [prPhone, setPrPhone] = useState('');
  const [prStream, setPrStream] = useState('CO_ROAST');
  const [prSaving, setPrSaving] = useState(false);

  function resetAll() {
    setFlow(null);
    setStep(0);
    setPClientId(''); setPClientName(''); setPProductName('');
    setPVariants([]); setPNewVariant(''); setPNewPrice('');
    setPRoastGroupMode('existing'); setPExistingRG('');
    setPNewRGName(''); setPNewRGBlend(false); setPNewRGOrigin('');
    setPLotId(''); setPSaving(false); setPResult(null); setPClientSearch('');
    setGContractId(''); setGContract(null); setGBags('');
    setGExpectedDate(undefined); setGCarrier(''); setGLotIdentifier('');
    setGSaving(false); setGResult(null); setGContractSearch('');
    setPrName(''); setPrContact(''); setPrEmail(''); setPrPhone('');
    setPrStream('CO_ROAST'); setPrSaving(false);
  }

  function close() {
    onOpenChange(false);
    setTimeout(resetAll, 300);
  }

  // ─── Queries ───────────────────────────────────────
  const { data: clients = [] } = useQuery({
    queryKey: ['qc-clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('id, account_name').eq('is_active', true).order('account_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && flow === 'product',
  });

  const { data: roastGroups = [] } = useQuery({
    queryKey: ['qc-roast-groups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roast_groups').select('roast_group, display_name').eq('is_active', true).order('display_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && flow === 'product',
  });

  const { data: greenLots = [] } = useQuery({
    queryKey: ['qc-green-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select('id, lot_number, kg_on_hand, status, contract_id, green_contracts(name)')
        .order('lot_number');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && (flow === 'product' || flow === 'lot'),
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ['qc-contracts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_contracts')
        .select('id, name, origin_country, num_bags, bag_size_kg, internal_contract_number, vendor_id, green_vendors(name, abbreviation)')
        .eq('status', 'ACTIVE')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && flow === 'lot',
  });

  // ─── Product Save ──────────────────────────────────
  async function saveProduct() {
    if (!pClientId || !pProductName.trim() || pVariants.length === 0) return;
    setPSaving(true);
    try {
      let roastGroupKey: string | null = null;
      let rgCreated = false;

      if (pRoastGroupMode === 'existing' && pExistingRG) {
        roastGroupKey = pExistingRG;
      } else if (pRoastGroupMode === 'new' && pNewRGName.trim()) {
        const result = await createOrReuseRoastGroup({
          displayName: pNewRGName.trim(),
          isBlend: pNewRGBlend,
          origin: pNewRGBlend ? null : pNewRGOrigin.trim() || null,
        });
        if (result.error) throw new Error(result.error);
        roastGroupKey = result.roastGroupKey;
        rgCreated = result.created;
      }

      const createdProducts: any[] = [];

      for (const v of pVariants) {
        const pkgOpt = PACKAGING_OPTIONS.find(o => o.value === v.variant);
        if (!pkgOpt) continue;

        const { data: product, error } = await supabase.from('products').insert({
          account_id: pClientId,
          product_name: `${pProductName.trim()} ${pkgOpt.label}`,
          roast_group: roastGroupKey,
          packaging_variant: v.variant as any,
          bag_size_g: pkgOpt.grams,
          format: 'WHOLE_BEAN' as any,
          grind_options: ['WHOLE_BEAN'] as any,
          is_active: true,
          is_perennial: true,
        } as any).select('id, product_name').single();
        if (error) throw error;
        createdProducts.push(product);

        if (v.price && parseFloat(v.price) > 0) {
          await supabase.from('price_list').insert({
            product_id: product.id,
            unit_price: parseFloat(v.price),
            currency: 'CAD',
            effective_date: format(new Date(), 'yyyy-MM-dd'),
          });
        }
      }

      if (pLotId && roastGroupKey) {
        await supabase.from('green_lot_roast_group_links').insert({
          lot_id: pLotId,
          roast_group: roastGroupKey,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['roast-groups-list'] });

      setPResult({
        clientName: pClientName,
        productName: pProductName.trim(),
        variants: pVariants.map(v => PACKAGING_OPTIONS.find(o => o.value === v.variant)?.label || v.variant),
        roastGroupKey,
        rgCreated,
        rgName: pRoastGroupMode === 'new' ? pNewRGName.trim() : roastGroups.find(r => r.roast_group === pExistingRG)?.display_name || null,
        lotNumber: pLotId ? greenLots.find(l => l.id === pLotId)?.lot_number : null,
        createdProducts,
      });
      setStep(5); // summary
      toast.success('Product created');
    } catch (err: any) {
      toast.error(`Failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setPSaving(false);
    }
  }

  // ─── Green Lot Save ────────────────────────────────
  async function saveLot() {
    if (!gContractId || !gBags) return;
    setGSaving(true);
    try {
      // Generate PO number
      let poNumber = '';
      try {
        const { data, error } = await supabase.rpc('nextval_text' as any, { seq_name: 'po_number_seq' });
        if (error) throw error;
        const seqVal = typeof data === 'number' ? data : parseInt(String(data));
        poNumber = `PO-${String(seqVal).padStart(3, '0')}`;
      } catch {
        poNumber = `PO-${String(Date.now()).slice(-4)}`;
      }

      const vendor = (gContract as any)?.green_vendors;
      const vendorAbbr = vendor?.abbreviation || '???';
      const country = gContract?.origin_country || '???';
      const lotNumber = `${vendorAbbr}-${country}-${poNumber}`;

      const { data: lot, error } = await supabase.from('green_lots').insert({
        lot_number: lotNumber,
        contract_id: gContractId,
        bags_released: parseInt(gBags),
        bag_size_kg: gContract?.bag_size_kg || 0,
        status: 'EN_ROUTE' as any,
        expected_delivery_date: gExpectedDate ? format(gExpectedDate, 'yyyy-MM-dd') : null,
        carrier: gCarrier.trim() || null,
        lot_identifier: gLotIdentifier.trim() || null,
        kg_on_hand: 0,
        created_by: authUser!.id,
        po_number: poNumber,
      } as any).select('id, lot_number').single();
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots-all'] });

      setGResult({
        lotId: lot.id,
        lotNumber: lot.lot_number,
        contractName: gContract?.name,
        bagsReleased: parseInt(gBags),
        bagSizeKg: gContract?.bag_size_kg,
      });
      setStep(3); // lot summary
      toast.success('Lot created');
    } catch (err: any) {
      toast.error(`Failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setGSaving(false);
    }
  }

  // ─── Prospect Save ─────────────────────────────────
  async function saveProspect() {
    if (!prName.trim()) return;
    setPrSaving(true);
    try {
      const contactInfo = [prEmail.trim(), prPhone.trim()].filter(Boolean).join(' | ') || null;
      const { data, error } = await supabase.from('prospects').insert({
        business_name: prName.trim(),
        contact_name: prContact.trim() || null,
        contact_info: contactInfo,
        stream: prStream as any,
        created_by: authUser!.id,
      }).select('id').single();
      if (error) throw error;
      toast.success('Got it — thanks');
      close();
      navigate(`/prospects/${data.id}`);
    } catch (err: any) {
      toast.error(`Failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setPrSaving(false);
    }
  }

  // ─── Add variant helper ────────────────────────────
  function addVariant() {
    if (!pNewVariant) return;
    if (pVariants.some(v => v.variant === pNewVariant)) return;
    setPVariants(prev => [...prev, { variant: pNewVariant, price: pNewPrice }]);
    setPNewVariant('');
    setPNewPrice('');
  }

  // ─── Render ────────────────────────────────────────
  function renderContent() {
    // ── Step 0: Menu ──
    if (flow === null) {
      return (
        <>
          <DialogHeader>
            <DialogTitle>What do you want to create?</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 mt-2">
            {[
              { icon: ShoppingCart, label: 'New Order', action: () => { close(); navigate('/orders/new'); } },
              { icon: Package, label: 'New Product', action: () => { setFlow('product'); setStep(1); } },
              { icon: Coffee, label: 'New Roast Group', action: () => { close(); onOpenNewRoastGroup(); } },
              { icon: Boxes, label: 'New Green Lot', action: () => { setFlow('lot'); setStep(1); } },
              { icon: UserPlus, label: 'New Prospect', action: () => { setFlow('prospect'); setStep(1); } },
            ].map(item => (
              <button
                key={item.label}
                onClick={item.action}
                className="flex items-center gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
              >
                <item.icon className="h-6 w-6 text-primary shrink-0" />
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </>
      );
    }

    // ════════════════════════════════════════════════════
    // PRODUCT WIZARD
    // ════════════════════════════════════════════════════
    if (flow === 'product') {
      // P1 — Client
      if (step === 1) {
        const filtered = clients.filter((c: any) =>
          c.account_name.toLowerCase().includes(pClientSearch.toLowerCase())
        );
        return (
          <>
            <DialogHeader><DialogTitle>New Product</DialogTitle></DialogHeader>
            <StepIndicator step={1} total={4} />
            <p className="text-sm text-muted-foreground mb-3">Which client is this product for?</p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search clients…" value={pClientSearch} onChange={e => setPClientSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto">
              {filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setPClientId(c.id); setPClientName(c.account_name); setStep(2); }}
                  className="flex w-full items-center justify-between rounded-md border border-border p-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="text-sm font-medium">{c.account_name}</span>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No clients found</p>}
            </div>
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => { setFlow(null); setStep(0); }}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
            </div>
          </>
        );
      }

      // P2 — Product name + variants
      if (step === 2) {
        const usedVariants = pVariants.map(v => v.variant);
        const availableVariants = PACKAGING_OPTIONS.filter(o => !usedVariants.includes(o.value));
        return (
          <>
            <DialogHeader><DialogTitle>New Product</DialogTitle></DialogHeader>
            <StepIndicator step={2} total={4} />
            <p className="text-sm text-muted-foreground mb-1">For <span className="font-medium text-foreground">{pClientName}</span></p>
            <div className="space-y-4">
              <div>
                <Label>Product Name</Label>
                <Input value={pProductName} onChange={e => setPProductName(e.target.value)} placeholder="e.g. Sunrise Blend" />
              </div>
              <div>
                <Label>Packaging Variants</Label>
                {pVariants.length > 0 && (
                  <div className="space-y-1 mt-2 mb-2">
                    {pVariants.map((v, i) => {
                      const opt = PACKAGING_OPTIONS.find(o => o.value === v.variant);
                      return (
                        <div key={v.variant} className="flex items-center gap-2 text-sm rounded-md border border-border px-3 py-2">
                          <span className="flex-1">{opt?.label}</span>
                          {v.price && <span className="text-muted-foreground">${v.price}</span>}
                          <button onClick={() => setPVariants(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <Select value={pNewVariant} onValueChange={setPNewVariant}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select size" /></SelectTrigger>
                    <SelectContent>
                      {availableVariants.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={pNewPrice} onChange={e => setPNewPrice(e.target.value)} placeholder="Price (opt)" className="w-24" type="number" min="0" step="0.01" />
                  <Button variant="outline" size="sm" onClick={addVariant} disabled={!pNewVariant}>Add</Button>
                </div>
              </div>
            </div>
            <div className="flex justify-between mt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button size="sm" onClick={() => setStep(3)} disabled={!pProductName.trim() || pVariants.length === 0}>Next</Button>
            </div>
          </>
        );
      }

      // P3 — Roast group
      if (step === 3) {
        return (
          <>
            <DialogHeader><DialogTitle>New Product</DialogTitle></DialogHeader>
            <StepIndicator step={3} total={4} />
            <p className="text-sm text-muted-foreground mb-3">Assign a roast group</p>
            <div className="space-y-3">
              <button
                onClick={() => setPRoastGroupMode('existing')}
                className={cn('w-full rounded-lg border p-3 text-left transition-colors', pRoastGroupMode === 'existing' ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50')}
              >
                <span className="text-sm font-medium">Use an existing roast group</span>
              </button>
              {pRoastGroupMode === 'existing' && (
                <Select value={pExistingRG} onValueChange={setPExistingRG}>
                  <SelectTrigger><SelectValue placeholder="Select roast group" /></SelectTrigger>
                  <SelectContent>
                    {roastGroups.map(rg => (
                      <SelectItem key={rg.roast_group} value={rg.roast_group}>{rg.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <button
                onClick={() => setPRoastGroupMode('new')}
                className={cn('w-full rounded-lg border p-3 text-left transition-colors', pRoastGroupMode === 'new' ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50')}
              >
                <span className="text-sm font-medium">Create a new roast group</span>
              </button>
              {pRoastGroupMode === 'new' && (
                <div className="space-y-2 pl-3 border-l-2 border-muted">
                  <Input value={pNewRGName} onChange={e => setPNewRGName(e.target.value)} placeholder="Display name" />
                  <RadioGroup value={pNewRGBlend ? 'blend' : 'single'} onValueChange={v => setPNewRGBlend(v === 'blend')} className="flex gap-4">
                    <div className="flex items-center gap-1.5"><RadioGroupItem value="single" id="qc-so" /><Label htmlFor="qc-so" className="text-sm">Single Origin</Label></div>
                    <div className="flex items-center gap-1.5"><RadioGroupItem value="blend" id="qc-bl" /><Label htmlFor="qc-bl" className="text-sm">Blend</Label></div>
                  </RadioGroup>
                  {!pNewRGBlend && <Input value={pNewRGOrigin} onChange={e => setPNewRGOrigin(e.target.value)} placeholder="Origin (e.g. Colombia)" />}
                </div>
              )}
            </div>
            <button onClick={() => { setPRoastGroupMode('skip'); setStep(4); }} className="text-xs text-muted-foreground hover:text-foreground mt-3 underline">I'll do this later</button>
            <div className="flex justify-between mt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button size="sm" onClick={() => setStep(4)} disabled={pRoastGroupMode === 'existing' && !pExistingRG || pRoastGroupMode === 'new' && !pNewRGName.trim()}>Next</Button>
            </div>
          </>
        );
      }

      // P4 — Link a green lot
      if (step === 4) {
        return (
          <>
            <DialogHeader><DialogTitle>New Product</DialogTitle></DialogHeader>
            <StepIndicator step={4} total={4} />
            <p className="text-sm text-muted-foreground mb-3">Link a green lot (optional)</p>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto">
              {greenLots.map((lot: any) => (
                <button
                  key={lot.id}
                  onClick={() => setPLotId(lot.id === pLotId ? '' : lot.id)}
                  className={cn('flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors',
                    pLotId === lot.id ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50')}
                >
                  <div className="flex-1">
                    <span className="text-sm font-medium">{lot.lot_number}</span>
                    <span className="text-xs text-muted-foreground ml-2">{(lot.green_contracts as any)?.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={lot.status === 'RECEIVED' ? 'default' : 'secondary'} className="text-xs">{lot.status}</Badge>
                    <span className="text-xs text-muted-foreground">{lot.kg_on_hand} kg</span>
                    {pLotId === lot.id && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </button>
              ))}
              {greenLots.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No lots available</p>}
            </div>
            <button onClick={() => { setPLotId(''); saveProduct(); }} className="text-xs text-muted-foreground hover:text-foreground mt-3 underline">Skip for now</button>
            <div className="flex justify-between mt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep(3)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button size="sm" onClick={saveProduct} disabled={pSaving}>
                {pSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Finish
              </Button>
            </div>
          </>
        );
      }

      // P5 — Summary
      if (step === 5 && pResult) {
        return (
          <>
            <DialogHeader><DialogTitle>Product Created</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Client</span><span className="font-medium">{pResult.clientName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Product</span><span className="font-medium">{pResult.productName}</span></div>
                <div className="flex justify-between items-start"><span className="text-muted-foreground">Variants</span><div className="text-right">{pResult.variants.map((v: string) => <Badge key={v} variant="outline" className="ml-1 text-xs">{v}</Badge>)}</div></div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Roast Group</span>
                  <span className="font-medium">{pResult.rgName ? `${pResult.rgName} ${pResult.rgCreated ? '(created)' : '(existing)'}` : 'Not linked yet'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Green Lot</span>
                  <span className="font-medium">{pResult.lotNumber || 'Not linked yet'}</span>
                </div>
              </div>
              {pResult.createdProducts?.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {pResult.createdProducts.map((p: any) => (
                    <Link key={p.id} to={`/products`} className="flex items-center gap-1 hover:underline">
                      <ExternalLink className="h-3 w-3" /> {p.product_name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-between mt-4">
              <Button variant="outline" size="sm" onClick={() => { resetAll(); }}>Create another</Button>
              <Button size="sm" onClick={close}>Done</Button>
            </div>
          </>
        );
      }
    }

    // ════════════════════════════════════════════════════
    // GREEN LOT WIZARD
    // ════════════════════════════════════════════════════
    if (flow === 'lot') {
      // G1 — Pick contract
      if (step === 1) {
        const filtered = contracts.filter((c: any) =>
          c.name?.toLowerCase().includes(gContractSearch.toLowerCase()) ||
          c.origin_country?.toLowerCase().includes(gContractSearch.toLowerCase())
        );
        return (
          <>
            <DialogHeader><DialogTitle>New Green Lot</DialogTitle></DialogHeader>
            <StepIndicator step={1} total={2} />
            <p className="text-sm text-muted-foreground mb-3">Which contract?</p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search contracts…" value={gContractSearch} onChange={e => setGContractSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto">
              {filtered.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => { setGContractId(c.id); setGContract(c); setStep(2); }}
                  className="flex w-full flex-col rounded-md border border-border p-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="text-sm font-medium">{c.name}</span>
                  <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                    {(c.green_vendors as any)?.name && <span>{(c.green_vendors as any).name}</span>}
                    {c.origin_country && <span>{c.origin_country}</span>}
                    {c.num_bags && c.bag_size_kg && <span>{c.num_bags} × {c.bag_size_kg}kg</span>}
                    {c.internal_contract_number && <span>#{c.internal_contract_number}</span>}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No contracts found</p>}
            </div>
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => { setFlow(null); setStep(0); }}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
            </div>
          </>
        );
      }

      // G2 — Lot details
      if (step === 2) {
        const vendor = (gContract as any)?.green_vendors;
        const vendorAbbr = vendor?.abbreviation || '???';
        const country = gContract?.origin_country || '???';
        return (
          <>
            <DialogHeader><DialogTitle>New Green Lot</DialogTitle></DialogHeader>
            <StepIndicator step={2} total={2} />
            <div className="rounded-md border border-border p-3 text-sm space-y-1 mb-4 bg-muted/30">
              <div className="flex justify-between"><span className="text-muted-foreground">Contract</span><span className="font-medium">{gContract?.name}</span></div>
              {vendor?.abbreviation && <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span>{vendor.abbreviation}</span></div>}
              {gContract?.origin_country && <div className="flex justify-between"><span className="text-muted-foreground">Origin</span><span>{gContract.origin_country}</span></div>}
              {gContract?.bag_size_kg && <div className="flex justify-between"><span className="text-muted-foreground">Bag size</span><span>{gContract.bag_size_kg} kg</span></div>}
            </div>
            <p className="text-xs text-muted-foreground mb-1">Lot number preview: <span className="font-mono">{vendorAbbr}-{country}-PO###</span> <span className="italic">(auto-assigned on save)</span></p>
            <div className="space-y-3">
              <div>
                <Label>Bags released *</Label>
                <Input type="number" min="1" value={gBags} onChange={e => setGBags(e.target.value)} placeholder="e.g. 50" />
              </div>
              <div>
                <Label>Expected delivery date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {gExpectedDate ? format(gExpectedDate, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={gExpectedDate} onSelect={setGExpectedDate} /></PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Carrier</Label>
                <Input value={gCarrier} onChange={e => setGCarrier(e.target.value)} placeholder="e.g. Continental" />
              </div>
              <div>
                <Label>Lot identifier / notes</Label>
                <Input value={gLotIdentifier} onChange={e => setGLotIdentifier(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-between mt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button size="sm" onClick={saveLot} disabled={gSaving || !gBags}>
                {gSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Create Lot
              </Button>
            </div>
          </>
        );
      }

      // G3 — Lot summary
      if (step === 3 && gResult) {
        return (
          <>
            <DialogHeader><DialogTitle>Lot Created</DialogTitle></DialogHeader>
            <div className="rounded-lg border border-border p-4 space-y-2 text-sm mt-2">
              <div className="flex justify-between"><span className="text-muted-foreground">Lot number</span><span className="font-mono font-medium">{gResult.lotNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Contract</span><span>{gResult.contractName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Bags released</span><span>{gResult.bagsReleased}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Bag size</span><span>{gResult.bagSizeKg} kg</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant="secondary" className="text-xs">EN_ROUTE</Badge></div>
            </div>
            <div className="mt-2 text-xs">
              <Link to="/sourcing/lots" className="flex items-center gap-1 text-muted-foreground hover:underline" onClick={close}>
                <ExternalLink className="h-3 w-3" /> View in Sourcing → Lots
              </Link>
            </div>
            <div className="flex justify-between mt-4">
              <Button variant="outline" size="sm" onClick={resetAll}>Create another</Button>
              <Button size="sm" onClick={close}>Done</Button>
            </div>
          </>
        );
      }
    }

    // ════════════════════════════════════════════════════
    // PROSPECT WIZARD
    // ════════════════════════════════════════════════════
    if (flow === 'prospect' && step === 1) {
      return (
        <>
          <DialogHeader><DialogTitle>New Prospect</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label>Business name *</Label>
              <Input value={prName} onChange={e => setPrName(e.target.value)} placeholder="e.g. Bright Coffee Co." />
            </div>
            <div>
              <Label>Contact name</Label>
              <Input value={prContact} onChange={e => setPrContact(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={prEmail} onChange={e => setPrEmail(e.target.value)} type="email" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={prPhone} onChange={e => setPrPhone(e.target.value)} type="tel" />
            </div>
            <div>
              <Label>Stream</Label>
              <Select value={prStream} onValueChange={setPrStream}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STREAM_OPTIONS.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-between mt-4">
            <Button variant="ghost" size="sm" onClick={() => { setFlow(null); setStep(0); }}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
            <Button size="sm" onClick={saveProspect} disabled={prSaving || !prName.trim()}>
              {prSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Save
            </Button>
          </div>
        </>
      );
    }

    return null;
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); else onOpenChange(true); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
