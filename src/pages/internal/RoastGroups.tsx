import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDisplayName } from '@/lib/roastGroupUtils';
import { NewRoastGroupModal } from '@/components/roast-groups/NewRoastGroupModal';

type FilterType = 'ALL' | 'BLENDS' | 'SINGLE_ORIGINS' | 'NEEDS_ATTENTION';

export default function RoastGroups() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [modalOpen, setModalOpen] = useState(false);

  // Hook 1: Fetch all roast groups with components and lot links (no product join)
  const { data: rawGroups = [], isLoading, error: groupsError } = useQuery({
    queryKey: ['roast-groups-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select(`
          *,
          roast_group_components (component_roast_group, pct),
          green_lot_roast_group_links (lot_id, green_lots (id, lot_number, status))
        `)
        .order('display_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Hook 2: Fetch product counts separately
  const { data: productCountMap = {} } = useQuery({
    queryKey: ['roast-group-product-counts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('roast_group')
        .not('roast_group', 'is', null);
      const map: Record<string, number> = {};
      (data ?? []).forEach((p: any) => {
        if (p.roast_group) map[p.roast_group] = (map[p.roast_group] || 0) + 1;
      });
      return map;
    },
  });

  // Fetch all roast group display names for component resolution
  const { data: allGroupNames = {} } = useQuery({
    queryKey: ['roast-group-name-map'],
    queryFn: async () => {
      const { data } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name')
        .eq('is_active', true);
      const map: Record<string, string> = {};
      (data ?? []).forEach((r: any) => {
        map[r.roast_group] = getDisplayName(r.display_name, r.roast_group);
      });
      return map;
    },
  });

  // Merge product counts into roast groups
  const roastGroups = useMemo(() =>
    rawGroups.map((rg: any) => ({
      ...rg,
      product_count: productCountMap[rg.roast_group] || 0,
    })),
    [rawGroups, productCountMap]
  );

  const needsAttention = (rg: any) => {
    if (rg.is_seasonal || !rg.is_active) return false;
    const activeLots = (rg.green_lot_roast_group_links ?? []).filter(
      (link: any) => link.green_lots && link.green_lots.status !== 'EXHAUSTED'
    );
    return activeLots.length === 0;
  };

  const filtered = useMemo(() => {
    return roastGroups.filter((rg: any) => {
      if (filter === 'BLENDS') return rg.is_blend;
      if (filter === 'SINGLE_ORIGINS') return !rg.is_blend;
      if (filter === 'NEEDS_ATTENTION') return needsAttention(rg);
      return true;
    });
  }, [roastGroups, filter]);

  const filters: { key: FilterType; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'BLENDS', label: 'Blends' },
    { key: 'SINGLE_ORIGINS', label: 'Single Origins' },
    { key: 'NEEDS_ATTENTION', label: 'Needs Attention' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Roast Groups</h1>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Roast Group
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
              filter === f.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted text-muted-foreground border-border hover:bg-accent'
            )}
          >
            {f.label}
            {f.key === 'NEEDS_ATTENTION' && (() => {
              const count = roastGroups.filter(needsAttention).length;
              return count > 0 ? ` (${count})` : '';
            })()}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading roast groups…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground">No roast groups match this filter.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((rg: any) => {
            const displayName = getDisplayName(rg.display_name, rg.roast_group);
            const activeLots = (rg.green_lot_roast_group_links ?? []).filter(
              (link: any) => link.green_lots && link.green_lots.status !== 'EXHAUSTED'
            );
            const attention = needsAttention(rg);
            const productCount = rg.product_count ?? 0;

            return (
              <button
                key={rg.roast_group}
                onClick={() => navigate(`/roast-groups/${encodeURIComponent(rg.roast_group)}`)}
                className={cn(
                  'relative text-left rounded-lg border bg-card p-4 transition-shadow hover:shadow-md',
                  'border-l-4',
                  !rg.is_active && 'opacity-50',
                  rg.is_blend ? 'border-l-blue-500' : 'border-l-green-500'
                )}
              >
                {attention && (
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded px-2 py-1">
                    <AlertTriangle className="h-3 w-3" />
                    Needs Attention — no green lot linked
                  </div>
                )}

                <p className="font-semibold text-sm">{displayName}</p>

                {/* Badges row */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Badge variant="outline" className={cn(
                    'text-[10px]',
                    rg.is_blend
                      ? 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300'
                      : 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300'
                  )}>
                    {rg.is_blend ? 'Blend' : 'Single Origin'}
                  </Badge>
                  <Badge variant="outline" className={cn(
                    'text-[10px]',
                    rg.is_seasonal
                      ? 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300'
                      : 'border-border text-muted-foreground'
                  )}>
                    {rg.is_seasonal ? 'Seasonal' : 'Perennial'}
                  </Badge>
                  {!rg.is_active && (
                    <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
                  )}
                </div>

                {/* Blend composition or origin */}
                {rg.is_blend && rg.roast_group_components?.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground truncate">
                    {rg.roast_group_components.map((c: any) => {
                      const name = allGroupNames[c.component_roast_group] || c.component_roast_group;
                      return `${name} ${c.pct}%`;
                    }).join(' · ')}
                  </p>
                )}
                {!rg.is_blend && rg.origin && (
                  <p className="mt-2 text-xs text-muted-foreground">{rg.origin}</p>
                )}

                {/* Bottom row */}
                <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                  <span>{productCount} product{productCount !== 1 ? 's' : ''}</span>
                  {activeLots.length > 0 ? (
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      {activeLots[0].green_lots.lot_number}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">— no lot</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <NewRoastGroupModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
