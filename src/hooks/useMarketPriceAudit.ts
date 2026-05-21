import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  MarketPriceAuditDraftRow,
  MarketPriceAuditRow,
  MarketPriceAuditRun,
} from '@/lib/marketPricingTypes';

// Supabase client is typed against an auto-generated DB schema that has not been
// regenerated yet. The new tables/RPCs are real in the DB, so we narrow the cast
// to `any` at the call site and re-type on the way out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb: any = supabase;

const LATEST_KEY = ['market-audit', 'latest'] as const;
const RUNS_KEY = ['market-audit', 'runs'] as const;

export interface LatestAudit {
  run: MarketPriceAuditRun;
  rows: MarketPriceAuditRow[];
}

/** Latest published run + its rows. Null while empty / not yet published. */
export function useLatestAudit() {
  return useQuery({
    queryKey: LATEST_KEY,
    queryFn: async (): Promise<LatestAudit | null> => {
      const { data: runs, error } = await sb
        .from('market_price_audit_runs')
        .select('*')
        .eq('is_published', true)
        .order('run_date', { ascending: false })
        .limit(1);
      if (error) throw error;
      const run: MarketPriceAuditRun | undefined = runs?.[0];
      if (!run) return null;
      const { data: rows, error: rowErr } = await sb
        .from('market_price_audit_rows')
        .select('*')
        .eq('run_id', run.id)
        .order('price_per_g_cad', { ascending: true });
      if (rowErr) throw rowErr;
      return { run, rows: (rows ?? []) as MarketPriceAuditRow[] };
    },
  });
}

/** All runs (admin view) ordered newest first, with row counts. */
export interface AuditRunWithCount extends MarketPriceAuditRun {
  row_count: number;
}

export function useAuditRuns() {
  return useQuery({
    queryKey: RUNS_KEY,
    queryFn: async (): Promise<AuditRunWithCount[]> => {
      const { data: runs, error } = await sb
        .from('market_price_audit_runs')
        .select('*')
        .order('run_date', { ascending: false });
      if (error) throw error;
      const list = (runs ?? []) as MarketPriceAuditRun[];
      if (list.length === 0) return [];
      // Single count round-trip per page: fetch counts grouped by run_id.
      const { data: rowsForCount, error: countErr } = await sb
        .from('market_price_audit_rows')
        .select('run_id', { count: 'exact', head: false });
      if (countErr) throw countErr;
      const counts = new Map<string, number>();
      for (const r of (rowsForCount ?? []) as { run_id: string }[]) {
        counts.set(r.run_id, (counts.get(r.run_id) ?? 0) + 1);
      }
      return list.map(r => ({ ...r, row_count: counts.get(r.id) ?? 0 }));
    },
  });
}

export function useImportAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      run_date: string;
      source_filename?: string | null;
      notes?: string | null;
      rows: MarketPriceAuditDraftRow[];
    }) => {
      const payload = args.rows.map(r => ({
        brand: r.brand,
        product_name: r.product_name,
        product_url: r.product_url,
        bag_size_g: r.bag_size_g,
        price_cad: r.price_cad,
        price_per_g_cad: r.price_per_g_cad,
        status: r.status ?? 'ok',
        notes: r.notes,
      }));
      const { data, error } = await sb.rpc('import_market_price_audit', {
        _run_date: args.run_date,
        _source_filename: args.source_filename ?? null,
        _notes: args.notes ?? null,
        _rows: payload,
      });
      if (error) throw error;
      return data as string; // new run_id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RUNS_KEY });
      qc.invalidateQueries({ queryKey: LATEST_KEY });
    },
  });
}

export function usePublishAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (run_id: string) => {
      const { error } = await sb.rpc('publish_market_price_audit', { _run_id: run_id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RUNS_KEY });
      qc.invalidateQueries({ queryKey: LATEST_KEY });
    },
  });
}

export function useUnpublishAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (run_id: string) => {
      const { error } = await sb.rpc('unpublish_market_price_audit', { _run_id: run_id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RUNS_KEY });
      qc.invalidateQueries({ queryKey: LATEST_KEY });
    },
  });
}

export function useDeleteAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (run_id: string) => {
      const { error } = await sb.rpc('delete_market_price_audit', { _run_id: run_id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RUNS_KEY });
    },
  });
}
