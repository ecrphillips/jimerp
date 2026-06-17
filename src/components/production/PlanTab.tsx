import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { format, formatDistanceToNow, getDay, getHours, subDays, parseISO } from 'date-fns';
import {
  AlertTriangle,
  Info,
  X,
  Trash2,
  CheckCircle2,
  AlertCircle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Upload,
  PlusCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { TIMEZONE, getVancouverNow } from '@/lib/productionScheduling';
import {
  useAuthoritativeWip,
  useAuthoritativeFg,
} from '@/hooks/useAuthoritativeInventory';
import type { DateFilterConfig } from '@/components/production/types';

interface PlanTabProps {
  dateFilterConfig: DateFilterConfig;
  today: string;
}

type Anomaly = {
  key: string;
  message: string;
  orderId?: string;
  action?: { kind: 'delete-batch'; batchId: string } | { kind: 'open-order'; orderId: string };
};

type AnomaliesResult = { orderSurprises: Anomaly[] };
type OrphansResult = { orphans: Anomaly[] };

const DISMISS_STORAGE_KEY = 'plan-tab-dismissed-orphans-v1';

function readDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}
function writeDismissed(set: Set<string>) {
  try {
    sessionStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/** Vancouver-local YYYY-MM-DD for a timestamp (or null). */
function vDate(ts: string | null | undefined): string | null {
  if (!ts) return null;
  try {
    return formatInTimeZone(new Date(ts), TIMEZONE, 'yyyy-MM-dd');
  } catch {
    return null;
  }
}

const fmtKg = (kg: number) => `${kg.toFixed(1)} kg / ${(kg * 2.20462).toFixed(1)} lb`;

// ─────────────────────────────────────────────────────────────────────────────
// Shared types for the plan data
// ─────────────────────────────────────────────────────────────────────────────
type OpenOrder = {
  id: string;
  order_number: string;
  status: string;
  account_id: string | null;
  account_location_id: string | null;
  accountName: string;
  locationName: string | null;
  workDeadlineDate: string | null;   // Vancouver YYYY-MM-DD
  workDeadlineRaw: string | null;    // raw ts for display/sort
  createdAt: string;
  kg: number;
  lines: Array<{ product_id: string; quantity_units: number; bag_size_g: number; roast_group: string | null }>;
};

type AccountRow = {
  id: string;
  account_name: string;
  production_weekdays: number[] | null;
  locations: Array<{ id: string; location_name: string; is_active: boolean }>;
};

export function PlanTab({ dateFilterConfig: _dateFilterConfig, today }: PlanTabProps) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    writeDismissed(dismissed);
  }, [dismissed]);

  const dismiss = (key: string) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

  const invalidateAfterMutation = () => {
    queryClient.invalidateQueries({ queryKey: ['plan-data-orphans'] });
    queryClient.invalidateQueries({ queryKey: ['plan-data'] });
    queryClient.invalidateQueries({ queryKey: ['roast-tab-groups'] });
    queryClient.invalidateQueries({ queryKey: ['production-roast-groups'] });
  };

  const handleDeleteBatch = async (batchId: string) => {
    try {
      const { error } = await supabase.from('roasted_batches').delete().eq('id', batchId);
      if (error) throw error;
      toast.success('Batch deleted');
      invalidateAfterMutation();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Core plan data: accounts + open orders + last FUNK import
  // ─────────────────────────────────────────────────────────────────────────
  const { data: planData, isLoading: planLoading } = useQuery({
    queryKey: ['plan-data', today],
    queryFn: async () => {
      const [acctRes, ordersRes, funkSessRes] = await Promise.all([
        supabase
          .from('accounts')
          .select('id, account_name, production_weekdays, account_locations(id, location_name, is_active)')
          .eq('is_active', true),
        supabase
          .from('orders')
          .select(
            `id, order_number, status, created_at, work_deadline_at, work_deadline,
             account_id, account_location_id, client_id,
             accounts!orders_account_id_fkey(account_name),
             account_locations!orders_account_location_id_fkey(location_name),
             clients(name),
             order_line_items(product_id, quantity_units, products(bag_size_g, roast_group))`
          )
          .not('status', 'in', '(SHIPPED,CANCELLED)'),
        supabase
          .from('funk_import_sessions')
          .select('id, file_name, imported_at, orders_new, orders_skipped')
          .order('imported_at', { ascending: false })
          .limit(1),
      ]);

      if (acctRes.error) throw acctRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const accounts: AccountRow[] = (acctRes.data ?? []).map((a) => ({
        id: a.id,
        account_name: a.account_name,
        production_weekdays: (a.production_weekdays as number[] | null) ?? null,
        locations: ((a.account_locations as Array<{ id: string; location_name: string; is_active: boolean }> | null) ?? []),
      }));

      const orders: OpenOrder[] = (ordersRes.data ?? []).map((o: any) => {
        const lines = (o.order_line_items ?? []).map((li: any) => ({
          product_id: li.product_id,
          quantity_units: li.quantity_units ?? 0,
          bag_size_g: li.products?.bag_size_g ?? 0,
          roast_group: li.products?.roast_group ?? null,
        }));
        const kg = lines.reduce(
          (s: number, li: { quantity_units: number; bag_size_g: number }) =>
            s + (li.quantity_units * li.bag_size_g) / 1000,
          0
        );
        const wd = o.work_deadline_at ?? o.work_deadline ?? null;
        return {
          id: o.id,
          order_number: o.order_number,
          status: o.status,
          account_id: o.account_id ?? null,
          account_location_id: o.account_location_id ?? null,
          accountName:
            (o.accounts as { account_name?: string } | null)?.account_name ??
            (o.clients as { name?: string } | null)?.name ??
            'Unknown',
          locationName:
            (o.account_locations as { location_name?: string } | null)?.location_name ?? null,
          workDeadlineDate: vDate(wd) ?? (wd && wd.length === 10 ? wd : null),
          workDeadlineRaw: wd,
          createdAt: o.created_at,
          kg,
          lines,
        };
      });

      // Last "order entry" per account (max created_at across open + recent closed not necessary —
      // use ALL orders for completeness in a secondary query)
      const lastOrderRes = await supabase
        .from('orders')
        .select('account_id, created_at')
        .not('account_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);
      const lastOrderByAccount = new Map<string, string>();
      for (const row of lastOrderRes.data ?? []) {
        if (!row.account_id) continue;
        if (!lastOrderByAccount.has(row.account_id)) {
          lastOrderByAccount.set(row.account_id, row.created_at);
        }
      }

      return {
        accounts,
        orders,
        lastOrderByAccount,
        lastFunkImport: (funkSessRes.data ?? [])[0] ?? null,
      };
    },
  });

  const { data: wipByGroup } = useAuthoritativeWip();
  const { data: fgByProduct } = useAuthoritativeFg();

  // ─────────────────────────────────────────────────────────────────────────
  // Bucket math
  // ─────────────────────────────────────────────────────────────────────────
  const buckets = useMemo(() => {
    if (!planData) {
      return null;
    }
    const vNow = getVancouverNow();
    const jsDay = getDay(vNow); // 0=Sun..6=Sat — matches accounts.production_weekdays convention
    const tomorrowStr = formatInTimeZone(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      TIMEZONE,
      'yyyy-MM-dd'
    );
    const jsTomorrow = (jsDay + 1) % 7;

    const priorityAccounts = planData.accounts.filter((a) =>
      (a.production_weekdays ?? []).includes(jsDay)
    );
    const priorityAcctIds = new Set(priorityAccounts.map((a) => a.id));

    const tomorrowPriorityIds = new Set(
      planData.accounts
        .filter((a) => (a.production_weekdays ?? []).includes(jsTomorrow))
        .map((a) => a.id)
    );

    const todayOrders = planData.orders.filter((o) => o.workDeadlineDate === today);
    const tomorrowOrders = planData.orders.filter((o) => o.workDeadlineDate === tomorrowStr);

    // Bucket 1: per priority account, list today-deadline orders
    type PriorityAcct = {
      account: AccountRow;
      orders: OpenOrder[];
      kg: number;
      lastOrderAt: string | null;
    };
    const bucket1: PriorityAcct[] = priorityAccounts
      .map((acct) => {
        const orders = todayOrders.filter((o) => o.account_id === acct.id);
        const kg = orders.reduce((s, o) => s + o.kg, 0);
        return {
          account: acct,
          orders,
          kg,
          lastOrderAt: planData.lastOrderByAccount.get(acct.id) ?? null,
        };
      })
      .sort((a, b) => {
        // Missing first, then by name
        const aMissing = a.orders.length === 0 ? 0 : 1;
        const bMissing = b.orders.length === 0 ? 0 : 1;
        if (aMissing !== bMissing) return aMissing - bMissing;
        return a.account.account_name.localeCompare(b.account.account_name);
      });

    // Bucket 2: today-deadline orders for non-priority accounts
    const bucket2 = todayOrders
      .filter((o) => !o.account_id || !priorityAcctIds.has(o.account_id))
      .sort((a, b) => {
        const ad = a.workDeadlineRaw ?? '';
        const bd = b.workDeadlineRaw ?? '';
        return ad.localeCompare(bd) || a.accountName.localeCompare(b.accountName);
      });

    // Bucket 3: tomorrow's orders, priority accounts first
    const bucket3 = tomorrowOrders.slice().sort((a, b) => {
      const aPrio = a.account_id && tomorrowPriorityIds.has(a.account_id) ? 0 : 1;
      const bPrio = b.account_id && tomorrowPriorityIds.has(b.account_id) ? 0 : 1;
      if (aPrio !== bPrio) return aPrio - bPrio;
      const ad = a.workDeadlineRaw ?? '';
      const bd = b.workDeadlineRaw ?? '';
      return ad.localeCompare(bd) || a.accountName.localeCompare(b.accountName);
    });

    // Summary: total demand today + coverage (WIP/FG already on hand)
    // Per roast group: demand_kg vs (wip_available + fg_available_kg).
    // Coverage capped at demand per group so we don't over-credit.
    const demandByGroup: Record<string, number> = {};
    const fgKgByGroup: Record<string, number> = {};

    for (const o of todayOrders) {
      for (const li of o.lines) {
        if (!li.roast_group) continue;
        const kg = (li.quantity_units * li.bag_size_g) / 1000;
        demandByGroup[li.roast_group] = (demandByGroup[li.roast_group] ?? 0) + kg;
      }
    }
    if (fgByProduct) {
      for (const fg of Object.values(fgByProduct)) {
        if (!fg.roast_group) continue;
        fgKgByGroup[fg.roast_group] =
          (fgKgByGroup[fg.roast_group] ?? 0) + (fg.fg_available_units * fg.bag_size_g) / 1000;
      }
    }

    let totalDemand = 0;
    let totalWipCover = 0;
    let totalFgCover = 0;
    for (const [rg, demand] of Object.entries(demandByGroup)) {
      totalDemand += demand;
      const wipAv = wipByGroup?.[rg]?.wip_available_kg ?? 0;
      const fgAv = fgKgByGroup[rg] ?? 0;
      const wipCover = Math.min(demand, wipAv);
      const fgCover = Math.min(Math.max(0, demand - wipCover), fgAv);
      totalWipCover += wipCover;
      totalFgCover += fgCover;
    }
    const netDemand = Math.max(0, totalDemand - totalWipCover - totalFgCover);

    return {
      bucket1,
      bucket2,
      bucket3,
      tomorrowPriorityIds,
      tomorrowStr,
      summary: {
        orderCount: todayOrders.length,
        totalDemand,
        wipCover: totalWipCover,
        fgCover: totalFgCover,
        netDemand,
      },
      weekdayName: format(vNow, 'EEEE'),
    };
  }, [planData, today, wipByGroup, fgByProduct]);

  // ─────────────────────────────────────────────────────────────────────────
  // Anomalies + orphans (unchanged from prior version)
  // ─────────────────────────────────────────────────────────────────────────
  const { data: anomalies } = useQuery<AnomaliesResult>({
    queryKey: ['plan-anomalies'],
    queryFn: async () => {
      const vNow = getVancouverNow();
      const todayWeekday = getDay(vNow);
      const todayStr = format(vNow, 'yyyy-MM-dd');
      const vHour = getHours(vNow);
      const past28Iso = subDays(new Date(), 28).toISOString();
      const past24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const ordersRes = await supabase
        .from('orders')
        .select('id, order_number, client_id, created_at, status, clients(name)')
        .gte('created_at', past28Iso)
        .not('client_id', 'is', null);
      if (ordersRes.error) throw ordersRes.error;
      const orders = ordersRes.data ?? [];

      const liRes = await supabase
        .from('order_line_items')
        .select(
          'order_id, product_id, products!inner(product_name, is_active), orders!inner(id, status, client_id, clients(name))'
        )
        .eq('products.is_active', false)
        .not('orders.status', 'in', '(SHIPPED,CANCELLED)');
      if (liRes.error) throw liRes.error;

      const orderSurprises: Anomaly[] = [];

      if (vHour >= 11) {
        type ClientAgg = { name: string; matchDays: Set<string>; hasToday: boolean };
        const byClient = new Map<string, ClientAgg>();
        for (const o of orders) {
          if (!o.client_id) continue;
          const zoned = toZonedTime(new Date(o.created_at), TIMEZONE);
          const dStr = format(zoned, 'yyyy-MM-dd');
          const wd = getDay(zoned);
          let entry = byClient.get(o.client_id);
          if (!entry) {
            entry = {
              name: (o.clients as { name?: string } | null)?.name ?? 'Unknown',
              matchDays: new Set(),
              hasToday: false,
            };
            byClient.set(o.client_id, entry);
          }
          if (wd === todayWeekday && dStr !== todayStr) entry.matchDays.add(dStr);
          if (dStr === todayStr) entry.hasToday = true;
        }
        const weekdayName = format(vNow, 'EEEE');
        for (const [cid, info] of byClient) {
          if (info.hasToday) continue;
          if (info.matchDays.size >= 3) {
            orderSurprises.push({
              key: `A-${cid}`,
              message: `${info.name} usually orders by 11am on ${weekdayName} — none seen yet`,
            });
          }
        }
      }

      type RecentAgg = { name: string; orders: { id: string; num: string }[] };
      const recentByClient = new Map<string, RecentAgg>();
      for (const o of orders) {
        if (!o.client_id) continue;
        if (o.created_at < past24hIso) continue;
        let entry = recentByClient.get(o.client_id);
        if (!entry) {
          entry = {
            name: (o.clients as { name?: string } | null)?.name ?? 'Unknown',
            orders: [],
          };
          recentByClient.set(o.client_id, entry);
        }
        entry.orders.push({ id: o.id, num: o.order_number });
      }
      for (const [cid, info] of recentByClient) {
        if (info.orders.length >= 2) {
          const nums = info.orders.map((x) => x.num).join(', ');
          orderSurprises.push({
            key: `B-${cid}`,
            message: `${info.name} — ${info.orders.length} orders in last 24h: ${nums}`,
            orderId: info.orders[0].id,
          });
        }
      }

      const seenC = new Set<string>();
      for (const row of liRes.data ?? []) {
        const product = row.products as { product_name: string; is_active: boolean } | null;
        const order = row.orders as
          | { id: string; status: string; client_id: string | null; clients: { name?: string } | null }
          | null;
        if (!product || !order) continue;
        const dedupeKey = `${order.id}-${row.product_id}`;
        if (seenC.has(dedupeKey)) continue;
        seenC.add(dedupeKey);
        const clientName = order.clients?.name ?? 'Unknown';
        orderSurprises.push({
          key: `C-${dedupeKey}`,
          message: `${clientName} ordered ${product.product_name} — flagged inactive`,
          orderId: order.id,
        });
      }

      return { orderSurprises };
    },
  });

  const { data: orphansData } = useQuery<OrphansResult>({
    queryKey: ['plan-data-orphans'],
    queryFn: async () => {
      const vNow = getVancouverNow();
      const stuckCutoffIso = subDays(vNow, 1).toISOString();
      const orphans: Anomaly[] = [];

      const batchesRes = await supabase
        .from('roasted_batches')
        .select('id, roast_group, status, created_at, target_date')
        .eq('status', 'PLANNED')
        .lt('created_at', stuckCutoffIso);
      if (batchesRes.error) throw batchesRes.error;
      for (const b of batchesRes.data ?? []) {
        const rel = formatDistanceToNow(new Date(b.created_at), { addSuffix: true });
        orphans.push({
          key: `D-${b.id}`,
          message: `Batch ${b.roast_group} (${b.target_date}) stuck in PLANNED ${rel}`,
          action: { kind: 'delete-batch', batchId: b.id },
        });
      }

      const allBatchesRes = await supabase
        .from('roasted_batches')
        .select('id, roast_group, target_date, status');
      if (allBatchesRes.error) throw allBatchesRes.error;
      const allBatches = allBatchesRes.data ?? [];

      if (allBatches.length > 0) {
        const ids = allBatches.map((b) => b.id);
        const wipRes = await supabase
          .from('wip_ledger')
          .select('related_batch_id')
          .in('related_batch_id', ids);
        if (wipRes.error) throw wipRes.error;
        const referenced = new Set(
          (wipRes.data ?? []).map((r) => r.related_batch_id).filter((v): v is string => !!v)
        );
        for (const b of allBatches) {
          if (referenced.has(b.id)) continue;
          if (b.status === 'PLANNED') continue;
          orphans.push({
            key: `G-${b.id}`,
            message: `Ghost batch ${b.roast_group} (${b.target_date}) — no inventory ledger entries`,
            action: { kind: 'delete-batch', batchId: b.id },
          });
        }
      }

      const picksRes = await supabase
        .from('ship_picks')
        .select(
          'order_line_item_id, units_picked, order_line_items!inner(id, quantity_units, products(product_name), orders!inner(id, order_number, status, clients(name)))'
        )
        .not('order_line_items.orders.status', 'in', '(SHIPPED,CANCELLED)');
      if (picksRes.error) throw picksRes.error;

      type LineAgg = {
        totalPicked: number;
        required: number;
        productName: string;
        orderId: string;
        orderNumber: string;
        clientName: string;
      };
      const byLine = new Map<string, LineAgg>();
      for (const row of picksRes.data ?? []) {
        const li = row.order_line_items as
          | {
              id: string;
              quantity_units: number;
              products: { product_name: string } | null;
              orders: {
                id: string;
                order_number: string;
                status: string;
                clients: { name?: string } | null;
              } | null;
            }
          | null;
        if (!li || !li.orders) continue;
        let agg = byLine.get(li.id);
        if (!agg) {
          agg = {
            totalPicked: 0,
            required: li.quantity_units,
            productName: li.products?.product_name ?? 'Unknown product',
            orderId: li.orders.id,
            orderNumber: li.orders.order_number,
            clientName: li.orders.clients?.name ?? 'Unknown',
          };
          byLine.set(li.id, agg);
        }
        agg.totalPicked += row.units_picked ?? 0;
      }
      for (const [lineId, agg] of byLine) {
        if (agg.totalPicked > agg.required) {
          orphans.push({
            key: `F-${lineId}`,
            message: `${agg.clientName} order #${agg.orderNumber} — ${agg.productName} picked ${agg.totalPicked}, required ${agg.required}`,
            orderId: agg.orderId,
            action: { kind: 'open-order', orderId: agg.orderId },
          });
        }
      }

      return { orphans };
    },
  });

  const surprises = (anomalies?.orderSurprises ?? []).filter((a) => !dismissed.has(a.key));
  const visibleSurprises = surprises.slice(0, 2);
  const extraSurprises = surprises.length - visibleSurprises.length;
  const orphans = (orphansData?.orphans ?? []).filter((a) => !dismissed.has(a.key));
  const visibleOrphans = orphans.slice(0, 5);
  const extraOrphans = orphans.length - visibleOrphans.length;
  const hasAnomalies = surprises.length > 0 || orphans.length > 0;

  const renderActionButton = (a: Anomaly) => {
    if (!a.action) return null;
    if (a.action.kind === 'delete-batch') {
      const batchId = a.action.batchId;
      return (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => handleDeleteBatch(batchId)}
        >
          <Trash2 className="h-3 w-3 mr-1" /> Delete
        </Button>
      );
    }
    return null;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  const isFunk = (acctName: string) => /funk/i.test(acctName);
  const lastFunkImport = planData?.lastFunkImport ?? null;

  return (
    <div className="space-y-4">
      {/* TOP SUMMARY — today's demand vs coverage */}
      <div className="rounded-md border bg-card px-4 py-3">
        {planLoading || !buckets ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                Today’s demand — {buckets.weekdayName}
              </p>
              <p className="text-xs text-muted-foreground">
                {buckets.summary.orderCount} order
                {buckets.summary.orderCount === 1 ? '' : 's'} with today’s work deadline
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Stat label="Total demand" value={fmtKg(buckets.summary.totalDemand)} />
              <Stat label="WIP covers" value={fmtKg(buckets.summary.wipCover)} tone="ok" />
              <Stat label="FG covers" value={fmtKg(buckets.summary.fgCover)} tone="ok" />
              <Stat
                label="Net to roast"
                value={fmtKg(buckets.summary.netDemand)}
                tone={buckets.summary.netDemand > 0 ? 'warn' : 'ok'}
                emphasis
              />
            </div>
          </div>
        )}
      </div>

      {/* BUCKET 1 — Priority accounts (today is a set production day) */}
      <BucketShell
        icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
        title={`Priority accounts — ${buckets?.weekdayName ?? ''}`}
        right={
          buckets ? (
            <span className="text-xs text-muted-foreground">
              {buckets.bucket1.length} account{buckets.bucket1.length === 1 ? '' : 's'}
            </span>
          ) : null
        }
      >
        {planLoading || !buckets ? (
          <div className="px-4 py-3">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : buckets.bucket1.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            No accounts have today as a standard production day.
          </div>
        ) : (
          <div className="divide-y">
            {buckets.bucket1.map((row) => (
              <PriorityAccountCard
                key={row.account.id}
                row={row}
                lastFunkImport={isFunk(row.account.account_name) ? lastFunkImport : null}
              />
            ))}
          </div>
        )}
      </BucketShell>

      {/* BUCKET 2 — Other today */}
      <BucketShell
        title="Other orders due today"
        right={
          buckets ? (
            <span className="text-xs text-muted-foreground">
              {buckets.bucket2.length} order{buckets.bucket2.length === 1 ? '' : 's'}
            </span>
          ) : null
        }
      >
        {planLoading || !buckets ? (
          <div className="px-4 py-3">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : buckets.bucket2.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            None — every today-deadline order belongs to a priority account.
          </div>
        ) : (
          <OrderList orders={buckets.bucket2} />
        )}
      </BucketShell>

      {/* BUCKET 3 — Work ahead (tomorrow) */}
      <BucketShell
        title="Work ahead — tomorrow"
        right={
          buckets ? (
            <span className="text-xs text-muted-foreground">
              {buckets.bucket3.length} order{buckets.bucket3.length === 1 ? '' : 's'} · priority first
            </span>
          ) : null
        }
      >
        {planLoading || !buckets ? (
          <div className="px-4 py-3">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : buckets.bucket3.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">No orders for tomorrow yet.</div>
        ) : (
          <OrderList
            orders={buckets.bucket3}
            highlightAccountIds={buckets.tomorrowPriorityIds}
          />
        )}
      </BucketShell>

      {/* ANOMALIES (unchanged) */}
      {hasAnomalies && (
        <div className="space-y-3">
          {surprises.length > 0 && (
            <div className="rounded-md border-2 border-amber-500 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
              <div className="mb-2 flex items-center gap-2 text-base font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-5 w-5" />
                Order surprises
              </div>
              <ul className="space-y-1 text-sm">
                {visibleSurprises.map((a) => (
                  <li key={a.key} className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {a.orderId ? (
                        <Link
                          to={`/orders/${a.orderId}`}
                          className="text-amber-900 hover:underline dark:text-amber-100"
                        >
                          {a.message}
                        </Link>
                      ) : (
                        <span className="text-amber-900 dark:text-amber-100">{a.message}</span>
                      )}
                    </div>
                    <button
                      onClick={() => dismiss(a.key)}
                      className="shrink-0 rounded p-1 text-amber-800/70 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/60 dark:hover:bg-amber-900/40"
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {extraSurprises > 0 && (
                  <li className="text-xs text-amber-800/80 dark:text-amber-200/80">
                    +{extraSurprises} more
                  </li>
                )}
              </ul>
            </div>
          )}

          {orphans.length > 0 && (
            <div className="rounded-md border border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                <Info className="h-4 w-4" />
                Data orphans
              </div>
              <ul className="space-y-1 text-xs">
                {visibleOrphans.map((a) => {
                  const isBatch = a.key.startsWith('D-') || a.key.startsWith('G-');
                  const target = a.orderId
                    ? `/orders/${a.orderId}`
                    : isBatch
                      ? '/production'
                      : null;
                  return (
                    <li key={a.key} className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {target ? (
                          <Link
                            to={target}
                            className="text-slate-700 hover:underline dark:text-slate-300"
                          >
                            {a.message}
                          </Link>
                        ) : (
                          <span className="text-slate-700 dark:text-slate-300">{a.message}</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {renderActionButton(a)}
                        <button
                          onClick={() => dismiss(a.key)}
                          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          aria-label="Dismiss"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
                {extraOrphans > 0 && (
                  <li className="text-xs text-slate-500 dark:text-slate-400">
                    +{extraOrphans} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────
function Stat({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
  emphasis?: boolean;
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-destructive'
      : tone === 'ok'
        ? 'text-green-700 dark:text-green-400'
        : 'text-foreground';
  return (
    <div className="rounded border bg-background px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono ${emphasis ? 'text-sm font-semibold' : 'text-xs'} ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

function BucketShell({
  icon,
  title,
  right,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function PriorityAccountCard({
  row,
  lastFunkImport,
}: {
  row: {
    account: AccountRow;
    orders: OpenOrder[];
    kg: number;
    lastOrderAt: string | null;
  };
  lastFunkImport: {
    file_name: string | null;
    imported_at: string;
    orders_new: number;
    orders_skipped: number;
  } | null;
}) {
  const [open, setOpen] = useState(row.orders.length === 0);
  const hasOrders = row.orders.length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <Link
              to={`/accounts/${row.account.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium hover:underline truncate"
            >
              {row.account.account_name}
            </Link>
            {hasOrders ? (
              <Badge
                variant="outline"
                className="text-[10px] h-5 border-green-500 text-green-700 dark:text-green-400"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {row.orders.length} order{row.orders.length === 1 ? '' : 's'}
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px] h-5">
                <AlertCircle className="h-3 w-3 mr-1" /> No order yet
              </Badge>
            )}
          </div>
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {hasOrders ? fmtKg(row.kg) : '—'}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-10 pb-3 pt-1 space-y-2 text-xs">
          <div className="text-muted-foreground">
            Last order entered:{' '}
            {row.lastOrderAt ? (
              <span title={row.lastOrderAt}>
                {formatDistanceToNow(parseISO(row.lastOrderAt), { addSuffix: true })}
              </span>
            ) : (
              <span className="italic">never</span>
            )}
            {lastFunkImport && (
              <>
                {' '}· Last CSV import:{' '}
                <span title={lastFunkImport.imported_at}>
                  {formatDistanceToNow(parseISO(lastFunkImport.imported_at), { addSuffix: true })}
                </span>{' '}
                ({lastFunkImport.orders_new} new, {lastFunkImport.orders_skipped} skipped)
              </>
            )}
          </div>

          {hasOrders ? (
            <ul className="divide-y rounded border bg-background">
              {row.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link to={`/orders/${o.id}`} className="font-medium hover:underline">
                      #{o.order_number}
                    </Link>
                    {o.locationName && (
                      <span className="text-muted-foreground truncate">· {o.locationName}</span>
                    )}
                    <Badge variant="outline" className="text-[10px] h-4">
                      {o.status}
                    </Badge>
                  </div>
                  <span className="font-mono text-muted-foreground">{fmtKg(o.kg)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded border border-dashed bg-background px-3 py-2">
              <span className="text-destructive">
                No order entered for {row.account.account_name} today.
              </span>
              {lastFunkImport !== null || /funk/i.test(row.account.account_name) ? (
                <Button asChild size="sm" variant="outline" className="h-6 text-[11px]">
                  <Link to="/admin/funk-import">
                    <Upload className="h-3 w-3 mr-1" /> Import CSV
                  </Link>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline" className="h-6 text-[11px]">
                <Link to={`/orders/new?account=${row.account.id}`}>
                  <PlusCircle className="h-3 w-3 mr-1" /> Create order
                </Link>
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function OrderList({
  orders,
  highlightAccountIds,
}: {
  orders: OpenOrder[];
  highlightAccountIds?: Set<string>;
}) {
  return (
    <ul className="divide-y">
      {orders.slice(0, 50).map((o) => {
        const isPriority =
          highlightAccountIds && o.account_id && highlightAccountIds.has(o.account_id);
        return (
          <li
            key={o.id}
            className="px-4 py-2 flex items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Link to={`/orders/${o.id}`} className="font-medium hover:underline shrink-0">
                #{o.order_number}
              </Link>
              <span className="text-foreground/80 truncate">
                {o.accountName}
                {o.locationName ? ` · ${o.locationName}` : ''}
              </span>
              {isPriority && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-4 shrink-0 border-amber-500 text-amber-700 dark:text-amber-400"
                >
                  priority
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] h-4 shrink-0">
                {o.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {o.kg > 0 && <span className="font-mono text-muted-foreground">{fmtKg(o.kg)}</span>}
              <span className="font-mono text-muted-foreground">
                {o.workDeadlineRaw
                  ? format(
                      o.workDeadlineRaw.length === 10
                        ? parseISO(o.workDeadlineRaw)
                        : new Date(o.workDeadlineRaw),
                      'MMM d'
                    )
                  : '—'}
              </span>
            </div>
          </li>
        );
      })}
      {orders.length > 50 && (
        <li className="px-4 py-2 text-[11px] text-muted-foreground text-center">
          +{orders.length - 50} more — see{' '}
          <Link to="/orders" className="hover:underline">
            Orders
          </Link>
        </li>
      )}
    </ul>
  );
}
