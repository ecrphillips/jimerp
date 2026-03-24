import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, subYears, subMonths } from 'date-fns';

export function CoRoastingTab({ enabled }: { enabled: boolean }) {
  const today = new Date();
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  const sunday = endOfWeek(today, { weekStartsOn: 1 });
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  // Section A — Upcoming bookings this week
  const { data: weekBookings, isLoading: loadingWeek } = useQuery({
    queryKey: ['dashboard-coroast-week'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, booking_date, start_time, end_time, duration_hours, status, account_id, accounts(account_name)')
        .eq('status', 'CONFIRMED')
        .gte('booking_date', format(monday, 'yyyy-MM-dd'))
        .lte('booking_date', format(sunday, 'yyyy-MM-dd'))
        .order('booking_date')
        .order('start_time');
      if (error) throw error;
      return data || [];
    },
  });

  // Section B — Members with incomplete certification
  const { data: incompleteChecklist, isLoading: loadingChecklist } = useQuery({
    queryKey: ['dashboard-coroast-checklist'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_member_checklist')
        .select('id, account_id, item_number, completed, accounts(account_name)')
        .eq('completed', false);
      if (error) throw error;

      // Group by account
      const byAccount: Record<string, { name: string; count: number; accountId: string }> = {};
      for (const item of data || []) {
        const aid = item.account_id;
        if (!aid) continue;
        if (!byAccount[aid]) {
          byAccount[aid] = {
            name: (item.accounts as any)?.account_name || 'Unknown',
            count: 0,
            accountId: aid,
          };
        }
        byAccount[aid].count++;
      }
      return Object.values(byAccount);
    },
  });

  // Section C — MTD summary
  const { data: mtdBookings, isLoading: loadingMtd } = useQuery({
    queryKey: ['dashboard-coroast-mtd'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, duration_hours, account_id, status')
        .in('status', ['CONFIRMED', 'COMPLETED'])
        .gte('booking_date', format(monthStart, 'yyyy-MM-dd'))
        .lte('booking_date', format(monthEnd, 'yyyy-MM-dd'));
      if (error) throw error;
      return data || [];
    },
  });

  const mtdStats = useMemo(() => {
    if (!mtdBookings) return { hours: 0, members: 0, estRevenue: 0 };
    const totalHours = mtdBookings.reduce((s, b) => s + (b.duration_hours || 0), 0);
    const uniqueMembers = new Set(mtdBookings.map(b => b.account_id).filter(Boolean)).size;
    return {
      hours: totalHours,
      members: uniqueMembers,
      estRevenue: totalHours * 120,
    };
  }, [mtdBookings]);

  // Section D — Historical comparison
  const { data: billingPeriods, isLoading: loadingHistorical } = useQuery({
    queryKey: ['dashboard-coroast-historical'],
    enabled,
    queryFn: async () => {
      const thisMonthStr = format(monthStart, 'yyyy-MM-dd');
      const lastYearSameMonth = format(subYears(monthStart, 1), 'yyyy-MM-dd');
      const t12Start = format(subMonths(monthStart, 12), 'yyyy-MM-dd');

      const { data, error } = await supabase
        .from('coroast_billing_periods')
        .select('period_start, period_end, base_fee, is_closed')
        .gte('period_start', t12Start);
      if (error) throw error;

      const { data: invoices, error: invErr } = await supabase
        .from('coroast_invoices')
        .select('period_start, period_end, base_fee, overage_charge, storage_charge, total_amount')
        .gte('period_start', t12Start);
      if (invErr) throw invErr;

      const thisMonth = format(monthStart, 'yyyy-MM');
      const lastYearMonth = format(subYears(monthStart, 1), 'yyyy-MM');

      const sumForPeriod = (filter: (inv: any) => boolean) => {
        const filtered = (invoices || []).filter(filter);
        return {
          baseFees: filtered.reduce((s, i) => s + (i.base_fee || 0), 0),
          overage: filtered.reduce((s, i) => s + (i.overage_charge || 0), 0),
          storage: filtered.reduce((s, i) => s + (i.storage_charge || 0), 0),
          total: filtered.reduce((s, i) => s + (i.total_amount || 0), 0),
        };
      };

      return {
        thisMonth: sumForPeriod(i => i.period_start?.startsWith(thisMonth)),
        lastYear: sumForPeriod(i => i.period_start?.startsWith(lastYearMonth)),
        t12: sumForPeriod(() => true),
        hasData: (invoices || []).length > 0,
      };
    },
  });

  const fmtMoney = (v: number) => `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtCell = (v: number | undefined, hasData: boolean) => hasData && v !== undefined ? fmtMoney(v) : '—';

  return (
    <div className="space-y-6">
      {/* Section A */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upcoming bookings this week</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingWeek ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !weekBookings?.length ? (
            <p className="text-sm text-muted-foreground">No bookings this week.</p>
          ) : (
            <div className="space-y-2">
              {weekBookings.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{format(new Date(b.booking_date + 'T00:00:00'), 'EEE MMM d')}</span>
                    <span className="font-medium">{b.accounts?.account_name || 'Unknown'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{b.start_time?.slice(0, 5)}–{b.end_time?.slice(0, 5)}</span>
                    <span>{b.duration_hours}h</span>
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
          <CardTitle className="text-base">Members with incomplete certification</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingChecklist ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !incompleteChecklist?.length ? (
            <p className="text-sm text-muted-foreground">All members fully certified.</p>
          ) : (
            <div className="space-y-2">
              {incompleteChecklist.map((m) => (
                <div key={m.accountId} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-muted-foreground">{m.count} incomplete</span>
                  </div>
                  <Link to={`/accounts/${m.accountId}`} className="text-primary hover:underline text-xs">
                    View account
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
          <CardTitle className="text-base">This month summary (MTD)</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingMtd ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums">{mtdStats.hours.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Total hours booked</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums">{mtdStats.members}</p>
                <p className="text-xs text-muted-foreground">Active members</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums">{fmtMoney(mtdStats.estRevenue)}</p>
                <p className="text-xs text-muted-foreground">Est. revenue (approx)</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section D */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historical comparison</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingHistorical ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium text-muted-foreground"></th>
                      <th className="text-right py-2 font-medium text-muted-foreground">This month (MTD)</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Same month last year</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">T12 total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Total base fees', key: 'baseFees' as const },
                      { label: 'Total overage', key: 'overage' as const },
                      { label: 'Total storage', key: 'storage' as const },
                      { label: 'Grand total', key: 'total' as const },
                    ].map(row => (
                      <tr key={row.key} className="border-b last:border-0">
                        <td className="py-2 font-medium">{row.label}</td>
                        <td className="py-2 text-right tabular-nums">{fmtCell(billingPeriods?.thisMonth[row.key], !!billingPeriods?.hasData)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtCell(billingPeriods?.lastYear[row.key], !!billingPeriods?.hasData)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtCell(billingPeriods?.t12[row.key], !!billingPeriods?.hasData)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!billingPeriods?.hasData && (
                <p className="text-xs text-muted-foreground mt-3">
                  Historical data will populate as billing periods are closed.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
