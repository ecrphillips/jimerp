import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, addDays, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export type TimeHorizon = 'today' | 'tomorrow' | 'all';

interface DashboardMetrics {
  // Stage A: Green coffee equivalent needed for roast
  greenKgRequired: number;
  
  // Stage B: WIP (roasted, unpacked) kg
  wipKg: number;
  
  // Stage C: Finished goods ready to ship (kg)
  fgReadyKg: number;
  
  // Stage D: Demand blocked by missing FG (kg)
  blockedDemandKg: number;
  
  // Yield metrics
  expectedYieldLossPct: number;
  actualYieldLossPct: number | null;
  
  // Batch counts for context
  plannedBatches: number;
  completedBatches: number;
}

export function useDashboardMetrics(horizon: TimeHorizon) {
  const tz = 'America/Vancouver';
  const now = new Date();
  const zonedNow = toZonedTime(now, tz);
  const today = startOfDay(zonedNow);
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);

  // Build date filter based on horizon
  const getDateFilter = () => {
    if (horizon === 'today') {
      return { gte: format(today, 'yyyy-MM-dd'), lte: format(tomorrow, 'yyyy-MM-dd') };
    } else if (horizon === 'tomorrow') {
      return { gte: format(tomorrow, 'yyyy-MM-dd'), lte: format(dayAfter, 'yyyy-MM-dd') };
    }
    return null; // 'all' - no date filter
  };

  return useQuery({
    queryKey: ['dashboard-metrics', horizon],
    queryFn: async (): Promise<DashboardMetrics> => {
      const dateFilter = getDateFilter();

      // 1. Get roast groups with their yield expectations
      const { data: roastGroups } = await supabase
        .from('roast_groups')
        .select('roast_group, expected_yield_loss_pct, standard_batch_kg')
        .eq('is_active', true);

      const yieldByGroup = new Map(
        (roastGroups || []).map(rg => [rg.roast_group, rg.expected_yield_loss_pct])
      );

      // 2. Get demand from orders (line items with products)
      let demandQuery = supabase
        .from('order_line_items')
        .select(`
          quantity_units,
          product:products!inner(
            bag_size_g,
            roast_group
          ),
          order:orders!inner(
            status,
            work_deadline,
            requested_ship_date
          )
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);

      if (dateFilter) {
        demandQuery = demandQuery
          .gte('order.work_deadline', dateFilter.gte)
          .lte('order.work_deadline', dateFilter.lte);
      }

      const { data: orderDemand } = await demandQuery;

      // 3. Get external demand (andon boards)
      let externalQuery = supabase
        .from('external_demand')
        .select(`
          quantity_units,
          target_date,
          product:products!inner(
            bag_size_g,
            roast_group
          )
        `);

      if (dateFilter) {
        externalQuery = externalQuery
          .gte('target_date', dateFilter.gte)
          .lte('target_date', dateFilter.lte);
      }

      const { data: externalDemand } = await externalQuery;

      // 4. Calculate total roasted kg demand by roast group
      const demandByGroup = new Map<string, number>();

      // From orders
      (orderDemand || []).forEach(item => {
        const product = item.product as any;
        if (!product?.roast_group) return;
        const kgNeeded = (item.quantity_units * product.bag_size_g) / 1000;
        demandByGroup.set(
          product.roast_group,
          (demandByGroup.get(product.roast_group) || 0) + kgNeeded
        );
      });

      // From external demand
      (externalDemand || []).forEach(item => {
        const product = item.product as any;
        if (!product?.roast_group) return;
        const kgNeeded = (item.quantity_units * product.bag_size_g) / 1000;
        demandByGroup.set(
          product.roast_group,
          (demandByGroup.get(product.roast_group) || 0) + kgNeeded
        );
      });

      // 5. Convert roasted demand to green coffee equivalent
      let totalGreenKgRequired = 0;
      let totalWeightedYield = 0;
      let totalDemandWeight = 0;

      demandByGroup.forEach((roastedKg, group) => {
        const yieldLossPct = yieldByGroup.get(group) || 16;
        const greenKg = roastedKg / (1 - yieldLossPct / 100);
        totalGreenKgRequired += greenKg;
        
        // For weighted average yield calculation
        totalWeightedYield += yieldLossPct * roastedKg;
        totalDemandWeight += roastedKg;
      });

      const expectedYieldLossPct = totalDemandWeight > 0 
        ? totalWeightedYield / totalDemandWeight 
        : 16;

      // 6. Get WIP from inventory_transactions ledger
      const { data: wipTransactions } = await supabase
        .from('inventory_transactions')
        .select('roast_group, quantity_kg')
        .in('transaction_type', ['ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'ADJUSTMENT', 'LOSS'])
        .not('roast_group', 'is', null);

      let wipKg = 0;
      (wipTransactions || []).forEach(tx => {
        wipKg += Number(tx.quantity_kg) || 0;
      });

      // 7. Get FG from inventory_transactions ledger
      const { data: fgTransactions } = await supabase
        .from('inventory_transactions')
        .select('product_id, quantity_units')
        .in('transaction_type', ['PACK_PRODUCE_FG', 'SHIP_CONSUME_FG'])
        .not('product_id', 'is', null);

      // Get product bag sizes for FG kg conversion
      const { data: products } = await supabase
        .from('products')
        .select('id, bag_size_g, roast_group')
        .eq('is_active', true);

      const productInfo = new Map(
        (products || []).map(p => [p.id, { bag_size_g: p.bag_size_g, roast_group: p.roast_group }])
      );

      // Aggregate FG by product
      const fgByProduct = new Map<string, number>();
      (fgTransactions || []).forEach(tx => {
        if (!tx.product_id) return;
        fgByProduct.set(
          tx.product_id,
          (fgByProduct.get(tx.product_id) || 0) + (tx.quantity_units || 0)
        );
      });

      // Convert FG units to kg
      let fgReadyKg = 0;
      fgByProduct.forEach((units, productId) => {
        const info = productInfo.get(productId);
        if (info && units > 0) {
          fgReadyKg += (units * info.bag_size_g) / 1000;
        }
      });

      // 8. Calculate blocked demand (demand that can't be fulfilled from FG)
      // This is total demand kg minus available FG kg, floored at 0
      const totalDemandKg = Array.from(demandByGroup.values()).reduce((sum, kg) => sum + kg, 0);
      const blockedDemandKg = Math.max(0, totalDemandKg - fgReadyKg - wipKg);

      // 9. Get batch counts and actual yield for completed batches
      let batchQuery = supabase
        .from('roasted_batches')
        .select('id, status, roast_group, planned_output_kg, actual_output_kg');

      if (dateFilter) {
        batchQuery = batchQuery
          .gte('target_date', dateFilter.gte)
          .lte('target_date', dateFilter.lte);
      }

      const { data: batches } = await batchQuery;

      const plannedBatches = (batches || []).filter(b => b.status === 'PLANNED').length;
      const completedBatches = (batches || []).filter(b => b.status === 'ROASTED').length;

      // Calculate actual yield loss from completed batches
      let totalPlannedOutput = 0;
      let totalActualOutput = 0;
      (batches || []).filter(b => b.status === 'ROASTED').forEach(batch => {
        if (batch.planned_output_kg) {
          totalPlannedOutput += Number(batch.planned_output_kg);
          totalActualOutput += Number(batch.actual_output_kg);
        }
      });

      const actualYieldLossPct = totalPlannedOutput > 0
        ? ((totalPlannedOutput - totalActualOutput) / totalPlannedOutput) * 100
        : null;

      return {
        greenKgRequired: Math.round(totalGreenKgRequired * 10) / 10,
        wipKg: Math.round(wipKg * 10) / 10,
        fgReadyKg: Math.round(fgReadyKg * 10) / 10,
        blockedDemandKg: Math.round(blockedDemandKg * 10) / 10,
        expectedYieldLossPct: Math.round(expectedYieldLossPct * 10) / 10,
        actualYieldLossPct: actualYieldLossPct !== null 
          ? Math.round(actualYieldLossPct * 10) / 10 
          : null,
        plannedBatches,
        completedBatches,
      };
    },
    refetchInterval: 15000, // Refresh every 15 seconds
  });
}
