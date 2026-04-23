import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DepletionLink {
  link_id: string;
  lot_id: string;
  lot_number: string;
  pct_of_lot: number; // 0..100, defaults to 100 when null
  current_kg_on_hand: number;
  successor_lot_id: string | null;
  successor_lot: {
    id: string;
    lot_number: string;
    status: string;
    kg_on_hand: number;
  } | null;
}

export interface DepletionProjection {
  link: DepletionLink;
  projectedRemainingKg: number;
  willTriggerDepletion: boolean; // already at/below 10kg from existing planned batches
}

export interface DepletionImpact {
  link_id: string;
  lot_id: string;
  lot_number: string;
  current_kg_on_hand: number;
  projected_remaining_after_batch: number;
  will_deplete: boolean;
  already_depleted: boolean;
  successor_lot_id: string | null;
  successor_lot: DepletionLink['successor_lot'];
}

const DEPLETION_THRESHOLD_KG = 10;

interface UseGreenLotDepletionResult {
  isLoading: boolean;
  hasLinks: boolean;
  expectedYieldLossPct: number;
  projections: DepletionProjection[];
  /**
   * Compute impacts for one or more new planned batches that haven't been inserted yet.
   * Pass total kg of new planned output across all new batches on this roast group.
   */
  checkBatchImpact: (plannedOutputKg: number) => DepletionImpact[];
}

/**
 * Predicts which linked green lots will fall below 10 kg if a new planned batch is added.
 * Pure prediction — does not mutate kg_on_hand. The actual deduction from green lots
 * happens via the existing roast-execution flow.
 */
export function useGreenLotDepletion(
  roastGroupKey: string | null | undefined,
): UseGreenLotDepletionResult {
  const enabled = !!roastGroupKey;

  // Roast group config (for yield loss)
  const { data: rgConfig, isLoading: loadingRg } = useQuery({
    queryKey: ['rg-yield-config', roastGroupKey],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, expected_yield_loss_pct')
        .eq('roast_group', roastGroupKey!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Linked lots with successor info
  const { data: links = [], isLoading: loadingLinks } = useQuery({
    queryKey: ['depletion-links', roastGroupKey],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lot_roast_group_links')
        .select(`
          id,
          lot_id,
          pct_of_lot,
          successor_lot_id,
          green_lots!green_lot_roast_group_links_lot_id_fkey (
            id, lot_number, kg_on_hand
          ),
          successor:green_lots!green_lot_roast_group_links_successor_lot_id_fkey (
            id, lot_number, status, kg_on_hand
          )
        `)
        .eq('roast_group', roastGroupKey!);
      if (error) throw error;
      return (data ?? []).map((row: any): DepletionLink => ({
        link_id: row.id,
        lot_id: row.lot_id,
        lot_number: row.green_lots?.lot_number ?? '—',
        pct_of_lot: row.pct_of_lot == null ? 100 : Number(row.pct_of_lot),
        current_kg_on_hand: Number(row.green_lots?.kg_on_hand ?? 0),
        successor_lot_id: row.successor_lot_id ?? null,
        successor_lot: row.successor
          ? {
              id: row.successor.id,
              lot_number: row.successor.lot_number,
              status: row.successor.status,
              kg_on_hand: Number(row.successor.kg_on_hand ?? 0),
            }
          : null,
      }));
    },
  });

  // Existing planned batches on this roast group (pending consumption)
  const { data: plannedBatches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ['depletion-planned-batches', roastGroupKey],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('id, planned_output_kg, status')
        .eq('roast_group', roastGroupKey!)
        .eq('status', 'PLANNED');
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; planned_output_kg: number | null; status: string }>;
    },
  });

  const expectedYieldLossPct = Number(rgConfig?.expected_yield_loss_pct ?? 16);

  // kg of green input per kg of planned roasted output
  const greenFactor = 1 + expectedYieldLossPct / 100;

  // Total planned roasted output (kg) currently scheduled on this RG
  const pendingPlannedOutputKg = useMemo(
    () =>
      plannedBatches.reduce(
        (sum, b) => sum + Number(b.planned_output_kg ?? 0),
        0,
      ),
    [plannedBatches],
  );

  const projections = useMemo<DepletionProjection[]>(() => {
    return links.map(link => {
      const lotShare = pendingPlannedOutputKg * greenFactor * (link.pct_of_lot / 100);
      const projectedRemainingKg = link.current_kg_on_hand - lotShare;
      return {
        link,
        projectedRemainingKg,
        willTriggerDepletion: projectedRemainingKg < DEPLETION_THRESHOLD_KG,
      };
    });
  }, [links, pendingPlannedOutputKg, greenFactor]);

  const checkBatchImpact = useCallback(
    (plannedOutputKg: number): DepletionImpact[] => {
      if (!links.length) return [];
      if (!Number.isFinite(plannedOutputKg) || plannedOutputKg <= 0) {
        // Still surface lots that are already at/below threshold from prior planning
        return links
          .map(link => {
            const projectedFromPending =
              link.current_kg_on_hand -
              pendingPlannedOutputKg * greenFactor * (link.pct_of_lot / 100);
            const alreadyDepleted = link.current_kg_on_hand <= 0;
            const willDeplete = projectedFromPending < DEPLETION_THRESHOLD_KG;
            if (!willDeplete && !alreadyDepleted) return null;
            return buildImpact(link, projectedFromPending, alreadyDepleted, willDeplete);
          })
          .filter((x): x is DepletionImpact => !!x);
      }

      const impacts: DepletionImpact[] = [];
      for (const link of links) {
        const newBatchLotShare =
          plannedOutputKg * greenFactor * (link.pct_of_lot / 100);
        const projectedAfter =
          link.current_kg_on_hand -
          pendingPlannedOutputKg * greenFactor * (link.pct_of_lot / 100) -
          newBatchLotShare;
        const alreadyDepleted = link.current_kg_on_hand <= 0;
        const willDeplete = projectedAfter < DEPLETION_THRESHOLD_KG;
        if (willDeplete || alreadyDepleted) {
          impacts.push(buildImpact(link, projectedAfter, alreadyDepleted, willDeplete));
        }
      }
      return impacts;
    },
    [links, pendingPlannedOutputKg, greenFactor],
  );

  return {
    isLoading: enabled && (loadingRg || loadingLinks || loadingBatches),
    hasLinks: links.length > 0,
    expectedYieldLossPct,
    projections,
    checkBatchImpact,
  };
}

function buildImpact(
  link: DepletionLink,
  projectedAfter: number,
  alreadyDepleted: boolean,
  willDeplete: boolean,
): DepletionImpact {
  return {
    link_id: link.link_id,
    lot_id: link.lot_id,
    lot_number: link.lot_number,
    current_kg_on_hand: link.current_kg_on_hand,
    projected_remaining_after_batch: projectedAfter,
    will_deplete: willDeplete,
    already_depleted: alreadyDepleted,
    successor_lot_id: link.successor_lot_id,
    successor_lot: link.successor_lot,
  };
}

export const DEPLETION_THRESHOLD = DEPLETION_THRESHOLD_KG;
