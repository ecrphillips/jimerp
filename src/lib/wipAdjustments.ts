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
 * Both the per-row WipAdjustmentModal and the bulk WipFloorCountModal
 * use this helper. Writes ONLY to wip_adjustments — that is what the
 * Inventory Levels WIP math reads as the manual-adjustment source.
 */
export async function saveWipAdjustment(args: SaveWipAdjustmentArgs): Promise<void> {
  const { roastGroup, kgDelta, reason, notes, createdBy } = args;

  if (!roastGroup) throw new Error('Roast group is required.');
  if (!Number.isFinite(kgDelta) || kgDelta === 0) {
    throw new Error('kg delta must be a non-zero number.');
  }

  const { error } = await supabase.from('wip_adjustments').insert({
    roast_group: roastGroup,
    kg_delta: +kgDelta.toFixed(4),
    reason,
    notes: notes?.trim() ? notes.trim() : null,
    created_by: createdBy ?? null,
  });

  if (error) throw error;
}

export const WIP_ADJUSTMENT_QUERY_KEYS: string[][] = [
  ['wip-adjustments'],
  ['inventory-transactions-wip'],
  ['inventory-ledger-wip'],
  ['roast-group-wip'],
  ['roast-group-detail'],
  ['roast-group-inventory-levels'],
  // Authoritative hooks used by the production page
  ['authoritative-wip-manual-adjustments'],
  ['authoritative-wip-ledger'],
];
