import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Minus, Plus, AlertTriangle } from 'lucide-react';
import { useDashboardMetrics, TimeHorizon } from '@/hooks/useDashboardMetrics';
import { PacificTimeTicker } from '@/components/production/PacificTimeTicker';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { format, addDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// ===== VU Meter =====
function VuMeter({
  litCount,
  segments = 12,
  isLoading,
}: {
  litCount: number;
  segments?: number;
  isLoading: boolean;
}) {
  const getSegmentColor = (index: number, isLit: boolean) => {
    if (!isLit) return 'bg-zinc-700';
    const pct = index / segments;
    if (pct >= 10 / 12) return 'bg-red-500';
    if (pct >= 7 / 12) return 'bg-yellow-400';
    return 'bg-green-500';
  };

  return (
    <div className="border border-zinc-700 rounded-sm p-1 bg-zinc-950 flex flex-col-reverse gap-px">
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          className={`rounded-[1px] transition-colors ${
            segments === 16 ? 'w-6 h-2.5' : 'w-6 h-3'
          } ${isLoading ? 'bg-zinc-800 animate-pulse' : getSegmentColor(i, i < litCount)}`}
        />
      ))}
    </div>
  );
}

// ===== Mini bar for production vs co-roast split =====
function MiniBar({ production, coroast, label }: { production: number; coroast: number; label: string }) {
  const total = production + coroast;
  if (total === 0) return <span className="text-[10px] text-zinc-300">{label}: 0 kg</span>;
  const prodPct = (production / total) * 100;
  return (
    <div className="w-full space-y-0.5">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-800">
        <div className="bg-green-500" style={{ width: `${prodPct}%` }} />
        <div className="bg-green-500/40" style={{ width: `${100 - prodPct}%` }} />
      </div>
      <div className="flex justify-between text-[9px] text-zinc-300">
        <span>{production.toFixed(0)} prod</span>
        <span>{coroast.toFixed(0)} co-r</span>
      </div>
    </div>
  );
}

// ===== Channel Strip =====
function ChannelStrip({
  label,
  value,
  unit,
  subLabel,
  litCount,
  isLoading,
  children,
}: {
  label: string;
  value: string;
  unit: string;
  subLabel?: string;
  litCount: number;
  isLoading: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 w-16 shrink-0">
      <span className="text-[10px] font-semibold tracking-widest text-zinc-100 uppercase drop-shadow-[0_0_4px_rgba(255,255,255,0.4)]">
        {label}
      </span>
      <VuMeter litCount={litCount} isLoading={isLoading} />
      <p className="text-sm font-bold tabular-nums text-white leading-tight drop-shadow-[0_0_8px_rgba(255,255,255,0.7)]">
        {isLoading ? '—' : value}
      </p>
      <p className="text-[10px] text-zinc-300">{unit}</p>
      {children}
      {subLabel && <p className="text-[10px] text-zinc-300 text-center leading-tight">{subLabel}</p>}
    </div>
  );
}

// ===== Helpers =====
function calcLitCount(demand: number, hoursRemaining: number, capacityPerHr: number, segments = 12): number {
  const hrs = Math.max(0.5, hoursRemaining);
  const loadRatio = (demand / hrs) / capacityPerHr;
  return Math.min(segments, Math.round(loadRatio * segments));
}

// ===== Horizon Button =====
const horizonOptions: { value: TimeHorizon; label: string }[] = [
  { value: 'today', label: 'TODAY' },
  { value: 'tomorrow', label: 'TMRW' },
  { value: 'week', label: 'WEEK' },
];

