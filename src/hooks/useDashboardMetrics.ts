import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, addDays, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export type TimeHorizon = 'today' | 'tomorrow' | 'all';

interface DashboardMetrics {
  // Roast Demand: remaining roasting work (kg) for orders in window
  roastDemandKg: number;
  
  // WIP Buffer: only WIP needed for unpicked orders (kg)
  wipBufferKg: number;
  
  // FG Ready: only FG needed for unpicked orders (units)
  fgReadyUnits: number;
  
  // Blocked Demand: remaining units not yet picked (units)
  blockedDemandUnits: number;
  
  // Context counts
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

  // Build date filter based on horizon (matches Production page logic)
  const getDateFilter = () => {
    if (horizon === 'today') {
      return { gte: format(today, 'yyyy-MM-dd'), lte: format(tomorrow, 'yyyy-MM-dd') };
    } else if (horizon === 'tomorrow') {
      return { gte: format(tomorrow, 'yyyy-MM-dd'), lte: format(dayAfter, 'yyyy-MM-dd') };
    }
    return null; // 'all' - no date filter
  };

  return useQuery({
    queryKey: ['dashboard-metrics-v2', horizon],
    queryFn: async (): Promise<DashboardMetrics> => {
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

      // 4. Get roast groups to identify blends and their components
      const { data: roastGroups } = await supabase
        .from('roast_groups')
        .select('roast_group, is_blend, is_active')
        .eq('is_active', true);

      const blendGroups = new Set(
        (roastGroups || []).filter(rg => rg.is_blend).map(rg => rg.roast_group)
      );

      // 5. Get blend components to exclude component WIP from parent blend calculations
      const { data: blendComponents } = await supabase
        .from('roast_group_components')
        .select('parent_roast_group, component_roast_group');

      const componentGroups = new Set(
        (blendComponents || []).map(c => c.component_roast_group)
      );

      // 6. Calculate remaining demand per product and per roast_group
      // Remaining = ordered - picked
      const remainingByProduct = new Map<string, number>(); // product_id -> remaining units
      const remainingKgByRoastGroup = new Map<string, number>(); // roast_group -> remaining kg
      let totalRemainingUnits = 0;
      let lineItemCount = 0;
      const orderIds = new Set<string>();

      for (const order of orders || []) {
        orderIds.add(order.id);
        for (const item of order.order_line_items || []) {
          const picked = picksByLineItem.get(item.id) || 0;
          const remaining = Math.max(0, item.quantity_units - picked);
          
          if (remaining > 0) {
            lineItemCount++;
            totalRemainingUnits += remaining;
            
            // Aggregate by product
            remainingByProduct.set(
              item.product_id,
              (remainingByProduct.get(item.product_id) || 0) + remaining
            );
            
            // Aggregate by roast_group (convert to kg)
            const info = productInfo.get(item.product_id);
            if (info?.roast_group) {
              const gramsNeeded = remaining * info.grams_per_unit;
              const kgNeeded = gramsNeeded / 1000;
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

      // Aggregate FG by product
      const fgByProduct = new Map<string, number>();
      for (const tx of fgTransactions || []) {
        if (tx.product_id) {
          fgByProduct.set(
            tx.product_id,
            (fgByProduct.get(tx.product_id) || 0) + (tx.quantity_units || 0)
          );
        }
      }

      // 8. Get WIP from roasted batches and packing runs (authoritative calculation)
      // WIP = roasted output - packing consumed + adjustments
      // For blends: WIP = adjustments only (no direct roasted batches contribute)
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

      // Calculate roasted output by roast_group
      // EXCLUDE: component batches (planned_for_blend_roast_group set)
      // EXCLUDE: batches already consumed by blend (consumed_by_blend_at set)
      const roastedByGroup = new Map<string, number>();
      for (const batch of roastedBatches || []) {
        // Skip component batches - they don't count as WIP until blended
        if (batch.planned_for_blend_roast_group) {
          continue;
        }
        // Skip batches consumed by blend (defensive check)
        if (batch.consumed_by_blend_at) {
          continue;
        }
        roastedByGroup.set(
          batch.roast_group,
          (roastedByGroup.get(batch.roast_group) || 0) + Number(batch.actual_output_kg)
        );
      }

      // Calculate packing consumed by roast_group
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

      // Calculate adjustments by roast_group (includes blend outputs)
      const adjustmentsByGroup = new Map<string, number>();
      for (const adj of wipAdjustments || []) {
        if (adj.roast_group) {
          adjustmentsByGroup.set(
            adj.roast_group,
            (adjustmentsByGroup.get(adj.roast_group) || 0) + Number(adj.quantity_kg ?? 0)
          );
        }
      }

      // Calculate net WIP by roast_group
      // For blends: WIP = adjustments - consumed (blend WIP comes only from adjustments)
      // For single origins: WIP = roasted - consumed + adjustments
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
        
        // Check if this is a blend roast group
        const isBlend = blendGroups.has(rg);
        
        // For blends: WIP = adjustments - consumed
        // For single origins: WIP = roasted - consumed + adjustments
        const netWip = isBlend
          ? Math.max(0, adjusted - consumed)
          : Math.max(0, roasted - consumed + adjusted);
        
        if (netWip > 0) {
          wipByGroup.set(rg, netWip);
        }
      }

      // 9. Calculate FG Ready (capped at what's needed)
      // FG Ready = MIN(FG_on_hand, remaining_units_to_pick)
      let fgReadyUnits = 0;
      const fgUsedKgByRoastGroup = new Map<string, number>();

      for (const [productId, fgOnHand] of fgByProduct) {
        if (fgOnHand <= 0) continue;
        
        const remaining = remainingByProduct.get(productId) || 0;
        const usable = Math.min(fgOnHand, remaining);
        
        if (usable > 0) {
          fgReadyUnits += usable;
          
          // Track FG used by roast_group for WIP calculation offset
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

      // 10. Calculate WIP Buffer (capped at what's needed, after FG offset)
      // WIP Buffer = MIN(net_WIP, remaining_requirement_after_FG_offset)
      // Exclude component WIP for blends (component WIP should not inflate parent blend WIP buffer)
      let wipBufferKg = 0;

      for (const [roastGroup, wipAvailable] of wipByGroup) {
        // Skip component groups - their WIP only counts when blended into parent
        if (componentGroups.has(roastGroup) && !blendGroups.has(roastGroup)) {
          // This is a pure component group (not itself a blend), skip it
          // unless it's also required directly for orders
          const directDemand = remainingKgByRoastGroup.get(roastGroup) || 0;
          if (directDemand > 0) {
            const fgOffset = fgUsedKgByRoastGroup.get(roastGroup) || 0;
            const remainingAfterFg = Math.max(0, directDemand - fgOffset);
            const usableWip = Math.min(wipAvailable, remainingAfterFg);
            wipBufferKg += usableWip;
          }
          continue;
        }
        
        const demand = remainingKgByRoastGroup.get(roastGroup) || 0;
        const fgOffset = fgUsedKgByRoastGroup.get(roastGroup) || 0;
        const remainingAfterFg = Math.max(0, demand - fgOffset);
        const usableWip = Math.min(wipAvailable, remainingAfterFg);
        wipBufferKg += usableWip;
      }

      // 11. Calculate Roast Demand
      // Roast Demand = total kg requirement - WIP usable - FG usable (converted to kg)
      let roastDemandKg = 0;

      for (const [roastGroup, demandKg] of remainingKgByRoastGroup) {
        const fgOffsetKg = fgUsedKgByRoastGroup.get(roastGroup) || 0;
        const wipAvailable = wipByGroup.get(roastGroup) || 0;
        const wipUsable = Math.min(wipAvailable, Math.max(0, demandKg - fgOffsetKg));
        
        const remainingRoastWork = Math.max(0, demandKg - fgOffsetKg - wipUsable);
        roastDemandKg += remainingRoastWork;
      }

      // 12. Blocked Demand = total remaining units not picked
      const blockedDemandUnits = totalRemainingUnits;

      return {
        roastDemandKg: Math.round(roastDemandKg * 10) / 10,
        wipBufferKg: Math.round(wipBufferKg * 10) / 10,
        fgReadyUnits: Math.round(fgReadyUnits),
        blockedDemandUnits: Math.round(blockedDemandUnits),
        ordersInWindow: orderIds.size,
        lineItemsInWindow: lineItemCount,
      };
    },
    refetchInterval: 15000,
  });
}
