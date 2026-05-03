/**
 * Authoritative Inventory Hooks
 * 
 * These hooks compute inventory from SOURCE-OF-TRUTH tables:
 * - WIP = sum(roasted_batches.actual_output_kg where status='ROASTED') - sum(packing_runs.kg_consumed)
 * - FG = sum(packing_runs.units_packed) - sum(ship_picks.units_picked)
 * - Demand = CONFIRMED orders only (not DRAFT/SUBMITTED/CANCELLED)
 * 
 * These replace any cached "levels" tables for production UX.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthoritativeWip {
  roast_group: string;
  roasted_completed_kg: number;  // sum(actual_output_kg) for ROASTED batches
  packed_consumed_kg: number;    // sum(kg_consumed) from packing_runs
  adjustments_kg: number;        // sum(ADJUSTMENT/LOSS transactions) - includes blend outputs
  wip_available_kg: number;      // roasted_completed_kg - packed_consumed_kg + adjustments_kg
}

export interface AuthoritativeFg {
  product_id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  roast_group: string | null;
  fg_created_units: number;      // sum(units_packed) from packing_runs
  fg_allocated_units: number;    // sum(units_picked) from ship_picks for OPEN orders
  fg_available_units: number;    // fg_created_units - fg_allocated_units
}

export interface AuthoritativeDemand {
  product_id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  roast_group: string | null;
  demanded_units: number;        // from CONFIRMED orders only
  demanded_kg: number;
  picked_units: number;          // already allocated
  remaining_units: number;       // demanded - picked
  remaining_kg: number;
}

export interface RoastDemand {
  roast_group: string;
  gross_demand_kg: number;        // sum of order line demands
  wip_available_kg: number;       // from WIP calculation
  fg_unallocated_kg: number;      // FG available (not picked) converted to kg
  net_roast_demand_kg: number;    // max(0, gross - wip - fg_unallocated)
  planned_output_kg: number;      // sum of PLANNED batches
  roasted_output_kg: number;      // sum of ROASTED batches
}

/**
 * Component inventory: roasted batches that are earmarked for a blend but not yet blended.
 * These do NOT count as WIP for the component roast group.
 */
export interface ComponentInventory {
  component_roast_group: string;
  blend_roast_group: string;
  roasted_kg: number;             // sum of actual_output_kg for ROASTED component batches
  batch_count: number;            // number of ROASTED batches ready for blending
}

// ============================================================================
// RAW DATA QUERIES
// ============================================================================

/**
 * Fetch all roasted batches (for WIP calculation)
 * Includes planned_for_blend_roast_group to distinguish component batches
 * Includes consumed_by_blend_at to track consumed component batches
 */
