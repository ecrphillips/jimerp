import { supabase } from '@/integrations/supabase/client';

export type WipAdjustmentReason =
  | 'OPENING_BALANCE'
  | 'RECOUNT'
  | 'COUNT_ADJUSTMENT'
  | 'LOSS'
  | 'CONTAMINATION'
  | 'OTHER';

export interface SaveWipAdjustmentArgs {
  roastGroup: string;
  kgDelta: number;
  reason: WipAdjustmentReason;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * Single source of truth for writing WIP adjustments.
 * Both the per-row WipAdjustmentModal and the bulk WipFloorCountModal use this
 * helper. Writes ONE balancing ADJUSTMENT row to inventory_transactions — the
 * single ledger every WIP balance now reads. The human reason is folded into
 * notes (inventory_transactions has no reason column); the row is stamped with
 * the logged-in user and relies on created_at (now()) for the timestamp.
 */
export async function saveWipAdjustment(args: SaveWipAdjustmentArgs): Promise<void> {
  const { roastGroup, kgDelta, reason, notes, createdBy } = args;

  if (!roastGroup) throw new Error('Roast group is required.');
  if (!Number.isFinite(kgDelta) || kgDelta === 0) {
    throw new Error('kg delta must be a non-zero number.');
  }

  const trimmed = notes?.trim();
  const note = trimmed ? `[${reason}] ${trimmed}` : `[${reason}]`;

  const { error } = await supabase.from('inventory_transactions').insert({
    transaction_type: 'ADJUSTMENT',
    roast_group: roastGroup,
    quantity_kg: +kgDelta.toFixed(4),
    notes: note,
    created_by: createdBy ?? null,
    is_system_generated: false,
  });

  if (error) throw error;
}

export const WIP_ADJUSTMENT_QUERY_KEYS: string[][] = [
  ['inventory-transactions-wip'],
  ['roast-group-wip'],
  ['roast-group-detail'],
  ['roast-group-inventory-levels'],
  // Authoritative hook used by the production page
  ['authoritative-wip-ledger'],
  // "Last counted by X" footnote on the Inventory page WIP/FG rows
  ['inventory-last-counts'],
];
