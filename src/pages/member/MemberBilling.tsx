import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Info } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { parseDateOnly } from '@/lib/dateOnly';
import { timeToMinutes } from '@/components/bookings/bookingUtils';
import {
  resolveAccountPricing,
  formatPricingValue,
  formatAuditEntry,
  PRICING_FIELDS,
  type PricingAuditRow,
  type ResolvedAccountPricing,
  type PricingFieldKey,
} from '@/lib/coroastPricing';
import type { Database } from '@/integrations/supabase/types';

const BILLABLE_STATUSES: Database['public']['Enums']['coroast_booking_status'][] = ['CONFIRMED', 'COMPLETED', 'NO_SHOW'];

export default function MemberBilling() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const effectiveAccountId = previewAccountId ?? authUser?.accountId;
  const accountId = effectiveAccountId;

  const {
    data: member,
    isLoading: memberLoading,
    error: memberError,
    refetch: refetchMember,
  } = useQuery({
    queryKey: ['my-account-billing', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, coroast_tier, coroast_joined_date')
        .eq('id', accountId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Account row not found or not accessible');
      return data;
    },
    enabled: !!accountId,
  });

  const {
    data: pricing,
    isLoading: pricingLoading,
    error: pricingError,
    refetch: refetchPricing,
  } = useQuery({
    queryKey: ['coroast-resolved-pricing', accountId],
    queryFn: () => resolveAccountPricing(accountId!),
    enabled: !!accountId,
  });

  const { data: auditRows = [] } = useQuery({
    queryKey: ['coroast-pricing-audit-member', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_account_pricing_audit')
        .select('*')
        .eq('account_id', accountId!)
        .order('changed_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as unknown as PricingAuditRow[];
    },
    enabled: !!accountId,
  });

  const now = new Date();
  const currentMonthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const currentMonthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
  const todayStr = format(now, 'yyyy-MM-dd');

  const { data: currentBookings = [] } = useQuery({
    queryKey: ['member-billing-current', accountId, currentMonthStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, booking_date, start_time, end_time, duration_hours, status')
        .eq('account_id', accountId!)
        .gte('booking_date', currentMonthStart)
        .lte('booking_date', currentMonthEnd)
        .in('status', BILLABLE_STATUSES);
      if (error) throw error;
      return data;
    },
    enabled: !!accountId,
  });

  const hoursUsed = useMemo(() => {
    return currentBookings
      .filter(b => b.booking_date <= todayStr || b.status === 'COMPLETED')
      .reduce((sum, b) => sum + (Number(b.duration_hours) || (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)) / 60), 0);
  }, [currentBookings, todayStr]);

  const hoursScheduled = useMemo(() => {
    return currentBookings
      .filter(b => b.booking_date > todayStr && b.status !== 'COMPLETED')
      .reduce((sum, b) => sum + (Number(b.duration_hours) || (timeToMinutes(b.end_time) - timeToMinutes(b.start_time)) / 60), 0);
  }, [currentBookings, todayStr]);

  const totalHours = hoursUsed + hoursScheduled;
  const included = pricing?.includedHours.value ?? 0;
  const overageRate = pricing?.overageRate.value ?? 0;
  const remaining = Math.max(0, included - totalHours);
  const overageHours = Math.max(0, totalHours - included);
  const overageCharge = overageHours * overageRate;

  const usedPct = included > 0 ? Math.min(100, (hoursUsed / included) * 100) : 0;
  const scheduledPct = included > 0 ? Math.min(100 - usedPct, (hoursScheduled / included) * 100) : 0;
  const overagePct = included > 0 && totalHours > included ? Math.min(50, ((totalHours - included) / included) * 100) : 0;

  const { data: billingHistory = [] } = useQuery({
    queryKey: ['member-billing-history', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_invoices')
        .select('id, period_start, period_end, base_fee, used_hours, overage_hours, overage_charge, storage_charge, total_amount, created_at')
        .eq('account_id', accountId!)
        .order('period_start', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!accountId,
  });

  if (!accountId) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">No account linked</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Your user is not linked to a co-roasting account. Please contact an administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (memberLoading || pricingLoading) {
    return <div className="p-6"><p className="text-muted-foreground">Loading…</p></div>;
  }

  if (memberError || pricingError || !member || !pricing) {
    const message =
      (memberError instanceof Error && memberError.message) ||
      (pricingError instanceof Error && pricingError.message) ||
      'Unable to load billing.';
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-destructive">Couldn't load billing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{message}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { refetchMember(); refetchPricing(); }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ACCESS tier is legacy — hide the label from new UI.
  const displayTierLabel = pricing.tier === 'ACCESS' ? 'Co-Roasting Member' : `${pricing.tierLabel} Tier`;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Hours & Billing</h1>
        <p className="text-sm text-muted-foreground">{member.account_name} · {displayTierLabel}</p>
      </div>

      <MyPricingCard pricing={pricing} auditRows={auditRows} displayTierLabel={displayTierLabel} />

      {/* Current Month */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{format(now, 'MMMM yyyy')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Included Hours</p>
              <p className="text-lg font-bold">{included}h</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hours Used</p>
              <p className="text-lg font-bold">{hoursUsed.toFixed(1)}h</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hours Scheduled</p>
              <p className="text-lg font-bold">{hoursScheduled.toFixed(1)}h</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="text-lg font-bold">{remaining.toFixed(1)}h</p>
            </div>
          </div>

          {/* Usage bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Usage</span>
              <span>{totalHours.toFixed(1)}h of {included}h {overageHours > 0 && `(+${overageHours.toFixed(1)}h overage)`}</span>
            </div>
            <div className="relative h-4 rounded-full bg-muted overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-primary rounded-l-full transition-all" style={{ width: `${usedPct}%` }} />
              <div className="absolute inset-y-0 bg-primary/40 transition-all" style={{ left: `${usedPct}%`, width: `${scheduledPct}%` }} />
              {overagePct > 0 && (
                <div className="absolute inset-y-0 bg-destructive/70 rounded-r-full transition-all" style={{ left: '100%', width: `${overagePct}%` }} />
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-primary" /><span>Used</span></div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-primary/40" /><span>Scheduled</span></div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-muted border" /><span>Remaining</span></div>
              {overageHours > 0 && (
                <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-destructive/70" /><span>Overage</span></div>
              )}
            </div>
          </div>

          {overageCharge > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <p className="font-medium">Estimated overage charge: ${fmt(overageCharge)}</p>
              <p className="text-xs mt-1">
                {overageHours.toFixed(1)}h beyond included allowance @ ${overageRate}/hr
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Billing History</CardTitle>
        </CardHeader>
        <CardContent>
          {billingHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No billing history yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 font-medium">Period</th>
                    <th className="text-right py-2 font-medium">Hours</th>
                    <th className="text-right py-2 font-medium">Base Fee</th>
                    <th className="text-right py-2 font-medium">Overage</th>
                    <th className="text-right py-2 font-medium">Storage</th>
                    <th className="text-right py-2 font-medium">Total</th>
                    <th className="text-right py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billingHistory.map(inv => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="py-2">{format(parseDateOnly(inv.period_start)!, 'MMM yyyy')}</td>
                      <td className="py-2 text-right">{Number(inv.used_hours).toFixed(1)}h</td>
                      <td className="py-2 text-right">${fmt(Number(inv.base_fee))}</td>
                      <td className="py-2 text-right">{Number(inv.overage_charge) > 0 ? `$${fmt(Number(inv.overage_charge))}` : '—'}</td>
                      <td className="py-2 text-right">{Number(inv.storage_charge) > 0 ? `$${fmt(Number(inv.storage_charge))}` : '—'}</td>
                      <td className="py-2 text-right font-semibold">${fmt(Number(inv.total_amount))}</td>
                      <td className="py-2 text-right">
                        <Badge variant="secondary" className="text-xs">Invoiced</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── My Pricing section ────────────────────────────────────────────────────────

function MyPricingCard({
  pricing,
  auditRows,
  displayTierLabel,
}: {
  pricing: ResolvedAccountPricing;
  auditRows: PricingAuditRow[];
  displayTierLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">My Pricing</CardTitle>
        <p className="text-sm text-muted-foreground">{displayTierLabel}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {PRICING_FIELDS.map((meta) => {
                const field = pricing[meta.key as PricingFieldKey];
                const isCustom = field.source === 'ACCOUNT_OVERRIDE';
                const customDate = field.updatedAt
                  ? format(new Date(field.updatedAt), 'MMM d, yyyy')
                  : null;
                return (
                  <tr key={meta.key} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground">
                      {meta.label}
                      {meta.unit && <span className="ml-1 text-xs text-muted-foreground/70">({meta.unit})</span>}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium">
                      {formatPricingValue(meta, field.value)}
                    </td>
                    <td className="py-2 text-right">
                      {isCustom ? (
                        (() => {
                          const discount = field.tierDefault - field.value;
                          const isDiscount = discount > 0;
                          const label = isDiscount
                            ? `${meta.isCurrency ? `$${discount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : discount.toLocaleString()} off`
                            : 'Custom rate';
                          return (
                            <span className="inline-flex items-center gap-1">
                              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{label}</Badge>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">
                                    Standard {meta.label.toLowerCase()}: {formatPricingValue(meta, field.tierDefault)}
                                    {customDate ? ` · set ${customDate}` : ''}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                          );
                        })()
                      ) : null}
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {auditRows.length > 0 && (
          <Accordion type="single" collapsible>
            <AccordionItem value="recent-changes" className="border-0">
              <AccordionTrigger className="text-sm py-2">Recent changes</AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {auditRows.map((r) => (
                    <li key={r.id}>{formatAuditEntry(r)}</li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <p className="text-xs text-muted-foreground border-t pt-3">
          Overages and storage charges are invoiced at the end of each month. Included hours and packaging blocks do not carry over.
        </p>
      </CardContent>
    </Card>
  );
}
