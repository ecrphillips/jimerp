import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { differenceInDays } from 'date-fns';

export function GreenCoffeeTab({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  // Section A — Coverage Alerts
  const { data: coverageAlerts, isLoading: loadingCoverage } = useQuery({
    queryKey: ['dashboard-coverage-alerts'],
    enabled,
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from('green_lot_roast_group_links')
        .select(`
          roast_group,
          lot_id,
          green_lots!green_lot_roast_group_links_lot_id_fkey!inner(id, lot_number, status, received_date, expected_delivery_date, estimated_days_to_consume, kg_on_hand),
          roast_groups!inner(roast_group, display_name, is_seasonal)
        `);
      if (error) throw error;

      const today = new Date();
      // Filter to non-seasonal roast groups with estimated days
      const relevant = (links || []).filter((l: any) => 
        !l.roast_groups.is_seasonal && 
        l.green_lots.estimated_days_to_consume != null &&
        l.green_lots.status !== 'EXHAUSTED'
      );

      // Group by roast_group to find successors
      const byRG: Record<string, any[]> = {};
      for (const l of relevant) {
        const rg = l.roast_group;
        if (!byRG[rg]) byRG[rg] = [];
        byRG[rg].push(l);
      }

      const alerts: Array<{
        roastGroup: string;
        displayName: string;
        lotNumber: string;
        daysRemaining: number;
      }> = [];

      for (const [rg, lots] of Object.entries(byRG)) {
        for (const lot of lots) {
          const startDate = lot.green_lots.received_date 
            ? new Date(lot.green_lots.received_date) 
            : new Date(lot.green_lots.expected_delivery_date || today);
          const daysRemaining = differenceInDays(
            new Date(startDate.getTime() + lot.green_lots.estimated_days_to_consume * 86400000),
            today
          );
          
          if (daysRemaining < 5) {
            // Check if there's another non-exhausted lot for same RG
            const hasSuccessor = lots.some(
              (other: any) => other.lot_id !== lot.lot_id && other.green_lots.status !== 'EXHAUSTED'
            );
            if (!hasSuccessor) {
              alerts.push({
                roastGroup: rg,
                displayName: lot.roast_groups.display_name,
                lotNumber: lot.green_lots.lot_number,
                daysRemaining,
              });
            }
          }
        }
      }

      return alerts;
    },
  });

  // Section B — Roast groups needing green lot mapping
  const { data: unmappedGroups, isLoading: loadingUnmapped } = useQuery({
    queryKey: ['dashboard-unmapped-roast-groups'],
    enabled,
    queryFn: async () => {
      const { data: groups, error: gErr } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name, is_blend, blend_type')
        .eq('is_active', true)
        .eq('is_seasonal', false);
      if (gErr) throw gErr;

      // Filter: not post-roast blends
      const eligible = (groups || []).filter(
        (g: any) => !(g.blend_type === 'POST_ROAST') && !(g.is_blend && !g.blend_type)
      );

      const { data: links, error: lErr } = await supabase
        .from('green_lot_roast_group_links')
        .select('roast_group');
      if (lErr) throw lErr;

      const linkedSet = new Set((links || []).map((l: any) => l.roast_group));
      return eligible.filter((g: any) => !linkedSet.has(g.roast_group));
    },
  });

  // Section C — Lots with incomplete costing
  const { data: incompleteLots, isLoading: loadingIncomplete } = useQuery({
    queryKey: ['dashboard-incomplete-costing'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select('id, lot_number, status, costing_status')
        .eq('costing_status', 'INCOMPLETE')
        .neq('status', 'EXHAUSTED');
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <div className="space-y-6">
      {/* Coverage Calendar link */}
      <Card
        className="cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => navigate('/sourcing/lots?tab=coverage')}
      >
        <CardContent className="flex items-center gap-4 py-4">
          <CalendarDays className="h-6 w-6 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Coverage Calendar</p>
            <p className="text-xs text-muted-foreground">Visual lot coverage by roast group</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>

      {/* Section A */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perennial lots running low — no successor linked</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingCoverage ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !coverageAlerts?.length ? (
            <p className="text-sm text-muted-foreground">No coverage alerts.</p>
          ) : (
            <div className="space-y-2">
              {coverageAlerts.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{a.displayName}</span>
                    <span className="text-muted-foreground">{a.lotNumber}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={a.daysRemaining < 0 ? 'destructive' : 'secondary'}
                      className={a.daysRemaining >= 0 && a.daysRemaining < 5 ? 'bg-amber-100 text-amber-800 border-amber-200' : ''}>
                      {a.daysRemaining < 0 ? `${Math.abs(a.daysRemaining)}d overdue` : `${a.daysRemaining}d left`}
                    </Badge>
                    <Link to={`/roast-groups/${a.roastGroup}`} className="text-primary hover:underline text-xs">
                      View Roast Group
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section B */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active perennial roast groups with no green lot linked</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingUnmapped ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !unmappedGroups?.length ? (
            <p className="text-sm text-muted-foreground">All active roast groups have green lots linked.</p>
          ) : (
            <div className="space-y-2">
              {unmappedGroups.map((g: any) => (
                <div key={g.roast_group} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                  <span className="font-medium">{g.display_name}</span>
                  <Link to={`/roast-groups/${g.roast_group}`} className="text-primary hover:underline text-xs">
                    Link a lot
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section C */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lots with incomplete costing</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingIncomplete ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !incompleteLots?.length ? (
            <p className="text-sm text-muted-foreground">All lots are fully costed.</p>
          ) : (
            <div className="space-y-2">
              {incompleteLots.map((lot: any) => (
                <div key={lot.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{lot.lot_number}</span>
                    <Badge variant="outline">{lot.status}</Badge>
                  </div>
                  <Link to="/sourcing/lots" className="text-primary hover:underline text-xs">
                    Open lot
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
