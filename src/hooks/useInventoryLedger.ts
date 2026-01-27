import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type InventoryTransactionType = 
  | 'ROAST_OUTPUT'
  | 'PACK_CONSUME_WIP'
  | 'PACK_PRODUCE_FG'
  | 'SHIP_CONSUME_FG'
  | 'ADJUSTMENT'
  | 'LOSS';

export interface InventoryTransaction {
  id: string;
  created_at: string;
  created_by: string | null;
  transaction_type: InventoryTransactionType;
  roast_group: string | null;
  product_id: string | null;
  order_id: string | null;
  quantity_kg: number | null;
  quantity_units: number | null;
  notes: string | null;
  is_system_generated: boolean;
}

export interface WipInventory {
  [roastGroup: string]: number; // kg on hand
}

export interface FgInventory {
  [productId: string]: number; // units on hand
}

/**
 * Hook to read WIP (Work-In-Progress) inventory from the ledger.
 * WIP = sum(quantity_kg) grouped by roast_group
 */
export function useWipInventory() {
  return useQuery({
    queryKey: ['inventory-ledger-wip'],
    queryFn: async (): Promise<WipInventory> => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('roast_group, quantity_kg')
        .not('roast_group', 'is', null)
        .not('quantity_kg', 'is', null);
      
      if (error) throw error;
      
      const wip: WipInventory = {};
      for (const row of data ?? []) {
        if (row.roast_group && row.quantity_kg !== null) {
          wip[row.roast_group] = (wip[row.roast_group] ?? 0) + Number(row.quantity_kg);
        }
      }
      return wip;
    },
  });
}

/**
 * Hook to read FG (Finished Goods) inventory from the ledger.
 * FG = sum(quantity_units) grouped by product_id
 */
export function useFgInventory() {
  return useQuery({
    queryKey: ['inventory-ledger-fg'],
    queryFn: async (): Promise<FgInventory> => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('product_id, quantity_units')
        .not('product_id', 'is', null)
        .not('quantity_units', 'is', null);
      
      if (error) throw error;
      
      const fg: FgInventory = {};
      for (const row of data ?? []) {
        if (row.product_id && row.quantity_units !== null) {
          fg[row.product_id] = (fg[row.product_id] ?? 0) + row.quantity_units;
        }
      }
      return fg;
    },
  });
}

/**
 * Hook to fetch all inventory transactions (for ledger view).
 */
export function useInventoryTransactions(limit = 500) {
  return useQuery({
    queryKey: ['inventory-transactions', limit],
    queryFn: async (): Promise<InventoryTransaction[]> => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      return (data ?? []) as InventoryTransaction[];
    },
  });
}
