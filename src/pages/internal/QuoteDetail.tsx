import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  RefreshCw,
  Trash2,
  Copy,
  Edit,
  DollarSign,
  AlertTriangle,
  Send,
  CheckCircle2,
  Undo2,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { calculatePrice, type PricingInputs } from '@/lib/pricing';
import { formatMoney } from '@/lib/formatMoney';
import { marginColour, marginClass } from '@/lib/quoteConstants';
import { lotLeadLabel, type LotForLabel } from '@/components/quotes/lotLabel';
import { useGreenLotsForPicker } from '@/hooks/useGreenLotsForPicker';
import { GreenSourceModal, type GreenSourceValue } from '@/components/quotes/GreenSourceModal';
import {
  ProductPackagingModal,
  type ProductPackagingValue,
} from '@/components/quotes/ProductPackagingModal';
import { TierProfileModal, type TierProfileValue } from '@/components/quotes/TierProfileModal';
import {
  PriceOverrideModal,
  type PriceOverrideValue,
} from '@/components/quotes/PriceOverrideModal';
import type { PackagingVariant } from '@/components/PackagingBadge';

type Line = {
  id: string;
  quote_id: string;
  display_order: number;
  green_lot_id: string | null;
  blend_components: Array<{ lot_id: string; ratio_pct: number }> | null;
  product_id: string | null;
  packaging_variant: PackagingVariant;
  bag_size_g: number;
  quantity_bags: number;
  tier_id_override: string | null;
  profile_id_override: string | null;
  calc_total_cost_per_bag: number | null;
  calc_list_price_per_bag: number | null;
  calc_final_price_per_bag: number | null;
  calc_margin_pct: number | null;
  calc_payload: any;
  calc_warnings: string[] | null;
  calc_at: string | null;
  final_price_per_bag_override: number | null;
  override_reason: string | null;
  line_notes: string | null;
};

type Quote = {
  id: string;
  quote_number: string;
  account_id: string | null;
  prospect_id: string | null;
  status: string;
  sent_at: string | null;
  accepted_at: string | null;
  title: string | null;
  internal_notes: string | null;
  customer_notes: string | null;
  valid_until: string | null;
  accounts: { account_name: string } | null;
  prospects: { business_name: string } | null;
};

