import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { RefreshCw, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const sb = supabase as any;

const errMsg = (e: unknown): string => {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null) {
    const anyE = e as any;
    return anyE.message ?? anyE.error_description ?? JSON.stringify(anyE);
  }
  return String(e);
};

interface PullResult {
  store_slug: string;
  result: string;
  orders_retrieved: number;
  orders_included: number;
  orders_quarantined: number;
  order_number?: string;
  error?: string;
}

/**
 * Unified Shopify pull for ALL active sources (currently FUNK + No Smoke).
 * Visible to ADMIN and OPS only. Invokes the `shopify-pull-orders` edge function
 * with NO source_id, which runs the all-active-sources path — the same path the
 * daily cron uses. Replaces the old per-source No Smoke button and the FUNK CSV
 * import link (the CSV importer page lives on at /admin/funk-import as a fallback).
 */
export function ShopifyFetchTile({ onPulled }: { onPulled?: () => void }) {
  const { isInternal } = useAuth();
  const queryClient = useQueryClient();
  const [pulling, setPulling] = React.useState(false);

  // Most recent pull attempt across ALL sources (automatic or manual).
  const lastPullQ = useQuery({
    queryKey: ['shopify-fetch', 'last_pull'],
    enabled: isInternal,
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_pull_log')
        .select('result, trigger_type, attempted_at, triggered_by')
        .order('attempted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as {
        result: string | null;
        trigger_type: string | null;
        attempted_at: string | null;
        triggered_by: string | null;
      } | null;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['shopify-fetch', 'last_pull'] });
    queryClient.invalidateQueries({ queryKey: ['shopify-quarantine'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      // No source_id -> the edge function pulls every active shopify_sources row.
      const { data, error } = await supabase.functions.invoke('shopify-pull-orders', {
        body: {},
      });
      if (error) throw error;
      const results = (data?.results ?? []) as PullResult[];
      if (results.length === 0) {
        toast.info(data?.message ?? 'No active Shopify sources');
      }
      for (const r of results) {
        const summary = `${r.store_slug}: ${r.result} — ${r.orders_included} new order${r.orders_included === 1 ? '' : 's'} (retrieved ${r.orders_retrieved}, quarantined ${r.orders_quarantined})`;
        if (r.result === 'error') toast.error(`${summary} (${r.error})`);
        else if (r.result === 'partial') toast.warning(summary);
        else toast.success(summary);
      }
      invalidate();
      onPulled?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPulling(false);
    }
  };

  if (!isInternal) return null;

  const last = lastPullQ.data;
  // Date + time only. The pull does NOT populate triggered_by today, so a "by user"
  // segment is rendered only if the column is ever actually filled — never blank.
  const lastLabel = last?.attempted_at
    ? `Last fetch ${format(new Date(last.attempted_at), 'PPp')} · ${
        last.trigger_type === 'scheduled' ? 'auto' : 'manual'
      }${last.result && last.result !== 'success' ? ` · ${last.result}` : ''}${
        last.triggered_by ? ` · by ${last.triggered_by}` : ''
      }`
    : lastPullQ.isLoading
      ? 'Checking last fetch…'
      : 'Never fetched';

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <Cloud className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">
          Fetch FUNK and No Smoke Orders from Shopify
        </div>
        <div className="text-xs text-muted-foreground">{lastLabel}</div>
      </div>
      <Button onClick={handlePull} disabled={pulling} variant="secondary" className="ml-auto">
        <RefreshCw className={`mr-2 h-4 w-4 ${pulling ? 'animate-spin' : ''}`} />
        {pulling ? 'Fetching…' : 'Fetch'}
      </Button>
    </div>
  );
}
