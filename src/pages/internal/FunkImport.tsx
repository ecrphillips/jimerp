import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Upload, Check, ChevronsUpDown, ChevronDown, ChevronRight, Package, Box, AlertTriangle, Truck,
} from 'lucide-react';
import PackagingBadge from '@/components/PackagingBadge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  parseFunkCsv, classifyOrders, buildShipNowGroups, aggregateBatchMonths,
  parseBagSize, placeholderName, nextPlaceholderSeq, matchLineItem,
  funkReferenceBase, nextBusinessDayDeadline, slotProductName, dropShipDate,
  dateStamp, noonIso, dropBatchReference, monthShortYY, countGrindVariantLines,
  isGrindVariantName,
  type ProductLite, type MappingLite, type ReviewGroup, type Classification,
  type BatchClass, type BatchMonth, type CsvOrder,
} from '@/lib/funkCsvImport';

// funk_* tables + products.is_placeholder are not yet in the generated Supabase
// types (additive migrations, types not regenerated) — mirror the Shopify-pull
// pattern and cast through `any`.
const sb = supabase as any;

const errMsg = (e: unknown): string => {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null) {
    const a = e as any;
    return a.message ?? a.error_description ?? JSON.stringify(a);
  }
  return String(e);
};

// Ship-now group decision. `pending` = a guess the user has not yet confirmed.
type Resolution =
  | { status: 'product'; productId: string }
  | { status: 'placeholder' }
  | { status: 'pending'; guessId: string };

type DecisionChoice = 'ship_now' | 'drop_batch';

interface ParsedState {
  fileName: string;
  newCount: number;
  skippedCount: number;
  classification: Classification;
  products: ProductLite[];
  mappings: MappingLite[];
  grindCount: number;
  grindOrders: CsvOrder[];
}

const seedRes = (g: ReviewGroup): Resolution => {
  if (g.match.kind === 'matched' && g.match.productId) return { status: 'product', productId: g.match.productId };
  if (g.match.kind === 'needs_confirmation' && g.match.productId) return { status: 'pending', guessId: g.match.productId };
  return { status: 'placeholder' };
};

