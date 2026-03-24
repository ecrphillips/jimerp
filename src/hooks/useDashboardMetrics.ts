import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, startOfWeek, addDays, format, getHours, getDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export type TimeHorizon = 'today' | 'tomorrow' | 'week';

interface DashboardMetrics {
  roastDemandKg: number;
  wipBufferKg: number;
  fgReadyUnits: number;
  systemStressScore: number;
  ordersInWindow: number;
  lineItemsInWindow: number;
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

  const getDateFilter = () => {
    if (horizon === 'today') {
      return { gte: format(today, 'yyyy-MM-dd'), lte: format(tomorrow, 'yyyy-MM-dd') };
    } else if (horizon === 'tomorrow') {
      return { gte: format(tomorrow, 'yyyy-MM-dd'), lte: format(dayAfter, 'yyyy-MM-dd') };
    }
    // 'week' — Mon to Fri
    return { gte: format(monday, 'yyyy-MM-dd'), lte: format(fridayEnd, 'yyyy-MM-dd') };
  };

  // We need prodStartHour/prodEndHour outside queryFn for refetchInterval
  // Default values used; actual values come from queryFn
  const prodStartHourDefault = 6;
  const prodEndHourDefault = 15;

  return useQuery({
    queryKey: ['dashboard-metrics-v2', horizon],
    queryFn: async (): Promise<DashboardMetrics> => {
      // Fetch production window settings
      const { data: settingsRow } = await supabase
        .from('app_settings')
        .select('value_json')
        .eq('key', 'production_window')
        .maybeSingle();

      const prodWindow = settingsRow?.value_json as { start_hour: number; end_hour: number } | null;
      const prodStartHour = prodWindow?.start_hour ?? 6;
      const prodEndHour = prodWindow?.end_hour ?? 15;

      const dateFilter = getDateFilter();

      // 1. Get open orders with line items in the selected window
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

      // 2. Get ship_picks to know what's already picked
      const { data: shipPicks } = await supabase
        .from('ship_picks')
        .select('order_line_item_id, units_picked');

      const picksByLineItem = new Map(
        (shipPicks || []).map(p => [p.order_line_item_id, p.units_picked])
      );

      // 3. Get products with roast_group and bag_size_g
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

      // 4. Get roast groups to identify blends
      const { data: roastGroups } = await supabase
        .from('roast_groups')
        .select('roast_group, is_blend, is_active')
        .eq('is_active', true);

      const blendGroups = new Set(
        (roastGroups || []).filter(rg => rg.is_blend).map(rg => rg.roast_group)
      );

      // 5. Get blend components
      const { data: blendComponents } = await supabase
        .from('roast_group_components')
        .select('parent_roast_group, component_roast_group');

      // 6. Calculate remaining demand per product and per roast_group
      const remainingByProduct = new Map<string, number>();
      const remainingKgByRoastGroup = new Map<string, number>();
      let lineItemCount = 0;
      const orderIds = new Set<string>();

      for (const order of orders || []) {
        orderIds.add(order.id);
        for (const item of order.order_line_items || []) {
          const picked = picksByLineItem.get(item.id) || 0;
          const remaining = Math.max(0, item.quantity_units - picked);
          
          if (remaining > 0) {
            lineItemCount++;
            
            remainingByProduct.set(
              item.product_id,
              (remainingByProduct.get(item.product_id) || 0) + remaining
            );
            
            const info = productInfo.get(item.product_id);
            if (info?.roast_group) {
              const kgNeeded = (remaining * info.grams_per_unit) / 1000;
              remainingKgByRoastGroup.set(
                info.roast_group,
                (remainingKgByRoastGroup.get(info.roast_group) || 0) + kgNeeded
              );
            }
          }
        }
      }

      // 7. Get FG inventory from inventory_transactions ledger
      const { data: fgTransactions } = await supabase
        .from('inventory_transactions')
        .select('product_id, quantity_units')
        .in('transaction_type', ['PACK_PRODUCE_FG', 'SHIP_CONSUME_FG'])
        .not('product_id', 'is', null);

      const fgByProduct = new Map<string, number>();
      for (const tx of fgTransactions || []) {
        if (tx.product_id) {
          fgByProduct.set(
            tx.product_id,
            (fgByProduct.get(tx.product_id) || 0) + (tx.quantity_units || 0)
          );
        }
      }

      // 8. Get WIP from roasted batches and packing runs
      const { data: roastedBatches } = await supabase
        .from('roasted_batches')
        .select('roast_group, actual_output_kg, status, consumed_by_blend_at, planned_for_blend_roast_group')
        .eq('status', 'ROASTED');

      const { data: packingRuns } = await supabase
        .from('packing_runs')
        .select('product_id, kg_consumed');

      const { data: wipAdjustments } = await supabase
        .from('inventory_transactions')
        .select('roast_group, quantity_kg')
        .not('roast_group', 'is', null)
        .in('transaction_type', ['ADJUSTMENT', 'LOSS']);

      const roastedByGroup = new Map<string, number>();
      for (const batch of roastedBatches || []) {
        if (batch.planned_for_blend_roast_group) continue;
        if (batch.consumed_by_blend_at) continue;
        roastedByGroup.set(
          batch.roast_group,
          (roastedByGroup.get(batch.roast_group) || 0) + Number(batch.actual_output_kg)
        );
      }

      const consumedByGroup = new Map<string, number>();
      for (const run of packingRuns || []) {
        const info = productInfo.get(run.product_id);
        if (info?.roast_group) {
          consumedByGroup.set(
            info.roast_group,
            (consumedByGroup.get(info.roast_group) || 0) + Number(run.kg_consumed)
          );
        }
      }

      const adjustmentsByGroup = new Map<string, number>();
      for (const adj of wipAdjustments || []) {
        if (adj.roast_group) {
          adjustmentsByGroup.set(
            adj.roast_group,
            (adjustmentsByGroup.get(adj.roast_group) || 0) + Number(adj.quantity_kg ?? 0)
          );
        }
      }

      const wipByGroup = new Map<string, number>();
      const allWipGroups = new Set([
        ...roastedByGroup.keys(),
        ...consumedByGroup.keys(),
        ...adjustmentsByGroup.keys(),
      ]);

      for (const rg of allWipGroups) {
        const roasted = roastedByGroup.get(rg) || 0;
        const consumed = consumedByGroup.get(rg) || 0;
        const adjusted = adjustmentsByGroup.get(rg) || 0;
        const isBlend = blendGroups.has(rg);
        const netWip = isBlend
          ? Math.max(0, adjusted - consumed)
          : Math.max(0, roasted - consumed + adjusted);
        if (netWip > 0) {
          wipByGroup.set(rg, netWip);
        }
      }

      // 9. FG Ready — total FG on hand (uncapped)
      let fgReadyUnits = 0;
      for (const [, units] of fgByProduct) {
        if (units > 0) fgReadyUnits += units;
      }

      // Track FG offset for roast demand calculation
      const fgUsedKgByRoastGroup = new Map<string, number>();
      for (const [productId, fgOnHand] of fgByProduct) {
        if (fgOnHand <= 0) continue;
        const remaining = remainingByProduct.get(productId) || 0;
        const usable = Math.min(fgOnHand, remaining);
        if (usable > 0) {
          const info = productInfo.get(productId);
          if (info?.roast_group) {
            const kgUsed = (usable * info.grams_per_unit) / 1000;
            fgUsedKgByRoastGroup.set(
              info.roast_group,
              (fgUsedKgByRoastGroup.get(info.roast_group) || 0) + kgUsed
            );
          }
        }
      }

      // 10. WIP Buffer — total WIP on hand (uncapped)
      let wipBufferKg = 0;
      for (const [, wipKg] of wipByGroup) {
        wipBufferKg += wipKg;
      }

      // 11. Calculate Roast Demand from orders
      let roastDemandKg = 0;
      for (const [roastGroup, demandKg] of remainingKgByRoastGroup) {
        const fgOffsetKg = fgUsedKgByRoastGroup.get(roastGroup) || 0;
        const wipAvailable = wipByGroup.get(roastGroup) || 0;
        const wipUsable = Math.min(wipAvailable, Math.max(0, demandKg - fgOffsetKg));
        const remainingRoastWork = Math.max(0, demandKg - fgOffsetKg - wipUsable);
        roastDemandKg += remainingRoastWork;
      }

      // 11b. Add planned batches not connected to orders
      const { data: plannedBatches } = await supabase
        .from('roasted_batches')
        .select('roast_group, planned_output_kg, target_date')
        .eq('status', 'PLANNED');

      for (const batch of plannedBatches || []) {
        // Filter to date window
        if (dateFilter) {
          if (batch.target_date < dateFilter.gte || batch.target_date > dateFilter.lte) continue;
        }
        // Only add if roast_group is NOT already covered by order demand
        if (!remainingKgByRoastGroup.has(batch.roast_group)) {
          roastDemandKg += Number(batch.planned_output_kg ?? 0);
        }
      }

      // 12. System Stress Score
      const currentHour = getHours(zonedNow);
      const inWindow = currentHour >= prodStartHour && currentHour < prodEndHour;
      const hoursRemainingToday = inWindow ? Math.max(0, prodEndHour - currentHour) : 0;

      // Count remaining weekdays after today (Mon=1..Fri=5)
      const dayOfWeek = getDay(zonedNow); // 0=Sun, 1=Mon, ..., 6=Sat
      let remainingWeekdays = 0;
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        remainingWeekdays = 5 - dayOfWeek; // days after today in Mon-Fri
      }
      const windowHoursPerDay = prodEndHour - prodStartHour;
      const hoursRemainingThisWeek = hoursRemainingToday + remainingWeekdays * windowHoursPerDay;

      const systemStressScore = Math.min(
        100,
        Math.round((orderIds.size / Math.max(1, hoursRemainingToday)) * 20)
      );

      return {
        roastDemandKg: Math.round(roastDemandKg * 10) / 10,
        wipBufferKg: Math.round(wipBufferKg * 10) / 10,
        fgReadyUnits: Math.round(fgReadyUnits),
        systemStressScore,
        ordersInWindow: orderIds.size,
        lineItemsInWindow: lineItemCount,
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
