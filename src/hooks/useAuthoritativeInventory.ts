/**
 * Authoritative Inventory Hooks
 *
 * These hooks compute inventory from the inventory_transactions ledger — the
 * single source of truth that triggers/RPCs maintain and that manual floor
 * counts append balancing ADJUSTMENT rows to:
 * - WIP per roast_group = sum(quantity_kg) over ROAST_OUTPUT + PACK_CONSUME_WIP + BLEND + ADJUSTMENT + LOSS
 * - FG per product      = sum(quantity_units) over PACK_PRODUCE_FG + SHIP_CONSUME_FG + ADJUSTMENT
 * - Demand = CONFIRMED/open orders (order_line_items + ship_picks for picked progress)
 *
 * These replace the older packing_runs − ship_picks and wip_adjustments
 * derivations and any cached "levels" tables for production UX.
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
  blended_kg: number;            // sum(BLEND transactions) — negative for a component that gave weight, positive for the blend that received it
  adjustments_kg: number;        // sum(ADJUSTMENT/LOSS transactions) — genuine adjustments only, blend activity lives in blended_kg
  reserved_for_blend_kg: number; // kg of ROASTED batches earmarked for a blend, not yet consumed
  wip_net_kg: number;            // unclamped net (can be negative — used by Inventory page & floor count)
  wip_available_kg: number;      // max(0, wip_net_kg - reserved_for_blend_kg) — used by production UX
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
 * Fetch WIP-related transactions from inventory_transactions ledger
 * This includes ROAST_OUTPUT (positive), PACK_CONSUME_WIP (negative), BLEND, ADJUSTMENT, and LOSS
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
        .in('transaction_type', ['ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'BLEND', 'ADJUSTMENT', 'LOSS']);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fetch FG-related transactions from the inventory_transactions ledger.
 * FG on-hand per product = sum(quantity_units) over PACK_PRODUCE_FG (+),
 * SHIP_CONSUME_FG (−, written on pick/return), and ADJUSTMENT (floor count).
 * This ledger is the single source of truth for FG, replacing the old
 * packing_runs − ship_picks derivation so floor-count ADJUSTMENT rows move
 * the on-hand number.
 */
