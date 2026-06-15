import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const sb = supabase as any;

const NO_SMOKE_SLUG = 'no-smoke-coffee';

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
 * No Smoke Coffee–specific Shopify order pull. Visible to ADMIN and OPS only.
 * Triggers the `shopify-pull-orders` edge function scoped to the No Smoke
 * source and shows when the last pull ran (automatic or manual).
 */
export function NoSmokeShopifyPull({ onPulled }: { onPulled?: () => void }) {
  const { isInternal } = useAuth();
  const queryClient = useQueryClient();
  const [pulling, setPulling] = React.useState(false);

  // The No Smoke source row (id + active flag).
  const sourceQ = useQuery({
    queryKey: ['no-smoke-shopify', 'source'],
    enabled: isInternal,
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_sources')
        .select('id, store_name, is_active')
        .eq('store_slug', NO_SMOKE_SLUG)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; store_name: string | null; is_active: boolean | null } | null;
    },
  });

  const sourceId = sourceQ.data?.id;

  // Most recent pull attempt for this source (automatic or manual).
  const lastPullQ = useQuery({
    queryKey: ['no-smoke-shopify', 'last_pull', sourceId],
    enabled: isInternal && !!sourceId,
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_pull_log')
        .select('result, trigger_type, orders_included, attempted_at')
        .eq('source_id', sourceId)
        .order('attempted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as {
        result: string | null;
        trigger_type: string | null;
        orders_included: number | null;
        attempted_at: string | null;
      } | null;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['no-smoke-shopify', 'last_pull'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const handlePull = async () => {
    if (!sourceId) return;
    setPulling(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopify-pull-orders', {
        body: { source_id: sourceId },
      });
      if (error) throw error;
      const results = (data?.results ?? []) as PullResult[];
      const version = data?.version ?? 'unknown';
      if (results.length === 0) {
        toast.info(data?.message ?? 'No active No Smoke source');
      }
      for (const r of results) {
        const summary = `No Smoke: ${r.result} — ${r.orders_included} new order${r.orders_included === 1 ? '' : 's'} (retrieved ${r.orders_retrieved}, quarantined ${r.orders_quarantined})`;
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
  // No source configured yet — stay quiet rather than show a broken control.
  if (sourceQ.isSuccess && !sourceQ.data) return null;

  const last = lastPullQ.data;
  const lastLabel = last?.attempted_at
    ? `Last fetch ${formatDistanceToNow(new Date(last.attempted_at), { addSuffix: true })} · ${
        last.trigger_type === 'scheduled' ? 'auto' : 'manual'
      }${last.result && last.result !== 'success' ? ` · ${last.result}` : ''}`
    : lastPullQ.isLoading
      ? 'Checking last fetch…'
      : 'Never fetched';

  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
      <Cloud className="h-5 w-5 shrink-0 text-emerald-600" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-emerald-900">No Smoke Shopify orders</div>
        <div className="text-xs text-emerald-700">{lastLabel}</div>
      </div>
      <Button
        onClick={handlePull}
        disabled={pulling || !sourceId}
        className="ml-auto bg-emerald-600 hover:bg-emerald-700"
      >
        <RefreshCw className={`mr-2 h-4 w-4 ${pulling ? 'animate-spin' : ''}`} />
        {pulling ? 'Fetching…' : 'Fetch No Smoke orders'}
      </Button>
    </div>
  );
}
