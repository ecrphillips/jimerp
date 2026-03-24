import React, { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { subDays, format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';

function useDismissedAlerts(key: string) {
  return useQuery({
    queryKey: ['app-settings', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value_json')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      return (data?.value_json as string[]) || [];
    },
  });
}

async function dismissAlert(key: string, accountId: string, current: string[]) {
  const updated = [...current, accountId];
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value_json: updated as any, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  return updated;
}

export function AccountsTab({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { authUser } = useAuth();

  const { data: dismissedInactive } = useDismissedAlerts('dismissed_inactive');
  const { data: dismissedNoCode } = useDismissedAlerts('dismissed_no_code');
  const { data: dismissedNoProducts } = useDismissedAlerts('dismissed_no_products');

  // Inactive accounts (no activity 60+ days)
  const cutoffDate = format(subDays(new Date(), 60), 'yyyy-MM-dd');
  const { data: inactiveAccounts, isLoading: loadingInactive } = useQuery({
    queryKey: ['dashboard-inactive-accounts'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, updated_at')
        .eq('is_active', true)
        .lt('updated_at', cutoffDate + 'T00:00:00Z');
      if (error) throw error;

      // Filter to those with at least one order (via account_users → orders by client_id)
      // Simplified: just show accounts updated > 60 days ago
      return data || [];
    },
  });

  // Missing account code
  const { data: noCodeAccounts, isLoading: loadingNoCode } = useQuery({
    queryKey: ['dashboard-no-code-accounts'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('is_active', true)
        .is('account_code', null);
      if (error) throw error;
      return data || [];
    },
  });

  // No products linked
  const { data: noProductAccounts, isLoading: loadingNoProducts } = useQuery({
    queryKey: ['dashboard-no-product-accounts'],
    enabled,
    queryFn: async () => {
      const { data: accounts, error: aErr } = await supabase
        .from('accounts')
        .select('id, account_name, programs')
        .eq('is_active', true)
        .contains('programs', ['MANUFACTURING']);
      if (aErr) throw aErr;

      const { data: products, error: pErr } = await supabase
        .from('products')
        .select('account_id')
        .not('account_id', 'is', null);
      if (pErr) throw pErr;

      const accountsWithProducts = new Set((products || []).map(p => p.account_id));
      return (accounts || []).filter(a => !accountsWithProducts.has(a.id));
    },
  });

  // Prospects pipeline
  const { data: prospects, isLoading: loadingProspects } = useQuery({
    queryKey: ['dashboard-prospects-pipeline'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospects')
        .select('id, business_name, stream, stage, updated_at')
        .eq('converted', false)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const stageCounts = useMemo(() => {
    const stages = ['AWARE', 'CONTACTED', 'CONVERSATION', 'AGREEMENT_SENT', 'ONBOARDED'] as const;
    const counts: Record<string, number> = {};
    for (const s of stages) counts[s] = 0;
    for (const p of prospects || []) {
      if (counts[p.stage] !== undefined) counts[p.stage]++;
    }
    return counts;
  }, [prospects]);

  const handleDismiss = async (key: string, accountId: string, current: string[]) => {
    try {
      await dismissAlert(key, accountId, current);
      queryClient.invalidateQueries({ queryKey: ['app-settings', key] });
    } catch {
      toast.error('Failed to dismiss alert');
    }
  };

  const filteredInactive = (inactiveAccounts || []).filter(a => !(dismissedInactive || []).includes(a.id));
  const filteredNoCode = (noCodeAccounts || []).filter(a => !(dismissedNoCode || []).includes(a.id));
  const filteredNoProducts = (noProductAccounts || []).filter(a => !(dismissedNoProducts || []).includes(a.id));

  const stageLabels: Record<string, string> = {
    AWARE: 'Aware',
    CONTACTED: 'Contacted',
    CONVERSATION: 'Conversation',
    AGREEMENT_SENT: 'Agreement Sent',
    ONBOARDED: 'Onboarded',
  };

  return (
    <div className="space-y-6">
      {/* Section A */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts needing attention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sub-list 1: Inactive */}
          <div>
            <p className="text-sm font-medium mb-2">No activity in 60+ days</p>
            {loadingInactive ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !filteredInactive.length ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <div className="space-y-1">
                {filteredInactive.map(a => (
                  <div key={a.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-1 last:pb-0">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{a.account_name}</span>
                      <span className="text-muted-foreground text-xs">Last updated {format(new Date(a.updated_at), 'MMM d, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link to={`/accounts/${a.id}`} className="text-primary hover:underline text-xs">View</Link>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleDismiss('dismissed_inactive', a.id, dismissedInactive || [])}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sub-list 2: Missing code */}
          <div>
            <p className="text-sm font-medium mb-2">Missing account code</p>
            {loadingNoCode ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !filteredNoCode.length ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <div className="space-y-1">
                {filteredNoCode.map(a => (
                  <div key={a.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-1 last:pb-0">
                    <span className="font-medium">{a.account_name}</span>
                    <div className="flex items-center gap-2">
                      <Link to={`/accounts/${a.id}`} className="text-primary hover:underline text-xs">Set code</Link>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleDismiss('dismissed_no_code', a.id, dismissedNoCode || [])}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sub-list 3: No products */}
          <div>
            <p className="text-sm font-medium mb-2">No products linked</p>
            {loadingNoProducts ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !filteredNoProducts.length ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <div className="space-y-1">
                {filteredNoProducts.map(a => (
                  <div key={a.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-1 last:pb-0">
                    <span className="font-medium">{a.account_name}</span>
                    <div className="flex items-center gap-2">
                      <Link to={`/accounts/${a.id}`} className="text-primary hover:underline text-xs">View</Link>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleDismiss('dismissed_no_products', a.id, dismissedNoProducts || [])}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section B — Prospects pipeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prospects pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingProspects ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(stageCounts).map(([stage, count]) => (
                  <Badge key={stage} variant="secondary" className="text-xs">
                    {stageLabels[stage] || stage}: {count}
                  </Badge>
                ))}
              </div>
              {(prospects || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No active prospects.</p>
              ) : (
                <div className="space-y-2">
                  {(prospects || []).slice(0, 5).map(p => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1"
                      onClick={() => navigate(`/prospects/${p.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{p.business_name}</span>
                        <Badge variant="outline" className="text-xs">{p.stream}</Badge>
                        <Badge variant="secondary" className="text-xs">{stageLabels[p.stage] || p.stage}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(p.updated_at), 'MMM d, yyyy')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
