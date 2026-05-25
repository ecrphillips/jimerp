import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toZonedTime } from 'date-fns-tz';
import { format, formatDistanceToNow, getDay, getHours, subDays } from 'date-fns';
import { AlertTriangle, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
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

type Anomaly = {
  key: string;
  message: string;
  orderId?: string;
};

type AnomaliesResult = {
  orderSurprises: Anomaly[];
};

type OrphansResult = {
  orphans: Anomaly[];
};

export function PlanTab({ dateFilterConfig, today }: PlanTabProps) {
  const targetDate = useMemo(
    () => resolveTargetDate(dateFilterConfig.mode, today),
    [dateFilterConfig.mode, today]
  );

  const { data: dayShape, isLoading } = useQuery({
    queryKey: ['plan-day-shape', dateFilterConfig.mode, targetDate],
    queryFn: async () => {
      // planned_output_kg on roasted_batches represents inbound green kg
      // per the existing RoastTab convention.
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

      // NOTE: Rules A and B currently only consider orders.client_id, not
      // orders.account_id. Extend to account-scoped orders in a later pass.
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
        });
      }

      // Rule E (shipped but no timestamp) intentionally skipped — orders table has no shipped_at column.
      // Future migration: add orders.shipped_at timestamptz, populate on status transition to SHIPPED, then implement this rule.

      // Rule F (picked > required) — sum ship_picks.units_picked per order_line_item_id, compare to quantity_units
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
          });
        }
      }

      // Rule F yield sub-check skipped — roasted_batches has no planned roasted output column.
      // actual_output_kg exists but there's no expected baseline to compare against.

      return { orphans };
    },
  });

  const label = dayShapeLabel(dateFilterConfig.mode);
  const surprises = anomalies?.orderSurprises ?? [];
  const visibleSurprises = surprises.slice(0, 2);
  const extraSurprises = surprises.length - visibleSurprises.length;
  const orphans = orphansData?.orphans ?? [];
  const visibleOrphans = orphans.slice(0, 2);
  const extraOrphans = orphans.length - visibleOrphans.length;
  const hasAnomalies = surprises.length > 0 || orphans.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card px-4 py-3">
        {isLoading || !dayShape ? (
          <Skeleton className="h-6 w-3/4" />
        ) : (
          <p className="text-base font-medium">
            {label}: {dayShape.batches} batches across {dayShape.roastGroups} roast
            groups, ~{Math.round(dayShape.greenKg)} kg green, {dayShape.openOrders}{' '}
            orders open
          </p>
        )}
      </div>

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
                  <li key={a.key}>
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
                  const isBatch = a.key.startsWith('D-');
                  const target = a.orderId
                    ? `/orders/${a.orderId}`
                    : isBatch
                      ? '/production'
                      : null;
                  return (
                    <li key={a.key}>
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
