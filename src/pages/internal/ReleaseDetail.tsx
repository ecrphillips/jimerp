import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ArrowLeft, CalendarIcon, Save, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPerKg, formatPerLb } from '@/lib/formatMoney';
import {
  Currency,
  SharedCostsJson,
  SHARED_COST_KEYS,
  SharedCostKey,
  SHARED_COST_LABELS,
  KG_PER_LB,
  emptySharedCosts,
  totalSharedCostsUsd,
  bookValuePerKgUsd,
  bookValuePerLbUsd,
  statusBadgeClass,
} from '@/components/sourcing/releases/releaseUtils';

interface ReleaseRow {
  id: string;
  vendor_id: string | null;
  status: string;
  invoice_number: string | null;
  po_number: string | null;
  eta_date: string | null;
  received_date: string | null;
  arrival_status: string;
  shared_costs: SharedCostsJson;
  notes: string | null;
  created_at: string;
}

interface LineRow {
  id: string;
  release_id: string;
  contract_id: string | null;
  lot_id: string | null;
  bags_requested: number;
  bag_size_kg: number;
  price_per_lb_usd: number | null;
  original_price: any;
  notes: string | null;
}

interface LotRow {
  id: string;
  lot_number: string;
  contract_id: string | null;
  release_id: string | null;
  bags_released: number;
  bag_size_kg: number;
  kg_on_hand: number;
  book_value_per_kg: number | null;
  status: string;
  received_date: string | null;
  expected_delivery_date: string | null;
}

