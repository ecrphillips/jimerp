import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, isPast, parseISO } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Plus, CalendarIcon, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';
import { COMMON_ORIGINS, OTHER_ORIGINS, getCountryName } from '@/lib/coffeeOrigins';
import { useNavigate } from 'react-router-dom';

// ─── Types ─────────────────────────────────────────────────

interface Vendor {
  id: string;
  name: string;
  abbreviation: string | null;
  is_active: boolean;
}

interface PurchaseRow {
  id: string;
  vendor_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  fx_rate: number | null;
  fx_rate_is_cad: boolean;
  shared_freight_usd: number;
  shared_carry_usd: number;
  shared_other_usd: number;
  shared_other_label: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

interface PurchaseLine {
  id: string;
  purchase_id: string;
  lot_identifier: string | null;
  origin_country: string | null;
  region: string | null;
  producer: string | null;
  variety: string | null;
  crop_year: string | null;
  category: string | null;
  bags: number;
  bag_size_kg: number;
  price_per_lb_usd: number | null;
  warehouse_location: string | null;
  notes: string | null;
  lot_id: string | null;
  display_order: number;
  created_at: string;
}

const CATEGORY_OPTIONS = [
  { value: 'BLENDER', label: 'Blender' },
  { value: 'MICRO_LOT', label: 'Micro-lot' },
  { value: 'HYPER_PREMIUM', label: 'Hyper Premium' },
];

const CATEGORY_LABELS: Record<string, string> = {
  BLENDER: 'Blender',
  SINGLE_ORIGIN: 'Blender',
  MICRO_LOT: 'Micro-lot',
  HYPER_PREMIUM: 'Hyper Premium',
};

// ─── Empty line template ───────────────────────────────────

function emptyLine(): CoffeeLine {
  return {
    key: crypto.randomUUID(),
    lot_identifier: '',
    origin_country: '',
    region: '',
    producer: '',
    variety: '',
    crop_year: '',
    category: 'BLENDER',
    bags: 0,
    bag_size_kg: 0,
    price_per_lb_usd: '',
    warehouse_location: '',
    notes: '',
  };
}

interface CoffeeLine {
  key: string;
  lot_identifier: string;
  origin_country: string;
  region: string;
  producer: string;
  variety: string;
  crop_year: string;
  category: string;
  bags: number;
  bag_size_kg: number;
  price_per_lb_usd: string;
  warehouse_location: string;
  notes: string;
}

// ─── Page Component ────────────────────────────────────────

export default function SourcingPurchases() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Fetch vendors
  const { data: vendors = [] } = useQuery({
    queryKey: ['green-vendors-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendors')
        .select('id, name, abbreviation, is_active')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const vendorMap = useMemo(() => {
    const m: Record<string, Vendor> = {};
    vendors.forEach(v => m[v.id] = v);
    return m;
  }, [vendors]);

  // Fetch all vendors (including inactive) for display
  const { data: allVendors = [] } = useQuery({
    queryKey: ['green-vendors-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendors')
        .select('id, name, abbreviation, is_active')
        .order('name');
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const allVendorMap = useMemo(() => {
    const m: Record<string, Vendor> = {};
    allVendors.forEach(v => m[v.id] = v);
    return m;
  }, [allVendors]);

  // Fetch purchases
  const { data: purchases = [], isLoading } = useQuery({
    queryKey: ['green-purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_purchases')
        .select('*')
        .order('invoice_date', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data as PurchaseRow[];
    },
  });

  // Fetch all purchase lines
  const { data: allLines = [] } = useQuery({
    queryKey: ['green-purchase-lines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_purchase_lines')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return data as PurchaseLine[];
    },
  });

  const linesByPurchase = useMemo(() => {
    const m: Record<string, PurchaseLine[]> = {};
    allLines.forEach(l => {
      if (!m[l.purchase_id]) m[l.purchase_id] = [];
      m[l.purchase_id].push(l);
    });
    return m;
  }, [allLines]);

  const selectedPurchase = purchases.find(p => p.id === selectedId) || null;
  const selectedLines = selectedId ? (linesByPurchase[selectedId] || []) : [];

  return (
    <>
      <GreenCoffeeAlerts />
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Purchases</h1>
          <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New Purchase
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : purchases.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No purchases yet. Click "New Purchase" to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead className="text-right">Coffees</TableHead>
                  <TableHead className="text-right">Total kg</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map(p => {
                  const lines = linesByPurchase[p.id] || [];
                  const coffeeCount = lines.length;
                  const totalKg = lines.reduce((sum, l) => sum + l.bags * l.bag_size_kg, 0);
                  const overdue = p.due_date && isPast(parseISO(p.due_date));
                  const vendor = allVendorMap[p.vendor_id];

                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{vendor?.name || '—'}</TableCell>
                      <TableCell>{p.invoice_number || '—'}</TableCell>
                      <TableCell>{p.invoice_date ? format(parseISO(p.invoice_date), 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell className="text-right">{coffeeCount}</TableCell>
                      <TableCell className="text-right">{totalKg > 0 ? `${totalKg.toLocaleString()} kg` : '—'}</TableCell>
                      <TableCell>
                        {p.due_date ? (
                          <span className={cn(overdue && 'text-amber-600 font-medium')}>
                            {format(parseISO(p.due_date), 'MMM d, yyyy')}
                            {overdue && ' (overdue)'}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(p.id)}>View</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <CreatePurchaseModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        vendors={vendors}
      />

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Purchase Detail</SheetTitle>
          </SheetHeader>
          {selectedPurchase && (
            <PurchaseDetailContent
              purchase={selectedPurchase}
              lines={selectedLines}
              vendor={allVendorMap[selectedPurchase.vendor_id]}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Detail Sheet Content ──────────────────────────────────

function PurchaseDetailContent({
  purchase,
  lines,
  vendor,
}: {
  purchase: PurchaseRow;
  lines: PurchaseLine[];
  vendor: Vendor | undefined;
}) {
  const navigate = useNavigate();
  const totalKg = lines.reduce((sum, l) => sum + l.bags * l.bag_size_kg, 0);

  return (
    <div className="space-y-6 pt-4">
      {/* Header fields */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Vendor</p>
          <p className="font-medium">{vendor?.name || '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Invoice Number</p>
          <p className="font-medium">{purchase.invoice_number || '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Invoice Date</p>
          <p>{purchase.invoice_date ? format(parseISO(purchase.invoice_date), 'MMM d, yyyy') : '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Due Date</p>
          <p>{purchase.due_date ? format(parseISO(purchase.due_date), 'MMM d, yyyy') : '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">FX Rate (USD → CAD)</p>
          <p>{purchase.fx_rate != null ? purchase.fx_rate.toFixed(4) : '—'}</p>
        </div>
      </div>

      {/* Shared costs */}
      {(purchase.shared_freight_usd > 0 || purchase.shared_carry_usd > 0 || purchase.shared_other_usd > 0) && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Shared Costs</h3>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Freight (USD)</p>
              <p>${purchase.shared_freight_usd.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Carry (USD)</p>
              <p>${purchase.shared_carry_usd.toFixed(2)}</p>
            </div>
            {purchase.shared_other_usd > 0 && (
              <div>
                <p className="text-muted-foreground text-xs">{purchase.shared_other_label || 'Other'} (USD)</p>
                <p>${purchase.shared_other_usd.toFixed(2)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {purchase.notes && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-1">Notes</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{purchase.notes}</p>
        </div>
      )}

      {/* Coffee lines */}
      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold mb-3">Coffees ({lines.length})</h3>
        <div className="space-y-3">
          {lines.map(line => {
            const lineKg = line.bags * line.bag_size_kg;
            const share = totalKg > 0 ? lineKg / totalKg : 0;
            return (
              <Card key={line.id}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{line.lot_identifier || '(no identifier)'}</p>
                      <p className="text-xs text-muted-foreground">
                        {getCountryName(line.origin_country) || line.origin_country || '—'}
                        {line.region ? ` · ${line.region}` : ''}
                        {line.producer ? ` · ${line.producer}` : ''}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[line.category || ''] || line.category || '—'}</Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                    <div>{line.bags} bags × {line.bag_size_kg} kg</div>
                    <div className="font-medium text-foreground">{lineKg.toLocaleString()} kg</div>
                    {line.price_per_lb_usd != null && <div>${Number(line.price_per_lb_usd).toFixed(4)}/lb</div>}
                    {line.warehouse_location && <div>{line.warehouse_location}</div>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Freight: ${(purchase.shared_freight_usd * share).toFixed(2)}</span>
                    <span>Carry: ${(purchase.shared_carry_usd * share).toFixed(2)}</span>
                    {purchase.shared_other_usd > 0 && <span>Other: ${(purchase.shared_other_usd * share).toFixed(2)}</span>}
                  </div>
                  {line.lot_id && (
                    <Button
                      size="sm"
                      variant="link"
                      className="p-0 h-auto text-xs gap-1"
                      onClick={() => navigate(`/sourcing/lots?lot=${line.lot_id}`)}
                    >
                      <ExternalLink className="h-3 w-3" /> Go to Lot
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Create Purchase Modal ─────────────────────────────────

function CreatePurchaseModal({
  open,
  onOpenChange,
  vendors,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendors: Vendor[];
}) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [vendorId, setVendorId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<Date | undefined>();
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [fxRate, setFxRate] = useState('');
  const [sharedFreight, setSharedFreight] = useState('0');
  const [sharedCarry, setSharedCarry] = useState('0');
  const [sharedOther, setSharedOther] = useState('0');
  const [sharedOtherLabel, setSharedOtherLabel] = useState('');
  const [headerNotes, setHeaderNotes] = useState('');

  // Step 2 lines
  const [lines, setLines] = useState<CoffeeLine[]>([emptyLine()]);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setStep(1);
      setVendorId('');
      setInvoiceNumber('');
      setInvoiceDate(undefined);
      setDueDate(undefined);
      setFxRate('');
      setSharedFreight('0');
      setSharedCarry('0');
      setSharedOther('0');
      setSharedOtherLabel('');
      setHeaderNotes('');
      setLines([emptyLine()]);
    }
  }, [open]);

  const selectedVendor = vendors.find(v => v.id === vendorId);

  const updateLine = (key: string, field: keyof CoffeeLine, value: any) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  };

  const removeLine = (key: string) => {
    setLines(prev => prev.filter(l => l.key !== key));
  };

  // Proration calculations
  const freightNum = parseFloat(sharedFreight) || 0;
  const carryNum = parseFloat(sharedCarry) || 0;
  const otherNum = parseFloat(sharedOther) || 0;
  const totalKgAll = lines.reduce((s, l) => s + (l.bags * l.bag_size_kg), 0);

  const canCreate = lines.some(l => l.lot_identifier.trim() && l.bags > 0 && l.bag_size_kg > 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      // 1. Insert purchase
      const { data: purchase, error: purchaseErr } = await supabase
        .from('green_purchases')
        .insert({
          vendor_id: vendorId,
          invoice_number: invoiceNumber.trim() || null,
          invoice_date: invoiceDate ? format(invoiceDate, 'yyyy-MM-dd') : null,
          due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
          fx_rate: fxRate ? parseFloat(fxRate) : null,
          fx_rate_is_cad: false,
          shared_freight_usd: freightNum,
          shared_carry_usd: carryNum,
          shared_other_usd: otherNum,
          shared_other_label: sharedOtherLabel.trim() || null,
          notes: headerNotes.trim() || null,
          created_by: authUser!.id,
        } as any)
        .select('id')
        .single();

      if (purchaseErr) throw purchaseErr;
      const purchaseId = purchase.id;

      const fxRateNum = fxRate ? parseFloat(fxRate) : null;
      let lotCount = 0;

      // 2. For each line: create lot + purchase line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.lot_identifier.trim() || line.bags <= 0 || line.bag_size_kg <= 0) continue;

        const lineKg = line.bags * line.bag_size_kg;
        const share = totalKgAll > 0 ? lineKg / totalKgAll : 0;
        const freightAllocated = freightNum * share;
        const carryAllocated = carryNum * share;
        const otherAllocated = otherNum * share;

        // Generate lot number: VENDOR_ABBR-ORIGIN_COUNTRY-PO###
        let poNumber = '';
        try {
          const { data: seqData, error: seqErr } = await supabase.rpc('nextval_text' as any, { seq_name: 'po_number_seq' });
          if (seqErr) throw seqErr;
          const seqVal = typeof seqData === 'number' ? seqData : parseInt(String(seqData));
          poNumber = `PO-${String(seqVal).padStart(3, '0')}`;
        } catch {
          poNumber = `PO-${String(Date.now()).slice(-6)}`;
        }

        const vendorAbbr = selectedVendor?.abbreviation || '???';
        const originCode = line.origin_country || '???';
        const lotNumber = `${vendorAbbr}-${originCode}-${poNumber}`;

        // Freight in CAD if fx_rate provided, else store USD
        const freightCad = fxRateNum ? freightAllocated * fxRateNum : freightAllocated;

        const { data: lot, error: lotErr } = await supabase
          .from('green_lots')
          .insert({
            lot_number: lotNumber,
            lot_identifier: line.lot_identifier.trim(),
            contract_id: null as any, // No contract for direct purchases
            bags_released: line.bags,
            bag_size_kg: line.bag_size_kg,
            kg_received: lineKg,
            kg_on_hand: lineKg,
            status: 'EN_ROUTE' as any,
            costing_status: 'INCOMPLETE',
            expected_delivery_date: null,
            received_date: null,
            origin_country: line.origin_country || null,
            region: line.region.trim() || null,
            producer: line.producer.trim() || null,
            variety: line.variety.trim() || null,
            crop_year: line.crop_year.trim() || null,
            category: line.category || null,
            fx_rate: fxRateNum,
            freight_cad: freightCad,
            carry_fees_usd: carryAllocated,
            other_costs_cad: fxRateNum ? otherAllocated * fxRateNum : otherAllocated,
            warehouse_location: line.warehouse_location.trim() || null,
            notes_internal: line.notes.trim() || null,
            po_number: poNumber,
            created_by: authUser!.id,
          } as any)
          .select('id')
          .single();

        if (lotErr) throw lotErr;

        // Insert purchase line linking to both purchase and lot
        const { error: lineErr } = await supabase
          .from('green_purchase_lines')
          .insert({
            purchase_id: purchaseId,
            lot_identifier: line.lot_identifier.trim(),
            origin_country: line.origin_country || null,
            region: line.region.trim() || null,
            producer: line.producer.trim() || null,
            variety: line.variety.trim() || null,
            crop_year: line.crop_year.trim() || null,
            category: line.category || null,
            bags: line.bags,
            bag_size_kg: line.bag_size_kg,
            price_per_lb_usd: line.price_per_lb_usd ? parseFloat(line.price_per_lb_usd) : null,
            warehouse_location: line.warehouse_location.trim() || null,
            notes: line.notes.trim() || null,
            lot_id: lot.id,
            display_order: i,
          } as any);

        if (lineErr) throw lineErr;
        lotCount++;
      }

      return lotCount;
    },
    onSuccess: (lotCount) => {
      toast.success(`Purchase created — ${lotCount} lot${lotCount !== 1 ? 's' : ''} added to inventory`);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['green-purchases'] });
      queryClient.invalidateQueries({ queryKey: ['green-purchase-lines'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots-all'] });
      navigate('/sourcing/lots');
    },
    onError: (err: any) => {
      toast.error(`Failed to create purchase: ${err?.message || 'Unknown error'}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'New Purchase — Invoice Details' : `New Purchase — Coffees (${selectedVendor?.name || ''}${invoiceNumber ? ` · ${invoiceNumber}` : ''})`}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            {/* Vendor */}
            <div>
              <Label>Vendor *</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}{v.abbreviation ? ` (${v.abbreviation})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Number</Label>
                <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-2024-001" />
              </div>
              <div>
                <Label>FX Rate (USD → CAD)</Label>
                <Input type="number" step="0.0001" value={fxRate} onChange={e => setFxRate(e.target.value)} placeholder="e.g. 1.3850" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {invoiceDate ? format(invoiceDate, 'MMM d, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={invoiceDate} onSelect={setInvoiceDate} />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Due Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDate ? format(dueDate, 'MMM d, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dueDate} onSelect={setDueDate} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Shared Costs */}
            <div className="border rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-semibold">Shared Costs</h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Freight (USD)</Label>
                  <Input type="number" step="0.01" value={sharedFreight} onChange={e => setSharedFreight(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Carry / Storage (USD)</Label>
                  <Input type="number" step="0.01" value={sharedCarry} onChange={e => setSharedCarry(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Other (USD)</Label>
                  <div className="flex gap-1">
                    <Input type="number" step="0.01" value={sharedOther} onChange={e => setSharedOther(e.target.value)} className="w-24" />
                    <Input value={sharedOtherLabel} onChange={e => setSharedOtherLabel(e.target.value)} placeholder="Label" className="flex-1" />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea value={headerNotes} onChange={e => setHeaderNotes(e.target.value)} rows={2} placeholder="Optional" />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!vendorId} onClick={() => setStep(2)}>Next</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Coffee line cards */}
            {lines.map((line, idx) => (
              <Card key={line.key} className="relative">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-muted-foreground">Coffee {idx + 1}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={lines.length <= 1}
                      onClick={() => removeLine(line.key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Lot Identifier *</Label>
                      <Input value={line.lot_identifier} onChange={e => updateLine(line.key, 'lot_identifier', e.target.value)} placeholder="e.g. Estrellas de Aji" />
                    </div>
                    <div>
                      <Label className="text-xs">Origin Country</Label>
                      <Select value={line.origin_country} onValueChange={v => updateLine(line.key, 'origin_country', v)}>
                        <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Common Origins</SelectLabel>
                            {COMMON_ORIGINS.map(c => (
                              <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel>Other Origins</SelectLabel>
                            {OTHER_ORIGINS.map(c => (
                              <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Region</Label>
                      <Input value={line.region} onChange={e => updateLine(line.key, 'region', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Producer</Label>
                      <Input value={line.producer} onChange={e => updateLine(line.key, 'producer', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Variety</Label>
                      <Input value={line.variety} onChange={e => updateLine(line.key, 'variety', e.target.value)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs">Crop Year</Label>
                      <Input value={line.crop_year} onChange={e => updateLine(line.key, 'crop_year', e.target.value)} placeholder="e.g. 2024" />
                    </div>
                    <div>
                      <Label className="text-xs">Category</Label>
                      <Select value={line.category} onValueChange={v => updateLine(line.key, 'category', v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORY_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Bags *</Label>
                      <Input type="number" value={line.bags || ''} onChange={e => updateLine(line.key, 'bags', parseInt(e.target.value) || 0)} />
                    </div>
                    <div>
                      <Label className="text-xs">Bag Size (kg) *</Label>
                      <Input type="number" step="0.1" value={line.bag_size_kg || ''} onChange={e => updateLine(line.key, 'bag_size_kg', parseFloat(e.target.value) || 0)} placeholder="e.g. 69" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Price/lb (USD)</Label>
                      <Input type="number" step="0.0001" value={line.price_per_lb_usd} onChange={e => updateLine(line.key, 'price_per_lb_usd', e.target.value)} placeholder="0.0000" />
                    </div>
                    <div>
                      <Label className="text-xs">Warehouse</Label>
                      <Input value={line.warehouse_location} onChange={e => updateLine(line.key, 'warehouse_location', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <Input value={line.notes} onChange={e => updateLine(line.key, 'notes', e.target.value)} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button variant="outline" className="w-full gap-1.5" onClick={() => setLines(prev => [...prev, emptyLine()])}>
              <Plus className="h-4 w-4" /> Add Coffee
            </Button>

            {/* Proration preview */}
            {(freightNum > 0 || carryNum > 0 || otherNum > 0) && (
              <div className="border rounded-lg p-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cost Proration Preview</h4>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Coffee</TableHead>
                        <TableHead className="text-xs text-right">Bags</TableHead>
                        <TableHead className="text-xs text-right">Total kg</TableHead>
                        {freightNum > 0 && <TableHead className="text-xs text-right">Freight</TableHead>}
                        {carryNum > 0 && <TableHead className="text-xs text-right">Carry</TableHead>}
                        {otherNum > 0 && <TableHead className="text-xs text-right">Other</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map(l => {
                        const lkg = l.bags * l.bag_size_kg;
                        const share = totalKgAll > 0 ? lkg / totalKgAll : 0;
                        return (
                          <TableRow key={l.key}>
                            <TableCell className="text-xs">{l.lot_identifier || '—'}</TableCell>
                            <TableCell className="text-xs text-right">{l.bags || 0}</TableCell>
                            <TableCell className="text-xs text-right">{totalKgAll > 0 ? `${lkg.toLocaleString()} kg` : '—'}</TableCell>
                            {freightNum > 0 && <TableCell className="text-xs text-right">{totalKgAll > 0 ? `$${(freightNum * share).toFixed(2)}` : '—'}</TableCell>}
                            {carryNum > 0 && <TableCell className="text-xs text-right">{totalKgAll > 0 ? `$${(carryNum * share).toFixed(2)}` : '—'}</TableCell>}
                            {otherNum > 0 && <TableCell className="text-xs text-right">{totalKgAll > 0 ? `$${(otherNum * share).toFixed(2)}` : '—'}</TableCell>}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={!canCreate || createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? 'Creating…' : 'Create Purchase & Lots'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