function useFgLedgerTransactions() {
  return useQuery({
    queryKey: ['authoritative-fg-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('product_id, quantity_units, transaction_type')
        .not('product_id', 'is', null)
        .in('transaction_type', ['PACK_PRODUCE_FG', 'SHIP_CONSUME_FG', 'ADJUSTMENT']);
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
        .select('id, product_name, sku, bag_size_g, roast_group, requires_production')
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

export interface WipLedgerTx {
  roast_group: string | null;
  quantity_kg: number | null;
  transaction_type: string | null;
}
/** Minimal batch shape for blend-reservation accounting. */
export interface BlendReservationBatch {
  roast_group: string | null;
  status: 'PLANNED' | 'ROASTED' | string;
  actual_output_kg: number | null;
  planned_for_blend_roast_group: string | null;
  consumed_by_blend_at: string | null;
}

/**
 * Pure WIP reducer — the single source of truth for authoritative WIP.
 * Extracted from useAuthoritativeWip so it can be unit-tested without Supabase.
 *
 * WIP is calculated ENTIRELY from the inventory_transactions ledger:
 * - ROAST_OUTPUT: positive kg added (roasted batches, INCLUDING blend component batches,
 *   which write a ROAST_OUTPUT to their own component roast group when roasted)
 * - PACK_CONSUME_WIP: negative kg removed (packing consumed)
 * - BLEND: +/- kg blend movement (blend output +, blend component decrement -), tracked
 *   separately from ADJUSTMENT so the WIP screen can show blend activity in its own column
 * - ADJUSTMENT: +/- kg (reverts, and the manual floor-count / recount / opening-balance
 *   adjustments — these were formerly in the separate wip_adjustments table, now
 *   backfilled into inventory_transactions)
 * - LOSS: negative kg (recorded losses)
 *
 * Blend bookkeeping must stay balanced: executing a blend writes a positive BLEND row
 * to the blend group AND a matching negative BLEND row to each component group, so the
 * kg blended away is removed from component WIP (otherwise it is double-counted and a
 * sibling product in the component group can consume coffee already in the blend).
 *
 * Blend earmark moat: ROASTED component batches that carry a
 * planned_for_blend_roast_group AND have not yet been consumed by a blend are
 * physically present in the component group's WIP, but are conceptually 100%
 * reserved for the parent blend. They are subtracted from wip_available_kg so
 * sibling single-origin products cannot pack coffee that's earmarked for a blend.
 * The reservation is released when the blend is executed: the consumed kg is
 * deducted via a negative ADJUSTMENT and consumed_by_blend_at is set on the batch,
 * which removes it from this reservation (any unblended remainder becomes available).
 */
export function computeAuthoritativeWip(
  wipTransactions: WipLedgerTx[],
  reservationBatches: BlendReservationBatch[] = [],
): Record<string, AuthoritativeWip> {
  // Aggregate transactions by roast group and type
  const roastedByGroup: Record<string, number> = {};
  const consumedByGroup: Record<string, number> = {};
  const blendedByGroup: Record<string, number> = {};
  const adjustmentsByGroup: Record<string, number> = {};
  const reservedByGroup: Record<string, number> = {};

  for (const tx of wipTransactions) {
    if (!tx.roast_group) continue;
    const kg = Number(tx.quantity_kg ?? 0);

    switch (tx.transaction_type) {
      case 'ROAST_OUTPUT':
        roastedByGroup[tx.roast_group] = (roastedByGroup[tx.roast_group] ?? 0) + kg;
        break;
      case 'PACK_CONSUME_WIP':
        if (kg < 0) {
          consumedByGroup[tx.roast_group] = (consumedByGroup[tx.roast_group] ?? 0) + Math.abs(kg);
        } else {
          consumedByGroup[tx.roast_group] = (consumedByGroup[tx.roast_group] ?? 0) - kg;
        }
        break;
      case 'BLEND':
        blendedByGroup[tx.roast_group] = (blendedByGroup[tx.roast_group] ?? 0) + kg;
        break;
      case 'ADJUSTMENT':
        adjustmentsByGroup[tx.roast_group] = (adjustmentsByGroup[tx.roast_group] ?? 0) + kg;
        break;
      case 'LOSS':
        adjustmentsByGroup[tx.roast_group] = (adjustmentsByGroup[tx.roast_group] ?? 0) + kg;
        break;
    }
  }

  // Reservation: ROASTED component batches earmarked for a blend, not yet consumed.
  for (const b of reservationBatches) {
    if (!b.roast_group) continue;
    if (b.status !== 'ROASTED') continue;
    if (!b.planned_for_blend_roast_group) continue;
    if (b.consumed_by_blend_at) continue;
    reservedByGroup[b.roast_group] =
      (reservedByGroup[b.roast_group] ?? 0) + Number(b.actual_output_kg ?? 0);
  }

  const allGroups = new Set([
    ...Object.keys(roastedByGroup),
    ...Object.keys(consumedByGroup),
    ...Object.keys(blendedByGroup),
    ...Object.keys(adjustmentsByGroup),
    ...Object.keys(reservedByGroup),
  ]);
  const result: Record<string, AuthoritativeWip> = {};

  for (const rg of allGroups) {
    const roasted = roastedByGroup[rg] ?? 0;
    const consumed = consumedByGroup[rg] ?? 0;
    const blended = blendedByGroup[rg] ?? 0;
    const adjusted = adjustmentsByGroup[rg] ?? 0;
    const reserved = reservedByGroup[rg] ?? 0;

    const wipNet = roasted - consumed + blended + adjusted;
    const wipAvailable = wipNet - reserved;

    result[rg] = {
      roast_group: rg,
      roasted_completed_kg: roasted,
      packed_consumed_kg: consumed,
      blended_kg: blended,
      adjustments_kg: adjusted,
      reserved_for_blend_kg: reserved,
      wip_net_kg: wipNet,
      wip_available_kg: Math.max(0, wipAvailable),
    };
  }

  return result;
}

/**
 * Authoritative WIP by roast group.
 * Thin React-Query wrapper around computeAuthoritativeWip (the pure reducer above).
 */
export function useAuthoritativeWip() {
  const { data: wipTransactions, isLoading: wipLoading } = useWipLedgerTransactions();
  const { data: roastGroups, isLoading: roastGroupsLoading } = useRoastGroupsInfo();
  const { data: batches, isLoading: batchesLoading } = useRoastedBatches();

  const wip = useMemo((): Record<string, AuthoritativeWip> => {
    if (!wipTransactions) return {};
    return computeAuthoritativeWip(
      wipTransactions,
      (batches ?? []) as BlendReservationBatch[],
    );
  }, [wipTransactions, batches]);

  return {
    data: wip,
    isLoading: wipLoading || roastGroupsLoading || batchesLoading,
  };
}

/**
 * Planned-batch summary by roast_group.
 * Informational only — does NOT count toward WIP.
 * Skips batches earmarked for a blend (planned_for_blend_roast_group set)
 * and batches already consumed by a blend (consumed_by_blend_at set).
 */
export interface PlannedWipByGroup {
  count: number;
  planned_kg: number;
}

export function useAuthoritativePlannedWip() {
  const { data: batches, isLoading } = useRoastedBatches();

  const planned = useMemo((): Record<string, PlannedWipByGroup> => {
    const result: Record<string, PlannedWipByGroup> = {};
    for (const b of batches ?? []) {
      if (b.status !== 'PLANNED') continue;
      if (b.planned_for_blend_roast_group) continue;
      if (b.consumed_by_blend_at) continue;
      if (!b.roast_group) continue;
      const entry = result[b.roast_group] ?? { count: 0, planned_kg: 0 };
      entry.count += 1;
      entry.planned_kg += Number(b.planned_output_kg ?? 0);
      result[b.roast_group] = entry;
    }
    return result;
  }, [batches]);

  return { data: planned, isLoading };
}

export interface FgLedgerTx {
  product_id: string | null;
  quantity_units: number | null;
  transaction_type: string | null;
}

/** Per-product FG metadata used to decorate the ledger sums. */
export interface FgProductInfo {
  name: string;
  sku: string | null;
  bag_size_g: number;
  roast_group: string | null;
}

/**
 * Pure FG reducer — single source of truth for authoritative FG, computed
 * ENTIRELY from the inventory_transactions ledger (quantity_units):
 * - PACK_PRODUCE_FG: +units packed (negative when a pack is reversed)
 * - SHIP_CONSUME_FG: −units when picked/shipped (positive when returned)
 * - ADJUSTMENT: +/- units from a manual FG floor count / recount
 *
 * fg_available_units = created + ship(net, signed) + adjustments. This is true
 * physical on-hand: every pick reduces it immediately and stays reduced once the
 * order ships; a cancel must write a returning SHIP_CONSUME_FG (+units) for the
 * coffee to re-enter FG. Extracted so it can be unit-tested without Supabase.
 */
export function computeAuthoritativeFg(
  fgTransactions: FgLedgerTx[],
  productInfo: Record<string, FgProductInfo> = {},
): Record<string, AuthoritativeFg> {
  const createdByProduct: Record<string, number> = {};   // PACK_PRODUCE_FG (signed)
  const shipByProduct: Record<string, number> = {};       // SHIP_CONSUME_FG (signed, usually ≤ 0)
  const adjustByProduct: Record<string, number> = {};      // ADJUSTMENT units (signed)

  for (const tx of fgTransactions) {
    if (!tx.product_id) continue;
    const units = Number(tx.quantity_units ?? 0);
    if (!units) continue;
    switch (tx.transaction_type) {
      case 'PACK_PRODUCE_FG':
        createdByProduct[tx.product_id] = (createdByProduct[tx.product_id] ?? 0) + units;
        break;
      case 'SHIP_CONSUME_FG':
        shipByProduct[tx.product_id] = (shipByProduct[tx.product_id] ?? 0) + units;
        break;
      case 'ADJUSTMENT':
        adjustByProduct[tx.product_id] = (adjustByProduct[tx.product_id] ?? 0) + units;
        break;
    }
  }

  const allProducts = new Set([
    ...Object.keys(createdByProduct),
    ...Object.keys(shipByProduct),
    ...Object.keys(adjustByProduct),
  ]);
  const result: Record<string, AuthoritativeFg> = {};

  for (const pid of allProducts) {
    const info = productInfo[pid];
    const created = createdByProduct[pid] ?? 0;
    const shipNet = shipByProduct[pid] ?? 0;   // signed (consumption is negative)
    const adjust = adjustByProduct[pid] ?? 0;
    result[pid] = {
      product_id: pid,
      product_name: info?.name ?? '',
      sku: info?.sku ?? null,
      bag_size_g: info?.bag_size_g ?? 0,
      roast_group: info?.roast_group ?? null,
      fg_created_units: created,
      fg_allocated_units: -shipNet,            // total units consumed (picked/shipped), positive
      fg_available_units: Math.max(0, created + shipNet + adjust),
    };
  }

  return result;
}

/**
 * Authoritative FG by product — thin React-Query wrapper around
 * computeAuthoritativeFg (the pure ledger reducer above).
 */
export function useAuthoritativeFg() {
  const { data: fgTransactions, isLoading: ledgerLoading } = useFgLedgerTransactions();
  const { data: products, isLoading: productsLoading } = useProductsWithRoastGroup();

  const fg = useMemo((): Record<string, AuthoritativeFg> => {
    if (!fgTransactions) return {};
    const productInfo: Record<string, FgProductInfo> = {};
    for (const p of products ?? []) {
      productInfo[p.id] = {
        name: p.product_name,
        sku: p.sku,
        bag_size_g: p.bag_size_g,
        roast_group: p.roast_group,
      };
    }
    return computeAuthoritativeFg(fgTransactions as FgLedgerTx[], productInfo);
  }, [fgTransactions, products]);

  return {
    data: fg,
    isLoading: ledgerLoading || productsLoading,
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
    
    // Map product_id to roast_group. Bought-in products (requires_production =
    // false) never generate roast demand, even if a roast_group is somehow set.
    const productRoastGroup: Record<string, string> = {};
    for (const p of products) {
      if (p.roast_group && p.requires_production !== false) {
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
  const { data: fgTransactions, isLoading: ledgerLoading } = useFgLedgerTransactions();
  const { data: demand, isLoading: demandLoading } = useAuthoritativeDemand();
  const { data: products, isLoading: productsLoading } = useProductsWithRoastGroup();

  const shortList = useMemo(() => {
    if (!fgTransactions || !demand || !products) return [];

    // FG produced (total packed) by product, from the ledger — PACK_PRODUCE_FG is
    // signed (reverses are negative), so summing yields net produced. Picks/ships
    // (SHIP_CONSUME_FG) do not reduce shortage; this measures whether we have
    // produced enough total to cover demand.
    const fgCreatedByProduct: Record<string, number> = {};
    for (const tx of fgTransactions) {
      if (!tx.product_id || tx.transaction_type !== 'PACK_PRODUCE_FG') continue;
      fgCreatedByProduct[tx.product_id] =
        (fgCreatedByProduct[tx.product_id] ?? 0) + Number(tx.quantity_units ?? 0);
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
    
    // Bought-in products are never packed into FG, so they'd read as perpetually
    // "short" — exclude them from the short list entirely.
    const nonProducedIds = new Set(
      products.filter((p) => p.requires_production === false).map((p) => p.id),
    );

    for (const [pid, d] of Object.entries(demand)) {
      if (nonProducedIds.has(pid)) continue;
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
  }, [fgTransactions, demand, products]);

  return {
    data: shortList,
    isLoading: ledgerLoading || demandLoading || productsLoading,
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
