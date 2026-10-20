import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, ChevronDown, ChevronRight, Eye, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

const sb = supabase as any;

interface PreviewLine {
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  fate: 'product' | 'skip' | 'quarantine';
  reason: string | null;
  productId: string | null;
  productName: string | null;
  bagSizeG: number | null;
  units: number;
  grindLabel: string | null;
}
interface PreviewOrder {
  id: string;
  name: string;
  createdAt: string | null;
  customerName: string | null;
  note?: string | null;
  tags?: string[];
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  shippingTitle?: string | null;
  lines: PreviewLine[];
}
interface SourcePreview {
  source_id: string;
  store_slug: string;
  result: string;
  error?: string;
  orders_retrieved: number;
  preview?: { orders: PreviewOrder[]; pickup_ready_skipped: string[]; notes: string[] };
}

const sizeLabel = (g: number | null) =>
  !g ? '' : g >= 1000 && g % 1000 === 0 ? `${g / 1000}kg` : `${g}g`;

export default function ShopifyFetchReview() {
  const qc = useQueryClient();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(false);
  const [committing, setCommitting] = React.useState(false);
  const [previews, setPreviews] = React.useState<SourcePreview[] | null>(null);
  const [omit, setOmit] = React.useState<Set<string>>(new Set()); // `${source}|${order}`
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  const sourcesQ = useQuery({
    queryKey: ['shopify-review', 'sources'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_sources')
        .select('id, store_name, store_slug')
        .eq('is_active', true)
        .order('store_name');
      if (error) throw error;
      const rows = (data ?? []) as { id: string; store_name: string; store_slug: string }[];
      const withLast = await Promise.all(
        rows.map(async (s) => {
          const { data: l } = await sb
            .from('shopify_pull_log')
            .select('attempted_at, trigger_type, result')
            .eq('source_id', s.id)
            .order('attempted_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          return { ...s, last: l as { attempted_at: string; trigger_type: string; result: string } | null };
        }),
      );
      return withLast;
    },
  });

  const skippedQ = useQuery({
    queryKey: ['shopify-review', 'skipped'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_skipped_orders')
        .select('id, source_id, shopify_order_number, customer_name, skipped_at, line_items')
        .order('skipped_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as {
        id: string; source_id: string; shopify_order_number: string | null;
        customer_name: string | null; skipped_at: string;
        line_items: { title: string; variant_title: string | null; quantity: number }[] | null;
      }[];
    },
  });

  const sourceName = (id: string) => sourcesQ.data?.find((s) => s.id === id)?.store_name ?? 'Store';

  const toggle = (set: Set<string>, key: string) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  };

  const runPreview = async () => {
    const ids = [...selected];
    if (ids.length === 0) return toast.info('Pick at least one store');
    setLoading(true);
    setOmit(new Set());
    try {
      const out: SourcePreview[] = [];
      for (const id of ids) {
        const { data, error } = await supabase.functions.invoke('shopify-pull-orders', {
          body: { mode: 'preview', source_id: id },
        });
        if (error) throw error;
        out.push(...((data?.results ?? []) as SourcePreview[]));
      }
      setPreviews(out);
    } catch (e: any) {
      toast.error(e?.message ?? 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!previews) return;
    setCommitting(true);
    try {
      for (const p of previews) {
        if (!p.preview || p.preview.orders.length === 0) continue;
        const exclude = p.preview.orders.filter((o) => omit.has(`${p.source_id}|${o.id}`)).map((o) => o.id);
        const { data, error } = await supabase.functions.invoke('shopify-pull-orders', {
          body: { mode: 'commit', source_id: p.source_id, exclude_order_ids: exclude },
        });
        if (error) throw error;
        for (const r of (data?.results ?? []) as any[]) {
          const msg = `${sourceName(r.source_id)}: ${r.orders_included} order${r.orders_included === 1 ? '' : 's'} bundled${r.order_number ? ` into ${r.order_number}` : ''}${exclude.length ? `, ${exclude.length} skipped` : ''}`;
          if (r.result === 'error') toast.error(`${msg} (${r.error})`);
          else if (r.result === 'partial') toast.warning(`${msg} — some lines need mapping`);
          else toast.success(msg);
        }
      }
      setPreviews(null);
      setOmit(new Set());
      qc.invalidateQueries({ queryKey: ['shopify-review'] });
      qc.invalidateQueries({ queryKey: ['shopify-fetch', 'last_pull'] });
      qc.invalidateQueries({ queryKey: ['shopify-quarantine'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e: any) {
      toast.error(e?.message ?? 'Create failed');
    } finally {
      setCommitting(false);
    }
  };

  const unskip = async (id: string) => {
    const { error } = await sb.from('shopify_skipped_orders').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Un-skipped — it will come in on the next fetch');
    qc.invalidateQueries({ queryKey: ['shopify-review', 'skipped'] });
  };

  // Live totals across kept orders.
  const totals = React.useMemo(() => {
    const byProduct = new Map<string, { name: string; units: number; grams: number }>();
    let kept = 0;
    let omitted = 0;
    for (const p of previews ?? []) {
      for (const o of p.preview?.orders ?? []) {
        if (omit.has(`${p.source_id}|${o.id}`)) { omitted++; continue; }
        kept++;
        for (const l of o.lines) {
          if (l.fate !== 'product' || !l.productId) continue;
          const key = `${l.productId}|${l.grindLabel ?? ''}`;
          const e = byProduct.get(key) ?? {
            name: `${l.productName ?? 'Product'} ${sizeLabel(l.bagSizeG)}${l.grindLabel ? ` · ${l.grindLabel}` : ''}`,
            units: 0, grams: 0,
          };
          e.units += l.units;
          e.grams += l.units * (l.bagSizeG ?? 0);
          byProduct.set(key, e);
        }
      }
    }
    const rows = [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { kept, omitted, rows, units: rows.reduce((n, r) => n + r.units, 0), kg: rows.reduce((n, r) => n + r.grams, 0) / 1000 };
  }, [previews, omit]);

  const anyOrders = (previews ?? []).some((p) => (p.preview?.orders.length ?? 0) > 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link to="/orders"><ArrowLeft className="mr-1 h-4 w-4" />Orders</Link></Button>
        <h1 className="text-2xl font-semibold text-foreground">Shopify Fetch Review</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Preview what a fetch would bring in, leave out any orders you don't want, then create the bundled order.
        Nothing is created until you press Create order.
      </p>

      <section className="rounded-lg border border-border p-4 space-y-3">
        <div className="text-sm font-semibold text-foreground">1. Choose store(s)</div>
        <div className="flex flex-wrap gap-3">
          {(sourcesQ.data ?? []).map((s) => (
            <div
              key={s.id}
              role="checkbox"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setSelected(toggle(selected, s.id)); } }}
              aria-checked={selected.has(s.id)}
              aria-label={s.store_name}
              onClick={() => setSelected(toggle(selected, s.id))}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-muted/50"
            >
              <Checkbox checked={selected.has(s.id)} tabIndex={-1} className="pointer-events-none mt-0.5" />
              <div>
                <div className="text-sm font-medium text-foreground">{s.store_name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.last?.attempted_at
                    ? `Last fetch ${format(new Date(s.last.attempted_at), 'PPp')} · ${s.last.trigger_type === 'scheduled' ? 'auto' : 'manual'}${s.last.result !== 'success' ? ` · ${s.last.result}` : ''}`
                    : 'Never fetched'}
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button onClick={runPreview} disabled={loading || selected.size === 0}>
          <Eye className="mr-2 h-4 w-4" />{loading ? 'Reading Shopify…' : 'Preview fetch'}
        </Button>
      </section>

      {previews && (
        <section className="space-y-4">
          <div className="text-sm font-semibold text-foreground">2. Review orders</div>
          {previews.map((p) => (
            <div key={p.source_id} className="rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
                <div className="font-medium text-foreground">{sourceName(p.source_id)}</div>
                <div className="text-xs text-muted-foreground">
                  {p.result === 'error' ? <span className="text-destructive">{p.error}</span> : `${p.preview?.orders.length ?? 0} new order(s)`}
                </div>
              </div>
              {(p.preview?.pickup_ready_skipped.length ?? 0) > 0 && (
                <div className="px-4 py-2 text-xs text-muted-foreground">
                  Already ready for pickup / collected (left out automatically): {p.preview!.pickup_ready_skipped.join(', ')}
                </div>
              )}
              {(p.preview?.notes ?? []).map((n, i) => (
                <div key={i} className="px-4 py-1 text-xs text-muted-foreground">Note: {n}</div>
              ))}
              {p.preview?.orders.length === 0 && (
                <div className="px-4 py-4 text-sm text-muted-foreground">Nothing new to bring in.</div>
              )}
              <ul className="divide-y divide-border">
                {(p.preview?.orders ?? []).map((o) => {
                  const key = `${p.source_id}|${o.id}`;
                  const omitted = omit.has(key);
                  const isOpen = open.has(key);
                  const units = o.lines.reduce((n, l) => n + l.units, 0);
                  const unmapped = o.lines.filter((l) => l.fate === 'quarantine').length;
                  return (
                    <li key={o.id} className={omitted ? 'bg-muted/30' : ''}>
                      <div className="flex items-center gap-3 px-4 py-2">
                        <Checkbox
                          checked={!omitted}
                          onCheckedChange={() => setOmit(toggle(omit, key))}
                          aria-label={omitted ? `Include ${o.name}` : `Omit ${o.name}`}
                        />
                        <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setOpen(toggle(open, key))}>
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span className={`font-medium text-foreground ${omitted ? 'line-through opacity-60' : ''}`}>{o.name}</span>
                          <span className={`text-sm text-muted-foreground ${omitted ? 'line-through opacity-60' : ''}`}>
                            {o.customerName ?? 'Customer hidden'}
                            {o.createdAt ? ` · ${format(new Date(o.createdAt), 'MMM d, p')}` : ''}
                          </span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {o.shippingTitle && <Badge variant="outline">{o.shippingTitle}</Badge>}
                            {unmapped > 0 && <Badge variant="destructive">{unmapped} needs mapping</Badge>}
                            {omitted ? <Badge variant="secondary">Omitted</Badge> : units === 0 && unmapped === 0 ? 'Nothing to make' : `${units} bag${units === 1 ? '' : 's'}`}
                          </span>
                        </button>
                      </div>
                      {isOpen && (
                        <div className="space-y-2 bg-muted/20 px-12 pb-3 pt-1 text-sm">
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {o.financialStatus && <span>Payment: {o.financialStatus.toLowerCase().replace(/_/g, ' ')}</span>}
                            {o.fulfillmentStatus && <span>Fulfillment: {o.fulfillmentStatus.toLowerCase().replace(/_/g, ' ')}</span>}
                            {o.shippingTitle && <span>Delivery: {o.shippingTitle}</span>}
                            {(o.tags?.length ?? 0) > 0 && <span>Tags: {o.tags!.join(', ')}</span>}
                          </div>
                          {o.note && <div className="rounded border border-border bg-background px-2 py-1 text-xs">Note: {o.note}</div>}
                          <table className="w-full text-xs">
                            <thead className="text-muted-foreground">
                              <tr><th className="py-1 text-left font-normal">Shopify item</th><th className="text-left font-normal">SKU</th><th className="text-right font-normal">Qty</th><th className="pl-4 text-left font-normal">In JIM</th></tr>
                            </thead>
                            <tbody>
                              {o.lines.map((l, i) => (
                                <tr key={i} className="border-t border-border">
                                  <td className="py-1 text-foreground">{l.title}{l.variantTitle ? ` / ${l.variantTitle}` : ''}</td>
                                  <td className="text-muted-foreground">{l.sku ?? '—'}</td>
                                  <td className="text-right text-foreground">{l.quantity}</td>
                                  <td className="pl-4">
                                    {l.fate === 'product' ? (
                                      <span className="text-foreground">
                                        {l.units} × {l.productName} {sizeLabel(l.bagSizeG)}
                                        {l.grindLabel && <Badge className="ml-2" variant="outline">GRIND · {l.grindLabel}</Badge>}
                                      </span>
                                    ) : l.fate === 'skip' ? (
                                      <span className="text-muted-foreground">Not produced (set to skip)</span>
                                    ) : (
                                      <span className="text-destructive">Needs mapping — goes to the review list</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {anyOrders && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="text-sm font-semibold text-foreground">3. Create order</div>
              <div className="text-sm text-muted-foreground">
                {totals.kept} order(s) kept · {totals.omitted} omitted · {totals.units} bags · {totals.kg.toFixed(2)} kg
              </div>
              {totals.rows.length > 0 && (
                <ul className="text-sm">
                  {totals.rows.map((r) => (
                    <li key={r.name} className="flex justify-between border-t border-border py-1">
                      <span className="text-foreground">{r.name}</span>
                      <span className="text-muted-foreground">{r.units} · {(r.grams / 1000).toFixed(2)} kg</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Button onClick={commit} disabled={committing}>{committing ? 'Creating…' : 'Create order'}</Button>
                <Button variant="ghost" onClick={runPreview} disabled={loading || committing}>
                  <RotateCcw className="mr-2 h-4 w-4" />Refresh preview
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Omitted orders are remembered and won't come back on later fetches (manual or automatic). Un-skip them below.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border p-4 space-y-2">
        <div className="text-sm font-semibold text-foreground">Skipped orders</div>
        {(skippedQ.data ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground">None.</div>
        ) : (
          <ul className="divide-y divide-border">
            {skippedQ.data!.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-medium text-foreground">{s.shopify_order_number}</span>
                <span className="text-muted-foreground">{sourceName(s.source_id)} · {s.customer_name ?? 'Customer hidden'}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {(s.line_items ?? []).map((l) => `${l.quantity}× ${l.title}${l.variant_title ? ` / ${l.variant_title}` : ''}`).join(', ')}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">skipped {format(new Date(s.skipped_at), 'MMM d, p')}</span>
                <Button size="sm" variant="ghost" onClick={() => unskip(s.id)}><Undo2 className="mr-1 h-3 w-3" />Un-skip</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
