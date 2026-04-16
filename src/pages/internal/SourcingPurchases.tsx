import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, isPast, parseISO } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Plus, CalendarIcon, Trash2, ExternalLink, Pencil } from 'lucide-react';
import { formatMoney } from '@/lib/formatMoney';
import { cn } from '@/lib/utils';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';
import { ViewToggle, useViewMode } from '@/components/sourcing/ViewToggle';
import { COMMON_ORIGINS, OTHER_ORIGINS, getCountryName } from '@/lib/coffeeOrigins';
import { allocatePoNumber, poFromExisting, allocateSingleLotNumber } from '@/lib/lotNumberGenerator';
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
  po_number: string | null;
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

// ─── Shared cost types ────────────────────────────────────

type Currency = 'CAD' | 'USD';

interface SharedCostLine {
  amount: string;
  currency: Currency;
}

interface SharedCostLineWithLabel extends SharedCostLine {
  label: string;
}

interface SharedCosts {
  carry: SharedCostLine;
  freight: SharedCostLine;
  duties: SharedCostLine;
  fees: SharedCostLine;
  other: SharedCostLineWithLabel;
}

// Parsed shared_costs from notes JSON
interface SharedCostsJson {
  carry?: { amount: number; currency: string };
  freight?: { amount: number; currency: string };
  duties?: { amount: number; currency: string };
  fees?: { amount: number; currency: string };
  other?: { amount: number; currency: string; label?: string };
}

function parseSharedCostsFromNotes(notes: string | null): SharedCostsJson | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes);
    return parsed?.shared_costs || null;
  } catch {
    return null;
  }
}

function defaultCurrency(fxRate: string): Currency {
  return fxRate.trim() ? 'USD' : 'CAD';
}

function makeDefaultSharedCosts(cur: Currency): SharedCosts {
  return {
    carry: { amount: '0', currency: cur },
    freight: { amount: '0', currency: cur },
    duties: { amount: '0', currency: cur },
    fees: { amount: '0', currency: cur },
    other: { amount: '0', currency: cur, label: '' },
  };
}

// ─── Currency Toggle ──────────────────────────────────────

function CurrencyToggle({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  return (
    <div className="inline-flex rounded-md border border-input overflow-hidden h-10">
      <button
        type="button"
        className={cn(
          'px-2 text-xs font-medium transition-colors',
          value === 'CAD'
            ? 'bg-primary text-primary-foreground'
            : 'bg-background text-muted-foreground hover:bg-muted'
        )}
        onClick={() => onChange('CAD')}
      >
        CAD
      </button>
      <button
        type="button"
        className={cn(
          'px-2 text-xs font-medium transition-colors border-l border-input',
          value === 'USD'
            ? 'bg-primary text-primary-foreground'
            : 'bg-background text-muted-foreground hover:bg-muted'
        )}
        onClick={() => onChange('USD')}
      >
        USD
      </button>
    </div>
  );
}

// ─── Empty line template ───────────────────────────────────

type PriceUnit = 'USD_LB' | 'USD_KG' | 'CAD_LB' | 'CAD_KG';

const PRICE_UNIT_OPTIONS: { value: PriceUnit; label: string }[] = [
  { value: 'USD_LB', label: 'USD/lb' },
  { value: 'USD_KG', label: 'USD/kg' },
  { value: 'CAD_LB', label: 'CAD/lb' },
  { value: 'CAD_KG', label: 'CAD/kg' },
];

const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  USD_LB: 'USD/lb',
  USD_KG: 'USD/kg',
  CAD_LB: 'CAD/lb',
  CAD_KG: 'CAD/kg',
};

const KG_PER_LB = 2.20462;

function convertToUsdPerLb(amount: number, unit: PriceUnit, fxRate: number | null): { value: number; unconverted: boolean } {
  switch (unit) {
    case 'USD_LB':
      return { value: amount, unconverted: false };
    case 'USD_KG':
      return { value: amount / KG_PER_LB, unconverted: false };
    case 'CAD_LB':
      if (fxRate) return { value: amount / fxRate, unconverted: false };
      return { value: amount, unconverted: true };
    case 'CAD_KG':
      if (fxRate) return { value: (amount / fxRate) / KG_PER_LB, unconverted: false };
      return { value: amount / KG_PER_LB, unconverted: true };
  }
}

function convertToUsdPerKg(amount: number, unit: PriceUnit, fxRate: number | null): { value: number; unconverted: boolean } {
  switch (unit) {
    case 'USD_LB':
      return { value: amount * KG_PER_LB, unconverted: false };
    case 'USD_KG':
      return { value: amount, unconverted: false };
    case 'CAD_LB':
      if (fxRate) return { value: (amount / fxRate) * KG_PER_LB, unconverted: false };
      return { value: amount * KG_PER_LB, unconverted: true };
    case 'CAD_KG':
      if (fxRate) return { value: amount / fxRate, unconverted: false };
      return { value: amount, unconverted: true };
  }
}

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
    price_amount: '',
    price_unit: 'USD_LB',
    warehouse_location: '',
    notes: '',
    lot_id: null,
    purchase_line_id: null,
    importer_payment_terms_days: null,
    received: true,
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
  price_amount: string;
  price_unit: PriceUnit;
  warehouse_location: string;
  notes: string;
  lot_id: string | null;
  purchase_line_id: string | null;
  importer_payment_terms_days: number | null;
  received: boolean;
}

// Helper to parse original_prices from JSONB notes
interface OriginalPrice {
  lot_identifier: string;
  price_amount: number;
  price_unit: PriceUnit;
}

function parseOriginalPrices(notes: string | null): OriginalPrice[] {
  if (!notes) return [];
  try {
    const parsed = JSON.parse(notes);
    return parsed?.original_prices || [];
  } catch {
    return [];
  }
}

function purchaseLineToCoffeeLine(line: PurchaseLine, originalPrices: OriginalPrice[]): CoffeeLine {
  // Try to find original price for this line
  const orig = originalPrices.find(op => op.lot_identifier === (line.lot_identifier || ''));
  return {
    key: crypto.randomUUID(),
    lot_identifier: line.lot_identifier || '',
    origin_country: line.origin_country || '',
    region: line.region || '',
    producer: line.producer || '',
    variety: line.variety || '',
    crop_year: line.crop_year || '',
    category: line.category || 'BLENDER',
    bags: line.bags,
    bag_size_kg: line.bag_size_kg,
    price_amount: orig ? String(orig.price_amount) : (line.price_per_lb_usd != null ? String(line.price_per_lb_usd) : ''),
    price_unit: orig ? orig.price_unit : 'USD_LB',
    warehouse_location: line.warehouse_location || '',
    notes: line.notes || '',
    lot_id: line.lot_id || null,
    purchase_line_id: line.id,
    importer_payment_terms_days: null,
    received: true,
  };
}