// ===== Main Component =====
export function ProductionFlowTab() {
  const [horizon, setHorizon] = useState<TimeHorizon>('today');
  const { data: metrics, isLoading, refetch } = useDashboardMetrics(horizon);
  const [localStaff, setLocalStaff] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const staffCount = localStaff ?? metrics?.staffCount ?? 2.5;
  const hrs = Math.max(0.5, metrics?.hoursRemainingToday ?? 1);

  const roastCapPerHr = staffCount * 40;
  const packCapPerHr = staffCount * 33.5;
  const avgOrderKg = 10;
  const shipCapPerHr = staffCount * (33.5 / avgOrderKg);

  // Calculate lit counts
  const channelData = useMemo(() => {
    if (!metrics) return null;
    const samiacTotal = metrics.samiacBatchKgToday + metrics.samiacCoroastKgToday;
    const loringTotal = metrics.loringBatchKgToday + metrics.loringCoroastKgToday;

    const samiacLit = calcLitCount(samiacTotal, hrs, roastCapPerHr);
    const loringLit = calcLitCount(loringTotal, hrs, roastCapPerHr);
    const wipLit = calcLitCount(metrics.wipNeededTodayKg, hrs, packCapPerHr);
    const fgLit = calcLitCount(metrics.fgNeededTodayUnits, hrs, packCapPerHr * 10 / avgOrderKg);
    const shipLit = calcLitCount(metrics.ordersToShipToday, hrs, shipCapPerHr);

    const loads = [samiacLit, loringLit, wipLit, fgLit, shipLit];
    const masterLit = Math.min(16, Math.round((loads.reduce((a, b) => a + b, 0) / (5 * 12)) * 16));

    return { samiacLit, loringLit, wipLit, fgLit, shipLit, masterLit, loads };
  }, [metrics, hrs, roastCapPerHr, packCapPerHr, shipCapPerHr, avgOrderKg]);

  // Warning channels
  const redChannels = useMemo(() => {
    if (!channelData) return [];
    const names = ['Samiac', 'Loring', 'WIP/Pack', 'FG/Pack', 'Ship'];
    const suggestions = [
      'consider pushing lower-priority batches to tomorrow',
      'consider pushing batches or co-roasting bookings',
      'consider pushing lower-priority orders to tomorrow',
      'consider pushing lower-priority orders to tomorrow',
      'consider pushing lower-priority orders to tomorrow or adding a body to shipping',
    ];
    return channelData.loads
      .map((lit, i) => ({ name: names[i], suggestion: suggestions[i], lit }))
      .filter(c => c.lit >= 11);
  }, [channelData]);

  // Triage orders
  const tz = 'America/Vancouver';
  const zonedNow = toZonedTime(new Date(), tz);
  const todayStr = format(startOfDay(zonedNow), 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(startOfDay(zonedNow), 1), 'yyyy-MM-dd');

  const { data: triageOrders, refetch: refetchTriage } = useQuery({
    queryKey: ['triage-orders-today'],
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          work_deadline,
          status,
          client_id,
          clients ( name ),
          order_line_items ( id )
        `)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .gte('work_deadline', todayStr)
        .lte('work_deadline', tomorrowStr)
        .order('work_deadline', { ascending: true });
      return data || [];
    },
  });

  const handlePushToTomorrow = async (orderId: string) => {
    const { error } = await supabase
      .from('orders')
      .update({ work_deadline: tomorrowStr })
      .eq('id', orderId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Pushed to tomorrow' });
    refetch();
    refetchTriage();
    queryClient.invalidateQueries({ queryKey: ['dashboard-metrics-v3'] });
  };

  const horizonLabel = horizon === 'today'
    ? 'Today & Tomorrow'
    : horizon === 'tomorrow'
      ? 'Day After Tomorrow'
      : 'This Week (Mon–Fri)';

  return (
    <div className="space-y-4">
      {/* Header — external */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Production Flow</h2>
            <span className="text-sm text-muted-foreground tabular-nums">
              {metrics ? `${metrics.hoursRemainingToday}h left today` : '—'}
            </span>
          </div>
          <PacificTimeTicker />
        </div>

        <Button variant="ghost" size="icon" onClick={() => refetch()} className="h-8 w-8">
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Context line */}
      <p className="text-xs text-muted-foreground">
        Showing: <span className="font-medium">{horizonLabel}</span>
        {metrics && (
          <span className="ml-2">
            ({metrics.ordersInWindow} orders, {metrics.lineItemsInWindow} line items)
          </span>
        )}
      </p>

      {/* Warning banners */}
      {redChannels.map((ch) => (
        <div
          key={ch.name}
          className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>
            <strong>{ch.name}</strong> is over capacity — {ch.suggestion}.
          </span>
        </div>
      ))}

      {/* ===== Console ===== */}
      <div className="bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
        {/* Console header bar */}
        <div className="bg-zinc-900 border-b border-zinc-700 px-4 py-2 flex items-center justify-between">
          <span className="text-zinc-400 text-[10px] uppercase tracking-widest font-semibold">
            Floor Console
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider mr-2">Staff</span>
            <button
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-400 transition-colors"
              onClick={() => setLocalStaff(Math.max(0.5, staffCount - 0.5))}
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="text-sm font-bold tabular-nums w-8 text-center text-green-400 drop-shadow-[0_0_6px_rgba(74,222,128,0.5)]">
              {staffCount}
            </span>
            <button
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-400 transition-colors"
              onClick={() => setLocalStaff(Math.min(6, staffCount + 0.5))}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Console body */}
        <div className="p-4 overflow-x-auto">
          <div className="flex items-end justify-between min-w-max">
            {/* Left: Channel strips */}
            <div className="flex items-end gap-4">
              {/* Channel 1 — Samiac */}
              <ChannelStrip
                label="Samiac"
                value={`${((metrics?.samiacBatchKgToday ?? 0) + (metrics?.samiacCoroastKgToday ?? 0)).toFixed(0)}`}
                unit="kg"
                litCount={channelData?.samiacLit ?? 0}
                isLoading={isLoading}
              >
                <MiniBar
                  production={metrics?.samiacBatchKgToday ?? 0}
                  coroast={metrics?.samiacCoroastKgToday ?? 0}
                  label="samiac"
                />
              </ChannelStrip>

              {/* Channel 2 — Loring */}
              <ChannelStrip
                label="Loring"
                value={`${((metrics?.loringBatchKgToday ?? 0) + (metrics?.loringCoroastKgToday ?? 0)).toFixed(0)}`}
                unit="kg"
                litCount={channelData?.loringLit ?? 0}
                isLoading={isLoading}
              >
                <MiniBar
                  production={metrics?.loringBatchKgToday ?? 0}
                  coroast={metrics?.loringCoroastKgToday ?? 0}
                  label="loring"
                />
              </ChannelStrip>

              {/* Channel 3 — WIP */}
              <ChannelStrip
                label="WIP"
                value={`${(metrics?.wipNeededTodayKg ?? 0).toFixed(0)}`}
                unit="kg"
                subLabel="PACK"
                litCount={channelData?.wipLit ?? 0}
                isLoading={isLoading}
              />

              {/* Channel 4 — FG */}
              <ChannelStrip
                label="FG"
                value={`${metrics?.fgNeededTodayUnits ?? 0}`}
                unit="units"
                subLabel="PICK"
                litCount={channelData?.fgLit ?? 0}
                isLoading={isLoading}
              />

              {/* Channel 5 — Ship */}
              <ChannelStrip
                label="Ship"
                value={`${metrics?.ordersToShipToday ?? 0}`}
                unit="orders"
                subLabel="SHIP"
                litCount={channelData?.shipLit ?? 0}
                isLoading={isLoading}
              />
            </div>

            {/* Right: Divider + Master + Horizon buttons */}
            <div className="flex items-end gap-4">
              {/* Divider */}
              <div className="w-px h-48 bg-zinc-600 shrink-0" />

              {/* Master */}
              <div className="flex flex-col items-center gap-1.5 w-24 shrink-0">
                <span className="text-[10px] font-semibold tracking-widest text-zinc-100 uppercase drop-shadow-[0_0_4px_rgba(255,255,255,0.4)]">
                  Master
                </span>
                <div className="flex gap-1">
                  <VuMeter litCount={channelData?.masterLit ?? 0} segments={16} isLoading={isLoading} />
                  <VuMeter litCount={channelData?.masterLit ?? 0} segments={16} isLoading={isLoading} />
                </div>
                <p className="text-lg font-bold tabular-nums text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]">
                  {isLoading ? '—' : `${metrics?.masterLoadPct ?? 0}%`}
                </p>
                <p className="text-[10px] text-zinc-400">floor load</p>
              </div>

              {/* Horizon selector buttons */}
              <div className="flex flex-col gap-2 ml-4">
                {horizonOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setHorizon(opt.value)}
                    className={`w-20 h-10 rounded text-xs font-bold uppercase tracking-wider border transition-all ${
                      horizon === opt.value
                        ? 'bg-zinc-700 border-green-400 text-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]'
                        : 'bg-zinc-800 border-zinc-600 text-zinc-500 hover:border-zinc-500 hover:text-zinc-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Triage list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Orders Due Today</CardTitle>
        </CardHeader>
        <CardContent>
          {!triageOrders || triageOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders due today.</p>
          ) : (
            <div className="space-y-2">
              {triageOrders.map((order: any) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono font-medium">{order.order_number}</span>
                    <span className="text-muted-foreground truncate">
                      {order.clients?.name ?? '—'}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {order.order_line_items?.length ?? 0} items
                    </span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {(order.status as string).toLowerCase().replace('_', ' ')}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-xs"
                    onClick={() => handlePushToTomorrow(order.id)}
                  >
                    Push to Tomorrow
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Explanation */}
      <Card>
        <CardContent className="pt-4">
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Samiac / Loring</strong>: planned roasting kg for today, split by roaster.
              Co-roasting bookings add to Loring load at 40 kg/hr.
            </p>
            <p>
              <strong>WIP</strong>: roasted coffee kg still needed to pack today's orders.
            </p>
            <p>
              <strong>FG</strong>: finished good units still unpicked for today's orders.
            </p>
            <p>
              <strong>Ship</strong>: open orders due today not yet shipped.
            </p>
            <p>
              <strong>Master</strong>: weighted average load across all five channels.
              Adjust <em>Staff</em> to see how adding or removing a person changes capacity.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}