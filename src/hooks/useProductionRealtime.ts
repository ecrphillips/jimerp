import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Keeps the production tabs (Plan / Roast / Pack / Ship) live without manual refresh.
 *
 * Fast path: a single Supabase realtime channel listening for any change on the
 * tables that drive production inventory. Each change invalidates the relevant
 * React Query keys so the affected tab refetches.
 *
 * Fallback: a 30s interval that invalidates the same keys, so the tabs still stay
 * current even if the realtime publication is not enabled for these tables
 * (see the ALTER PUBLICATION note in the PR / migration).
 *
 * Mount this ONCE, high in the production page tree (Production.tsx).
 */

// Tables whose changes affect production inventory/demand.
const WATCHED_TABLES = [
  'roasted_batches',
  'inventory_transactions',
  'packing_runs',
  'wip_adjustments',
  'ship_picks',
  'orders',
  'order_line_items',
] as const;

// React Query keys used by the production tabs and the authoritative hooks.
const INVALIDATE_KEYS: string[] = [
  // authoritative hooks (useAuthoritativeInventory)
  'authoritative-roasted-batches',
  'authoritative-packing-runs',
  'authoritative-wip-ledger',
  'authoritative-wip-manual-adjustments',
  'authoritative-ship-picks',
  'authoritative-confirmed-demand',
  'authoritative-open-demand',
  'authoritative-products',
  'authoritative-roast-groups-info',
  // tab-local queries
  'roasted-batches',
  'packing-runs',
  'ship-picks',
  'inventory-transactions',
  'inventory-ledger-wip',
  'roast-demand',
  'production-checkmarks',
];

export function useProductionRealtime(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const invalidateAll = () => {
      for (const key of INVALIDATE_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    };

    // Fast path: realtime subscription. One channel, one listener per table.
    const channel = supabase.channel('production-realtime');
    for (const table of WATCHED_TABLES) {
      channel.on(
        // @ts-expect-error supabase-js realtime filter typing is loose for postgres_changes
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => invalidateAll(),
      );
    }
    channel.subscribe();

    // Fallback: poll-invalidate every 30s in case realtime is not publishing
    // these tables. Invalidation only refetches stale queries, so this is cheap.
    const interval = window.setInterval(invalidateAll, 30_000);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, [enabled, queryClient]);
}