export default function ReleaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [editInvoice, setEditInvoice] = useState('');
  const [editEta, setEditEta] = useState<Date | undefined>();
  const [editReceived, setEditReceived] = useState<Date | undefined>();
  const [editArrival, setEditArrival] = useState<'EN_ROUTE' | 'RECEIVED'>('EN_ROUTE');
  const [editNotes, setEditNotes] = useState('');
  const [editShared, setEditShared] = useState<SharedCostsJson>(emptySharedCosts('USD'));

  const { data: release } = useQuery({
    queryKey: ['green-release', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('green_releases').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as ReleaseRow;
    },
    enabled: !!id,
  });

  const { data: vendor } = useQuery({
    queryKey: ['green-vendor', release?.vendor_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('green_vendors').select('id, name').eq('id', release!.vendor_id!).single();
      if (error) throw error;
      return data as { id: string; name: string };
    },
    enabled: !!release?.vendor_id,
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['green-release-lines', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('green_release_lines').select('*').eq('release_id', id!);
      if (error) throw error;
      return data as LineRow[];
    },
    enabled: !!id,
  });

  const lotIds = lines.map(l => l.lot_id).filter(Boolean) as string[];
  const { data: lots = [] } = useQuery({
    queryKey: ['green-lots-by-release', id, lotIds],
    queryFn: async () => {
      if (lotIds.length === 0) return [] as LotRow[];
      const { data, error } = await supabase
        .from('green_lots')
        .select('id, lot_number, contract_id, release_id, bags_released, bag_size_kg, kg_on_hand, book_value_per_kg, status, received_date, expected_delivery_date')
        .in('id', lotIds);
      if (error) throw error;
      return data as LotRow[];
    },
    enabled: lotIds.length > 0,
  });

  const contractIds = lines.map(l => l.contract_id).filter(Boolean) as string[];
  const { data: contracts = [] } = useQuery({
    queryKey: ['green-contracts-by-ids', contractIds],
    queryFn: async () => {
      if (contractIds.length === 0) return [];
      const { data, error } = await supabase
        .from('green_contracts')
        .select('id, name, internal_contract_number, vendor_contract_number, origin_country, origin')
        .in('id', contractIds);
      if (error) throw error;
      return data as any[];
    },
    enabled: contractIds.length > 0,
  });

  const contractMap = useMemo(() => {
    const m: Record<string, any> = {};
    contracts.forEach(c => m[c.id] = c);
    return m;
  }, [contracts]);

  // Hydrate edit state when release loads
  useEffect(() => {
    if (!release) return;
    setEditInvoice(release.invoice_number || '');
    setEditEta(release.eta_date ? parseISO(release.eta_date) : undefined);
    setEditReceived(release.received_date ? parseISO(release.received_date) : undefined);
    setEditArrival((release.arrival_status as any) || 'EN_ROUTE');
    setEditNotes(release.notes || '');
    const sc = release.shared_costs || {};
    const merged = emptySharedCosts('USD');
    SHARED_COST_KEYS.forEach(k => {
      if (sc[k]) merged[k] = { amount: Number(sc[k]?.amount) || 0, currency: (sc[k]?.currency as Currency) || 'USD' };
    });
    setEditShared(merged);
  }, [release]);

  const totalKg = lines.reduce((s, l) => s + (l.bags_requested || 0) * Number(l.bag_size_kg || 0), 0);
  const totalSharedUsd = totalSharedCostsUsd(editShared);
  const sharedShareUsdPerKg = totalKg > 0 ? totalSharedUsd / totalKg : 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const newStatus = editInvoice.trim() ? 'INVOICED' : (release?.status === 'INVOICED' ? 'INVOICED' : 'PENDING');

      const { error } = await supabase
        .from('green_releases')
        .update({
          invoice_number: editInvoice.trim() || null,
          eta_date: editEta ? format(editEta, 'yyyy-MM-dd') : null,
          received_date: editReceived ? format(editReceived, 'yyyy-MM-dd') : null,
          arrival_status: editArrival,
          notes: editNotes.trim() || null,
          shared_costs: editShared as any,
          status: newStatus,
        })
        .eq('id', id!);
      if (error) throw error;

      // Compute per-bucket totals for currency-aware proration
      const bucketTotals = SHARED_COST_KEYS.reduce<Record<SharedCostKey, { usd: number; cad: number }>>((acc, k) => {
        const line = editShared[k];
        const amt = Number(line?.amount) || 0;
        const cur = (line?.currency || 'USD') as Currency;
        acc[k] = { usd: cur === 'USD' ? amt : 0, cad: cur === 'CAD' ? amt : 0 };
        return acc;
      }, {} as any);

      // Push recalculated cost allocations + arrival/dates to every linked lot
      for (const l of lines) {
        if (!l.lot_id) continue;
        const lineKg = (l.bags_requested || 0) * Number(l.bag_size_kg || 0);
        const kgShare = totalKg > 0 ? lineKg / totalKg : 0;
        const priceUsdPerLb = Number(l.price_per_lb_usd) || 0;
        const coffeeCostUsd = priceUsdPerLb > 0 ? priceUsdPerLb * KG_PER_LB * lineKg : null;

        const lotCarryUsd = bucketTotals.carry.usd * kgShare;
        const lotCarryCad = bucketTotals.carry.cad * kgShare;
        const lotFreightCad = (bucketTotals.freight.usd + bucketTotals.freight.cad) * kgShare;
        const lotDutiesCad = (bucketTotals.duties.usd + bucketTotals.duties.cad) * kgShare;
        const lotFeesCad = (bucketTotals.fees.usd + bucketTotals.fees.cad) * kgShare;
        const lotOtherCad = (bucketTotals.other.usd + bucketTotals.other.cad) * kgShare;

        const newBookKg = bookValuePerKgUsd(l.price_per_lb_usd, sharedShareUsdPerKg);

        const lotPatch: any = {
          // Arrival
          status: editArrival === 'RECEIVED' ? 'RECEIVED' : 'EN_ROUTE',
          // Costs (mirror USD into *_cad with fx_rate=1 placeholder for surfacing on the lot detail panel)
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
          book_value_per_kg: newBookKg > 0 ? newBookKg : null,
          market_value_per_kg: newBookKg > 0 ? newBookKg : null,
        };

        if (editArrival === 'RECEIVED' && editReceived) {
          lotPatch.received_date = format(editReceived, 'yyyy-MM-dd');
          lotPatch.kg_on_hand = (l.bags_requested || 0) * Number(l.bag_size_kg || 0);
          lotPatch.kg_received = (l.bags_requested || 0) * Number(l.bag_size_kg || 0);
        }
        if (editEta) lotPatch.expected_delivery_date = format(editEta, 'yyyy-MM-dd');
        if (editInvoice.trim()) {
          lotPatch.costing_status = 'COMPLETE';
          lotPatch.costing_complete = true;
        }
        await supabase.from('green_lots').update(lotPatch).eq('id', l.lot_id);
      }
    },
    onSuccess: () => {
      toast.success('Release updated');
      queryClient.invalidateQueries({ queryKey: ['green-release', id] });
      queryClient.invalidateQueries({ queryKey: ['green-releases'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots-by-release'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-lot-detail'] });
    },
    onError: (err: any) => toast.error(`Save failed: ${err?.message || 'Unknown error'}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Clear release_id on lots first (ON DELETE SET NULL would handle this, but be explicit)
      await supabase.from('green_lots').update({ release_id: null }).eq('release_id', id!);
      const { error } = await supabase.from('green_releases').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Release deleted');
      queryClient.invalidateQueries({ queryKey: ['green-releases'] });
      navigate('/sourcing/releases');
    },
    onError: (err: any) => toast.error(`Delete failed: ${err?.message || 'Unknown error'}`),
  });

  if (!release) {
    return <div className="p-6 max-w-6xl mx-auto"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }

  const lotMap: Record<string, LotRow> = {};
  lots.forEach(l => lotMap[l.id] = l);

  // Summary row
  const totalBags = lines.reduce((s, l) => s + (l.bags_requested || 0), 0);
  const weightedBookKgSum = lines.reduce((acc, l) => {
    const lineKg = (l.bags_requested || 0) * Number(l.bag_size_kg || 0);
    const bookKg = bookValuePerKgUsd(l.price_per_lb_usd, sharedShareUsdPerKg);
    return acc + bookKg * lineKg;
  }, 0);
  const wAvgBookKg = totalKg > 0 ? weightedBookKgSum / totalKg : 0;
  const wAvgBookLb = wAvgBookKg / 2.20462;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/sourcing/releases')}>
          <ArrowLeft className="h-4 w-4" /> Back to Releases
        </Button>
        <div className="flex items-center gap-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-1.5">
            <Save className="h-4 w-4" /> {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-1.5">
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this release?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The {lines.length} linked lot{lines.length === 1 ? '' : 's'} will have their release link cleared but will not be deleted. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Header */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{vendor?.name || 'Release'}</h1>
            {release.po_number && (
              <Badge variant="outline" className="font-mono text-sm">{release.po_number}</Badge>
            )}
            <Badge variant="outline" className={statusBadgeClass(release.status)}>{release.status}</Badge>
            <span className="text-xs text-muted-foreground ml-auto">Created {format(parseISO(release.created_at), 'MMM d, yyyy')}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <Label>Invoice Number</Label>
              <Input
                value={editInvoice}
                onChange={(e) => setEditInvoice(e.target.value)}
                placeholder="e.g. INV-12345"
              />
              <p className="text-xs text-muted-foreground mt-1">Setting this marks the release as Invoiced.</p>
            </div>

            <div>
              <Label>ETA Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !editEta && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {editEta ? format(editEta, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={editEta} onSelect={setEditEta} initialFocus className={cn('p-3 pointer-events-auto')} />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Received Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !editReceived && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {editReceived ? format(editReceived, 'PPP') : 'Not yet received'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={editReceived} onSelect={setEditReceived} initialFocus className={cn('p-3 pointer-events-auto')} />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Arrival Status (all lots)</Label>
              <Select value={editArrival} onValueChange={(v) => setEditArrival(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EN_ROUTE">En Route</SelectItem>
                  <SelectItem value="RECEIVED">Received</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shared Costs */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="text-lg font-semibold">Shared Costs</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {SHARED_COST_KEYS.map(key => (
              <div key={key}>
                <Label className="text-xs">{SHARED_COST_LABELS[key]}</Label>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    step="0.01"
                    value={editShared[key]?.amount ?? 0}
                    onChange={(e) => setEditShared(prev => ({
                      ...prev,
                      [key]: { amount: parseFloat(e.target.value) || 0, currency: prev[key]?.currency || 'USD' },
                    }))}
                    className="h-9"
                  />
                  <Select
                    value={editShared[key]?.currency || 'USD'}
                    onValueChange={(v) => setEditShared(prev => ({
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
          <p className="text-xs text-muted-foreground">Saving recalculates the prorated shared cost on all linked lots (weighted by kg).</p>
        </CardContent>
      </Card>

      {/* Lots table */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="text-lg font-semibold">Lots ({lines.length})</h2>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot #</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead className="text-right">Bags</TableHead>
                  <TableHead className="text-right">Total kg</TableHead>
                  <TableHead className="text-right">Coffee $/lb</TableHead>
                  <TableHead className="text-right">Shared $/kg</TableHead>
                  <TableHead className="text-right">Book $/kg</TableHead>
                  <TableHead className="text-right">Book $/lb</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => {
                  const lot = l.lot_id ? lotMap[l.lot_id] : null;
                  const contract = l.contract_id ? contractMap[l.contract_id] : null;
                  const lineKg = (l.bags_requested || 0) * Number(l.bag_size_kg || 0);
                  const bookKg = bookValuePerKgUsd(l.price_per_lb_usd, sharedShareUsdPerKg);
                  const bookLb = bookValuePerLbUsd(l.price_per_lb_usd, sharedShareUsdPerKg);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{lot?.lot_number || '—'}</TableCell>
                      <TableCell className="text-sm">{contract?.origin_country || contract?.origin || '—'}</TableCell>
                      <TableCell className="text-right">{l.bags_requested}</TableCell>
                      <TableCell className="text-right">{lineKg.toLocaleString()} kg</TableCell>
                      <TableCell className="text-right">{l.price_per_lb_usd != null ? formatPerLb(Number(l.price_per_lb_usd), 'USD') : '—'}</TableCell>
                      <TableCell className="text-right">{formatPerKg(sharedShareUsdPerKg, 'USD')}</TableCell>
                      <TableCell className="text-right font-medium">{formatPerKg(bookKg, 'USD')}</TableCell>
                      <TableCell className="text-right">{formatPerLb(bookLb, 'USD')}</TableCell>
                      <TableCell>{lot ? <Badge variant="outline" className="text-xs">{lot.status}</Badge> : '—'}</TableCell>
                      <TableCell>
                        {l.lot_id && (
                          <Button size="sm" variant="link" className="gap-1 p-0 h-auto" onClick={() => navigate(`/sourcing/lots?lot=${l.lot_id}`)}>
                            <ExternalLink className="h-3 w-3" /> Lot
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <tfoot className="bg-muted/30 border-t font-medium text-sm">
                <tr>
                  <td className="p-2"></td>
                  <td className="p-2 text-right">Total</td>
                  <td className="p-2 text-right">{totalBags}</td>
                  <td className="p-2 text-right">{totalKg.toLocaleString()} kg</td>
                  <td className="p-2"></td>
                  <td className="p-2 text-right">{formatPerKg(sharedShareUsdPerKg, 'USD')}</td>
                  <td className="p-2 text-right">{formatPerKg(wAvgBookKg, 'USD')}</td>
                  <td className="p-2 text-right">{formatPerLb(wAvgBookLb, 'USD')}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