// ─── Page Component ────────────────────────────────────────

export default function SourcingPurchases() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRow | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useViewMode('sourcing_view_purchases', 'list');

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
  const editingLines = editingPurchase ? (linesByPurchase[editingPurchase.id] || []) : [];

  const modalOpen = createOpen || !!editingPurchase;
  const handleModalClose = (o: boolean) => {
    if (!o) {
      setCreateOpen(false);
      setEditingPurchase(null);
    }
  };

  return (
    <>
      <GreenCoffeeAlerts />
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Purchases</h1>
          <div className="flex items-center gap-2">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New Purchase
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : purchases.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No purchases yet. Click "New Purchase" to get started.
            </CardContent>
          </Card>
        ) : viewMode === 'list' ? (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO #</TableHead>
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
                      <TableCell className="font-mono text-xs">{p.po_number || <span className="text-muted-foreground">—</span>}</TableCell>
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
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {purchases.map(p => {
              const lines = linesByPurchase[p.id] || [];
              const coffeeCount = lines.length;
              const totalKg = lines.reduce((sum, l) => sum + l.bags * l.bag_size_kg, 0);
              const overdue = p.due_date && isPast(parseISO(p.due_date));
              const vendor = allVendorMap[p.vendor_id];

              return (
                <Card key={p.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-base leading-tight">{vendor?.name || '—'}</p>
                      {p.invoice_number && (
                        <span className="text-xs text-muted-foreground font-mono shrink-0">{p.invoice_number}</span>
                      )}
                    </div>
                    {p.invoice_date && (
                      <p className="text-sm text-muted-foreground">
                        Invoiced {format(parseISO(p.invoice_date), 'MMM d, yyyy')}
                      </p>
                    )}
                    <p className="text-sm">{coffeeCount} {coffeeCount === 1 ? 'coffee' : 'coffees'} · {totalKg > 0 ? `${totalKg.toLocaleString()} kg` : '—'}</p>
                    {p.due_date && (
                      <p className={cn('text-xs', overdue ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
                        Due {format(parseISO(p.due_date), 'MMM d, yyyy')}{overdue && ' (overdue)'}
                      </p>
                    )}
                    <div className="pt-1">
                      <Button size="sm" variant="outline" onClick={() => setSelectedId(p.id)}>View</Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      <CreatePurchaseModal
        open={modalOpen}
        onOpenChange={handleModalClose}
        vendors={vendors}
        existingPurchase={editingPurchase || undefined}
        existingLines={editingPurchase ? editingLines : undefined}
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
              onDeleted={() => {
                setSelectedId(null);
                queryClient.invalidateQueries({ queryKey: ['green-purchases'] });
                queryClient.invalidateQueries({ queryKey: ['green-purchase-lines'] });
              }}
              onEdit={() => {
                setSelectedId(null);
                setEditingPurchase(selectedPurchase);
              }}
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
  onDeleted,
  onEdit,
}: {
  purchase: PurchaseRow;
  lines: PurchaseLine[];
  vendor: Vendor | undefined;
  onDeleted: () => void;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const { isAdmin, isOps } = useAuth();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [addCoffeeOpen, setAddCoffeeOpen] = useState(false);
  const totalKg = lines.reduce((sum, l) => sum + l.bags * l.bag_size_kg, 0);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error: linesErr } = await supabase
        .from('green_purchase_lines')
        .delete()
        .eq('purchase_id', purchase.id);
      if (linesErr) throw linesErr;

      const { error: purchaseErr } = await supabase
        .from('green_purchases')
        .delete()
        .eq('id', purchase.id);
      if (purchaseErr) throw purchaseErr;

      toast.success('Purchase deleted');
      onDeleted();
    } catch (err: any) {
      toast.error(`Delete failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setDeleting(false);
    }
  };

  // Try to parse structured shared costs from notes
  const sc = parseSharedCostsFromNotes(purchase.notes);

  // Build display costs: prefer JSONB, fall back to legacy columns
  const costLines: { label: string; amount: number; currency: string }[] = [];
  if (sc) {
    if (sc.carry && sc.carry.amount > 0) costLines.push({ label: 'Carry / Storage', amount: sc.carry.amount, currency: sc.carry.currency });
    if (sc.freight && sc.freight.amount > 0) costLines.push({ label: 'Freight', amount: sc.freight.amount, currency: sc.freight.currency });
    if (sc.duties && sc.duties.amount > 0) costLines.push({ label: 'Customs / Duties / Taxes', amount: sc.duties.amount, currency: sc.duties.currency });
    if (sc.fees && sc.fees.amount > 0) costLines.push({ label: 'Fees', amount: sc.fees.amount, currency: sc.fees.currency });
    if (sc.other && sc.other.amount > 0) costLines.push({ label: sc.other.label || 'Other', amount: sc.other.amount, currency: sc.other.currency });
  } else {
    if (purchase.shared_carry_usd > 0) costLines.push({ label: 'Carry / Storage', amount: purchase.shared_carry_usd, currency: 'USD' });
    if (purchase.shared_freight_usd > 0) costLines.push({ label: 'Freight', amount: purchase.shared_freight_usd, currency: 'USD' });
    if (purchase.shared_other_usd > 0) costLines.push({ label: purchase.shared_other_label || 'Other', amount: purchase.shared_other_usd, currency: 'USD' });
  }

  let displayNotes = purchase.notes || '';
  try {
    const parsed = JSON.parse(displayNotes);
    displayNotes = parsed?.notes_text || '';
  } catch { /* not JSON, use as-is */ }

  return (
    <div className="space-y-6 pt-4">
      {/* Action buttons — ADMIN/OPS */}
      {(isAdmin || isOps) && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit Purchase
          </Button>
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" /> Delete Purchase
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this purchase?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will not delete the lots that were already created from it. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Deleting…' : 'Delete'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}

      {/* Header fields */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">PO Number</p>
          <p className="font-mono font-semibold">{purchase.po_number || '—'}</p>
        </div>
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
      {costLines.length > 0 && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Shared Costs</h3>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {costLines.map((cl, i) => (
              <div key={i}>
                <p className="text-muted-foreground text-xs">{cl.label} ({cl.currency})</p>
                <p>${cl.amount.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {displayNotes && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-1">Notes</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{displayNotes}</p>
        </div>
      )}

      {/* Coffee lines */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Coffees ({lines.length})</h3>
          {(isAdmin || isOps) && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddCoffeeOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Coffee
            </Button>
          )}
        </div>
        <div className="space-y-3">
          {lines.map(line => {
            const lineKg = line.bags * line.bag_size_kg;
            const share = totalKg > 0 ? lineKg / totalKg : 0;

            const costShares: { label: string; value: string }[] = [];
            if (sc) {
              if (sc.carry && sc.carry.amount > 0) costShares.push({ label: `Carry (${sc.carry.currency})`, value: `$${(sc.carry.amount * share).toFixed(2)}` });
              if (sc.freight && sc.freight.amount > 0) costShares.push({ label: `Freight (${sc.freight.currency})`, value: `$${(sc.freight.amount * share).toFixed(2)}` });
              if (sc.duties && sc.duties.amount > 0) costShares.push({ label: `Duties (${sc.duties.currency})`, value: `$${(sc.duties.amount * share).toFixed(2)}` });
              if (sc.fees && sc.fees.amount > 0) costShares.push({ label: `Fees (${sc.fees.currency})`, value: `$${(sc.fees.amount * share).toFixed(2)}` });
              if (sc.other && sc.other.amount > 0) costShares.push({ label: `${sc.other.label || 'Other'} (${sc.other.currency})`, value: `$${(sc.other.amount * share).toFixed(2)}` });
            } else {
              if (purchase.shared_freight_usd > 0) costShares.push({ label: 'Freight', value: `$${(purchase.shared_freight_usd * share).toFixed(2)}` });
              if (purchase.shared_carry_usd > 0) costShares.push({ label: 'Carry', value: `$${(purchase.shared_carry_usd * share).toFixed(2)}` });
              if (purchase.shared_other_usd > 0) costShares.push({ label: 'Other', value: `$${(purchase.shared_other_usd * share).toFixed(2)}` });
            }

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
                  {costShares.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      {costShares.map((cs, i) => (
                        <span key={i}>{cs.label}: {cs.value}</span>
                      ))}
                    </div>
                  )}
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

      {/* Add Coffee Line Modal */}
      <AddCoffeeLineModal
        open={addCoffeeOpen}
        onOpenChange={setAddCoffeeOpen}
        purchase={purchase}
        vendor={vendor}
        existingLineCount={lines.length}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['green-purchase-lines'] });
          queryClient.invalidateQueries({ queryKey: ['green-lots'] });
          queryClient.invalidateQueries({ queryKey: ['green-lots-all'] });
        }}
      />
    </div>
  );
}

// ─── Create Purchase Modal ─────────────────────────────────

function CreatePurchaseModal({
  open,
  onOpenChange,
  vendors,
  existingPurchase,
  existingLines,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendors: Vendor[];
  existingPurchase?: PurchaseRow;
  existingLines?: PurchaseLine[];
}) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const isEdit = !!existingPurchase;

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [vendorId, setVendorId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<Date | undefined>();
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [fxRate, setFxRate] = useState('');
  const [sharedCosts, setSharedCosts] = useState<SharedCosts>(makeDefaultSharedCosts('CAD'));
  const [headerNotes, setHeaderNotes] = useState('');

  // Step 2 lines
  const [lines, setLines] = useState<CoffeeLine[]>([emptyLine()]);

  // Before You Save state
  const [confirmCosting, setConfirmCosting] = useState(true);
  const [markPaid, setMarkPaid] = useState(false);
  const [paidDate, setPaidDate] = useState<Date | undefined>(new Date());

  // React to FX rate changes — update default currencies for lines that haven't been manually toggled
  const prevFxRef = React.useRef('');
  React.useEffect(() => {
    const cur = defaultCurrency(fxRate);
    const prevCur = defaultCurrency(prevFxRef.current);
    if (cur !== prevCur) {
      setSharedCosts(prev => ({
        carry: { ...prev.carry, currency: prev.carry.amount === '0' || prev.carry.amount === '' ? cur : prev.carry.currency },
        freight: { ...prev.freight, currency: prev.freight.amount === '0' || prev.freight.amount === '' ? cur : prev.freight.currency },
        duties: { ...prev.duties, currency: prev.duties.amount === '0' || prev.duties.amount === '' ? cur : prev.duties.currency },
        fees: { ...prev.fees, currency: prev.fees.amount === '0' || prev.fees.amount === '' ? cur : prev.fees.currency },
        other: { ...prev.other, currency: prev.other.amount === '0' || prev.other.amount === '' ? cur : prev.other.currency },
      }));
    }
    prevFxRef.current = fxRate;
  }, [fxRate]);

  // Reset / pre-fill on open
  React.useEffect(() => {
    if (!open) return;
    setStep(1);

    if (existingPurchase) {
      // Edit mode: pre-fill from existing purchase
      setVendorId(existingPurchase.vendor_id);
      setInvoiceNumber(existingPurchase.invoice_number || '');
      setInvoiceDate(existingPurchase.invoice_date ? parseISO(existingPurchase.invoice_date) : undefined);
      setDueDate(existingPurchase.due_date ? parseISO(existingPurchase.due_date) : undefined);
      setFxRate(existingPurchase.fx_rate != null ? String(existingPurchase.fx_rate) : '');

      // Parse shared costs from JSONB notes
      const sc = parseSharedCostsFromNotes(existingPurchase.notes);
      if (sc) {
        setSharedCosts({
          carry: { amount: String(sc.carry?.amount ?? 0), currency: (sc.carry?.currency as Currency) || 'CAD' },
          freight: { amount: String(sc.freight?.amount ?? 0), currency: (sc.freight?.currency as Currency) || 'CAD' },
          duties: { amount: String(sc.duties?.amount ?? 0), currency: (sc.duties?.currency as Currency) || 'CAD' },
          fees: { amount: String(sc.fees?.amount ?? 0), currency: (sc.fees?.currency as Currency) || 'CAD' },
          other: { amount: String(sc.other?.amount ?? 0), currency: (sc.other?.currency as Currency) || 'CAD', label: sc.other?.label || '' },
        });
      } else {
        setSharedCosts({
          carry: { amount: String(existingPurchase.shared_carry_usd), currency: 'USD' },
          freight: { amount: String(existingPurchase.shared_freight_usd), currency: 'USD' },
          duties: { amount: '0', currency: 'CAD' },
          fees: { amount: '0', currency: 'CAD' },
          other: { amount: String(existingPurchase.shared_other_usd), currency: 'USD', label: existingPurchase.shared_other_label || '' },
        });
      }

      // Parse notes text
      let notesText = existingPurchase.notes || '';
      try { notesText = JSON.parse(notesText)?.notes_text || ''; } catch { /* not JSON */ }
      setHeaderNotes(notesText);

      // Pre-fill lines
      const originalPrices = parseOriginalPrices(existingPurchase.notes);
      if (existingLines && existingLines.length > 0) {
        setLines(existingLines.map(l => purchaseLineToCoffeeLine(l, originalPrices)));
      } else {
        setLines([emptyLine()]);
      }

      prevFxRef.current = existingPurchase.fx_rate != null ? String(existingPurchase.fx_rate) : '';
    } else {
      // Create mode: reset
      setVendorId('');
      setInvoiceNumber('');
      setInvoiceDate(undefined);
      setDueDate(undefined);
      setFxRate('');
      setSharedCosts(makeDefaultSharedCosts('CAD'));
      setHeaderNotes('');
      setLines([emptyLine()]);
      prevFxRef.current = '';
    }
    // Reset confirmation state
    setConfirmCosting(true);
    setMarkPaid(false);
    setPaidDate(new Date());
  }, [open, existingPurchase, existingLines]);

  const selectedVendor = vendors.find(v => v.id === vendorId);

  const updateLine = (key: string, field: keyof CoffeeLine, value: any) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  };

  const removeLine = (key: string) => {
    setLines(prev => prev.filter(l => l.key !== key));
  };

  const updateCost = (field: keyof SharedCosts, key: 'amount' | 'currency' | 'label', value: string) => {
    setSharedCosts(prev => ({
      ...prev,
      [field]: { ...prev[field], [key]: value },
    }));
  };

  // Proration calculations
  const carryNum = parseFloat(sharedCosts.carry.amount) || 0;
  const freightNum = parseFloat(sharedCosts.freight.amount) || 0;
  const dutiesNum = parseFloat(sharedCosts.duties.amount) || 0;
  const feesNum = parseFloat(sharedCosts.fees.amount) || 0;
  const otherNum = parseFloat(sharedCosts.other.amount) || 0;
  const totalKgAll = lines.reduce((s, l) => s + (l.bags * l.bag_size_kg), 0);
  const hasAnyCost = carryNum > 0 || freightNum > 0 || dutiesNum > 0 || feesNum > 0 || otherNum > 0;

  const canCreate = lines.some(l => l.lot_identifier.trim() && l.bags > 0 && l.bag_size_kg > 0);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Build JSONB for notes field
      const sharedCostsJson = {
        carry: { amount: carryNum, currency: sharedCosts.carry.currency },
        freight: { amount: freightNum, currency: sharedCosts.freight.currency },
        duties: { amount: dutiesNum, currency: sharedCosts.duties.currency },
        fees: { amount: feesNum, currency: sharedCosts.fees.currency },
        other: { amount: otherNum, currency: sharedCosts.other.currency, label: sharedCosts.other.label.trim() },
      };

      // Build original_prices array for JSONB
      const originalPrices = lines
        .filter(l => l.lot_identifier.trim() && l.price_amount)
        .map(l => ({ lot_identifier: l.lot_identifier.trim(), price_amount: parseFloat(l.price_amount) || 0, price_unit: l.price_unit }));

      const notesPayload = JSON.stringify({
        shared_costs: sharedCostsJson,
        original_prices: originalPrices,
        notes_text: headerNotes.trim(),
      });

      const purchasePayload: any = {
        vendor_id: vendorId,
        invoice_number: invoiceNumber.trim() || null,
        invoice_date: invoiceDate ? format(invoiceDate, 'yyyy-MM-dd') : null,
        due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
        fx_rate: fxRate ? parseFloat(fxRate) : null,
        fx_rate_is_cad: false,
        shared_freight_usd: freightNum,
        shared_carry_usd: carryNum,
        shared_other_usd: otherNum,
        shared_other_label: sharedCosts.other.label.trim() || null,
        notes: notesPayload,
      };
      if (markPaid) {
        purchasePayload.paid_at = paidDate ? format(paidDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
      }

      const fxRateNum = fxRate ? parseFloat(fxRate) : null;
      let purchaseId: string;

      if (isEdit && existingPurchase) {
        // ── EDIT MODE ──
        const { error: updateErr } = await supabase
          .from('green_purchases')
          .update(purchasePayload as any)
          .eq('id', existingPurchase.id);
        if (updateErr) throw updateErr;
        purchaseId = existingPurchase.id;

        let newLotCount = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.lot_identifier.trim() || line.bags <= 0 || line.bag_size_kg <= 0) continue;

          const lineKg = line.bags * line.bag_size_kg;
          const priceAmt = parseFloat(line.price_amount) || 0;
          const converted = priceAmt > 0 ? convertToUsdPerLb(priceAmt, line.price_unit, fxRateNum) : null;

          if (line.lot_id && line.purchase_line_id) {
            // Existing line — UPDATE purchase line + lot
            const { error: plErr } = await supabase
              .from('green_purchase_lines')
              .update({
                lot_identifier: line.lot_identifier.trim(),
                origin_country: line.origin_country || null,
                region: line.region.trim() || null,
                producer: line.producer.trim() || null,
                variety: line.variety.trim() || null,
                crop_year: line.crop_year.trim() || null,
                category: line.category || null,
                bags: line.bags,
                bag_size_kg: line.bag_size_kg,
                price_per_lb_usd: converted ? converted.value : null,
                warehouse_location: line.warehouse_location.trim() || null,
                notes: line.notes.trim() || null,
                display_order: i,
              } as any)
              .eq('id', line.purchase_line_id);
            if (plErr) throw plErr;

            // Update linked lot (do NOT update kg_on_hand)
            const { error: lotUpErr } = await supabase
              .from('green_lots')
              .update({
                lot_identifier: line.lot_identifier.trim(),
                origin_country: line.origin_country || null,
                region: line.region.trim() || null,
                producer: line.producer.trim() || null,
                variety: line.variety.trim() || null,
                crop_year: line.crop_year.trim() || null,
                bags_released: line.bags,
                bag_size_kg: line.bag_size_kg,
                kg_received: lineKg,
                fx_rate: fxRateNum,
                warehouse_location: line.warehouse_location.trim() || null,
                notes_internal: line.notes.trim() || null,
              } as any)
              .eq('id', line.lot_id);
            if (lotUpErr) throw lotUpErr;
          } else {
            // New line — INSERT lot + purchase line (same as create mode)
            // Reuse this purchase's PO if it already has one; else allocate a fresh PO.
            const sharedPo = await poFromExisting(existingPurchase.po_number, selectedVendor?.abbreviation);
            // If the purchase didn't have a PO yet, persist the freshly allocated one.
            if (!existingPurchase.po_number) {
              await (supabase.from('green_purchases' as any) as any).update({ po_number: sharedPo.poNumber }).eq('id', purchaseId);
            }
            const lotNumber = await allocateSingleLotNumber(sharedPo, line.origin_country);
            const poNumber = sharedPo.poNumber;

            const freightAllocated = totalKgAll > 0 ? freightNum * (lineKg / totalKgAll) : 0;
            const carryAllocated = totalKgAll > 0 ? carryNum * (lineKg / totalKgAll) : 0;
            const otherAllocated = totalKgAll > 0 ? otherNum * (lineKg / totalKgAll) : 0;
            const freightCad = fxRateNum ? freightAllocated * fxRateNum : freightAllocated;

            const { data: lot, error: lotErr } = await supabase
              .from('green_lots')
              .insert({
                lot_number: lotNumber,
                lot_identifier: line.lot_identifier.trim(),
                contract_id: null as any,
                bags_released: line.bags,
                bag_size_kg: line.bag_size_kg,
                kg_received: lineKg,
                kg_on_hand: line.received ? lineKg : 0,
                status: (line.received ? 'RECEIVED' : 'EN_ROUTE') as any,
                costing_status: confirmCosting ? 'COMPLETE' : 'INCOMPLETE',
                fx_rate: fxRateNum,
                freight_cad: freightCad,
                carry_fees_usd: carryAllocated,
                other_costs_cad: fxRateNum ? otherAllocated * fxRateNum : otherAllocated,
                warehouse_location: line.warehouse_location.trim() || null,
                notes_internal: line.notes.trim() || null,
                created_by: authUser!.id,
                purchase_id: purchaseId,
              } as any)
              .select('id')
              .single();
            if (lotErr) throw lotErr;

            const lotUpdateFields: any = {
              po_number: poNumber,
              vendor_invoice_number: invoiceNumber.trim() || null,
              importer_payment_terms_days: line.importer_payment_terms_days || null,
              received_date: line.received ? format(new Date(), 'yyyy-MM-dd') : null,
            };
            if (confirmCosting) {
              const now = new Date().toISOString();
              lotUpdateFields.costing_status = 'COMPLETE';
              lotUpdateFields.invoice_confirmed_at = now;
              lotUpdateFields.invoice_confirmed_by = authUser!.id;
              lotUpdateFields.fx_rate_confirmed_at = now;
              lotUpdateFields.fx_rate_confirmed_by = authUser!.id;
              lotUpdateFields.carry_fees_confirmed_at = now;
              lotUpdateFields.carry_fees_confirmed_by = authUser!.id;
              lotUpdateFields.freight_confirmed_at = now;
              lotUpdateFields.freight_confirmed_by = authUser!.id;
            }
            const { error: updateErr } = await (supabase.from('green_lots' as any) as any).update(lotUpdateFields as any).eq('id', lot.id);
            if (updateErr) throw updateErr;

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
                price_per_lb_usd: converted ? converted.value : null,
                warehouse_location: line.warehouse_location.trim() || null,
                notes: line.notes.trim() || null,
                lot_id: lot.id,
                display_order: i,
              } as any);
            if (lineErr) throw lineErr;
            newLotCount++;
          }
        }

        return { mode: 'edit' as const, newLotCount };
      } else {
        // ── CREATE MODE ──
        // Allocate one PO for the whole purchase (atomic)
        const po = await allocatePoNumber(selectedVendor?.abbreviation);

        const { data: purchase, error: purchaseErr } = await supabase
          .from('green_purchases')
          .insert({
            ...purchasePayload,
            po_number: po.poNumber,
            created_by: authUser!.id,
          } as any)
          .select('id')
          .single();
        if (purchaseErr) throw purchaseErr;
        purchaseId = purchase.id;

        let lotCount = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.lot_identifier.trim() || line.bags <= 0 || line.bag_size_kg <= 0) continue;

          const lineKg = line.bags * line.bag_size_kg;
          const share = totalKgAll > 0 ? lineKg / totalKgAll : 0;
          const freightAllocated = freightNum * share;
          const carryAllocated = carryNum * share;
          const otherAllocated = otherNum * share;
          const dutiesAllocated = dutiesNum * share;
          const feesAllocated = feesNum * share;

          // Generate lot number under the just-allocated PO for this purchase
          const lotNumber = await allocateSingleLotNumber(po, line.origin_country);
          const poNumber = po.poNumber;

          const priceAmt = parseFloat(line.price_amount) || 0;
          const converted = priceAmt > 0 ? convertToUsdPerLb(priceAmt, line.price_unit, fxRateNum) : null;
          const invoiceAmountUsd = converted ? converted.value * lineKg * KG_PER_LB : null;

          const freightCad = sharedCosts.freight.currency === 'USD' && fxRateNum ? freightAllocated * fxRateNum : freightAllocated;

          const { data: lot, error: lotErr } = await supabase
            .from('green_lots')
            .insert({
              lot_number: lotNumber,
              lot_identifier: line.lot_identifier.trim(),
              contract_id: null as any,
              bags_released: line.bags,
              bag_size_kg: line.bag_size_kg,
              kg_received: lineKg,
              kg_on_hand: line.received ? lineKg : 0,
              status: (line.received ? 'RECEIVED' : 'EN_ROUTE') as any,
              costing_status: confirmCosting ? 'COMPLETE' : 'INCOMPLETE',
              expected_delivery_date: null,
              received_date: line.received ? format(new Date(), 'yyyy-MM-dd') : null,
              fx_rate: fxRateNum,
              invoice_amount_usd: invoiceAmountUsd,
              invoice_amount_cad: invoiceAmountUsd != null ? (fxRateNum ? invoiceAmountUsd * fxRateNum : invoiceAmountUsd) : null,
              invoice_is_usd: fxRateNum ? true : false,
              freight_cad: freightCad,
              carry_fees_cad: sharedCosts.carry.currency === 'USD' && fxRateNum ? carryAllocated * fxRateNum : carryAllocated,
              duties_cad: sharedCosts.duties.currency === 'USD' && fxRateNum ? dutiesAllocated * fxRateNum : dutiesAllocated,
              transaction_fees_cad: sharedCosts.fees.currency === 'USD' && fxRateNum ? feesAllocated * fxRateNum : feesAllocated,
              other_costs_cad: sharedCosts.other.currency === 'USD' && fxRateNum ? otherAllocated * fxRateNum : otherAllocated,
              warehouse_location: line.warehouse_location.trim() || null,
              notes_internal: line.notes.trim() || null,
              created_by: authUser!.id,
              purchase_id: purchaseId,
              po_number: poNumber,
              vendor_invoice_number: invoiceNumber.trim() || null,
              importer_payment_terms_days: line.importer_payment_terms_days || null,
            } as any)
            .select('id')
            .single();
          if (lotErr) throw lotErr;

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
              price_per_lb_usd: converted ? converted.value : null,
              warehouse_location: line.warehouse_location.trim() || null,
              notes: line.notes.trim() || null,
              lot_id: lot.id,
              display_order: i,
            } as any);
          if (lineErr) throw lineErr;
          lotCount++;
        }

        return { mode: 'create' as const, newLotCount: lotCount };
      }
    },
    onSuccess: (result) => {
      if (result.mode === 'edit') {
        const msg = result.newLotCount > 0
          ? `Purchase updated — ${result.newLotCount} new lot${result.newLotCount !== 1 ? 's' : ''} added`
          : 'Purchase updated';
        toast.success(msg);
      } else {
        toast.success(`Purchase created — ${result.newLotCount} lot${result.newLotCount !== 1 ? 's' : ''} added to inventory`);
      }
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ['green-purchases'] });
      queryClient.invalidateQueries({ queryKey: ['green-purchase-lines'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots-all'] });
      if (!isEdit) navigate('/sourcing/lots');
    },
    onError: (err: any) => {
      toast.error(`Failed to ${isEdit ? 'update' : 'create'} purchase: ${err?.message || 'Unknown error'}`);
    },
  });

  const titlePrefix = isEdit ? 'Edit Purchase' : 'New Purchase';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? `${titlePrefix} — Invoice Details` : `${titlePrefix} — Coffees (${selectedVendor?.name || ''}${invoiceNumber ? ` · ${invoiceNumber}` : ''})`}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
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
              <div className="space-y-2">
                {/* Carry / Storage */}
                <div>
                  <Label className="text-xs">Carry / Storage</Label>
                  <div className="flex gap-1.5 items-center">
                    <Input type="number" step="0.01" value={sharedCosts.carry.amount} onChange={e => updateCost('carry', 'amount', e.target.value)} className="flex-1" />
                    <CurrencyToggle value={sharedCosts.carry.currency} onChange={c => updateCost('carry', 'currency', c)} />
                  </div>
                </div>
                {/* Freight */}
                <div>
                  <Label className="text-xs">Freight</Label>
                  <div className="flex gap-1.5 items-center">
                    <Input type="number" step="0.01" value={sharedCosts.freight.amount} onChange={e => updateCost('freight', 'amount', e.target.value)} className="flex-1" />
                    <CurrencyToggle value={sharedCosts.freight.currency} onChange={c => updateCost('freight', 'currency', c)} />
                  </div>
                </div>
                {/* Customs / Duties / Taxes */}
                <div>
                  <Label className="text-xs">Customs / Duties / Taxes</Label>
                  <div className="flex gap-1.5 items-center">
                    <Input type="number" step="0.01" value={sharedCosts.duties.amount} onChange={e => updateCost('duties', 'amount', e.target.value)} className="flex-1" />
                    <CurrencyToggle value={sharedCosts.duties.currency} onChange={c => updateCost('duties', 'currency', c)} />
                  </div>
                </div>
                {/* Fees */}
                <div>
                  <Label className="text-xs">Fees</Label>
                  <div className="flex gap-1.5 items-center">
                    <Input type="number" step="0.01" value={sharedCosts.fees.amount} onChange={e => updateCost('fees', 'amount', e.target.value)} className="flex-1" />
                    <CurrencyToggle value={sharedCosts.fees.currency} onChange={c => updateCost('fees', 'currency', c)} />
                  </div>
                </div>
                {/* Other */}
                <div>
                  <Label className="text-xs">Other</Label>
                  <div className="flex gap-1.5 items-center">
                    <Input type="number" step="0.01" value={sharedCosts.other.amount} onChange={e => updateCost('other', 'amount', e.target.value)} className="w-28" />
                    <Input value={sharedCosts.other.label} onChange={e => updateCost('other', 'label', e.target.value)} placeholder="Label" className="flex-1" />
                    <CurrencyToggle value={sharedCosts.other.currency} onChange={c => updateCost('other', 'currency', c)} />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea value={headerNotes} onChange={e => setHeaderNotes(e.target.value)} rows={2} placeholder="Optional" />
            </div>

            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!vendorId} onClick={() => setStep(2)}>Next</Button>
            </DialogFooter>
          </>
        ) : (
          <>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Coffee line cards */}
            {lines.map((line, idx) => (
              <Card key={line.key} className="relative">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-muted-foreground">Coffee {idx + 1}</span>
                      <div className="inline-flex rounded-md border border-input overflow-hidden h-7">
                        <button
                          type="button"
                          className={cn(
                            'px-2 text-xs font-medium transition-colors',
                            line.received
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background text-muted-foreground hover:bg-muted'
                          )}
                          onClick={() => updateLine(line.key, 'received', true)}
                        >
                          Received
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'px-2 text-xs font-medium transition-colors border-l border-input',
                            !line.received
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background text-muted-foreground hover:bg-muted'
                          )}
                          onClick={() => updateLine(line.key, 'received', false)}
                        >
                          En Route
                        </button>
                      </div>
                    </div>
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
                      <Label className="text-xs">Price</Label>
                      <div className="flex gap-1.5">
                        <Input type="number" step="0.0001" value={line.price_amount} onChange={e => updateLine(line.key, 'price_amount', e.target.value)} placeholder="0.0000" className="flex-1" />
                        <Select value={line.price_unit} onValueChange={(v: PriceUnit) => updateLine(line.key, 'price_unit', v)}>
                          <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PRICE_UNIT_OPTIONS.map(o => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {(line.price_unit === 'CAD_LB' || line.price_unit === 'CAD_KG') && !fxRate.trim() && parseFloat(line.price_amount) > 0 && (
                        <p className="text-xs text-amber-600 mt-1">FX rate not set — CAD price stored unconverted</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Warehouse</Label>
                      <Input value={line.warehouse_location} onChange={e => updateLine(line.key, 'warehouse_location', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Payment Terms (days)</Label>
                      <Input type="number" value={line.importer_payment_terms_days ?? ''} onChange={e => updateLine(line.key, 'importer_payment_terms_days', e.target.value ? parseInt(e.target.value) || null : null)} placeholder="e.g. 30" />
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

            {/* Before You Save */}
            <div className="border-t pt-3 space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Before You Save</h4>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={confirmCosting} onCheckedChange={(v) => setConfirmCosting(!!v)} />
                  Costing is complete — lock pricing on created lots
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={markPaid} onCheckedChange={(v) => setMarkPaid(!!v)} />
                    Mark purchase as paid
                  </label>
                  {markPaid && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                          <CalendarIcon className="h-3 w-3" />
                          {paidDate ? format(paidDate, 'MMM d, yyyy') : 'Paid date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={paidDate} onSelect={setPaidDate} className="pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            </div>

            {/* Estimated Book Value Summary */}
            {(() => {
              const fxRateNum = fxRate ? parseFloat(fxRate) : null;
              const validLines = lines.filter(l => l.bags > 0 && l.bag_size_kg > 0 && parseFloat(l.price_amount) > 0);
              if (validLines.length === 0) return null;

              // Convert each shared cost to USD
              const toUsd = (amount: number, currency: Currency): number => {
                if (currency === 'USD') return amount;
                if (fxRateNum) return amount / fxRateNum;
                return amount; // used as-is
              };
              const totalSharedUsd = toUsd(carryNum, sharedCosts.carry.currency)
                + toUsd(freightNum, sharedCosts.freight.currency)
                + toUsd(dutiesNum, sharedCosts.duties.currency)
                + toUsd(feesNum, sharedCosts.fees.currency)
                + toUsd(otherNum, sharedCosts.other.currency);

              const hasCADWithoutFx = !fxRateNum && [
                sharedCosts.carry, sharedCosts.freight, sharedCosts.duties, sharedCosts.fees, sharedCosts.other
              ].some(c => c.currency === 'CAD' && parseFloat(c.amount) > 0);

              const hasCADPriceWithoutFx = !fxRateNum && validLines.some(l => l.price_unit === 'CAD_LB' || l.price_unit === 'CAD_KG');

              return (
                <div className="border rounded-lg p-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Estimated Book Value</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Coffee</TableHead>
                          <TableHead className="text-xs text-right">Total kg</TableHead>
                          <TableHead className="text-xs text-right">Price input</TableHead>
                          <TableHead className="text-xs text-right">Coffee cost (USD)</TableHead>
                          <TableHead className="text-xs text-right">Shared costs (USD)</TableHead>
                          <TableHead className="text-xs text-right">Total cost (USD)</TableHead>
                           <TableHead className="text-xs text-right">Book $/kg (USD)</TableHead>
                           <TableHead className="text-xs text-right">Book $/lb (USD)</TableHead>
                           {fxRateNum > 0 && <TableHead className="text-xs text-right">Book $/kg (CAD)</TableHead>}
                           {fxRateNum > 0 && <TableHead className="text-xs text-right">Book $/lb (CAD)</TableHead>}
                         </TableRow>
                       </TableHeader>
                       <TableBody>
                        {lines.map((l, idx) => {
                          const lkg = l.bags * l.bag_size_kg;
                          const priceAmt = parseFloat(l.price_amount) || 0;
                          if (lkg <= 0 || priceAmt <= 0) return null;

                          const usdPerKg = convertToUsdPerKg(priceAmt, l.price_unit, fxRateNum);
                          const coffeeCostUsd = usdPerKg.value * lkg;
                          const share = totalKgAll > 0 ? lkg / totalKgAll : 0;
                          const sharedCostUsd = totalSharedUsd * share;
                          const totalCostUsd = coffeeCostUsd + sharedCostUsd;
                          const bookPerKg = lkg > 0 ? totalCostUsd / lkg : 0;
                          const bookPerLb = bookPerKg / KG_PER_LB;

                          return (
                            <TableRow key={l.key}>
                              <TableCell className="text-xs">{l.lot_identifier || `Coffee ${idx + 1}`}</TableCell>
                              <TableCell className="text-xs text-right">{lkg.toLocaleString()}</TableCell>
                              <TableCell className="text-xs text-right">${priceAmt.toFixed(4)} {PRICE_UNIT_LABELS[l.price_unit]}</TableCell>
                              <TableCell className="text-xs text-right">${coffeeCostUsd.toFixed(2)}</TableCell>
                              <TableCell className="text-xs text-right">${sharedCostUsd.toFixed(2)}</TableCell>
                              <TableCell className="text-xs text-right">${totalCostUsd.toFixed(2)}</TableCell>
                              <TableCell className="text-xs text-right">${bookPerKg.toFixed(4)}</TableCell>
                              <TableCell className="text-xs text-right">${bookPerLb.toFixed(4)}</TableCell>
                              {fxRateNum > 0 && <TableCell className="text-xs text-right">${(bookPerKg * fxRateNum).toFixed(4)}</TableCell>}
                              {fxRateNum > 0 && <TableCell className="text-xs text-right">${(bookPerLb * fxRateNum).toFixed(4)}</TableCell>}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {(hasCADWithoutFx || hasCADPriceWithoutFx) && (
                    <p className="text-xs text-amber-600 mt-2">FX rate not set — CAD amounts used as-is in USD column</p>
                  )}
                </div>
              );
            })()}

            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={!canCreate || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save Changes' : 'Create Purchase & Lots')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Coffee Line Modal ────────────────────────────────

function AddCoffeeLineModal({
  open,
  onOpenChange,
  purchase,
  vendor,
  existingLineCount,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  purchase: PurchaseRow;
  vendor: Vendor | undefined;
  existingLineCount: number;
  onSuccess: () => void;
}) {
  const { authUser } = useAuth();
  const [saving, setSaving] = useState(false);

  const [lotIdentifier, setLotIdentifier] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [region, setRegion] = useState('');
  const [producer, setProducer] = useState('');
  const [variety, setVariety] = useState('');
  const [cropYear, setCropYear] = useState('');
  const [category, setCategory] = useState('BLENDER');
  const [bags, setBags] = useState(0);
  const [bagSizeKg, setBagSizeKg] = useState(0);
  const [priceAmount, setPriceAmount] = useState('');
  const [priceUnit, setPriceUnit] = useState<PriceUnit>('USD_LB');
  const [warehouseLocation, setWarehouseLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState<number | null>(null);

  React.useEffect(() => {
    if (open) {
      setLotIdentifier('');
      setOriginCountry('');
      setRegion('');
      setProducer('');
      setVariety('');
      setCropYear('');
      setCategory('BLENDER');
      setBags(0);
      setBagSizeKg(0);
      setPriceAmount('');
      setPriceUnit('USD_LB');
      setWarehouseLocation('');
      setNotes('');
      setPaymentTermsDays(null);
    }
  }, [open]);

  const fxRateNum = purchase.fx_rate ? Number(purchase.fx_rate) : null;
  const canSave = lotIdentifier.trim() && bags > 0 && bagSizeKg > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const lineKg = bags * bagSizeKg;
      const priceAmt = parseFloat(priceAmount) || 0;
      const converted = priceAmt > 0 ? convertToUsdPerLb(priceAmt, priceUnit, fxRateNum) : null;

      // Reuse this purchase's PO if present; else allocate one and persist back to the purchase.
      const sharedPo = await poFromExisting(purchase.po_number, vendor?.abbreviation);
      if (!purchase.po_number) {
        await (supabase.from('green_purchases' as any) as any).update({ po_number: sharedPo.poNumber }).eq('id', purchase.id);
      }
      const lotNumber = await allocateSingleLotNumber(sharedPo, originCountry);
      const poNumber = sharedPo.poNumber;

      // Insert lot
      const { data: lot, error: lotErr } = await supabase
        .from('green_lots')
        .insert({
          lot_number: lotNumber,
          lot_identifier: lotIdentifier.trim(),
          contract_id: null as any,
          bags_released: bags,
          bag_size_kg: bagSizeKg,
          kg_received: lineKg,
          kg_on_hand: lineKg,
          status: 'EN_ROUTE' as any,
          costing_status: 'INCOMPLETE',
          fx_rate: fxRateNum,
          warehouse_location: warehouseLocation.trim() || null,
          notes_internal: notes.trim() || null,
          created_by: authUser!.id,
          purchase_id: purchase.id,
        } as any)
        .select('id')
        .single();

      if (lotErr) throw lotErr;

      const { error: updateErr } = await (supabase.from('green_lots' as any) as any).update({
        origin_country: originCountry || null,
        region: region.trim() || null,
        producer: producer.trim() || null,
        variety: variety.trim() || null,
        crop_year: cropYear.trim() || null,
        price_per_lb_usd: converted ? converted.value : null,
        po_number: poNumber,
        vendor_invoice_number: purchase.invoice_number || null,
        importer_payment_terms_days: paymentTermsDays || null,
      } as any).eq('id', lot.id);
      if (updateErr) {
        console.error('Lot field update error:', updateErr);
      }

      // Insert purchase line
      const { error: lineErr } = await supabase
        .from('green_purchase_lines')
        .insert({
          purchase_id: purchase.id,
          lot_identifier: lotIdentifier.trim(),
          origin_country: originCountry || null,
          region: region.trim() || null,
          producer: producer.trim() || null,
          variety: variety.trim() || null,
          crop_year: cropYear.trim() || null,
          category: category || null,
          bags,
          bag_size_kg: bagSizeKg,
          price_per_lb_usd: converted ? converted.value : null,
          warehouse_location: warehouseLocation.trim() || null,
          notes: notes.trim() || null,
          lot_id: lot.id,
          display_order: existingLineCount,
        } as any);

      if (lineErr) throw lineErr;

      toast.success('Coffee line added — lot created');
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(`Failed to add coffee: ${err?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Coffee Line</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Lot Identifier *</Label>
              <Input value={lotIdentifier} onChange={e => setLotIdentifier(e.target.value)} placeholder="e.g. Estrellas de Aji" />
            </div>
            <div>
              <Label className="text-xs">Origin Country</Label>
              <Select value={originCountry} onValueChange={setOriginCountry}>
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
              <Input value={region} onChange={e => setRegion(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Producer</Label>
              <Input value={producer} onChange={e => setProducer(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Variety</Label>
              <Input value={variety} onChange={e => setVariety(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Crop Year</Label>
              <Input value={cropYear} onChange={e => setCropYear(e.target.value)} placeholder="e.g. 2024" />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
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
              <Input type="number" value={bags || ''} onChange={e => setBags(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label className="text-xs">Bag Size (kg) *</Label>
              <Input type="number" step="0.1" value={bagSizeKg || ''} onChange={e => setBagSizeKg(parseFloat(e.target.value) || 0)} placeholder="e.g. 69" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Price</Label>
              <div className="flex gap-1.5">
                <Input type="number" step="0.0001" value={priceAmount} onChange={e => setPriceAmount(e.target.value)} placeholder="0.0000" className="flex-1" />
                <Select value={priceUnit} onValueChange={(v: PriceUnit) => setPriceUnit(v)}>
                  <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRICE_UNIT_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(priceUnit === 'CAD_LB' || priceUnit === 'CAD_KG') && !fxRateNum && parseFloat(priceAmount) > 0 && (
                <p className="text-xs text-amber-600 mt-1">FX rate not set — CAD price stored unconverted</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Warehouse</Label>
              <Input value={warehouseLocation} onChange={e => setWarehouseLocation(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Payment Terms (days)</Label>
              <Input type="number" value={paymentTermsDays ?? ''} onChange={e => setPaymentTermsDays(e.target.value ? parseInt(e.target.value) || null : null)} placeholder="e.g. 30" />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSave || saving} onClick={handleSave}>
            {saving ? 'Adding…' : 'Add Coffee & Create Lot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