const sb: any = supabase;

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();

  const { data: lots } = useGreenLotsForPicker();
  const lotById = useMemo(() => {
    const m: Record<string, LotForLabel> = {};
    (lots ?? []).forEach((l) => { m[l.id] = l; });
    return m;
  }, [lots]);

  const { data: quote, isLoading } = useQuery({
    queryKey: ['quote', id],
    queryFn: async () => {
      const { data, error } = await sb
        .from('quotes')
        .select(`
          id, quote_number, account_id, prospect_id, status, sent_at, accepted_at,
          title, internal_notes, customer_notes, valid_until,
          accounts ( account_name ),
          prospects ( business_name )
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Quote;
    },
    enabled: !!id,
  });

  const { data: lines } = useQuery({
    queryKey: ['quote-lines', id],
    queryFn: async () => {
      const { data, error } = await sb
        .from('quote_line_items')
        .select('*')
        .eq('quote_id', id)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Line[];
    },
    enabled: !!id,
  });

  const { data: tiers } = useQuery({
    queryKey: ['quote-detail-tiers'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('pricing_tiers')
        .select('id, name, is_default')
        .order('display_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const tierById = useMemo(() => {
    const m: Record<string, any> = {};
    (tiers ?? []).forEach((t: any) => { m[t.id] = t; });
    return m;
  }, [tiers]);
  const defaultTier = useMemo(() => (tiers ?? []).find((t: any) => t.is_default), [tiers]);

  // Local header form state (synced when quote loads)
  const [headerTitle, setHeaderTitle] = useState('');
  const [headerValidUntil, setHeaderValidUntil] = useState('');
  const [headerInternal, setHeaderInternal] = useState('');
  const [headerCustomer, setHeaderCustomer] = useState('');
  const [headerDirty, setHeaderDirty] = useState(false);

  useEffect(() => {
    if (!quote) return;
    setHeaderTitle(quote.title ?? '');
    setHeaderValidUntil(quote.valid_until ?? '');
    setHeaderInternal(quote.internal_notes ?? '');
    setHeaderCustomer(quote.customer_notes ?? '');
    setHeaderDirty(false);
  }, [quote]);

  const saveHeader = useMutation({
    mutationFn: async () => {
      const { error } = await sb
        .from('quotes')
        .update({
          title: headerTitle.trim() || null,
          valid_until: headerValidUntil || null,
          internal_notes: headerInternal.trim() || null,
          customer_notes: headerCustomer.trim() || null,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Quote saved');
      setHeaderDirty(false);
      qc.invalidateQueries({ queryKey: ['quote', id] });
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  // ---- Modal state per line ----
  const [greenModalLine, setGreenModalLine] = useState<Line | null>(null);
  const [productModalLine, setProductModalLine] = useState<Line | null>(null);
  const [tierModalLine, setTierModalLine] = useState<Line | null>(null);
  const [priceModalLine, setPriceModalLine] = useState<Line | null>(null);
  const [deleteLineId, setDeleteLineId] = useState<string | null>(null);

  // ---- Recalc / save line helpers ----
  const recalcLine = async (line: Line): Promise<Partial<Line>> => {
    if (!quote) throw new Error('Quote not loaded');
    const greenInput =
      line.green_lot_id
        ? { lot_id: line.green_lot_id }
        : line.blend_components
        ? { blend: line.blend_components }
        : null;
    if (!greenInput) throw new Error('No green source set');

    const inputs: PricingInputs = {
      green: greenInput as any,
      bag_size_g: line.bag_size_g,
      packaging_variant: line.packaging_variant,
      product_id: line.product_id ?? undefined,
      account_id: quote.account_id ?? undefined,
      tier_id_override: line.tier_id_override ?? undefined,
      profile_id_override: line.profile_id_override ?? undefined,
    };

    const r = await calculatePrice(supabase, inputs);
    return {
      calc_total_cost_per_bag: r.total_cost_per_bag,
      calc_list_price_per_bag: r.list_price_per_bag,
      calc_final_price_per_bag: r.final_price_per_bag,
      calc_margin_pct: r.margin_pct,
      calc_payload: r as any,
      calc_warnings: r.warnings,
      calc_at: new Date().toISOString(),
    };
  };

  const updateLine = useMutation({
    mutationFn: async ({ lineId, patch, recalc }: { lineId: string; patch: Partial<Line>; recalc: boolean }) => {
      let updates: Partial<Line> = { ...patch };
      if (recalc) {
        const cur = (lines ?? []).find((l) => l.id === lineId);
        if (!cur) throw new Error('Line not found');
        const merged = { ...cur, ...patch } as Line;
        try {
          const calcPatch = await recalcLine(merged);
          updates = { ...updates, ...calcPatch };
        } catch (e: any) {
          updates = {
            ...updates,
            calc_warnings: [`Recalc failed: ${e.message}`],
            calc_at: new Date().toISOString(),
          };
        }
      }
      const { error } = await sb.from('quote_line_items').update(updates).eq('id', lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quote-lines', id] });
    },
    onError: (e: any) => toast.error(`Update failed: ${e.message}`),
  });

  const addLine = useMutation({
    mutationFn: async () => {
      const last = (lines ?? [])[lines!.length - 1];
      const nextOrder = (lines ?? []).reduce((m, l) => Math.max(m, l.display_order), -1) + 1;
      const seed: any = {
        quote_id: id,
        display_order: nextOrder,
        // We must satisfy the green XOR check — start with an empty single-lot placeholder.
        // Use a sentinel lot_id we know exists? We don't. So instead, defer: use blend_components = []? That violates check.
        // Strategy: pick the first available lot id as a sane default.
        green_lot_id: null,
        blend_components: null,
        product_id: last?.product_id ?? null,
        packaging_variant: last?.packaging_variant ?? 'RETAIL_340G',
        bag_size_g: last?.bag_size_g ?? 340,
        quantity_bags: 1,
      };
      // To satisfy XOR, set green_lot_id to the first lot if available.
      if ((lots ?? []).length > 0) {
        seed.green_lot_id = lots![0].id;
      } else {
        throw new Error('No green lots available — create one first.');
      }
      const { data, error } = await sb
        .from('quote_line_items')
        .insert(seed)
        .select('*')
        .single();
      if (error) throw error;
      // Recalc immediately
      try {
        const calcPatch = await recalcLine(data as Line);
        await sb.from('quote_line_items').update(calcPatch).eq('id', data.id);
      } catch {
        /* ignore — line shows as un-calculated */
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quote-lines', id] });
      toast.success('Line added');
    },
    onError: (e: any) => toast.error(`Add line failed: ${e.message}`),
  });

  const duplicateLine = useMutation({
    mutationFn: async (line: Line) => {
      const nextOrder = (lines ?? []).reduce((m, l) => Math.max(m, l.display_order), -1) + 1;
      const { id: _omit, created_at: _c, updated_at: _u, ...rest } = line as any;
      const { error } = await sb
        .from('quote_line_items')
        .insert({ ...rest, display_order: nextOrder });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quote-lines', id] });
      toast.success('Line duplicated');
    },
    onError: (e: any) => toast.error(`Duplicate failed: ${e.message}`),
  });

  const deleteLine = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await sb.from('quote_line_items').delete().eq('id', lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quote-lines', id] });
      setDeleteLineId(null);
      toast.success('Line deleted');
    },
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });

  const reorderLine = useMutation({
    mutationFn: async ({ lineId, dir }: { lineId: string; dir: 'up' | 'down' }) => {
      const sorted = [...(lines ?? [])].sort((a, b) => a.display_order - b.display_order);
      const idx = sorted.findIndex((l) => l.id === lineId);
      if (idx === -1) return;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;
      const a = sorted[idx];
      const b = sorted[swapIdx];
      // Two-step swap to avoid uniqueness issues (we don't have a unique constraint, but stay safe)
      const { error: e1 } = await sb.from('quote_line_items').update({ display_order: b.display_order }).eq('id', a.id);
      if (e1) throw e1;
      const { error: e2 } = await sb.from('quote_line_items').update({ display_order: a.display_order }).eq('id', b.id);
      if (e2) throw e2;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quote-lines', id] }),
    onError: (e: any) => toast.error(`Reorder failed: ${e.message}`),
  });

  const recalcAll = useMutation({
    mutationFn: async () => {
      for (const line of lines ?? []) {
        try {
          const patch = await recalcLine(line);
          await sb.from('quote_line_items').update(patch).eq('id', line.id);
        } catch (e: any) {
          await sb
            .from('quote_line_items')
            .update({
              calc_warnings: [`Recalc failed: ${e.message}`],
              calc_at: new Date().toISOString(),
            })
            .eq('id', line.id);
        }
      }
    },
    onSuccess: () => {
      toast.success('All lines recalculated');
      qc.invalidateQueries({ queryKey: ['quote-lines', id] });
    },
    onError: (e: any) => toast.error(`Recalculate all failed: ${e.message}`),
  });

  // ---- Totals ----
  const totals = useMemo(() => {
    const list = lines ?? [];
    let bags = 0;
    let subtotal = 0;
    let cost = 0;
    for (const l of list) {
      const price = l.final_price_per_bag_override ?? l.calc_final_price_per_bag ?? 0;
      bags += Number(l.quantity_bags ?? 0);
      subtotal += Number(price) * Number(l.quantity_bags ?? 0);
      cost += Number(l.calc_total_cost_per_bag ?? 0) * Number(l.quantity_bags ?? 0);
    }
    const marginDollars = subtotal - cost;
    const marginPct = subtotal > 0 ? marginDollars / subtotal : 0;
    return { bags, subtotal, marginDollars, marginPct, count: list.length };
  }, [lines]);

  // ---- Render ----
  if (isLoading || !quote) {
    return <div className="container mx-auto p-6">Loading…</div>;
  }

  const recipientName =
    quote.accounts?.account_name ?? quote.prospects?.business_name ?? '—';
  const isProspect = !!quote.prospect_id;

  const greenSummary = (line: Line): string => {
    if (line.green_lot_id) {
      const lot = lotById[line.green_lot_id];
      if (lot) return lotLeadLabel(lot);
      return '(unknown lot)';
    }
    if (line.blend_components) {
      return `Blend (${line.blend_components.length} lots)`;
    }
    return '—';
  };

  const productSummary = (line: Line): string => {
    if (line.product_id) return `Product: ${line.packaging_variant} · ${line.bag_size_g}g`;
    return `Custom: ${line.packaging_variant} · ${line.bag_size_g}g`;
  };

  const tierSummary = (line: Line): { label: string; isDefault: boolean } => {
    if (line.tier_id_override && tierById[line.tier_id_override]) {
      return { label: tierById[line.tier_id_override].name, isDefault: false };
    }
    if (defaultTier) return { label: `Default (${defaultTier.name})`, isDefault: true };
    return { label: 'Default', isDefault: true };
  };

  const finalPrice = (l: Line): number | null => {
    if (l.final_price_per_bag_override != null) return Number(l.final_price_per_bag_override);
    return l.calc_final_price_per_bag != null ? Number(l.calc_final_price_per_bag) : null;
  };

  return (
    <TooltipProvider>
      <div className="container mx-auto p-6 max-w-6xl space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/accounts/quotes')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Quotes
        </Button>

        {/* Header card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="font-mono">{quote.quote_number}</CardTitle>
                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                  {recipientName}
                  {isProspect && <Badge variant="outline" className="text-xs">Prospect</Badge>}
                  <Badge variant="secondary">{quote.status}</Badge>
                </div>
              </div>
              {headerDirty && (
                <Button onClick={() => saveHeader.mutate()} disabled={saveHeader.isPending}>
                  Save changes
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isProspect && (
              <div className="rounded-md bg-muted p-3 text-sm">
                Prospect quotes use the default tier unless you override per line. Set per-line
                overrides to model what you'd actually charge.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Title</Label>
                <Input
                  value={headerTitle}
                  onChange={(e) => { setHeaderTitle(e.target.value); setHeaderDirty(true); }}
                />
              </div>
              <div>
                <Label>Valid until</Label>
                <Input
                  type="date"
                  value={headerValidUntil}
                  onChange={(e) => { setHeaderValidUntil(e.target.value); setHeaderDirty(true); }}
                />
              </div>
            </div>
            <div>
              <Label>Internal notes <span className="text-muted-foreground text-xs">(admin/ops only)</span></Label>
              <Textarea
                value={headerInternal}
                onChange={(e) => { setHeaderInternal(e.target.value); setHeaderDirty(true); }}
                rows={2}
              />
            </div>
            <div>
              <Label>Customer notes <span className="text-muted-foreground text-xs">(visible on customer-facing output)</span></Label>
              <Textarea
                value={headerCustomer}
                onChange={(e) => { setHeaderCustomer(e.target.value); setHeaderDirty(true); }}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Lines */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lines</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => recalcAll.mutate()}
                disabled={recalcAll.isPending || (lines?.length ?? 0) === 0}
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Recalculate all
              </Button>
              <Button size="sm" onClick={() => addLine.mutate()} disabled={addLine.isPending}>
                <Plus className="h-4 w-4 mr-1" /> Add line
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Green source</TableHead>
                  <TableHead>Product / Packaging</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Price/bag</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lines ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No lines yet. Add the first one.
                    </TableCell>
                  </TableRow>
                ) : (
                  (lines ?? []).map((line, idx) => {
                    const fp = finalPrice(line);
                    const subtotal = fp != null ? fp * Number(line.quantity_bags ?? 0) : null;
                    const tInfo = tierSummary(line);
                    const overridden = line.final_price_per_bag_override != null;
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-mono text-xs text-muted-foreground">{idx + 1}</span>
                            <div className="flex flex-col">
                              <Button variant="ghost" size="icon" className="h-5 w-5"
                                onClick={() => reorderLine.mutate({ lineId: line.id, dir: 'up' })}
                                disabled={idx === 0}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-5 w-5"
                                onClick={() => reorderLine.mutate({ lineId: line.id, dir: 'down' })}
                                disabled={idx === (lines?.length ?? 0) - 1}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <button
                            className="text-left underline-offset-2 hover:underline"
                            onClick={() => setGreenModalLine(line)}
                          >
                            {greenSummary(line)}
                          </button>
                          {(line.calc_warnings ?? []).length > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="inline-block h-3 w-3 ml-1 text-amber-500" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <ul className="text-xs list-disc list-inside">
                                  {(line.calc_warnings ?? []).map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>
                          <button
                            className="text-left underline-offset-2 hover:underline"
                            onClick={() => setProductModalLine(line)}
                          >
                            {productSummary(line)}
                          </button>
                        </TableCell>
                        <TableCell>{line.quantity_bags}</TableCell>
                        <TableCell>
                          <button
                            className="text-left"
                            onClick={() => setTierModalLine(line)}
                          >
                            <Badge variant={tInfo.isDefault ? 'outline' : 'default'}>
                              {tInfo.label}
                            </Badge>
                            {line.profile_id_override && (
                              <Badge variant="outline" className="ml-1 text-xs">profile</Badge>
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {overridden && line.calc_final_price_per_bag != null ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <span className="line-through text-muted-foreground text-xs mr-1">
                                    ${Number(line.calc_final_price_per_bag).toFixed(2)}
                                  </span>
                                  <span className="font-semibold">
                                    ${Number(line.final_price_per_bag_override).toFixed(2)}
                                  </span>
                                  <DollarSign className="inline h-3 w-3 ml-1 text-amber-500" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-xs">
                                  <div className="font-semibold">Price overridden</div>
                                  {line.override_reason && <div>{line.override_reason}</div>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ) : fp != null ? (
                            `$${fp.toFixed(2)}`
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${marginClass(marginColour(line.calc_margin_pct))}`}>
                          {line.calc_margin_pct != null
                            ? `${(Number(line.calc_margin_pct) * 100).toFixed(1)}%`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {subtotal != null ? formatMoney(subtotal) : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => updateLine.mutate({ lineId: line.id, patch: {}, recalc: true })}
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Recalculate</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => setPriceModalLine(line)}
                                >
                                  <DollarSign className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Override price</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => duplicateLine.mutate(line)}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Duplicate</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                  onClick={() => setDeleteLineId(line.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Totals footer */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Stat label="Lines" value={String(totals.count)} />
              <Stat label="Total bags" value={String(totals.bags)} />
              <Stat label="Subtotal" value={formatMoney(totals.subtotal)} />
              <Stat
                label="Aggregate margin %"
                value={`${(totals.marginPct * 100).toFixed(1)}%`}
                className={marginClass(marginColour(totals.marginPct))}
              />
              <Stat label="Aggregate margin $" value={formatMoney(totals.marginDollars)} />
            </div>
          </CardContent>
        </Card>

        {/* Modals */}
        {greenModalLine && (
          <GreenSourceModal
            open={!!greenModalLine}
            onOpenChange={(o) => !o && setGreenModalLine(null)}
            initial={
              greenModalLine.green_lot_id
                ? { mode: 'single', lot_id: greenModalLine.green_lot_id }
                : greenModalLine.blend_components
                ? { mode: 'blend', blend: greenModalLine.blend_components }
                : null
            }
            onSave={(v: GreenSourceValue) => {
              const patch: Partial<Line> =
                v.mode === 'single'
                  ? { green_lot_id: v.lot_id, blend_components: null }
                  : { green_lot_id: null, blend_components: v.blend };
              updateLine.mutate({ lineId: greenModalLine.id, patch, recalc: true });
              setGreenModalLine(null);
            }}
          />
        )}

        {productModalLine && (
          <ProductPackagingModal
            open={!!productModalLine}
            onOpenChange={(o) => !o && setProductModalLine(null)}
            initial={{
              product_id: productModalLine.product_id,
              packaging_variant: productModalLine.packaging_variant,
              bag_size_g: productModalLine.bag_size_g,
              quantity_bags: productModalLine.quantity_bags,
            }}
            accountIdFilter={quote.account_id ?? null}
            onSave={(v: ProductPackagingValue) => {
              updateLine.mutate({
                lineId: productModalLine.id,
                patch: {
                  product_id: v.product_id,
                  packaging_variant: v.packaging_variant,
                  bag_size_g: v.bag_size_g,
                  quantity_bags: v.quantity_bags,
                },
                recalc: true,
              });
              setProductModalLine(null);
            }}
          />
        )}

        {tierModalLine && (
          <TierProfileModal
            open={!!tierModalLine}
            onOpenChange={(o) => !o && setTierModalLine(null)}
            initial={{
              tier_id_override: tierModalLine.tier_id_override,
              profile_id_override: tierModalLine.profile_id_override,
            }}
            onSave={(v: TierProfileValue) => {
              updateLine.mutate({
                lineId: tierModalLine.id,
                patch: {
                  tier_id_override: v.tier_id_override,
                  profile_id_override: v.profile_id_override,
                },
                recalc: true,
              });
              setTierModalLine(null);
            }}
          />
        )}

        {priceModalLine && (
          <PriceOverrideModal
            open={!!priceModalLine}
            onOpenChange={(o) => !o && setPriceModalLine(null)}
            initial={{
              final_price_per_bag_override: priceModalLine.final_price_per_bag_override,
              override_reason: priceModalLine.override_reason,
            }}
            calcPrice={priceModalLine.calc_final_price_per_bag}
            onSave={(v: PriceOverrideValue) => {
              updateLine.mutate({
                lineId: priceModalLine.id,
                patch: {
                  final_price_per_bag_override: v.final_price_per_bag_override,
                  override_reason: v.override_reason,
                },
                recalc: false,
              });
              setPriceModalLine(null);
            }}
          />
        )}

        {/* Delete-line confirm */}
        {deleteLineId && (
          <DeleteLineDialog
            onConfirm={() => deleteLine.mutate(deleteLineId)}
            onCancel={() => setDeleteLineId(null)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${className ?? ''}`}>{value}</div>
    </div>
  );
}

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function DeleteLineDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <AlertDialog open onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete line?</AlertDialogTitle>
          <AlertDialogDescription>This removes the line from the quote.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
