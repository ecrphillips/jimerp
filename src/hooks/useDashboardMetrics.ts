import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, startOfWeek, addDays, format, getHours, getMinutes, getDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export type TimeHorizon = 'today' | 'tomorrow' | 'week';

export interface DashboardMetrics {
  // Channel 1 — Samiac
  samiacBatchKgToday: number;
  samiacCoroastKgToday: number;

  // Channel 2 — Loring
  loringBatchKgToday: number;
  loringCoroastKgToday: number;

  // Channel 3 — Pack pressure
  wipNeededTodayKg: number;

  // Channel 4 — FG pressure
  fgNeededTodayUnits: number;

  // Channel 5 — Ship pressure
  ordersToShipToday: number;

  // Master
  masterLoadPct: number;

  // Context
  hoursRemainingToday: number;
  ordersInWindow: number;
  lineItemsInWindow: number;

  // Staff
  staffCount: number;
}

export function useDashboardMetrics(horizon: TimeHorizon) {
  const tz = 'America/Vancouver';
  const now = new Date();
  const zonedNow = toZonedTime(now, tz);
  const today = startOfDay(zonedNow);
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const monday = startOfWeek(zonedNow, { weekStartsOn: 1 });
  const fridayEnd = addDays(monday, 5);

  const todayStr = format(today, 'yyyy-MM-dd');
  const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');

  const getDateFilter = () => {
    if (horizon === 'today') {
      return { gte: todayStr, lte: tomorrowStr };
    } else if (horizon === 'tomorrow') {
      return { gte: tomorrowStr, lte: format(dayAfter, 'yyyy-MM-dd') };
    }
    return { gte: format(monday, 'yyyy-MM-dd'), lte: format(fridayEnd, 'yyyy-MM-dd') };
  };

  const prodStartHourDefault = 8;
  const prodEndHourDefault = 16;

  return useQuery({
    queryKey: ['dashboard-metrics-v3', horizon],
    queryFn: async (): Promise<DashboardMetrics> => {
      // Fetch production window settings
      const { data: settingsRow } = await supabase
        .from('app_settings')
        .select('value_json')
        .eq('key', 'production_window')
        .maybeSingle();

      const prodWindow = settingsRow?.value_json as { start_hour: number; end_hour: number } | null;
      const prodStartHour = prodWindow?.start_hour ?? 8;
      const prodEndHour = prodWindow?.end_hour ?? 16;

      // Fetch staff count
      const { data: staffRow } = await supabase
        .from('app_settings')
        .select('value_json')
        .eq('key', 'floor_capacity')
        .maybeSingle();

      const staffJson = staffRow?.value_json as { staff_count: number } | null;
      const staffCount = staffJson?.staff_count ?? 2.5;

      // Hours remaining today (fractional so load doesn't jump at whole-hour boundaries)
      const currentHour = getHours(zonedNow);
      const currentMinute = getMinutes(zonedNow);
      const inWindow = currentHour >= prodStartHour && currentHour < prodEndHour;
      const hoursRemainingToday = inWindow
        ? Math.max(0, prodEndHour - currentHour - currentMinute / 60)
        : 0;

      const dateFilter = getDateFilter();

      // ===== Channel 1 & 2: Roaster batches today =====
      const { data: plannedBatches } = await supabase
        .from('roasted_batches')
        .select('roast_group, planned_output_kg, assigned_roaster')
        .eq('status', 'PLANNED')
        .eq('target_date', todayStr);

      let samiacBatchKgToday = 0;
      let loringBatchKgToday = 0;
      let unassignedKg = 0;

      for (const b of plannedBatches || []) {
        const kg = Number(b.planned_output_kg ?? 0);
        if (b.assigned_roaster === 'SAMIAC') {
          samiacBatchKgToday += kg;
        } else if (b.assigned_roaster === 'LORING') {
          loringBatchKgToday += kg;
        } else {
          unassignedKg += kg;
        }
      }
      // Split unassigned evenly
      samiacBatchKgToday += unassignedKg / 2;
      loringBatchKgToday += unassignedKg / 2;

      // ===== Channel 2b: Co-roasting today =====
      const { data: coroastBookings } = await supabase
        .from('coroast_bookings')
        .select('duration_hours, end_time')
        .eq('status', 'CONFIRMED')
        .eq('booking_date', todayStr);

      let loringCoroastKgToday = 0;
      const currentTotalMinutes = currentHour * 60 + currentMinute;

      for (const b of coroastBookings || []) {
        // For today's view, skip bookings that have already ended — their work is done
        // and they should no longer contribute to remaining demand.
        if (horizon === 'today' && b.end_time) {
          const [endH, endM] = b.end_time.split(':').map(Number);
          if (endH * 60 + (endM || 0) <= currentTotalMinutes) continue;
        }
        loringCoroastKgToday += (Number(b.duration_hours ?? 0)) * 40;
      }

      // Samiac doesn't do co-roasting
      const samiacCoroastKgToday = 0;

      // ===== Orders in window (for context line) =====
      let ordersQuery = supabase
        .from('orders')
        .select(`
          id,
          work_deadline,
          status,
          order_line_items (
            id,
            product_id,
            quantity_units
          )
        `)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);

      if (dateFilter) {
        ordersQuery = ordersQuery
          .gte('work_deadline', dateFilter.gte)
          .lte('work_deadline', dateFilter.lte);
      }
      const { data: orders } = await ordersQuery;

      // ===== Orders due TODAY specifically (for channels 3-5) =====
      const { data: todayOrders } = await supabase
        .from('orders')
        .select(`
          id,
          work_deadline,
          status,
          order_line_items (
            id,
            product_id,
            quantity_units
          )
        `)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .gte('work_deadline', todayStr)
        .lte('work_deadline', tomorrowStr);

      // Ship picks for today's orders
      const todayOrderIds = (todayOrders || []).map(o => o.id);
      const { data: shipPicks } = await supabase
        .from('ship_picks')
        .select('order_line_item_id, units_picked');

      const picksByLineItem = new Map(
        (shipPicks || []).map(p => [p.order_line_item_id, p.units_picked])
      );

      // Products info
      const { data: products } = await supabase
        .from('products')
        .select('id, bag_size_g, roast_group, grams_per_unit')
        .eq('is_active', true);

      const productInfo = new Map(
        (products || []).map(p => [p.id, {
          bag_size_g: p.bag_size_g,
          roast_group: p.roast_group,
          grams_per_unit: p.grams_per_unit || p.bag_size_g,
        }])
      );

      // ===== Channel 3: WIP needed today =====
      let wipNeededTodayKg = 0;

      // ===== Channel 4: FG needed today =====
      let fgNeededTodayUnits = 0;

      // ===== Channel 5: Orders to ship today =====
      let ordersToShipToday = 0;
      const todayOrderIdSet = new Set<string>();

      for (const order of todayOrders || []) {
        let orderHasRemaining = false;
        todayOrderIdSet.add(order.id);

        for (const item of order.order_line_items || []) {
          const picked = picksByLineItem.get(item.id) || 0;
          const remaining = Math.max(0, item.quantity_units - picked);

          if (remaining > 0) {
            orderHasRemaining = true;
            fgNeededTodayUnits += remaining;

            const info = productInfo.get(item.product_id);
            if (info) {
              wipNeededTodayKg += (remaining * info.grams_per_unit) / 1000;
            }
          }
        }

        if (orderHasRemaining) {
          ordersToShipToday++;
        }
      }

      // ===== Context counts for window =====
      let lineItemsInWindow = 0;
      const orderIdsInWindow = new Set<string>();

      for (const order of orders || []) {
        orderIdsInWindow.add(order.id);
        for (const item of order.order_line_items || []) {
          const picked = picksByLineItem.get(item.id) || 0;
          if (item.quantity_units - picked > 0) {
            lineItemsInWindow++;
          }
        }
      }

      // ===== Master load % =====
      const roastCapPerHr = staffCount * 40;
      const packCapPerHr = staffCount * 33.5;
      const avgOrderKg = 10;
      const shipCapPerHr = staffCount * (33.5 / avgOrderKg);
      const hrs = Math.max(0.5, hoursRemainingToday || 1); // avoid division by zero

      const samiacLoad = Math.min(100, ((samiacBatchKgToday + samiacCoroastKgToday) / hrs) / roastCapPerHr * 100);
      const loringLoad = Math.min(100, ((loringBatchKgToday + loringCoroastKgToday) / hrs) / roastCapPerHr * 100);
      const wipLoad = Math.min(100, (wipNeededTodayKg / hrs) / packCapPerHr * 100);
      const fgLoad = Math.min(100, (fgNeededTodayUnits / hrs) / (packCapPerHr / (avgOrderKg / 10)) * 100);
      const shipLoad = Math.min(100, (ordersToShipToday / hrs) / shipCapPerHr * 100);

      const masterLoadPct = Math.min(100, Math.round(
        (samiacLoad + loringLoad + wipLoad + fgLoad + shipLoad) / 5
      ));

      return {
        samiacBatchKgToday: Math.round(samiacBatchKgToday * 10) / 10,
        samiacCoroastKgToday: Math.round(samiacCoroastKgToday * 10) / 10,
        loringBatchKgToday: Math.round(loringBatchKgToday * 10) / 10,
        loringCoroastKgToday: Math.round(loringCoroastKgToday * 10) / 10,
        wipNeededTodayKg: Math.round(wipNeededTodayKg * 10) / 10,
        fgNeededTodayUnits: Math.round(fgNeededTodayUnits),
        ordersToShipToday,
        masterLoadPct,
        hoursRemainingToday,
        ordersInWindow: orderIdsInWindow.size,
        lineItemsInWindow,
        staffCount,
      };
    },
    refetchInterval: () => {
      const n = new Date();
      const zoned = toZonedTime(n, 'America/Vancouver');
      const h = getHours(zoned);
      return (h >= prodStartHourDefault && h < prodEndHourDefault) ? 60 * 60 * 1000 : false;
    },
  });
}
