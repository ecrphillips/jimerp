import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toZonedTime } from 'date-fns-tz';
import { format, formatDistanceToNow, getDay, getHours, subDays, parseISO, isBefore, isToday } from 'date-fns';
import { AlertTriangle, Info, X, Trash2, CheckCircle2, AlertCircle, CalendarClock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  TIMEZONE,
  getVancouverDateString,
  getVancouverNow,
} from '@/lib/productionScheduling';
import type { DateFilterConfig } from '@/components/production/types';

interface PlanTabProps {
  dateFilterConfig: DateFilterConfig;
  today: string;
}

function resolveTargetDate(mode: DateFilterConfig['mode'], today: string): string | null {
  if (mode === 'today') return today;
  if (mode === 'tomorrow') return getVancouverDateString(1);
  return null;
}

function dayShapeLabel(mode: DateFilterConfig['mode']): string {
  if (mode === 'today') return 'Today';
  if (mode === 'tomorrow') return 'Tomorrow';
  return 'All open';
}

const pl = (n: number, singular: string, plural?: string) =>
  `${n} ${n === 1 ? singular : (plural ?? singular + 's')}`;

type Anomaly = {
  key: string;
  message: string;
  orderId?: string;
  // Action descriptor — when set, an inline button is rendered
  action?:
    | { kind: 'delete-batch'; batchId: string }
    | { kind: 'open-order'; orderId: string };
};

type AnomaliesResult = {
  orderSurprises: Anomaly[];
};

type OrphansResult = {
  orphans: Anomaly[];
};

const DISMISS_STORAGE_KEY = 'plan-tab-dismissed-orphans-v1';

function readDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeDismissed(set: Set<string>) {
  try {
    sessionStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

export function PlanTab({ dateFilterConfig, today }: PlanTabProps) {
  const queryClient = useQueryClient();
  const targetDate = useMemo(
    () => resolveTargetDate(dateFilterConfig.mode, today),
    [dateFilterConfig.mode, today]
  );
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    writeDismissed(dismissed);
  }, [dismissed]);

  const dismiss = (key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const invalidateAfterMutation = () => {
    queryClient.invalidateQueries({ queryKey: ['plan-data-orphans'] });
    queryClient.invalidateQueries({ queryKey: ['plan-day-shape'] });
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

  const { data: dayShape, isLoading } = useQuery({
    queryKey: ['plan-day-shape', dateFilterConfig.mode, targetDate],
    queryFn: async () => {
      let batchesQ = supabase
        .from('roasted_batches')
        .select('roast_group, planned_output_kg, target_date');
      if (targetDate) batchesQ = batchesQ.eq('target_date', targetDate);

      let ordersQ = supabase
        .from('orders')
        .select('id, status, requested_ship_date')
        .not('status', 'in', '(SHIPPED,CANCELLED)');
      if (targetDate) ordersQ = ordersQ.eq('requested_ship_date', targetDate);

      const [batchesRes, ordersRes] = await Promise.all([batchesQ, ordersQ]);
      if (batchesRes.error) throw batchesRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const batches = batchesRes.data ?? [];
      const greenKg = batches.reduce(
        (sum, b) => sum + (b.planned_output_kg ?? 0),
        0
      );
      const roastGroupSet = new Set(batches.map((b) => b.roast_group));

      return {
        batches: batches.length,
        roastGroups: roastGroupSet.size,
        greenKg,
        openOrders: (ordersRes.data ?? []).length,
      };
    },
  });

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

      // Rule A — recurring missing (only after 11:00 Vancouver time)
      if (vHour >= 11) {
        type ClientAgg = {
          name: string;
          matchDays: Set<string>;
          hasToday: boolean;
        };
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

      // Rule B — duplicate orders within last 24h
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

      // Rule C — discontinued product on open order
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

      // Rule D — stuck batch (PLANNED status, created > 24h ago)
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

      // Rule G — ghost batches: roasted_batches with no wip_ledger reference
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
          // Skip PLANNED rows — Rule D already covers them; ghost = ROASTED/COMPLETED w/o ledger
          if (b.status === 'PLANNED') continue;
          orphans.push({
            key: `G-${b.id}`,
            message: `Ghost batch ${b.roast_group} (${b.target_date}) — no inventory ledger entries`,
            action: { kind: 'delete-batch', batchId: b.id },
          });
        }
      }

      // Rule F (picked > required)
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

  // ─────────────────────────────────────────────────────────────────────────
  // NEW: Priority accounts today + remaining open orders
  // ─────────────────────────────────────────────────────────────────────────
  const { data: priorityPlan, isLoading: priorityLoading } = useQuery({
    queryKey: ['plan-priority-today', today],
    queryFn: async () => {
      const vNow = getVancouverNow();
      const jsDay = getDay(vNow); // 0=Sun..6=Sat
      const isoWeekday = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun

      // 1. Accounts that schedule production today
      const acctRes = await supabase
        .from('accounts')
        .select(
          'id, account_name, production_weekdays, account_locations(id, location_name, is_active)'
        )
        .contains('production_weekdays', [isoWeekday])
        .eq('is_active', true);
      if (acctRes.error) throw acctRes.error;
      const priorityAccounts = acctRes.data ?? [];
      const priorityIds = new Set(priorityAccounts.map((a) => a.id));

      // 2. All open orders (with line items + bag sizes for kg totals)
      const ordersRes = await supabase
        .from('orders')
        .select(
          `id, order_number, status, requested_ship_date, work_deadline, work_deadline_at,
           account_id, account_location_id, client_id,
           accounts(account_name), account_locations(location_name),
           clients(name),
           order_line_items(quantity_units, products(bag_size_g))`
        )
        .not('status', 'in', '(SHIPPED,CANCELLED)');
      if (ordersRes.error) throw ordersRes.error;
      const allOpen = ordersRes.data ?? [];

      // Helper — compute kg for an order from line items
      const orderKg = (o: typeof allOpen[number]): number => {
        const lines = (o.order_line_items ?? []) as Array<{
          quantity_units: number | null;
          products: { bag_size_g: number | null } | null;
        }>;
        return lines.reduce(
          (sum, li) => sum + ((li.quantity_units ?? 0) * (li.products?.bag_size_g ?? 0)) / 1000,
          0
        );
      };

      // 3. Group orders by account for priority accounts (any open order counts as "covered" for the location)
      type LocStatus = {
        locationId: string;
        locationName: string;
        orders: Array<{ id: string; orderNumber: string; kg: number; status: string }>;
      };
      type AcctRow = {
        accountId: string;
        accountName: string;
        locations: LocStatus[];
        totalKg: number;
        anyMissing: boolean;
      };

      const acctRows: AcctRow[] = priorityAccounts.map((a) => {
        const locs = ((a.account_locations as Array<{
          id: string;
          location_name: string;
          is_active: boolean;
        }> | null) ?? []).filter((l) => l.is_active);
        const acctOpen = allOpen.filter((o) => o.account_id === a.id);

        // If the account has NO defined locations, treat as a single implicit location bucket
        const locStatuses: LocStatus[] = locs.length === 0
          ? [{
              locationId: '__none__',
              locationName: 'Default',
              orders: acctOpen.map((o) => ({
                id: o.id,
                orderNumber: o.order_number,
                kg: orderKg(o),
                status: o.status,
              })),
            }]
          : locs.map((l) => {
              const matching = acctOpen.filter((o) => o.account_location_id === l.id);
              return {
                locationId: l.id,
                locationName: l.location_name,
                orders: matching.map((o) => ({
                  id: o.id,
                  orderNumber: o.order_number,
                  kg: orderKg(o),
                  status: o.status,
                })),
              };
            });

        const totalKg = locStatuses.reduce(
          (sum, l) => sum + l.orders.reduce((s, o) => s + o.kg, 0),
          0
        );
        const anyMissing = locStatuses.some((l) => l.orders.length === 0);
        return {
          accountId: a.id,
          accountName: a.account_name,
          locations: locStatuses,
          totalKg,
          anyMissing,
        };
      });

      // Sort: missing first, then by name
      acctRows.sort((a, b) => {
        if (a.anyMissing !== b.anyMissing) return a.anyMissing ? -1 : 1;
        return a.accountName.localeCompare(b.accountName);
      });

      // 4. Other open orders (not in priority accounts), sorted by work deadline
      const otherOrders = allOpen
        .filter((o) => !o.account_id || !priorityIds.has(o.account_id))
        .map((o) => ({
          id: o.id,
          orderNumber: o.order_number,
          status: o.status,
          accountName:
            (o.accounts as { account_name?: string } | null)?.account_name ??
            (o.clients as { name?: string } | null)?.name ??
            'Unknown',
          locationName:
            (o.account_locations as { location_name?: string } | null)?.location_name ?? null,
          kg: orderKg(o),
          workDeadline: o.work_deadline_at ?? o.work_deadline ?? null,
          requestedShipDate: o.requested_ship_date ?? null,
        }))
        .sort((a, b) => {
          const ad = a.workDeadline ?? a.requestedShipDate ?? '9999-12-31';
          const bd = b.workDeadline ?? b.requestedShipDate ?? '9999-12-31';
          return ad.localeCompare(bd);
        });

      return { acctRows, otherOrders, weekdayName: format(vNow, 'EEEE') };
    },
  });

  const label = dayShapeLabel(dateFilterConfig.mode);
  const surprises = (anomalies?.orderSurprises ?? []).filter((a) => !dismissed.has(a.key));
  const visibleSurprises = surprises.slice(0, 2);
  const extraSurprises = surprises.length - visibleSurprises.length;
  const orphans = (orphansData?.orphans ?? []).filter((a) => !dismissed.has(a.key));
  const visibleOrphans = orphans.slice(0, 5);
  const extraOrphans = orphans.length - visibleOrphans.length;
  const hasAnomalies = surprises.length > 0 || orphans.length > 0;

  const fmtKg = (kg: number) => `${kg.toFixed(1)} kg / ${(kg * 2.20462).toFixed(1)} lb`;
  const deadlineTone = (iso: string | null): 'overdue' | 'today' | 'soon' | 'later' => {
    if (!iso) return 'later';
    const d = iso.length === 10 ? parseISO(iso) : new Date(iso);
    if (isToday(d)) return 'today';
    if (isBefore(d, new Date())) return 'overdue';
    const days = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days < 3 ? 'soon' : 'later';
  };

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

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card px-4 py-3">
        {isLoading || !dayShape ? (
          <Skeleton className="h-6 w-3/4" />
        ) : (
          <p className="text-base font-medium">
            {label}: {pl(dayShape.batches, 'batch', 'batches')} across{' '}
            {pl(dayShape.roastGroups, 'roast group')}, ~{Math.round(dayShape.greenKg)} kg green,{' '}
            {pl(dayShape.openOrders, 'order')} open
          </p>
        )}
      </div>

      {/* Priority accounts today */}
      <div className="rounded-md border bg-card">
        <div className="border-b px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              Priority accounts — {priorityPlan?.weekdayName ?? format(getVancouverNow(), 'EEEE')}
            </h3>
          </div>
          {priorityPlan && (
            <span className="text-xs text-muted-foreground">
              {priorityPlan.acctRows.length} account{priorityPlan.acctRows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="divide-y">
          {priorityLoading ? (
            <div className="px-4 py-3"><Skeleton className="h-12 w-full" /></div>
          ) : !priorityPlan || priorityPlan.acctRows.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              No accounts scheduled for production today.
            </div>
          ) : (
            priorityPlan.acctRows.map((acct) => (
              <div key={acct.accountId} className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link
                      to={`/internal/accounts/${acct.accountId}`}
                      className="text-sm font-medium hover:underline truncate"
                    >
                      {acct.accountName}
                    </Link>
                    {acct.anyMissing ? (
                      <Badge variant="destructive" className="text-[10px] h-5">
                        <AlertCircle className="h-3 w-3 mr-1" /> Missing order
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] h-5 border-green-500 text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Covered
                      </Badge>
                    )}
                  </div>
                  {acct.totalKg > 0 && (
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {fmtKg(acct.totalKg)}
                    </span>
                  )}
                </div>
                <ul className="space-y-1 pl-1">
                  {acct.locations.map((loc) => {
                    const locKg = loc.orders.reduce((s, o) => s + o.kg, 0);
                    const hasOrder = loc.orders.length > 0;
                    return (
                      <li
                        key={loc.locationId}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {hasOrder ? (
                            <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
                          ) : (
                            <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                          )}
                          <span className="text-muted-foreground truncate">{loc.locationName}</span>
                          {hasOrder ? (
                            <span className="text-foreground/80">
                              ·{' '}
                              {loc.orders.map((o, i) => (
                                <React.Fragment key={o.id}>
                                  {i > 0 && ', '}
                                  <Link
                                    to={`/internal/orders/${o.id}`}
                                    className="hover:underline"
                                  >
                                    #{o.orderNumber}
                                  </Link>
                                </React.Fragment>
                              ))}
                            </span>
                          ) : (
                            <span className="text-destructive">— no order entered</span>
                          )}
                        </div>
                        {hasOrder && (
                          <span className="font-mono text-muted-foreground shrink-0">
                            {fmtKg(locKg)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Other open orders */}
      {priorityPlan && priorityPlan.otherOrders.length > 0 && (
        <div className="rounded-md border bg-card">
          <div className="border-b px-4 py-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Other open orders</h3>
            <span className="text-xs text-muted-foreground">
              {priorityPlan.otherOrders.length} order
              {priorityPlan.otherOrders.length === 1 ? '' : 's'} · sorted by work deadline
            </span>
          </div>
          <ul className="divide-y">
            {priorityPlan.otherOrders.slice(0, 25).map((o) => {
              const tone = deadlineTone(o.workDeadline);
              const toneClass =
                tone === 'overdue'
                  ? 'text-destructive font-medium'
                  : tone === 'today'
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : tone === 'soon'
                  ? 'text-amber-700/80 dark:text-amber-300/80'
                  : 'text-muted-foreground';
              return (
                <li key={o.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Link
                      to={`/internal/orders/${o.id}`}
                      className="font-medium hover:underline shrink-0"
                    >
                      #{o.orderNumber}
                    </Link>
                    <span className="text-foreground/80 truncate">
                      {o.accountName}
                      {o.locationName ? ` · ${o.locationName}` : ''}
                    </span>
                    <Badge variant="outline" className="text-[10px] h-4 shrink-0">
                      {o.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {o.kg > 0 && (
                      <span className="font-mono text-muted-foreground">{fmtKg(o.kg)}</span>
                    )}
                    <span className={`font-mono ${toneClass}`}>
                      {o.workDeadline
                        ? format(
                            o.workDeadline.length === 10
                              ? parseISO(o.workDeadline)
                              : new Date(o.workDeadline),
                            'MMM d'
                          )
                        : '—'}
                    </span>
                  </div>
                </li>
              );
            })}
            {priorityPlan.otherOrders.length > 25 && (
              <li className="px-4 py-2 text-[11px] text-muted-foreground text-center">
                +{priorityPlan.otherOrders.length - 25} more — see{' '}
                <Link to="/internal/orders" className="hover:underline">Orders</Link>
              </li>
            )}
          </ul>
        </div>
      )}



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
