import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type DayCloseKind = 'ROAST' | 'SHIP';

export interface DayCloseRow {
  id: string;
  work_date: string;
  kind: DayCloseKind;
  closed_by: string | null;
  closed_at: string;
  notes: string | null;
  forced: boolean;
  reopened_at: string | null;
  snapshot: Record<string, unknown>;
}

/** The active (not reopened) close for a date + kind, if any. */
export function useDayClose(workDate: string, kind: DayCloseKind) {
  return useQuery({
    queryKey: ['day-close', workDate, kind],
    queryFn: async (): Promise<DayCloseRow | null> => {
      const { data, error } = await supabase
        .from('production_day_closes')
        .select('*')
        .eq('work_date', workDate)
        .eq('kind', kind)
        .is('reopened_at', null)
        .order('closed_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as DayCloseRow | undefined) ?? null;
    },
  });
}

export function useCloseDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workDate: string; kind: DayCloseKind; userId: string;
      snapshot: Record<string, unknown>; notes: string | null; forced: boolean;
    }) => {
      const { error } = await supabase.from('production_day_closes').insert({
        work_date: input.workDate,
        kind: input.kind,
        closed_by: input.userId,
        snapshot: input.snapshot as never,
        notes: input.notes,
        forced: input.forced,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-close'] }),
  });
}

export function useReopenDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      const { error } = await supabase
        .from('production_day_closes')
        .update({ reopened_at: new Date().toISOString(), reopened_by: userId })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day-close'] }),
  });
}

/** Vancouver calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function vancouverDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function vancouverTime(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export interface RoastedBatchTime {
  roast_group: string;
  assigned_roaster: string | null;
  actual_output_kg: number;
  roasted_at: string;
}

/** Roasted batches with a roast time in the last `days` days. */
export function useRecentRoastTimes(days: number) {
  return useQuery({
    queryKey: ['recent-roast-times', days],
    queryFn: async (): Promise<RoastedBatchTime[]> => {
      const since = new Date(Date.now() - (days + 1) * 86400000).toISOString();
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('roast_group, assigned_roaster, actual_output_kg, roasted_at')
        .eq('status', 'ROASTED')
        .gte('roasted_at', since)
        .order('roasted_at', { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .filter((b) => b.roasted_at)
        .map((b) => ({ ...b, actual_output_kg: Number(b.actual_output_kg ?? 0) })) as RoastedBatchTime[];
    },
  });
}

export interface RoasterDaySummary { roaster: string; kg: number; batches: number; first: string; last: string }

export function summarizeRoasterDay(rows: RoastedBatchTime[], date: string): RoasterDaySummary[] {
  const by: Record<string, RoasterDaySummary> = {};
  for (const r of rows) {
    if (vancouverDate(r.roasted_at) !== date) continue;
    const key = r.assigned_roaster ?? 'UNASSIGNED';
    const s = by[key] ?? { roaster: key, kg: 0, batches: 0, first: r.roasted_at, last: r.roasted_at };
    s.kg += r.actual_output_kg;
    s.batches += 1;
    if (r.roasted_at < s.first) s.first = r.roasted_at;
    if (r.roasted_at > s.last) s.last = r.roasted_at;
    by[key] = s;
  }
  return Object.values(by).sort((a, b) => a.roaster.localeCompare(b.roaster));
}
