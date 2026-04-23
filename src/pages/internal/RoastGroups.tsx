import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDisplayName } from '@/lib/roastGroupUtils';
import { NewRoastGroupModal } from '@/components/roast-groups/NewRoastGroupModal';
import { ViewToggle, useViewMode } from '@/components/sourcing/ViewToggle';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type FilterType = 'ALL' | 'ACTIVE' | 'BLENDS' | 'SINGLE_ORIGINS' | 'NEEDS_ATTENTION' | 'INACTIVE';
type SortKey = 'name' | 'type' | 'roaster' | 'products' | 'lot' | 'status';

const ROASTER_LABEL: Record<string, string> = {
  SAMIAC: 'Samiac',
  LORING: 'Loring',
  EITHER: 'Either',
};

function formatRoaster(value: string | null | undefined) {
  if (!value) return '—';
  return ROASTER_LABEL[value] ?? value;
}

export default function RoastGroups() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterType>('ACTIVE');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewMode, setViewMode] = useViewMode('manufacturing_view_roast_groups', 'cards');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Hook 1: Fetch roast groups + components + lot links as 3 parallel queries
  // (split to avoid Supabase schema cache failures on the joined query)
  const { data: rawGroups = [], isLoading } = useQuery({
    queryKey: ['roast-groups-list'],
    queryFn: async () => {
      const [groupsRes, componentsRes, linksRes] = await Promise.all([
        supabase.from('roast_groups').select('*').order('display_name'),
        supabase
          .from('roast_group_components')
          .select('parent_roast_group, component_roast_group, pct'),
        supabase
          .from('green_lot_roast_group_links')
          .select('id, roast_group, lot_id, green_lots!green_lot_roast_group_links_lot_id_fkey (id, lot_number, status, received_date, expected_delivery_date, estimated_days_to_consume)'),
      ]);

      if (groupsRes.error) throw groupsRes.error;
      if (componentsRes.error) throw componentsRes.error;

      const groups = groupsRes.data ?? [];
      const components = componentsRes.data ?? [];
      let links: any[] = [];
      if (linksRes.error) {
        console.error('green_lot_roast_group_links query failed:', linksRes.error);
      } else {
        links = linksRes.data ?? [];
      }

      const componentsByGroup: Record<string, any[]> = {};
      for (const c of components) {
        const k = (c as any).parent_roast_group;
        if (!k) continue;
        (componentsByGroup[k] ||= []).push(c);
      }
      const linksByGroup: Record<string, any[]> = {};
      for (const l of links) {
        const k = (l as any).roast_group;
        if (!k) continue;
        (linksByGroup[k] ||= []).push(l);
      }

      return groups.map((rg: any) => ({
        ...rg,
        roast_group_components: componentsByGroup[rg.roast_group] ?? [],
        green_lot_roast_group_links: linksByGroup[rg.roast_group] ?? [],
      }));
    },
  });

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

  const roastGroups = useMemo(() =>
    rawGroups.map((rg: any) => ({
      ...rg,
      product_count: productCountMap[rg.roast_group] || 0,
    })),
    [rawGroups, productCountMap]
  );

  const getLowCoverageLots = (rg: any) => {
    const today = new Date();
    return (rg.green_lot_roast_group_links ?? []).filter((link: any) => {
      const lot = link.green_lots;
      if (!lot || lot.status === 'EXHAUSTED' || !lot.estimated_days_to_consume) return false;
      const startDate = lot.status === 'RECEIVED' ? lot.received_date : lot.expected_delivery_date;
      if (!startDate) return false;
      const endDate = new Date(startDate + 'T00:00:00');
      endDate.setDate(endDate.getDate() + lot.estimated_days_to_consume);
      const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return daysRemaining < 5;
    });
  };

  const needsAttention = (rg: any) => {
    if (rg.is_seasonal || !rg.is_active) return false;
    const activeLots = (rg.green_lot_roast_group_links ?? []).filter(
      (link: any) => link.green_lots && link.green_lots.status !== 'EXHAUSTED'
    );
    if (activeLots.length === 0) return true;
    if (getLowCoverageLots(rg).length > 0) return true;
    return false;
  };

  const attentionTooltip = (rg: any) => {
    const activeLots = (rg.green_lot_roast_group_links ?? []).filter(
      (link: any) => link.green_lots && link.green_lots.status !== 'EXHAUSTED'
    );
    if (activeLots.length === 0) return 'Needs Attention — no green lot linked';
    const low = getLowCoverageLots(rg);
    if (low.length > 0) {
      const lot = low[0].green_lots;
      const startDate = lot.status === 'RECEIVED' ? lot.received_date : lot.expected_delivery_date;
      const endDate = new Date(startDate + 'T00:00:00');
      endDate.setDate(endDate.getDate() + lot.estimated_days_to_consume);
      const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
      return `Running low — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} coverage remaining on ${lot.lot_number}`;
    }
    return 'Needs Attention';
  };

  const filtered = useMemo(() => {
    return roastGroups.filter((rg: any) => {
      if (filter === 'ACTIVE') return rg.is_active === true;
      if (filter === 'BLENDS') return rg.is_blend === true && rg.is_active === true;
      if (filter === 'SINGLE_ORIGINS') return rg.is_blend === false && rg.is_active === true;
      if (filter === 'NEEDS_ATTENTION') return needsAttention(rg);
      if (filter === 'INACTIVE') return rg.is_active === false;
      return true;
    });
  }, [roastGroups, filter]);

  // Sorted view (used by list)
  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const arr = [...filtered];
    arr.sort((a: any, b: any) => {
      const lotA = (a.green_lot_roast_group_links ?? []).filter((l: any) => l.green_lots && l.green_lots.status !== 'EXHAUSTED').map((l: any) => l.green_lots.lot_number).join(', ');
      const lotB = (b.green_lot_roast_group_links ?? []).filter((l: any) => l.green_lots && l.green_lots.status !== 'EXHAUSTED').map((l: any) => l.green_lots.lot_number).join(', ');
      let av: any;
      let bv: any;
      switch (sortKey) {
        case 'name':
          av = getDisplayName(a.display_name, a.roast_group).toLowerCase();
          bv = getDisplayName(b.display_name, b.roast_group).toLowerCase();
          break;
        case 'type':
          av = `${a.is_blend ? 'B' : 'S'}-${a.is_seasonal ? 'S' : 'P'}`;
          bv = `${b.is_blend ? 'B' : 'S'}-${b.is_seasonal ? 'S' : 'P'}`;
          break;
        case 'roaster':
          av = formatRoaster(a.default_roaster).toLowerCase();
          bv = formatRoaster(b.default_roaster).toLowerCase();
          break;
        case 'products':
          av = a.product_count ?? 0;
          bv = b.product_count ?? 0;
          break;
        case 'lot':
          av = lotA.toLowerCase();
          bv = lotB.toLowerCase();
          break;
        case 'status':
          av = a.is_active ? 1 : 0;
          bv = b.is_active ? 1 : 0;
          break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortHeader = ({ k, label, align }: { k: SortKey; label: string; align?: 'right' }) => (
    <TableHead className={align === 'right' ? 'text-right' : ''}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground transition-colors',
          align === 'right' && 'flex-row-reverse'
        )}
      >
        {label}
        {sortKey === k ? (
          sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  const filters: { key: FilterType; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'ACTIVE', label: 'Active' },
    { key: 'BLENDS', label: 'Blends' },
    { key: 'SINGLE_ORIGINS', label: 'Single Origins' },
    { key: 'NEEDS_ATTENTION', label: 'Needs Attention' },
    { key: 'INACTIVE', label: 'Inactive' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Roast Groups</h1>
        <div className="flex items-center gap-2">
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Roast Group
          </Button>
        </div>
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
      ) : viewMode === 'cards' ? (
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
                {attention && activeLots.length === 0 && (
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded px-2 py-1">
                    <AlertTriangle className="h-3 w-3" />
                    Needs Attention — no green lot linked
                  </div>
                )}
                {getLowCoverageLots(rg).map((link: any) => {
                  const lot = link.green_lots;
                  const startDate = lot.status === 'RECEIVED' ? lot.received_date : lot.expected_delivery_date;
                  const endDate = new Date(startDate + 'T00:00:00');
                  endDate.setDate(endDate.getDate() + lot.estimated_days_to_consume);
                  const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                  return (
                    <div key={link.lot_id} className="flex items-center gap-1.5 mb-2 text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded px-2 py-1">
                      <AlertTriangle className="h-3 w-3" />
                      Running low — {daysLeft} day{daysLeft !== 1 ? 's' : ''} coverage remaining on {lot.lot_number}
                    </div>
                  );
                })}

                <p className="font-semibold text-sm">{displayName}</p>

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

                {rg.is_blend && rg.blend_type === 'POST_ROAST' && rg.roast_group_components?.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground truncate">
                    {rg.roast_group_components.map((c: any) => {
                      const name = allGroupNames[c.component_roast_group] || c.component_roast_group;
                      return `${name} ${c.pct}%`;
                    }).join(' · ')}
                  </p>
                )}
                {rg.is_blend && rg.blend_type === 'PRE_ROAST' && (
                  <p className="mt-2 text-xs text-muted-foreground">Pre-roast blend</p>
                )}
                {rg.is_blend && !rg.blend_type && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Blend type not set</p>
                )}
                {!rg.is_blend && rg.origin && (
                  <p className="mt-2 text-xs text-muted-foreground">{rg.origin}</p>
                )}

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
      ) : (
        <TooltipProvider>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <SortHeader k="name" label="Name" />
                  <SortHeader k="type" label="Type" />
                  <SortHeader k="roaster" label="Default Roaster" />
                  <SortHeader k="products" label="Products" align="right" />
                  <SortHeader k="lot" label="Green Lot" />
                  <SortHeader k="status" label="Status" />
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((rg: any) => {
                  const displayName = getDisplayName(rg.display_name, rg.roast_group);
                  const activeLots = (rg.green_lot_roast_group_links ?? []).filter(
                    (link: any) => link.green_lots && link.green_lots.status !== 'EXHAUSTED'
                  );
                  const attention = needsAttention(rg);
                  const productCount = rg.product_count ?? 0;
                  const subtitle = rg.is_blend
                    ? (rg.blend_type === 'PRE_ROAST'
                      ? 'Pre-roast blend'
                      : rg.blend_type === 'POST_ROAST'
                        ? 'Post-roast blend'
                        : 'Blend')
                    : (rg.origin || null);

                  return (
                    <TableRow
                      key={rg.roast_group}
                      onClick={() => navigate(`/roast-groups/${encodeURIComponent(rg.roast_group)}`)}
                      className={cn(
                        'cursor-pointer',
                        !rg.is_active && 'opacity-60'
                      )}
                    >
                      <TableCell className="w-8">
                        {attention && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-4 w-4 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent>{attentionTooltip(rg)}</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-sm">{displayName}</div>
                        {subtitle && (
                          <div className="text-xs text-muted-foreground">{subtitle}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
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
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{formatRoaster(rg.default_roaster)}</TableCell>
                      <TableCell className="text-right text-sm">{productCount}</TableCell>
                      <TableCell>
                        {activeLots.length > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-sm">
                            <span className={cn(
                              'h-2 w-2 rounded-full shrink-0',
                              getLowCoverageLots(rg).length > 0 ? 'bg-amber-500' : 'bg-green-500'
                            )} />
                            <span className="truncate">
                              {activeLots.map((l: any) => l.green_lots.lot_number).join(', ')}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">— no lot</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {rg.is_active ? (
                          <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 dark:border-green-700 dark:text-green-300">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/roast-groups/${encodeURIComponent(rg.roast_group)}`);
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      )}

      <NewRoastGroupModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
