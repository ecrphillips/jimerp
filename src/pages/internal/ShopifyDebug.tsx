import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Shopify tables/columns are new and types.ts has not been regenerated yet.
// Cast at call sites until `supabase gen types` runs.
const sb = supabase as unknown as {
  from: (t: string) => ReturnType<typeof supabase.from>;
};

function describeError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

interface SourceRow {
  id: string;
  store_name: string;
  store_slug: string;
  is_active: boolean;
  created_at: string;
}

interface PullLogRow {
  id: string;
  shopify_source_id: string;
  result: string;
  trigger_type: string;
  orders_retrieved: number;
  orders_included: number;
  orders_quarantined: number;
  created_at: string;
}

export default function ShopifyDebug() {
  const qc = useQueryClient();

  const sourcesQuery = useQuery({
    queryKey: ['debug_shopify_sources'],
    queryFn: async (): Promise<SourceRow[]> => {
      const { data, error } = await sb
        .from('shopify_sources')
        .select('id, store_name, store_slug, is_active, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SourceRow[];
    },
  });

  const pullLogQuery = useQuery({
    queryKey: ['debug_shopify_pull_log'],
    queryFn: async () => {
      const recent = await sb
        .from('shopify_pull_log')
        .select(
          'id, shopify_source_id, result, trigger_type, orders_retrieved, orders_included, orders_quarantined, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(5);
      if (recent.error) throw recent.error;
      const countRes = await sb
        .from('shopify_pull_log')
        .select('id', { count: 'exact', head: true });
      if (countRes.error) throw countRes.error;
      return {
        rows: (recent.data ?? []) as unknown as PullLogRow[],
        total: countRes.count ?? 0,
      };
    },
  });

  const orderStatsQuery = useQuery({
    queryKey: ['debug_orders_source_stats'],
    queryFn: async () => {
      const orders = () =>
        (supabase.from('orders') as unknown as {
          select: (
            s: string,
            opts: { count: 'exact'; head: true },
          ) => {
            eq: (col: string, val: string) => Promise<{ count: number | null; error: unknown }>;
            not: (
              col: string,
              op: string,
              val: null,
            ) => Promise<{ count: number | null; error: unknown }>;
            then: <T>(
              fn: (v: { count: number | null; error: unknown }) => T,
            ) => Promise<T>;
          };
        }).select('id', { count: 'exact', head: true });

      const total = await orders();
      if (total.error) throw total.error;

      const manual = await orders().eq('source_channel', 'manual');
      if (manual.error) throw manual.error;

      const auto = await orders().eq('source_channel', 'shopify_auto');
      if (auto.error) throw auto.error;

      const fallback = await orders().eq('source_channel', 'shopify_manual_fallback');
      if (fallback.error) throw fallback.error;

      const linked = await orders().not('shopify_source_id', 'is', null);
      if (linked.error) throw linked.error;

      return {
        total: total.count ?? 0,
        manual: manual.count ?? 0,
        auto: auto.count ?? 0,
        fallback: fallback.count ?? 0,
        linked: linked.count ?? 0,
      };
    },
  });

  const lineItemStatsQuery = useQuery({
    queryKey: ['debug_line_item_short_ship'],
    queryFn: async () => {
      const li = () =>
        (supabase.from('order_line_items') as unknown as {
          select: (
            s: string,
            opts: { count: 'exact'; head: true },
          ) => {
            eq: (col: string, val: string) => Promise<{ count: number | null; error: unknown }>;
            not: (
              col: string,
              op: string,
              val: null,
            ) => Promise<{ count: number | null; error: unknown }>;
            then: <T>(
              fn: (v: { count: number | null; error: unknown }) => T,
            ) => Promise<T>;
          };
        }).select('id', { count: 'exact', head: true });

      const total = await li();
      if (total.error) throw total.error;

      const anyShort = await li().not('short_ship_reason', 'is', null);
      if (anyShort.error) throw anyShort.error;

      const deferred = await li().eq('short_ship_reason', 'deferred');
      if (deferred.error) throw deferred.error;

      const abandoned = await li().eq('short_ship_reason', 'abandoned');
      if (abandoned.error) throw abandoned.error;

      return {
        total: total.count ?? 0,
        any: anyShort.count ?? 0,
        deferred: deferred.count ?? 0,
        abandoned: abandoned.count ?? 0,
      };
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['debug_shopify_sources'] });
    qc.invalidateQueries({ queryKey: ['debug_shopify_pull_log'] });
    qc.invalidateQueries({ queryKey: ['debug_orders_source_stats'] });
  };

  const insertTestSource = async () => {
    try {
      const { data: account, error: accountErr } = await supabase
        .from('accounts')
        .select('id')
        .limit(1)
        .single();
      if (accountErr) throw accountErr;
      if (!account?.id) throw new Error('No account found to link');

      const slug = `test-source-${Date.now()}`;
      const { error } = await sb.from('shopify_sources').insert({
        store_name: 'TEST',
        store_slug: slug,
        linked_account_id: account.id,
        store_url: 'https://test.myshopify.com',
        pull_cadence: 'manual',
        is_active: false,
      } as never);
      if (error) throw error;
      toast.success(`Inserted source ${slug}`);
      invalidateAll();
    } catch (err) {
      toast.error(`Insert source failed: ${describeError(err)}`);
    }
  };

  const deleteAllTestSources = async () => {
    try {
      const { data, error } = await sb
        .from('shopify_sources')
        .delete()
        .eq('store_name', 'TEST')
        .select('id');
      if (error) throw error;
      toast.success(`Deleted ${data?.length ?? 0} TEST sources (FK cascade applied)`);
      invalidateAll();
    } catch (err) {
      toast.error(`Delete failed: ${describeError(err)}`);
    }
  };

  const insertTestPullLog = async () => {
    try {
      const { data: latest, error: srcErr } = await sb
        .from('shopify_sources')
        .select('id')
        .eq('store_name', 'TEST')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (srcErr) throw srcErr;
      if (!latest?.id) throw new Error('Insert a TEST source first');

      const { error } = await sb.from('shopify_pull_log').insert({
        shopify_source_id: (latest as { id: string }).id,
        result: 'success',
        trigger_type: 'manual',
        orders_retrieved: 5,
        orders_included: 4,
        orders_quarantined: 1,
      } as never);
      if (error) throw error;
      toast.success('Inserted pull log entry');
      qc.invalidateQueries({ queryKey: ['debug_shopify_pull_log'] });
    } catch (err) {
      toast.error(`Insert pull log failed: ${describeError(err)}`);
    }
  };

  const orderStats = orderStatsQuery.data;
  const lineStats = lineItemStatsQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Shopify Debug</h1>
        <p className="text-sm text-muted-foreground">
          Admin-only smoke test for the Shopify integration foundation. Ugly on purpose.
        </p>
      </div>

      {/* Section 1 — Sources */}
      <Card>
        <CardHeader>
          <CardTitle>1. Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={insertTestSource}>Insert test source</Button>
            <Button variant="destructive" onClick={deleteAllTestSources}>
              Delete all test sources
            </Button>
          </div>
          <div className="text-sm">
            Total rows: <strong>{sourcesQuery.data?.length ?? '—'}</strong>
            {sourcesQuery.error && (
              <span className="text-destructive ml-2">
                Error: {describeError(sourcesQuery.error)}
              </span>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead>store_name</TableHead>
                <TableHead>store_slug</TableHead>
                <TableHead>is_active</TableHead>
                <TableHead>created_at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sourcesQuery.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</TableCell>
                  <TableCell>{r.store_name}</TableCell>
                  <TableCell>{r.store_slug}</TableCell>
                  <TableCell>{String(r.is_active)}</TableCell>
                  <TableCell>{r.created_at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Section 2 — Pull log */}
      <Card>
        <CardHeader>
          <CardTitle>2. Pull log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={insertTestPullLog}>Insert test pull log entry</Button>
          <div className="text-sm">
            Total rows: <strong>{pullLogQuery.data?.total ?? '—'}</strong>
            {pullLogQuery.error && (
              <span className="text-destructive ml-2">
                Error: {describeError(pullLogQuery.error)}
              </span>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead>source</TableHead>
                <TableHead>result</TableHead>
                <TableHead>trigger</TableHead>
                <TableHead>retrieved / included / quarantined</TableHead>
                <TableHead>created_at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pullLogQuery.data?.rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.shopify_source_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>{r.result}</TableCell>
                  <TableCell>{r.trigger_type}</TableCell>
                  <TableCell>
                    {r.orders_retrieved} / {r.orders_included} / {r.orders_quarantined}
                  </TableCell>
                  <TableCell>{r.created_at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Section 3 — Orders source linkage */}
      <Card>
        <CardHeader>
          <CardTitle>3. Orders source linkage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {orderStatsQuery.error && (
            <div className="text-destructive">
              Error: {describeError(orderStatsQuery.error)}
            </div>
          )}
          <div>Total orders: <strong>{orderStats?.total ?? '—'}</strong></div>
          <div>source_channel = manual: <strong>{orderStats?.manual ?? '—'}</strong></div>
          <div>source_channel = shopify_auto: <strong>{orderStats?.auto ?? '—'}</strong></div>
          <div>
            source_channel = shopify_manual_fallback:{' '}
            <strong>{orderStats?.fallback ?? '—'}</strong>
          </div>
          <div>shopify_source_id IS NOT NULL: <strong>{orderStats?.linked ?? '—'}</strong></div>
          <p className="text-muted-foreground pt-2">
            This confirms the new orders columns are queryable. Should show all manual right
            now.
          </p>
        </CardContent>
      </Card>

      {/* Section 4 — Line item short-ship */}
      <Card>
        <CardHeader>
          <CardTitle>4. Line item short-ship</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {lineItemStatsQuery.error && (
            <div className="text-destructive">
              Error: {describeError(lineItemStatsQuery.error)}
            </div>
          )}
          <div>Total line items: <strong>{lineStats?.total ?? '—'}</strong></div>
          <div>short_ship_reason IS NOT NULL: <strong>{lineStats?.any ?? '—'}</strong></div>
          <div>short_ship_reason = deferred: <strong>{lineStats?.deferred ?? '—'}</strong></div>
          <div>
            short_ship_reason = abandoned: <strong>{lineStats?.abandoned ?? '—'}</strong>
          </div>
          <p className="text-muted-foreground pt-2">
            Should be all-null right now. The fields exist; nothing has used them yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
