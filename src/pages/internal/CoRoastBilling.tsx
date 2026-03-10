import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, TrendingUp } from 'lucide-react';
import { format, endOfMonth, subMonths, addMonths, startOfMonth } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TIER_RATES, timeToMinutes } from '@/components/bookings/bookingUtils';
import QuickBooksInstructionsModal from '@/components/coroast/QuickBooksInstructionsModal';

const BILLABLE_STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW'];
const GST_RATE = 0.05;

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
  const [modalData, setModalData] = useState<any>(null);

  // Parse year/month to avoid timezone issues with new Date('YYYY-MM-DD')
  const [selYear, selMonthNum] = selectedMonth.split('-').map(Number);
  const selectedDate = new Date(selYear, selMonthNum - 1, 1);
  const periodStart = format(selectedDate, 'yyyy-MM-dd');
  const periodEnd = format(endOfMonth(selectedDate), 'yyyy-MM-dd');

  const prevDate = subMonths(selectedDate, 1);
  const prevMonth = format(prevDate, 'yyyy-MM');
  const prevPeriodStart = format(prevDate, 'yyyy-MM-dd');
  const prevPeriodEnd = format(endOfMonth(prevDate), 'yyyy-MM-dd');

  const { data: members = [] } = useQuery({
    queryKey: ['coroast-billing-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_members')
        .select('id, business_name, tier, is_active, contact_email')
        .eq('is_active', true)
        .order('business_name');
      if (error) throw error;
      return data;
    },
  });

  const { data: billingPeriods = [], refetch: refetchPeriods } = useQuery({
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

  // Auto-create billing periods for active members who don't have one for this month
  useEffect(() => {
    if (members.length === 0) return;

    const membersWithoutPeriod = members.filter(
      m => !billingPeriods.some(bp => bp.member_id === m.id)
    );

    if (membersWithoutPeriod.length === 0) return;

    const monthStart = format(startOfMonth(selectedDate), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(selectedDate), 'yyyy-MM-dd');

    const createMissing = async () => {
      const inserts = membersWithoutPeriod.map(m => {
        const tier = m.tier ?? 'ACCESS';
        const rates = TIER_RATES[tier] ?? TIER_RATES.ACCESS;
        return {
          member_id: m.id,
          period_start: monthStart,
          period_end: monthEnd,
          tier_snapshot: tier,
          included_hours: rates.includedHours,
          overage_rate_per_hr: rates.overageRate,
          base_fee: rates.base,
        };
      });

      const { error } = await supabase.from('coroast_billing_periods').insert(inserts as any);
      if (error) {
        console.error('Failed to auto-create billing periods:', error);
        return;
      }
      refetchPeriods();
    };

    createMissing();
  }, [members, billingPeriods, selectedMonth, refetchPeriods]);

  // Query bookings directly with billable status filter for current month
  const { data: bookings = [] } = useQuery({
    queryKey: ['coroast-billing-bookings', periodStart, periodEnd],
    queryFn: async () => {
      console.log('[Billing] Querying bookings for period:', periodStart, 'to', periodEnd);
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, member_id, booking_date, start_time, end_time, duration_hours, status')
        .gte('booking_date', periodStart)
        .lte('booking_date', periodEnd)
        .in('status', BILLABLE_STATUSES);
      if (error) throw error;
      console.log('[Billing] Bookings returned:', data?.length, 'rows', data?.map(b => ({ member: b.member_id, date: b.booking_date, hours: b.duration_hours, status: b.status })));
      return data;
    },
  });

  // Query bookings for previous month (for upgrade recommendation)
  const { data: prevBookings = [] } = useQuery({
    queryKey: ['coroast-billing-bookings-prev', prevPeriodStart, prevPeriodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, member_id, start_time, end_time, duration_hours, status')
        .gte('booking_date', prevPeriodStart)
        .lte('booking_date', prevPeriodEnd)
        .in('status', BILLABLE_STATUSES);
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

  // Calculate hours from duration_hours, falling back to time diff
  function calcBookingHours(bk: { duration_hours: number | null; start_time: string; end_time: string }) {
    const dh = Number(bk.duration_hours);
    if (!isNaN(dh) && dh > 0) return dh;
    const diff = (timeToMinutes(bk.end_time) - timeToMinutes(bk.start_time)) / 60;
    return diff > 0 ? diff : 0;
  }

  // Sum hours per member from bookings (already filtered to billable statuses)
  const memberHoursUsed = useMemo(() => {
    const map = new Map<string, number>();
    for (const bk of bookings) {
      const hours = calcBookingHours(bk);
      map.set(bk.member_id, (map.get(bk.member_id) ?? 0) + hours);
    }
    console.log('[Billing] memberHoursUsed:', Object.fromEntries(map));
    return map;
  }, [bookings]);

  const prevMemberHoursUsed = useMemo(() => {
    const map = new Map<string, number>();
    for (const bk of prevBookings) {
      const hours = calcBookingHours(bk as any);
      map.set(bk.member_id, (map.get(bk.member_id) ?? 0) + hours);
    }
    return map;
  }, [prevBookings]);

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
      const palletRate = Number(storage?.rate_per_add_pallet ?? 0);
      const storageCharge = paidPallets * palletRate;

      const subtotal = baseFee + overageCharge + storageCharge;
      const gst = subtotal * GST_RATE;
      const grandTotal = subtotal + gst;

      const invoice = bp ? invoices.find((inv: any) => inv.member_id === m.id && inv.billing_period_id === bp.id) : null;

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
        palletRate,
        storageCharge,
        subtotal,
        gst,
        grandTotal,
        invoice,
        upgradeRecommended,
        contactEmail: (m as any).contact_email ?? null,
      };
    });
  }, [members, billingPeriods, memberHoursUsed, prevMemberHoursUsed, storageAllocations, invoices]);

  const totals = useMemo(() => {
    let baseFees = 0, overageCharges = 0, storageCharges = 0, subtotal = 0, gst = 0, grandTotal = 0;
    for (const d of memberBillingData) {
      baseFees += d.baseFee;
      overageCharges += d.overageCharge;
      storageCharges += d.storageCharge;
      subtotal += d.subtotal;
      gst += d.gst;
      grandTotal += d.grandTotal;
    }
    return { baseFees, overageCharges, storageCharges, subtotal, gst, grandTotal };
  }, [memberBillingData]);

  const markReadyMutation = useMutation({
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
        total_amount: data.grandTotal,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Marked as ready to invoice');
      refetchInvoices();
      setModalData(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Ready to Invoice ✓ {format(new Date(d.invoice.created_at), 'MMM d')}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => setModalData(d)}
                      disabled={!d.bp}
                    >
                      Mark as Ready to Invoice
                    </Button>
                  )}
                </div>
              </div>
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

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Subtotal</span>
                  <span className="text-sm font-semibold">${fmt(d.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">GST (5%)</span>
                  <span className="text-sm font-semibold">${fmt(d.gst)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Total incl. GST</span>
                  <span className="text-lg font-bold">${fmt(d.grandTotal)}</span>
                </div>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Total Base Fees</p>
                <p className="font-bold text-lg">${totals.baseFees.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Overage Charges</p>
                <p className="font-bold text-lg">${fmt(totals.overageCharges)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Storage Charges</p>
                <p className="font-bold text-lg">${fmt(totals.storageCharges)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Subtotal</p>
                <p className="font-bold text-lg">${fmt(totals.subtotal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total GST (5%)</p>
                <p className="font-bold text-lg">${fmt(totals.gst)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Grand Total incl. GST</p>
                <p className="font-bold text-xl text-primary">${fmt(totals.grandTotal)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {modalData && (
        <QuickBooksInstructionsModal
          open={!!modalData}
          onClose={() => setModalData(null)}
          onConfirm={() => markReadyMutation.mutate(modalData)}
          isPending={markReadyMutation.isPending}
          memberName={modalData.member.business_name}
          memberEmail={modalData.contactEmail}
          tier={modalData.tier}
          periodEnd={periodEnd}
          baseFee={modalData.baseFee}
          overageHours={modalData.overageHours}
          overageRate={modalData.overageRate}
          overageCharge={modalData.overageCharge}
          paidPallets={modalData.paidPallets}
          palletRate={modalData.palletRate}
          storageCharge={modalData.storageCharge}
          subtotal={modalData.subtotal}
          gst={modalData.gst}
          grandTotal={modalData.grandTotal}
        />
      )}
    </div>
  );
}
