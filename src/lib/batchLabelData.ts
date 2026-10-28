/**
 * Loads what a WIP bin label needs, for a roasted batch or a blend run,
 * and prints it (see batchLabel.ts).
 */
import { supabase } from '@/integrations/supabase/client';
import { lotLeadLabel } from '@/components/quotes/lotLabel';
import { printLabel, machineName, type LabelData } from './batchLabel';

export interface StoredLotSplit {
  lot_id: string;
  pct: number;
}

export function parseLotSplits(raw: unknown): StoredLotSplit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => ({ lot_id: String((e as { lot_id?: unknown })?.lot_id ?? ''), pct: Number((e as { pct?: unknown })?.pct ?? 0) }))
    .filter((s) => s.lot_id && s.pct > 0);
}

function roastGroupLabel(rg: { roast_group: string; display_name: string | null } | null | undefined, key: string): string {
  return rg?.display_name?.trim() || key.replace(/_/g, ' ');
}

/** Friendly names for green lots (lotLeadLabel), keyed by lot id. */
export async function fetchLotLabels(lotIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(lotIds)].filter(Boolean);
  if (ids.length === 0) return {};
  const [{ data: lots }, { data: lines }] = await Promise.all([
    supabase.from('green_lots').select('id, lot_number, lot_identifier, book_value_per_kg').in('id', ids),
    supabase.from('green_purchase_lines').select('lot_id, origin_country, producer, lot_identifier').in('lot_id', ids),
  ]);
  const lineByLot = new Map((lines ?? []).map((l) => [l.lot_id as string, l]));
  const out: Record<string, string> = {};
  for (const lot of lots ?? []) {
    const pl = lineByLot.get(lot.id);
    out[lot.id] = lotLeadLabel({
      id: lot.id,
      lot_number: lot.lot_number,
      book_value_per_kg: null,
      lot_identifier: lot.lot_identifier ?? pl?.lot_identifier ?? null,
      origin_country: pl?.origin_country ?? null,
      producer: pl?.producer ?? null,
    });
  }
  return out;
}

export async function loadBatchLabel(batchId: string): Promise<LabelData> {
  const { data: batch, error } = await supabase
    .from('roasted_batches')
    .select('id, roast_group, batch_number, batch_date, roasted_at, assigned_roaster, planned_output_kg, actual_output_kg, green_lot_splits')
    .eq('id', batchId)
    .single();
  if (error) throw error;
  if (!batch.batch_number) throw new Error('This batch has no batch number yet');

  const { data: rg } = await supabase
    .from('roast_groups').select('roast_group, display_name, is_blend').eq('roast_group', batch.roast_group).maybeSingle();

  let lotText: string | null = null;
  if (!rg?.is_blend) {
    const splits = parseLotSplits(batch.green_lot_splits);
    if (splits.length > 0) {
      const names = await fetchLotLabels(splits.map((s) => s.lot_id));
      lotText = splits.map((s) => names[s.lot_id]).filter(Boolean).join(' + ') || null;
    }
  }

  return {
    batchDate: batch.batch_date ?? (batch.roasted_at ?? new Date().toISOString()).slice(0, 10),
    roastGroupName: roastGroupLabel(rg as { roast_group: string; display_name: string | null } | null, batch.roast_group),
    batchNumber: batch.batch_number,
    machineName: machineName(batch.assigned_roaster),
    greenKg: batch.planned_output_kg,
    roastedKg: batch.actual_output_kg,
    lotText,
  };
}

export async function loadBlendLabel(blendRunId: string): Promise<LabelData> {
  const { data: run, error } = await supabase
    .from('blend_runs')
    .select('id, batch_number, batch_date, blend_roast_group, total_kg, blend_run_components(kg_used, roasted_batches(batch_number))')
    .eq('id', blendRunId)
    .single();
  if (error) throw error;

  const { data: rg } = await supabase
    .from('roast_groups').select('roast_group, display_name').eq('roast_group', run.blend_roast_group).maybeSingle();
  const comps = (run.blend_run_components ?? []) as { kg_used: number; roasted_batches: { batch_number: string | null } | null }[];
  const usedKg = comps.reduce((a, c) => a + Number(c.kg_used || 0), 0);

  return {
    batchDate: run.batch_date,
    roastGroupName: roastGroupLabel(rg as { roast_group: string; display_name: string | null } | null, run.blend_roast_group),
    batchNumber: run.batch_number,
    machineName: machineName('BLEND'),
    greenKg: usedKg,
    roastedKg: Number(run.total_kg),
    components: comps.map((c) => c.roasted_batches?.batch_number ?? '?').sort(),
  };
}

/** Print a roasted batch's label. */
export async function printBatchLabel(batchId: string) {
  printLabel(await loadBatchLabel(batchId));
}

/** Print a blend's label. */
export async function printBlendLabel(blendRunId: string) {
  printLabel(await loadBlendLabel(blendRunId));
}