export default function FunkImport() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ParsedState | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [decisions, setDecisions] = useState<Record<string, DecisionChoice>>({});
  const [workDeadline, setWorkDeadline] = useState<string>(nextBusinessDayDeadline());
  const [submitting, setSubmitting] = useState(false);
  const [grindAck, setGrindAck] = useState(false);

  const productsQ = useQuery({
    queryKey: ['funk-import', 'products'],
    queryFn: async (): Promise<ProductLite[]> => {
      const { data, error } = await sb
        .from('products')
        .select('id, product_name, sku, is_placeholder, packaging_variant, bag_size_g, internal_packaging_notes')
        .order('product_name');
      if (error) throw error;
      return (data ?? []) as ProductLite[];
    },
  });

  const realProducts = useMemo(
    () => (productsQ.data ?? []).filter((p) => !p.is_placeholder),
    [productsQ.data],
  );
  const productById = useMemo(() => {
    const m = new Map<string, ProductLite>();
    for (const p of productsQ.data ?? []) m.set(p.id, p);
    return m;
  }, [productsQ.data]);

  // ---- file upload + parse --------------------------------------------------
  const onPickFile = async (file: File) => {
    if (!productsQ.data) {
      toast.error('Products still loading — try again in a moment.');
      return;
    }
    try {
      const text = await file.text();
      const { orders, error } = parseFunkCsv(text);
      if (error) { toast.error(error); return; }
      if (orders.length === 0) { toast.error('No orders found in CSV.'); return; }

      // Dedupe against funk_imported_orders by Shopify order Name.
      const names = orders.map((o) => o.name);
      const { data: existing, error: dedupeErr } = await sb
        .from('funk_imported_orders')
        .select('shopify_order_name')
        .in('shopify_order_name', names);
      if (dedupeErr) throw dedupeErr;
      const seen = new Set(
        (existing ?? []).map((r: { shopify_order_name: string }) => r.shopify_order_name),
      );
      const newOrders = orders.filter((o) => !seen.has(o.name));
      const skippedCount = orders.length - newOrders.length;

      const { data: mapRows, error: mapErr } = await sb
        .from('funk_import_product_mappings')
        .select('csv_sku, csv_product_name, product_id');
      if (mapErr) throw mapErr;
      const mappings = (mapRows ?? []) as MappingLite[];

      const classification = classifyOrders(newOrders);
      const grindCount = countGrindVariantLines(newOrders);
      const grindOrders = newOrders.filter((o) => o.lineItems.some((li) => !li.isDrop && isGrindVariantName(li.rawName)));
      setResolutions({});
      setDecisions({});
      setGrindAck(false);
      setParsed({
        fileName: file.name,
        newCount: newOrders.length,
        skippedCount,
        classification,
        products: productsQ.data,
        mappings,
        grindCount,
        grindOrders,
      });
      if (newOrders.length === 0) toast.info(`${orders.length} orders, all already imported (skipped).`);
      else toast.success(`${newOrders.length} new, ${skippedCount} already imported (skipped).`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const setRes = (key: string, r: Resolution) => setResolutions((p) => ({ ...p, [key]: r }));
  const effRes = (g: ReviewGroup): Resolution => resolutions[g.key] ?? seedRes(g);

  // ---- derived buckets ------------------------------------------------------
  const shipNowOrders = useMemo(() => {
    if (!parsed) return [];
    const held = parsed.classification.decisionOrders
      .filter((d) => decisions[d.order.name] === 'ship_now')
      .map((d) => d.order);
    return [...parsed.classification.shipNowOrders, ...held];
  }, [parsed, decisions]);

  const shipNowGroups = useMemo(() => {
    if (!parsed) return [];
    return buildShipNowGroups(shipNowOrders, parsed.products, parsed.mappings);
  }, [parsed, shipNowOrders]);

  const batchMonths = useMemo<BatchMonth[]>(() => {
    if (!parsed) return [];
    const heldBatch: BatchClass[] = parsed.classification.decisionOrders
      .filter((d) => decisions[d.order.name] === 'drop_batch' && d.year != null && d.month != null)
      .map((d) => ({
        order: d.order,
        year: d.year as number,
        month: d.month as number,
        slot1Cans: d.slot1Cans,
        slot2Cans: d.slot2Cans,
        heldLines: d.nonDropLines,
      }));
    return aggregateBatchMonths([...parsed.classification.batchOrders, ...heldBatch]);
  }, [parsed, decisions]);

  const buckets = useMemo(() => {
    const matched: ReviewGroup[] = [];
    const needs: ReviewGroup[] = [];
    const unmatched: ReviewGroup[] = [];
    for (const g of shipNowGroups) {
      if (g.match.kind === 'matched') matched.push(g);
      else if (g.match.kind === 'needs_confirmation') needs.push(g);
      else unmatched.push(g);
    }
    return { matched, needs, unmatched };
  }, [shipNowGroups]);

  const unactioned = useMemo(
    () => (parsed?.classification.decisionOrders ?? []).filter((d) => !decisions[d.order.name]),
    [parsed, decisions],
  );

  const pendingGroups = shipNowGroups.filter((g) => effRes(g).status === 'pending').length;

  const summary = useMemo(() => {
    const byProduct = new Map<string, number>();
    let placeholders = 0;
    let shipUnits = 0;
    for (const g of shipNowGroups) {
      shipUnits += g.totalQuantity;
      const r = effRes(g);
      if (r.status === 'product') byProduct.set(r.productId, (byProduct.get(r.productId) ?? 0) + g.totalQuantity);
      else if (r.status === 'placeholder') placeholders++;
    }
    const dropUnits = batchMonths.reduce((s, m) => s + m.slot1Cans + m.slot2Cans, 0);
    return {
      shipLines: byProduct.size + placeholders,
      shipUnits,
      placeholders,
      dropUnits,
      decisionsLeft: unactioned.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipNowGroups, batchMonths, resolutions, unactioned]);

  // ---- confirm + create -----------------------------------------------------
  const handleConfirm = async () => {
    if (!parsed) return;
    if (unactioned.length > 0) {
      toast.error(`${unactioned.length} order(s) still need a decision (ship now or hold for batch).`);
      return;
    }
    if (pendingGroups > 0) { toast.error(`${pendingGroups} guessed match(es) need confirming.`); return; }
    if (parsed.grindCount > 0 && !grindAck) {
      toast.error('Acknowledge the grind-variant warning before confirming.');
      return;
    }
    if (!workDeadline) { toast.error('Set a work deadline before confirming.'); return; }

    setSubmitting(true);
    try {
      // FUNK account (find by name; never auto-create).
      const { data: accts, error: acctErr } = await sb
        .from('accounts').select('id, account_name').ilike('account_name', '%funk%').eq('is_active', true);
      if (acctErr) throw acctErr;
      const funk = (accts ?? [])[0];
      if (!funk) {
        toast.error('No active FUNK account found. Create the FUNK account first, then re-import.');
        setSubmitting(false);
        return;
      }

      // Shared placeholder allocator (reuse by stored CSV name; sequential names).
      const allProducts = [...parsed.products];
      const reuseByNote = new Map<string, string>();
      for (const p of allProducts) if (p.is_placeholder && p.internal_packaging_notes) reuseByNote.set(p.internal_packaging_notes, p.id);
      let seq = nextPlaceholderSeq(allProducts);
      const ensurePlaceholder = async (rawName: string): Promise<string> => {
        const hit = reuseByNote.get(rawName);
        if (hit) return hit;
        const bag = parseBagSize(rawName);
        const { data, error } = await sb.from('products').insert({
          product_name: placeholderName(seq),
          is_placeholder: true, is_active: true,
          bag_size_g: bag.grams, packaging_variant: bag.variant, format: 'WHOLE_BEAN',
          internal_packaging_notes: rawName,
        }).select('id').single();
        if (error) throw error;
        reuseByNote.set(rawName, data.id);
        seq++;
        return data.id;
      };

      // ---- ship-now bundle ----------------------------------------------------
      const groupProductId = new Map<string, string>();
      for (const g of shipNowGroups) {
        const r = effRes(g);
        groupProductId.set(g.key, r.status === 'product' ? r.productId : await ensurePlaceholder(g.rawName));
      }
      const shipQty = new Map<string, number>();
      for (const g of shipNowGroups) {
        const pid = groupProductId.get(g.key)!;
        shipQty.set(pid, (shipQty.get(pid) ?? 0) + g.totalQuantity);
      }

      let bundleOrderId: string | null = null;
      let bundleOrderNumber = '';
      if (shipQty.size > 0) {
        const refBase = funkReferenceBase();
        const { data: sameDay, error: refErr } = await sb
          .from('orders').select('client_po').eq('account_id', funk.id).like('client_po', `${refBase}%`);
        if (refErr) throw refErr;
        const existingRefs = (sameDay ?? []).length;
        const reference = existingRefs === 0 ? refBase : `${refBase}-${existingRefs + 1}`;

        const { data: order, error: orderErr } = await sb.from('orders').insert({
          account_id: funk.id,
          order_number: '',
          status: 'CONFIRMED',
          work_deadline_at: new Date(workDeadline).toISOString(),
          delivery_method: 'COURIER',
          client_po: reference,
          source_channel: 'manual',
          internal_ops_notes: `FUNK CSV import — ${parsed.fileName} (${parsed.newCount} orders)`,
          created_by_user_id: authUser?.id,
          created_by_admin: true,
        }).select('id, order_number').single();
        if (orderErr) throw orderErr;
        if (!order) throw new Error('Order insert returned null — possible RLS or trigger issue.');
        bundleOrderId = order.id;
        bundleOrderNumber = order.order_number;

        const { data: shipment, error: shipErr } = await sb.from('order_shipments')
          .insert({ order_id: order.id, shipment_number: 1, delivery_method: 'COURIER' })
          .select('id').single();
        if (shipErr) throw shipErr;

        const lines = Array.from(shipQty.entries()).map(([product_id, quantity_units]) => ({
          order_id: order.id, product_id, quantity_units, grind: null,
          unit_price_locked: 0, shipment_id: shipment?.id ?? null,
        }));
        const { error: liErr } = await sb.from('order_line_items').insert(lines);
        if (liErr) throw liErr;
      }

      // ---- DROP batch orders (one standing order per month) ------------------
      for (const m of batchMonths) {
        // Resolve slot products via funk_drop_slots (get-or-create).
        const slotProduct: Record<1 | 2, string | null> = { 1: null, 2: null };
        for (const slot of [1, 2] as const) {
          const cans = slot === 1 ? m.slot1Cans : m.slot2Cans;
          if (cans <= 0) continue;
          const { data: slotRow, error: slotErr } = await sb.from('funk_drop_slots')
            .select('product_id')
            .eq('batch_year', m.year).eq('batch_month', m.month).eq('slot_number', slot)
            .maybeSingle();
          if (slotErr) throw slotErr;
          if (slotRow?.product_id) {
            slotProduct[slot] = slotRow.product_id;
          } else {
            const { data: prod, error: prodErr } = await sb.from('products').insert({
              product_name: slotProductName(slot, m.year, m.month),
              is_placeholder: true, is_active: true,
              bag_size_g: 250, packaging_variant: 'RETAIL_250G', format: 'WHOLE_BEAN',
              internal_packaging_notes: `FUNK DROP slot ${slot} — ${monthShortYY(m.year, m.month)}`,
            }).select('id').single();
            if (prodErr) throw prodErr;
            slotProduct[slot] = prod.id;
            const { error: insSlot } = await sb.from('funk_drop_slots').insert({
              batch_year: m.year, batch_month: m.month, slot_number: slot,
              product_id: prod.id, sourced_green_ref: null,
            });
            if (insSlot) throw insSlot;
          }
        }

        // Demand per product for this month: slot cans + any held non-DROP lines.
        const demand = new Map<string, number>();
        if (slotProduct[1] && m.slot1Cans > 0) demand.set(slotProduct[1]!, m.slot1Cans);
        if (slotProduct[2] && m.slot2Cans > 0) demand.set(slotProduct[2]!, (demand.get(slotProduct[2]!) ?? 0) + m.slot2Cans);
        for (const { line } of m.heldLines) {
          const match = matchLineItem(line.sku, line.cleanedName, parsed.products, parsed.mappings);
          const pid = match.kind === 'matched' && match.productId
            ? match.productId
            : await ensurePlaceholder(line.rawName);
          demand.set(pid, (demand.get(pid) ?? 0) + line.quantity);
        }

        // Get-or-create the standing batch order for this month.
        const { data: batchRow, error: batchErr } = await sb.from('funk_drop_batches')
          .select('order_id').eq('batch_year', m.year).eq('batch_month', m.month).maybeSingle();
        if (batchErr) throw batchErr;

        const ship = dropShipDate(m.year, m.month);
        let batchOrderId: string;
        let batchShipmentId: string | null = null;
        if (batchRow?.order_id) {
          batchOrderId = batchRow.order_id;
          const { data: existShip } = await sb.from('order_shipments')
            .select('id').eq('order_id', batchOrderId).order('shipment_number').limit(1).maybeSingle();
          batchShipmentId = existShip?.id ?? null;
        } else {
          const { data: bo, error: boErr } = await sb.from('orders').insert({
            account_id: funk.id,
            order_number: '',
            status: 'CONFIRMED',
            work_deadline_at: noonIso(ship),
            delivery_method: 'COURIER',
            client_po: dropBatchReference(m.year, m.month),
            source_channel: 'manual',
            internal_ops_notes: `FUNK monthly DROP batch — ${monthShortYY(m.year, m.month)} (ships ${dateStamp(ship)})`,
            created_by_user_id: authUser?.id,
            created_by_admin: true,
          }).select('id').single();
          if (boErr) throw boErr;
          batchOrderId = bo.id;
          const { data: bShip, error: bShipErr } = await sb.from('order_shipments')
            .insert({ order_id: batchOrderId, shipment_number: 1, delivery_method: 'COURIER' })
            .select('id').single();
          if (bShipErr) throw bShipErr;
          batchShipmentId = bShip?.id ?? null;
          const { error: insBatch } = await sb.from('funk_drop_batches').insert({
            batch_year: m.year, batch_month: m.month, ship_date: dateStamp(ship), order_id: batchOrderId,
          });
          if (insBatch) throw insBatch;
        }

        // Add/update line quantities for the newly imported demand.
        for (const [product_id, qty] of demand.entries()) {
          const { data: existLine, error: elErr } = await sb.from('order_line_items')
            .select('id, quantity_units').eq('order_id', batchOrderId).eq('product_id', product_id).maybeSingle();
          if (elErr) throw elErr;
          if (existLine) {
            const { error: updErr } = await sb.from('order_line_items')
              .update({ quantity_units: (existLine.quantity_units ?? 0) + qty }).eq('id', existLine.id);
            if (updErr) throw updErr;
          } else {
            const { error: insErr } = await sb.from('order_line_items').insert({
              order_id: batchOrderId, product_id, quantity_units: qty, grind: null,
              unit_price_locked: 0, shipment_id: batchShipmentId,
            });
            if (insErr) throw insErr;
          }
        }
      }

      // ---- import session + dedupe ledger ------------------------------------
      const { data: session, error: sessErr } = await sb.from('funk_import_sessions').insert({
        file_name: parsed.fileName,
        orders_new: parsed.newCount,
        orders_skipped: parsed.skippedCount,
        bundle_order_id: bundleOrderId,
      }).select('id').single();
      if (sessErr) throw sessErr;

      // Every included order, recorded with its resolved destination.
      const ledger: { name: string; shopifyId: string; destination: DecisionChoice }[] = [];
      for (const o of parsed.classification.shipNowOrders) ledger.push({ name: o.name, shopifyId: o.shopifyId, destination: 'ship_now' });
      for (const b of parsed.classification.batchOrders) ledger.push({ name: b.order.name, shopifyId: b.order.shopifyId, destination: 'drop_batch' });
      for (const d of parsed.classification.decisionOrders) {
        const choice = decisions[d.order.name]!;
        ledger.push({ name: d.order.name, shopifyId: d.order.shopifyId, destination: choice });
      }
      if (ledger.length > 0) {
        const { error: ledErr } = await sb.from('funk_imported_orders').insert(
          ledger.map((l) => ({
            shopify_order_name: l.name,
            shopify_order_id: l.shopifyId || null,
            destination: l.destination,
            import_session_id: session.id,
          })),
        );
        if (ledErr) throw ledErr;
      }

      // Remember ship-now mappings (never for placeholders).
      for (const g of shipNowGroups) {
        const r = effRes(g);
        if (r.status !== 'product') continue;
        const useSku = g.csvSku.trim() !== '';
        const col = useSku ? 'csv_sku' : 'csv_product_name';
        const val = useSku ? g.csvSku.trim() : g.cleanedName;
        const { data: ex } = await sb.from('funk_import_product_mappings').select('id').eq(col, val).maybeSingle();
        if (ex) await sb.from('funk_import_product_mappings').update({ product_id: r.productId }).eq('id', ex.id);
        else await sb.from('funk_import_product_mappings').insert({
          csv_sku: useSku ? g.csvSku.trim() : null,
          csv_product_name: useSku ? null : g.cleanedName,
          product_id: r.productId,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['funk-import'] });
      if (bundleOrderId) {
        toast.success(`Bundle order ${bundleOrderNumber} created.`);
        navigate(`/orders/${bundleOrderId}`);
      } else {
        toast.success('Import complete — DROP batch order(s) updated.');
        navigate('/orders');
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ---- render ---------------------------------------------------------------
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">FUNK CSV Import</h1>
        <p className="text-sm text-muted-foreground">
          Manual bridge until the Shopify connector is live. Upload a Shopify orders export, review the
          three buckets, and create the ship-now bundle plus this month's DROP batch.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Input
            ref={fileRef} type="file" accept=".csv,text/csv" className="max-w-sm"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Choose CSV
          </Button>
          {parsed && (
            <span className="text-sm text-muted-foreground">
              {parsed.fileName} — {parsed.newCount} new, {parsed.skippedCount} already imported (skipped)
            </span>
          )}
        </CardContent>
      </Card>

      {parsed && parsed.newCount > 0 && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end gap-6 pt-6">
              <Stat label="Ship-now lines" value={summary.shipLines} />
              <Stat label="Ship-now units" value={summary.shipUnits} />
              <Stat label="DROP cans" value={summary.dropUnits} />
              <Stat label="Placeholders" value={summary.placeholders} />
              <Stat label="Need a decision" value={summary.decisionsLeft} />
              <Stat label="New / skipped" value={`${parsed.newCount} / ${parsed.skippedCount}`} />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Ship-now work deadline</label>
                <Input type="datetime-local" value={workDeadline} onChange={(e) => setWorkDeadline(e.target.value)} className="w-56" />
              </div>
              <Button
                className="ml-auto"
                disabled={submitting || pendingGroups > 0 || summary.decisionsLeft > 0 || (parsed.grindCount > 0 && !grindAck)}
                onClick={handleConfirm}
              >
                {submitting ? 'Creating…' : 'Confirm & create orders'}
              </Button>
            </CardContent>
          </Card>
          {(pendingGroups > 0 || summary.decisionsLeft > 0) && (
            <p className="text-sm text-amber-600">
              {summary.decisionsLeft > 0 && `${summary.decisionsLeft} order(s) need a decision. `}
              {pendingGroups > 0 && `${pendingGroups} guessed match(es) need confirming. `}
              Resolve these before creating orders.
            </p>
          )}

          {parsed.grindCount > 0 && (
            <Card className={cn('border-2', grindAck ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-amber-500 bg-amber-500/10')}>
              <CardContent className="flex flex-wrap items-start gap-3 pt-6">
                <AlertTriangle className={cn('h-5 w-5 shrink-0 mt-0.5', grindAck ? 'text-emerald-600' : 'text-amber-600')} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    There {parsed.grindCount === 1 ? 'is' : 'are'} {parsed.grindCount} product{parsed.grindCount === 1 ? '' : 's'} that need to be ground. Make sure you double check which ones and make a note.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Grind variants aren't tracked separately yet — they'll be folded into the matched/placeholder products. Note the grind on the order before it goes to production.
                  </p>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Show {parsed.grindCount} grind line{parsed.grindCount === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-4">
                      {parsed.grindOrders.flatMap((o) =>
                        o.lineItems
                          .filter((li) => !li.isDrop && isGrindVariantName(li.rawName))
                          .map((li, i) => (
                            <li key={`${o.name}-${i}`}>{o.name} — {li.quantity}× {li.rawName}</li>
                          )),
                      )}
                    </ul>
                  </details>
                </div>
                <Button
                  size="sm"
                  variant={grindAck ? 'secondary' : 'default'}
                  onClick={() => setGrindAck((v) => !v)}
                >
                  {grindAck ? <><Check className="mr-1 h-3 w-3" /> Acknowledged</> : 'I will note the grinds'}
                </Button>
              </CardContent>
            </Card>
          )}


          {/* SHIP NOW */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Package className="h-4 w-4" /> Ship now</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {shipNowGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No ship-now lines.</p>
              ) : (
                <>
                  <Section title="Matched" count={buckets.matched.length}>
                    {buckets.matched.map((g) => <MatchedRow key={g.key} group={g} productById={productById} />)}
                  </Section>
                  <Section title="Needs confirmation" count={buckets.needs.length}>
                    {buckets.needs.map((g) => (
                      <DecisionRow key={g.key} group={g} resolution={effRes(g)} products={realProducts}
                        productById={productById} onChange={(r) => setRes(g.key, r)} showAcceptGuess />
                    ))}
                  </Section>
                  <Section title="Unmatched" count={buckets.unmatched.length}>
                    {buckets.unmatched.map((g) => (
                      <DecisionRow key={g.key} group={g} resolution={effRes(g)} products={realProducts}
                        productById={productById} onChange={(r) => setRes(g.key, r)} />
                    ))}
                  </Section>
                </>
              )}
            </CardContent>
          </Card>

          {/* DROP BATCH */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Box className="h-4 w-4" /> This month's DROP batch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {batchMonths.length === 0 ? (
                <p className="text-sm text-muted-foreground">No DROP boxes routed to a batch.</p>
              ) : (
                batchMonths.map((m) => {
                  const ship = dropShipDate(m.year, m.month);
                  return (
                    <div key={`${m.year}-${m.month}`} className="rounded border p-3">
                      <div className="mb-2 flex items-center gap-2 font-medium">
                        <Truck className="h-4 w-4" /> {monthShortYY(m.year, m.month)} batch — ships {dateStamp(ship)}
                      </div>
                      <SlotLine label={slotProductName(1, m.year, m.month)} cans={m.slot1Cans} />
                      <SlotLine label={slotProductName(2, m.year, m.month)} cans={m.slot2Cans} />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Slot products are placeholders until named/sourced — the slot row is the stable key.
                      </p>
                      {m.heldLines.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          + {m.heldLines.length} held non-DROP line(s) ride along on the batch order:
                          <ul className="pl-4">
                            {m.heldLines.map((h, i) => <li key={i}>{h.orderName} — {h.line.quantity}× {h.line.cleanedName}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* NEEDS A DECISION */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4" /> Needs a decision ({unactioned.length} open)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {parsed.classification.decisionOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No mixed or unreadable orders.</p>
              ) : (
                parsed.classification.decisionOrders.map((d) => {
                  const choice = decisions[d.order.name];
                  const canHold = d.canExpand;
                  return (
                    <div key={d.order.name} className="rounded border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{d.order.name}</span>
                        <Badge variant="outline" className="text-amber-600">
                          {d.reason === 'mixed' ? 'mixed order' : d.reason === 'unparseable' ? 'can count unreadable' : 'no order date'}
                        </Badge>
                        {choice && (
                          <Badge variant="default" className="gap-1">
                            <Check className="h-3 w-3" /> {choice === 'ship_now' ? 'ship now' : 'hold for DROP batch'}
                          </Badge>
                        )}
                      </div>
                      <ul className="mt-1 pl-4 text-xs text-muted-foreground">
                        {d.order.lineItems.map((li, i) => (
                          <li key={i}>{li.isDrop ? '🟦 ' : ''}{li.quantity}× {li.cleanedName}{li.isDrop && li.dropCans == null ? ' (can count unreadable)' : ''}</li>
                        ))}
                      </ul>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant={choice === 'ship_now' ? 'secondary' : 'outline'}
                          onClick={() => setDecisions((p) => ({ ...p, [d.order.name]: 'ship_now' }))}>
                          Ship the whole order now
                        </Button>
                        <Button size="sm" variant={choice === 'drop_batch' ? 'secondary' : 'outline'}
                          disabled={!canHold}
                          title={canHold ? '' : 'Can count or order date unreadable — cannot expand into a batch.'}
                          onClick={() => setDecisions((p) => ({ ...p, [d.order.name]: 'drop_batch' }))}>
                          Hold whole order for this month's DROP batch
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
    </div>
  );
}

function SlotLine({ label, cans }: { label: string; cans: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <span className="font-semibold">{cans} cans (250g)</span>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title} <span className="text-muted-foreground">({count})</span></h3>
      {count === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <div className="space-y-2">{children}</div>}
    </div>
  );
}

function ContributingRows({ group }: { group: ReviewGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {group.rows.length} contributing line{group.rows.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ul className="mt-1 pl-5 text-xs text-muted-foreground">
          {group.rows.map((r, i) => <li key={i}>{r.orderName} — {r.quantity}× {r.rawName}</li>)}
        </ul>
      )}
    </div>
  );
}

function MatchedRow({ group, productById }: { group: ReviewGroup; productById: Map<string, ProductLite> }) {
  const product = productById.get(group.match.productId!);
  const parsedVariant = parseBagSize(group.rawName).variant;
  const variant = product?.packaging_variant ?? parsedVariant;
  return (
    <div className="rounded border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{product?.product_name ?? '(unknown product)'}</span>
          <PackagingBadge variant={variant} />
        </div>
        <span className="shrink-0 text-sm font-semibold">{group.totalQuantity} units</span>
      </div>
      <ContributingRows group={group} />
    </div>
  );
}

function DecisionRow({
  group, resolution, products, productById, onChange, showAcceptGuess,
}: {
  group: ReviewGroup;
  resolution: Resolution;
  products: ProductLite[];
  productById: Map<string, ProductLite>;
  onChange: (r: Resolution) => void;
  showAcceptGuess?: boolean;
}) {
  const guessId = group.match.productId;
  const guess = guessId ? productById.get(guessId) : undefined;
  const chosen = resolution.status === 'product' ? productById.get(resolution.productId) : undefined;
  return (
    <div className="rounded border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate font-medium">{group.cleanedName}</div>
            <PackagingBadge variant={parseBagSize(group.rawName).variant} />
          </div>
          {group.csvSku && <div className="text-xs text-muted-foreground">SKU {group.csvSku}</div>}
        </div>
        <span className="shrink-0 text-sm font-semibold">{group.totalQuantity} units</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {resolution.status === 'product' && (
          <Badge variant="default" className="gap-1"><Check className="h-3 w-3" /> {chosen?.product_name ?? 'product'}</Badge>
        )}
        {resolution.status === 'placeholder' && (
          <Badge variant="secondary" className="max-w-xs gap-1"><Check className="h-3 w-3" /> new placeholder for “{group.rawName}”</Badge>
        )}
        {resolution.status === 'pending' && (
          <Badge variant="outline" className="text-amber-600">needs confirmation</Badge>
        )}
        {showAcceptGuess && guessId && resolution.status === 'pending' && (
          <Button size="sm" variant="outline" onClick={() => onChange({ status: 'product', productId: guessId })}>
            Accept guess: {guess?.product_name ?? 'product'}
          </Button>
        )}
        <ProductCombobox products={products} value={resolution.status === 'product' ? resolution.productId : ''}
          onChange={(id) => onChange({ status: 'product', productId: id })} />
        <Button size="sm" variant={resolution.status === 'placeholder' ? 'secondary' : 'ghost'}
          disabled={resolution.status === 'placeholder'} onClick={() => onChange({ status: 'placeholder' })}>
          {resolution.status === 'placeholder' ? 'Placeholder ✓' : 'Send to placeholder'}
        </Button>
      </div>
      <ContributingRows group={group} />
    </div>
  );
}

function ProductCombobox({ products, value, onChange }: { products: ProductLite[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = products.find((p) => p.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="justify-between gap-2">
          {selected ? selected.product_name : 'Pick a product'}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[28rem] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search products…" />
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.product_name} ${p.sku ?? ''}`}
                  className="flex items-center gap-2"
                  onSelect={() => { onChange(p.id); setOpen(false); }}
                >
                  <Check className={cn('shrink-0 h-4 w-4', value === p.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1 truncate">{p.product_name}</span>
                  {p.sku && <span className="shrink-0 text-xs text-muted-foreground font-mono">{p.sku}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
