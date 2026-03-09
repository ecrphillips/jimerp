import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { FileText, TrendingUp, AlertTriangle } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TIER_RATES } from '@/components/bookings/bookingUtils';

const CANCELLED_STATUSES = ['CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED'];

function buildMonthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = -6; i <= 3; i++) {
    const d = i < 0 ? subMonths(now, -i) : i > 0 ? addMonths(now, i) : now;
    const val = format(d, 'yyyy-MM');
    opts.push({ value: val, label: format(d, 'MMMM yyyy') });
  }
  return opts;
}

export default function CoRoastBilling() {
  const queryClient = useQueryClient();
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));

  const periodStart = `${selectedMonth}-01`;
  const periodEnd = format(endOfMonth(new Date(`${selectedMonth}-01`)), 'yyyy-MM-dd');

  // Previous month for upgrade nudge
  const prevMonth = format(subMonths(new Date(`${selectedMonth}-01`), 1), 'yyyy-MM');
  const prevPeriodStart = `${prevMonth}-01`;
  const prevPeriodEnd = format(endOfMonth(new Date(`${prevMonth}-01`)), 'yyyy-MM-dd');

  const { data: members = [] } = useQuery({
    queryKey: ['coroast-billing-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_members')
        .select('id, business_name, tier, is_active')
        .eq('is_active', true)
        .order('business_name');
      if (error) throw error;
      return data;
    },
  });

  const { data: billingPeriods = [] } = useQuery({
    queryKey: ['coroast-billing-periods', selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_billing_periods')
        .select('*')
        .gte('period_start', periodStart)
        .lte('period_start', periodEnd);
      if (error) throw error;
      return data;
    },
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ['coroast-billing-bookings', selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, member_id, booking_date, start_time, end_time, duration_hours, status')
        .gte('booking_date', periodStart)
        .lte('booking_date', periodEnd);
      if (error) throw error;
      return data;
    },
  });

  // Previous month bookings for upgrade nudge
  const { data: prevBookings = [] } = useQuery({
    queryKey: ['coroast-billing-bookings-prev', prevMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, member_id, duration_hours, status')
        .gte('booking_date', prevPeriodStart)
        .lte('booking_date', prevPeriodEnd);
      if (error) throw error;
      return data;
    },
  });

  const { data: storageAllocations = [] } = useQuery({
    queryKey: ['coroast-billing-storage', selectedMonth],
    queryFn: async () => {
      const bpIds = billingPeriods.map(bp => bp.id);
      if (bpIds.length === 0) return [];
      const { data, error } = await supabase
        .from('coroast_storage_allocations')
        .select('*')
        .in('billing_period_id', bpIds);
      if (error) throw error;
      return data;
    },
    enabled: billingPeriods.length > 0,
  });

  const { data: invoices = [], refetch: refetchInvoices } = useQuery({
    queryKey: ['coroast-invoices', selectedMonth],
    queryFn: async () => {
      const bpIds = billingPeriods.map(bp => bp.id);
      if (bpIds.length === 0) return [];
      const { data, error } = await supabase
        .from('coroast_invoices')
        .select('*')
        .in('billing_period_id', bpIds);
      if (error) throw error;
      return data as any[];
    },
    enabled: billingPeriods.length > 0,
  });

  // Compute per-member hours used
  const memberHoursUsed = useMemo(() => {
    const map = new Map<string, number>();
    for (const bk of bookings) {
      if (CANCELLED_STATUSES.includes(bk.status)) continue;
      const dur = bk.duration_hours ?? 0;
      map.set(bk.member_id, (map.get(bk.member_id) ?? 0) + Number(dur));
    }
    return map;
  }, [bookings]);

  // Previous month hours for upgrade nudge
  const prevMemberHoursUsed = useMemo(() => {
    const map = new Map<string, number>();
    for (const bk of prevBookings) {
      if (CANCELLED_STATUSES.includes(bk.status)) continue;
      const dur = bk.duration_hours ?? 0;
      map.set(bk.member_id, (map.get(bk.member_id) ?? 0) + Number(dur));
    }
    return map;
  }, [prevBookings]);

  // Build member billing data
  const memberBillingData = useMemo(() => {
    return members.map(m => {
      const tier = m.tier ?? 'ACCESS';
      const rates = TIER_RATES[tier] ?? TIER_RATES.ACCESS;
      const bp = billingPeriods.find(bp => bp.member_id === m.id);
      const baseFee = rates.base;
      const includedHours = rates.includedHours;
      const usedHours = memberHoursUsed.get(m.id) ?? 0;
      const overageHours = Math.max(0, usedHours - includedHours);
      const overageCharge = overageHours * rates.overageRate;

      const storage = storageAllocations.find(s => s.member_id === m.id);
      const includedPallets = storage?.included_pallets ?? 0;
      const paidPallets = storage?.paid_pallets ?? 0;
      const palletRate = storage?.rate_per_add_pallet ?? 0;
      const storageCharge = paidPallets * Number(palletRate);

      const totalAmount = baseFee + overageCharge + storageCharge;

      const invoice = bp ? invoices.find((inv: any) => inv.member_id === m.id && inv.billing_period_id === bp.id) : null;

      // Upgrade nudge: exceeded 6h this AND prev month, only for ACCESS tier
      const prevUsed = prevMemberHoursUsed.get(m.id) ?? 0;
      const upgradeRecommended = tier === 'ACCESS' && usedHours > 6 && prevUsed > 6;

      return {
        member: m,
        tier,
        bp,
        baseFee,
        includedHours,
        usedHours,
        overageHours,
        overageRate: rates.overageRate,
        overageCharge,
        includedPallets,
        paidPallets,
        palletRate: Number(palletRate),
        storageCharge,
        totalAmount,
        invoice,
        upgradeRecommended,
      };
    });
  }, [members, billingPeriods, memberHoursUsed, prevMemberHoursUsed, storageAllocations, invoices]);

  // Totals
  const totals = useMemo(() => {
    let baseFees = 0, overageCharges = 0, storageCharges = 0, grandTotal = 0;
    for (const d of memberBillingData) {
      baseFees += d.baseFee;
      overageCharges += d.overageCharge;
      storageCharges += d.storageCharge;
      grandTotal += d.totalAmount;
    }
    return { baseFees, overageCharges, storageCharges, grandTotal };
  }, [memberBillingData]);

  const generateInvoiceMutation = useMutation({
    mutationFn: async (data: typeof memberBillingData[number]) => {
      if (!data.bp) throw new Error('No billing period found for this member');
      const { error } = await supabase.from('coroast_invoices').insert({
        member_id: data.member.id,
        billing_period_id: data.bp.id,
        period_start: periodStart,
        period_end: periodEnd,
        tier_snapshot: data.tier,
        base_fee: data.baseFee,
        included_hours: data.includedHours,
        used_hours: data.usedHours,
        overage_hours: data.overageHours,
        overage_rate: data.overageRate,
        overage_charge: data.overageCharge,
        included_pallets: data.includedPallets,
        paid_pallets: data.paidPallets,
        pallet_rate: data.palletRate,
        storage_charge: data.storageCharge,
        total_amount: data.totalAmount,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invoice generated');
      refetchInvoices();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Co-Roasting Billing</h1>
          <p className="text-sm text-muted-foreground">Monthly billing summary for all co-roasting members</p>
        </div>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {memberBillingData.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No active members found.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {memberBillingData.map(d => (
          <Card key={d.member.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{d.member.business_name}</CardTitle>
                  <Badge variant="secondary" className="text-xs">{d.tier}</Badge>
                  {d.upgradeRecommended && (
                    <Badge variant="outline" className="text-xs border-amber-400 text-amber-600 bg-amber-50">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      Upgrade Recommended
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {d.invoice ? (
                    <Badge variant="secondary" className="text-xs">
                      <FileText className="h-3 w-3 mr-1" />
                      Invoice Generated
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => generateInvoiceMutation.mutate(d)}
                      disabled={!d.bp || generateInvoiceMutation.isPending}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1" />
                      Generate Invoice
                    </Button>
                  )}
                </div>
              </div>
              {!d.bp && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 mt-1">
                  <AlertTriangle className="h-3 w-3" />
                  No billing period found for this month. Create one on the Members page.
                </div>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Base Fee</p>
                  <p className="font-semibold">${d.baseFee.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Hours Used / Included</p>
                  <p className="font-semibold">
                    {d.usedHours.toFixed(1)}h / {d.includedHours}h
                    {d.overageHours > 0 && (
                      <span className="text-destructive ml-1">(+{d.overageHours.toFixed(1)}h overage)</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Overage Charge</p>
                  <p className="font-semibold">
                    {d.overageCharge > 0 ? `$${d.overageCharge.toFixed(2)}` : '—'}
                    {d.overageCharge > 0 && (
                      <span className="text-muted-foreground text-xs ml-1">@ ${d.overageRate}/hr</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Storage</p>
                  <p className="font-semibold">
                    {d.includedPallets + d.paidPallets > 0 ? (
                      <>
                        {d.includedPallets} incl + {d.paidPallets} paid
                        {d.storageCharge > 0 && (
                          <span className="text-destructive ml-1">(${d.storageCharge.toFixed(2)})</span>
                        )}
                      </>
                    ) : '—'}
                  </p>
                </div>
              </div>

              <Separator className="my-3" />

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Total Amount</span>
                <span className="text-lg font-bold">${d.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {memberBillingData.length > 0 && (
        <Card className="bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Period Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Total Base Fees</p>
                <p className="font-bold text-lg">${totals.baseFees.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Overage Charges</p>
                <p className="font-bold text-lg">${totals.overageCharges.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Storage Charges</p>
                <p className="font-bold text-lg">${totals.storageCharges.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Grand Total</p>
                <p className="font-bold text-xl text-primary">${totals.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
