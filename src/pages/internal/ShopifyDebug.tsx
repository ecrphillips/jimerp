import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const sb = supabase as any;

const trunc = (id: string | null | undefined) =>
  id ? String(id).slice(0, 8) : '—';

const errMsg = (e: unknown): string => {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null) {
    const anyE = e as any;
    return anyE.message ?? anyE.error_description ?? JSON.stringify(anyE);
  }
  return String(e);
};

async function countQuery(
  table: string,
  apply?: (q: any) => any,
): Promise<number> {
  let q = sb.from(table).select('*', { count: 'exact', head: true });
  if (apply) q = apply(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export default function ShopifyDebug() {
  const queryClient = useQueryClient();

  const sourcesQ = useQuery({
    queryKey: ['shopify-debug', 'sources'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_sources')
        .select('id, store_name, store_slug, is_active, created_at, oauth_client_id, oauth_client_secret')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Array<{
        id: string;
        store_name: string | null;
        store_slug: string | null;
        is_active: boolean | null;
        created_at: string | null;
        oauth_client_id: string | null;
        oauth_client_secret: string | null;
      }>;
    },
  });

  const pullLogQ = useQuery({
    queryKey: ['shopify-debug', 'pull_log'],
    queryFn: async () => {
      const { data, error } = await sb
        .from('shopify_pull_log')
        .select(
          'id, source_id, result, trigger_type, orders_retrieved, orders_included, orders_quarantined, attempted_at',
        )
        .order('attempted_at', { ascending: false });
      if (error) throw error;
      return data as Array<{
        id: string;
        source_id: string | null;
        result: string | null;
        trigger_type: string | null;
        orders_retrieved: number | null;
        orders_included: number | null;
        orders_quarantined: number | null;
        attempted_at: string | null;
      }>;
    },
  });

  const orderCountsQ = useQuery({
    queryKey: ['shopify-debug', 'order_counts'],
    queryFn: async () => {
      const [total, manual, shopifyAuto, shopifyFallback, withShopifyId] =
        await Promise.all([
          countQuery('orders'),
          countQuery('orders', (q) => q.eq('source_channel', 'manual')),
          countQuery('orders', (q) => q.eq('source_channel', 'shopify_auto')),
          countQuery('orders', (q) =>
            q.eq('source_channel', 'shopify_manual_fallback'),
          ),
          countQuery('orders', (q) => q.not('shopify_source_id', 'is', null)),
        ]);
      return { total, manual, shopifyAuto, shopifyFallback, withShopifyId };
    },
  });

  const lineItemCountsQ = useQuery({
    queryKey: ['shopify-debug', 'line_item_counts'],
    queryFn: async () => {
      const [total, anyReason, deferred, abandoned] = await Promise.all([
        countQuery('order_line_items'),
        countQuery('order_line_items', (q) =>
          q.not('short_ship_reason', 'is', null),
        ),
        countQuery('order_line_items', (q) =>
          q.eq('short_ship_reason', 'deferred'),
        ),
        countQuery('order_line_items', (q) =>
          q.eq('short_ship_reason', 'abandoned'),
        ),
      ]);
      return { total, anyReason, deferred, abandoned };
    },
  });

  const invalidate = (key: string) =>
    queryClient.invalidateQueries({ queryKey: ['shopify-debug', key] });

  const [pulling, setPulling] = React.useState(false);

  const handleRunPullNow = async () => {
    setPulling(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'shopify-pull-orders',
        { body: {} },
      );
      if (error) throw error;
      const results = (data?.results ?? []) as Array<{
        store_slug: string;
        result: string;
        orders_retrieved: number;
        orders_included: number;
        orders_quarantined: number;
        order_number?: string;
        error?: string;
      }>;
      const version = data?.version ?? 'pre-2.1 (stale deploy)';
      if (results.length === 0) {
        toast.info(`${data?.message ?? 'No active Shopify sources'} — fn ${version}`);
      }
      for (const r of results) {
        const summary = `[fn ${version}] ${r.store_slug}: ${r.result} — retrieved ${r.orders_retrieved}, included ${r.orders_included}, quarantined ${r.orders_quarantined}${r.order_number ? `, order ${r.order_number}` : ''}`;
        if (r.result === 'error') toast.error(`${summary} (${r.error})`);
        else if (r.result === 'partial') toast.warning(summary);
        else toast.success(summary);
      }
      invalidate('pull_log');
      invalidate('order_counts');
      invalidate('line_item_counts');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPulling(false);
    }
  };

  const handleInsertTestSource = async () => {
    try {
      const { data: account, error: acctErr } = await sb
        .from('accounts')
        .select('id')
        .limit(1)
        .single();
      if (acctErr) throw acctErr;
      if (!account?.id) throw new Error('No accounts found to link');

      const { error } = await sb.from('shopify_sources').insert({
        store_name: 'TEST',
        store_slug: 'test-source-' + Date.now(),
        linked_account_id: account.id,
        store_url: 'https://test.myshopify.com',
        pull_cadence: 'manual',
        is_active: false,
      });
      if (error) throw error;
      toast.success('Test source inserted');
      invalidate('sources');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const handleDeleteTestSources = async () => {
    try {
      const { error } = await sb
        .from('shopify_sources')
        .delete()
        .eq('store_name', 'TEST');
      if (error) throw error;
      toast.success('Test sources deleted');
      invalidate('sources');
      invalidate('pull_log');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const handleInsertTestPullLog = async () => {
    try {
      const { data: src, error: srcErr } = await sb
        .from('shopify_sources')
        .select('id')
        .eq('store_name', 'TEST')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (srcErr) throw srcErr;
      if (!src?.id)
        throw new Error('No TEST source found — insert one first');

      const { error } = await sb.from('shopify_pull_log').insert({
        source_id: src.id,
        result: 'success',
        trigger_type: 'manual',
        orders_retrieved: 5,
        orders_included: 4,
        orders_quarantined: 1,
      });
      if (error) throw error;
      toast.success('Test pull log entry inserted');
      invalidate('pull_log');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Shopify Debug</h1>
        <p className="text-sm text-muted-foreground">
          Admin-only inspection &amp; seeding for Shopify integration tables.
        </p>
      </div>

      {/* 1. Sources */}
      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={handleRunPullNow} disabled={pulling}>
              {pulling ? 'Pulling…' : 'Run pull now'}
            </Button>
            <Button onClick={handleInsertTestSource}>Insert test source</Button>
            <Button variant="destructive" onClick={handleDeleteTestSources}>
              Delete all test sources
            </Button>
          </div>
          {sourcesQ.error && (
            <p className="text-sm text-red-600">
              Error: {errMsg(sourcesQ.error)}
            </p>
          )}
          <p className="text-sm">
            Total rows: {sourcesQ.data?.length ?? (sourcesQ.isLoading ? '…' : 0)}
          </p>
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
              {(sourcesQ.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {trunc(r.id)}
                  </TableCell>
                  <TableCell>{r.store_name ?? '—'}</TableCell>
                  <TableCell>{r.store_slug ?? '—'}</TableCell>
                  <TableCell>{String(r.is_active)}</TableCell>
                  <TableCell className="text-xs">
                    {r.created_at ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 2. Pull log */}
      <Card>
        <CardHeader>
          <CardTitle>Pull Log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleInsertTestPullLog}>
            Insert test pull log entry
          </Button>
          {pullLogQ.error && (
            <p className="text-sm text-red-600">
              Error: {errMsg(pullLogQ.error)}
            </p>
          )}
          <p className="text-sm">
            Total rows: {pullLogQ.data?.length ?? (pullLogQ.isLoading ? '…' : 0)}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead>source_id</TableHead>
                <TableHead>result</TableHead>
                <TableHead>trigger_type</TableHead>
                <TableHead>retrieved</TableHead>
                <TableHead>included</TableHead>
                <TableHead>quarantined</TableHead>
                <TableHead>attempted_at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pullLogQ.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {trunc(r.id)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {trunc(r.source_id)}
                  </TableCell>
                  <TableCell>{r.result ?? '—'}</TableCell>
                  <TableCell>{r.trigger_type ?? '—'}</TableCell>
                  <TableCell>{r.orders_retrieved ?? '—'}</TableCell>
                  <TableCell>{r.orders_included ?? '—'}</TableCell>
                  <TableCell>{r.orders_quarantined ?? '—'}</TableCell>
                  <TableCell className="text-xs">
                    {r.attempted_at ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 3. Orders source linkage */}
      <Card>
        <CardHeader>
          <CardTitle>Orders Source Linkage (read-only)</CardTitle>
        </CardHeader>
        <CardContent>
          {orderCountsQ.error && (
            <p className="text-sm text-red-600">
              Error: {errMsg(orderCountsQ.error)}
            </p>
          )}
          <ul className="text-sm space-y-1">
            <li>Total orders: {orderCountsQ.data?.total ?? '…'}</li>
            <li>source_channel = manual: {orderCountsQ.data?.manual ?? '…'}</li>
            <li>
              source_channel = shopify_auto:{' '}
              {orderCountsQ.data?.shopifyAuto ?? '…'}
            </li>
            <li>
              source_channel = shopify_manual_fallback:{' '}
              {orderCountsQ.data?.shopifyFallback ?? '…'}
            </li>
            <li>
              shopify_source_id NOT NULL:{' '}
              {orderCountsQ.data?.withShopifyId ?? '…'}
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* 4. Line item short-ship */}
      <Card>
        <CardHeader>
          <CardTitle>Line Item Short-Ship (read-only)</CardTitle>
        </CardHeader>
        <CardContent>
          {lineItemCountsQ.error && (
            <p className="text-sm text-red-600">
              Error: {errMsg(lineItemCountsQ.error)}
            </p>
          )}
          <ul className="text-sm space-y-1">
            <li>Total order_line_items: {lineItemCountsQ.data?.total ?? '…'}</li>
            <li>
              short_ship_reason NOT NULL:{' '}
              {lineItemCountsQ.data?.anyReason ?? '…'}
            </li>
            <li>
              short_ship_reason = deferred:{' '}
              {lineItemCountsQ.data?.deferred ?? '…'}
            </li>
            <li>
              short_ship_reason = abandoned:{' '}
              {lineItemCountsQ.data?.abandoned ?? '…'}
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