function useRoastedBatches() {
  return useQuery({
    queryKey: ['authoritative-roasted-batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('id, roast_group, status, actual_output_kg, planned_output_kg, planned_for_blend_roast_group, consumed_by_blend_at, target_date');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch all packing runs (for WIP consumption and FG creation)
 */
function usePackingRuns() {
  return useQuery({
    queryKey: ['authoritative-packing-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packing_runs')
        .select('id, product_id, units_packed, kg_consumed');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch WIP-related transactions from inventory_transactions ledger
 * This includes ROAST_OUTPUT (positive), PACK_CONSUME_WIP (negative), ADJUSTMENT, and LOSS
 * The ledger is the single source of truth for all WIP movements
 */
function useWipLedgerTransactions() {
  return useQuery({
    queryKey: ['authoritative-wip-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('id, roast_group, quantity_kg, transaction_type, notes')
        .not('roast_group', 'is', null)
        .in('transaction_type', ['ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'ADJUSTMENT', 'LOSS']);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch manual WIP adjustments (opening balances, recounts, losses, etc.)
 * These are separate from inventory_transactions and must be included for correct WIP totals.
 */
function useWipManualAdjustments() {
  return useQuery({
    queryKey: ['authoritative-wip-manual-adjustments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wip_adjustments')
        .select('roast_group, kg_delta');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch all products with roast_group mapping
 */
function useProductsWithRoastGroup() {
  return useQuery({
    queryKey: ['authoritative-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, roast_group')
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch roast groups to identify blends
 */
function useRoastGroupsInfo() {
  return useQuery({
    queryKey: ['authoritative-roast-groups-info'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, is_blend, is_active')
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch ship_picks for OPEN orders (not SHIPPED/CANCELLED)
 * These are allocations that reduce FG availability
 */
function useShipPicks() {
  return useQuery({
    queryKey: ['authoritative-ship-picks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ship_picks')
        .select(`
          id, 
          order_line_item_id, 
          units_picked, 
          order_id,
          order:orders!inner(id, status)
        `)
        // Only count picks for orders that are still open (not shipped/cancelled)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch order line items for CONFIRMED orders only (for demand)
 */
function useConfirmedOrderLines() {
  return useQuery({
    queryKey: ['authoritative-confirmed-demand'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order_id,
          order:orders!inner(id, status)
        `)
        // CONFIRMED orders only - this is the authoritative source of demand
        .eq('order.status', 'CONFIRMED');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch ALL open order lines for demand calculation (SUBMITTED, CONFIRMED, IN_PRODUCTION, READY)
 */
function useOpenOrderLines() {
  return useQuery({
    queryKey: ['authoritative-open-demand'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          product_id,
          quantity_units,
          order_id,
          order:orders!inner(id, status, work_deadline)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ============================================================================
// COMPUTED HOOKS
// ============================================================================

/**
 * Authoritative WIP by roast group
 * 
 * WIP is calculated ENTIRELY from the inventory_transactions ledger:
 * - ROAST_OUTPUT: positive kg added (roasted batches)
 * - PACK_CONSUME_WIP: negative kg removed (packing consumed)
 * - ADJUSTMENT: +/- kg (blend outputs, reverts, manual adjustments)
 * - LOSS: negative kg (recorded losses)
 * 
 * This is the single source of truth. The roasted_batches table is used only
 * for batch status tracking, not for inventory calculations.
 */
export function useAuthoritativeWip() {
  const { data: wipTransactions, isLoading: wipLoading } = useWipLedgerTransactions();
  const { data: manualAdjustments, isLoading: manualLoading } = useWipManualAdjustments();
  const { data: roastGroups, isLoading: roastGroupsLoading } = useRoastGroupsInfo();

  const wip = useMemo((): Record<string, AuthoritativeWip> => {
    if (!wipTransactions) return {};

    // Track which roast groups are blends
    const blendGroups = new Set<string>();
    for (const rg of roastGroups ?? []) {
      if (rg.is_blend) {
        blendGroups.add(rg.roast_group);
      }
    }

    // Aggregate transactions by roast group and type
    const roastedByGroup: Record<string, number> = {};
    const consumedByGroup: Record<string, number> = {};
    const adjustmentsByGroup: Record<string, number> = {};

    for (const tx of wipTransactions) {
      if (!tx.roast_group) continue;
      const kg = Number(tx.quantity_kg ?? 0);

      switch (tx.transaction_type) {
        case 'ROAST_OUTPUT':
          // Direct roast output - positive kg
          roastedByGroup[tx.roast_group] = (roastedByGroup[tx.roast_group] ?? 0) + kg;
          break;
        case 'PACK_CONSUME_WIP':
          // Packing consumption - typically negative, but track absolute consumed
          if (kg < 0) {
            consumedByGroup[tx.roast_group] = (consumedByGroup[tx.roast_group] ?? 0) + Math.abs(kg);
          } else {
            // Reversal - reduce consumed
            consumedByGroup[tx.roast_group] = (consumedByGroup[tx.roast_group] ?? 0) - kg;
          }
          break;
        case 'ADJUSTMENT':
          // Adjustments can be positive (blend output, reverts) or negative (blend consume)
          adjustmentsByGroup[tx.roast_group] = (adjustmentsByGroup[tx.roast_group] ?? 0) + kg;
          break;
        case 'LOSS':
          // Losses are negative
          adjustmentsByGroup[tx.roast_group] = (adjustmentsByGroup[tx.roast_group] ?? 0) + kg;
          break;
      }
    }

    // Add manual adjustments from wip_adjustments table (opening balances, recounts, etc.)
    // These are NOT in inventory_transactions but must be included for correct authoritative WIP.
    for (const adj of manualAdjustments ?? []) {
      if (!adj.roast_group) continue;
      adjustmentsByGroup[adj.roast_group] = (adjustmentsByGroup[adj.roast_group] ?? 0) + Number(adj.kg_delta ?? 0);
    }

    // Combine into authoritative WIP
    const allGroups = new Set([
      ...Object.keys(roastedByGroup),
      ...Object.keys(consumedByGroup),
      ...Object.keys(adjustmentsByGroup),
    ]);
    const result: Record<string, AuthoritativeWip> = {};

    for (const rg of allGroups) {
      const roasted = roastedByGroup[rg] ?? 0;
      const consumed = consumedByGroup[rg] ?? 0;
      const adjusted = adjustmentsByGroup[rg] ?? 0;

      // WIP = roasted - consumed + adjustments (includes manual adjustments from wip_adjustments)
      const wipAvailable = roasted - consumed + adjusted;

      result[rg] = {
        roast_group: rg,
        roasted_completed_kg: roasted,
        packed_consumed_kg: consumed,
        adjustments_kg: adjusted,
        wip_available_kg: Math.max(0, wipAvailable),
      };
    }

    return result;
  }, [wipTransactions, manualAdjustments, roastGroups]);

  return {
    data: wip,
    isLoading: wipLoading || manualLoading || roastGroupsLoading,
  };
}

/**
 * Authoritative FG by product
 * FG = sum(units_packed) - sum(units_picked for OPEN orders)
 */
export function useAuthoritativeFg() {
  const { data: packingRuns, isLoading: packingLoading } = usePackingRuns();
  const { data: shipPicks, isLoading: picksLoading } = useShipPicks();
  const { data: products, isLoading: productsLoading } = useProductsWithRoastGroup();
  const { data: orderLines, isLoading: linesLoading } = useOpenOrderLines();
  
  const fg = useMemo((): Record<string, AuthoritativeFg> => {
    if (!packingRuns || !shipPicks || !products) return {};
    
    // Map product info
    const productInfo: Record<string, { name: string; sku: string | null; bag_size_g: number; roast_group: string | null }> = {};
    for (const p of products) {
      productInfo[p.id] = {
        name: p.product_name,
        sku: p.sku,
        bag_size_g: p.bag_size_g,
        roast_group: p.roast_group,
      };
    }
    
    // Map order_line_item_id to product_id
    const lineToProduct: Record<string, string> = {};
    for (const li of orderLines ?? []) {
      lineToProduct[li.id] = li.product_id;
    }
    
    // Calculate FG created by product
    const createdByProduct: Record<string, number> = {};
    for (const pr of packingRuns) {
      createdByProduct[pr.product_id] = (createdByProduct[pr.product_id] ?? 0) + pr.units_packed;
    }
    
    // Calculate FG allocated (picked) by product
    const allocatedByProduct: Record<string, number> = {};
    for (const pick of shipPicks) {
      const productId = lineToProduct[pick.order_line_item_id];
      if (productId) {
        allocatedByProduct[productId] = (allocatedByProduct[productId] ?? 0) + pick.units_picked;
      }
    }
    
    // Combine into authoritative FG
    const allProducts = new Set([...Object.keys(createdByProduct), ...Object.keys(allocatedByProduct)]);
    const result: Record<string, AuthoritativeFg> = {};
    
    for (const pid of allProducts) {
      const info = productInfo[pid];
      if (!info) continue;
      
      const created = createdByProduct[pid] ?? 0;
      const allocated = allocatedByProduct[pid] ?? 0;
      result[pid] = {
        product_id: pid,
        product_name: info.name,
        sku: info.sku,
        bag_size_g: info.bag_size_g,
        roast_group: info.roast_group,
        fg_created_units: created,
        fg_allocated_units: allocated,
        fg_available_units: Math.max(0, created - allocated),
      };
    }
    
    return result;
  }, [packingRuns, shipPicks, products, orderLines]);
  
  return {
    data: fg,
    isLoading: packingLoading || picksLoading || productsLoading || linesLoading,
  };
}

/**
 * Authoritative demand by product for CONFIRMED orders
 * Includes picked/allocated units
 */
export function useAuthoritativeDemand() {
  const { data: orderLines, isLoading: linesLoading } = useOpenOrderLines();
  const { data: shipPicks, isLoading: picksLoading } = useShipPicks();
  const { data: products, isLoading: productsLoading } = useProductsWithRoastGroup();
  
  const demand = useMemo((): Record<string, AuthoritativeDemand> => {
    if (!orderLines || !products) return {};
    
    // Map product info
    const productInfo: Record<string, { name: string; sku: string | null; bag_size_g: number; roast_group: string | null }> = {};
    for (const p of products) {
      productInfo[p.id] = {
        name: p.product_name,
        sku: p.sku,
        bag_size_g: p.bag_size_g,
        roast_group: p.roast_group,
      };
    }
    
    // Map picks by order_line_item_id
    const picksByLine: Record<string, number> = {};
    for (const pick of shipPicks ?? []) {
      picksByLine[pick.order_line_item_id] = pick.units_picked;
    }
    
    // Aggregate demand by product
    const demandByProduct: Record<string, { units: number; picked: number }> = {};
    for (const li of orderLines) {
      if (!demandByProduct[li.product_id]) {
        demandByProduct[li.product_id] = { units: 0, picked: 0 };
      }
      demandByProduct[li.product_id].units += li.quantity_units;
      demandByProduct[li.product_id].picked += picksByLine[li.id] ?? 0;
    }
    
    // Build result
    const result: Record<string, AuthoritativeDemand> = {};
    for (const [pid, data] of Object.entries(demandByProduct)) {
      const info = productInfo[pid];
      if (!info) continue;
      
      const remaining = Math.max(0, data.units - data.picked);
      result[pid] = {
        product_id: pid,
        product_name: info.name,
        sku: info.sku,
        bag_size_g: info.bag_size_g,
        roast_group: info.roast_group,
        demanded_units: data.units,
        demanded_kg: (data.units * info.bag_size_g) / 1000,
        picked_units: data.picked,
        remaining_units: remaining,
        remaining_kg: (remaining * info.bag_size_g) / 1000,
      };
    }
    
    return result;
  }, [orderLines, shipPicks, products]);
  
  return {
    data: demand,
    isLoading: linesLoading || picksLoading || productsLoading,
  };
}

/**
 * Authoritative roast demand by roast group
 * net_roast_demand = max(0, gross_demand - wip - fg_unallocated)
 */
export function useAuthoritativeRoastDemand() {
  const { data: wip, isLoading: wipLoading } = useAuthoritativeWip();
  const { data: fg, isLoading: fgLoading } = useAuthoritativeFg();
  const { data: demand, isLoading: demandLoading } = useAuthoritativeDemand();
  const { data: batches, isLoading: batchesLoading } = useRoastedBatches();
  const { data: products, isLoading: productsLoading } = useProductsWithRoastGroup();
  
  const roastDemand = useMemo((): Record<string, RoastDemand> => {
    if (!demand || !products) return {};
    
    // Map product_id to roast_group
    const productRoastGroup: Record<string, string> = {};
    for (const p of products) {
      if (p.roast_group) {
        productRoastGroup[p.id] = p.roast_group;
      }
    }
    
    // Aggregate demand by roast_group (using remaining demand after picks)
    const grossDemandByGroup: Record<string, number> = {};
    for (const [pid, d] of Object.entries(demand)) {
      const rg = productRoastGroup[pid];
      if (rg) {
        // Use remaining_kg (after picks) for demand, not total
        grossDemandByGroup[rg] = (grossDemandByGroup[rg] ?? 0) + d.remaining_kg;
      }
    }
    
    // Aggregate FG (unallocated) by roast_group as kg
    const fgUnallocatedByGroup: Record<string, number> = {};
    for (const [pid, f] of Object.entries(fg ?? {})) {
      const rg = productRoastGroup[pid];
      if (rg) {
        const kgEquivalent = (f.fg_available_units * f.bag_size_g) / 1000;
        fgUnallocatedByGroup[rg] = (fgUnallocatedByGroup[rg] ?? 0) + kgEquivalent;
      }
    }
    
    // Calculate planned and roasted output by group
    const plannedByGroup: Record<string, number> = {};
    const roastedByGroup: Record<string, number> = {};
    for (const b of batches ?? []) {
      if (b.status === 'PLANNED') {
        plannedByGroup[b.roast_group] = (plannedByGroup[b.roast_group] ?? 0) + Number(b.planned_output_kg ?? 0);
      } else if (b.status === 'ROASTED') {
        roastedByGroup[b.roast_group] = (roastedByGroup[b.roast_group] ?? 0) + Number(b.actual_output_kg);
      }
    }
    
    // Build result for all roast groups with demand
    const result: Record<string, RoastDemand> = {};
    for (const rg of Object.keys(grossDemandByGroup)) {
      const gross = grossDemandByGroup[rg] ?? 0;
      const wipAvailable = wip?.[rg]?.wip_available_kg ?? 0;
      const fgUnallocated = fgUnallocatedByGroup[rg] ?? 0;
      
      result[rg] = {
        roast_group: rg,
        gross_demand_kg: gross,
        wip_available_kg: wipAvailable,
        fg_unallocated_kg: fgUnallocated,
        net_roast_demand_kg: Math.max(0, gross - wipAvailable - fgUnallocated),
        planned_output_kg: plannedByGroup[rg] ?? 0,
        roasted_output_kg: roastedByGroup[rg] ?? 0,
      };
    }
    
    return result;
  }, [demand, wip, fg, batches, products]);
  
  return {
    data: roastDemand,
    isLoading: wipLoading || fgLoading || demandLoading || batchesLoading || productsLoading,
  };
}

/**
 * Short list calculation - authoritative
 * Shows SKUs where total FG (packed) is less than total demanded
 * Picks are progress tracking, not shortage reduction
 */
export function useAuthoritativeShortList() {
  const { data: packingRuns, isLoading: packingLoading } = usePackingRuns();
  const { data: demand, isLoading: demandLoading } = useAuthoritativeDemand();
  const { data: products, isLoading: productsLoading } = useProductsWithRoastGroup();
  
  const shortList = useMemo(() => {
    if (!packingRuns || !demand || !products) return [];
    
    // Calculate FG created (total packed) by product - no allocation subtraction
    const fgCreatedByProduct: Record<string, number> = {};
    for (const pr of packingRuns) {
      fgCreatedByProduct[pr.product_id] = (fgCreatedByProduct[pr.product_id] ?? 0) + pr.units_packed;
    }
    
    const items: Array<{
      product_id: string;
      product_name: string;
      sku: string | null;
      bag_size_g: number;
      demanded_units: number;
      picked_units: number;
      remaining_units: number;
      fg_available_units: number;
      shortage: number;
    }> = [];
    
    for (const [pid, d] of Object.entries(demand)) {
      const fgCreated = fgCreatedByProduct[pid] ?? 0;
      
      // Shortage = total demanded - total FG created (picks don't affect shortage)
      const shortage = d.demanded_units - fgCreated;
      
      if (shortage > 0) {
        items.push({
          product_id: pid,
          product_name: d.product_name,
          sku: d.sku,
          bag_size_g: d.bag_size_g,
          demanded_units: d.demanded_units,
          picked_units: d.picked_units,
          remaining_units: d.remaining_units,
          fg_available_units: fgCreated,
          shortage,
        });
      }
    }
    
    return items.sort((a, b) => b.shortage - a.shortage);
  }, [packingRuns, demand, products]);
  
  return {
    data: shortList,
    isLoading: packingLoading || demandLoading || productsLoading,
  };
}

/**
 * Component Inventory by blend roast group
 * Shows roasted component batches that are available for blending.
 * These batches have planned_for_blend_roast_group set, are ROASTED, and NOT yet consumed.
 */
export function useComponentInventory() {
  const { data: batches, isLoading } = useRoastedBatches();
  
  const componentInventory = useMemo((): Record<string, ComponentInventory[]> => {
    if (!batches) return {};
    
    // Group by blend roast group, then by component roast group
    // Only include UNCONSUMED batches (consumed_by_blend_at is null)
    const byBlend: Record<string, Record<string, { kg: number; count: number }>> = {};
    
    for (const b of batches) {
      // Only include ROASTED batches that are linked to a blend AND not yet consumed
      if (b.status === 'ROASTED' && b.planned_for_blend_roast_group && !b.consumed_by_blend_at) {
        if (!byBlend[b.planned_for_blend_roast_group]) {
          byBlend[b.planned_for_blend_roast_group] = {};
        }
        if (!byBlend[b.planned_for_blend_roast_group][b.roast_group]) {
          byBlend[b.planned_for_blend_roast_group][b.roast_group] = { kg: 0, count: 0 };
        }
        byBlend[b.planned_for_blend_roast_group][b.roast_group].kg += Number(b.actual_output_kg);
        byBlend[b.planned_for_blend_roast_group][b.roast_group].count += 1;
      }
    }
    
    // Convert to array format
    const result: Record<string, ComponentInventory[]> = {};
    for (const [blendRg, components] of Object.entries(byBlend)) {
      result[blendRg] = Object.entries(components).map(([componentRg, data]) => ({
        component_roast_group: componentRg,
        blend_roast_group: blendRg,
        roasted_kg: data.kg,
        batch_count: data.count,
      }));
    }
    
    return result;
  }, [batches]);
  
  return {
    data: componentInventory,
    isLoading,
  };
}
