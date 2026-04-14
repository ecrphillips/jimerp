import { useState, useMemo, useEffect } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, TrendingUp, Lock, Trash2, Plus } from 'lucide-react';
import { format, endOfMonth, subMonths, addMonths, startOfMonth, getDaysInMonth, isAfter } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TIER_RATES, STORAGE_RATES, timeToMinutes } from '@/components/bookings/bookingUtils';
import { resolveAccountRates } from '@/components/bookings/resolveRates';
import { useAuth } from '@/contexts/AuthContext';
import QuickBooksInstructionsModal from '@/components/coroast/QuickBooksInstructionsModal';

const BILLABLE_STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] as const;
type BillableStatus = (typeof BILLABLE_STATUSES)[number];
const GST_RATE = 0.05;
const PST_RATE = 0.07;

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

interface ExtraRow {
  id: string;
  billing_period_id: string;
  description: string;
  qty: number;
  unit_price: number;
  apply_gst: boolean;
  apply_pst: boolean;
}

export default function CoRoastBilling() {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [modalData, setModalData] = useState<any>(null);
  const [undoInvoiceId, setUndoInvoiceId] = useState<string | null>(null);

  // Inline add-charge form state per member
  const [addingForMember, setAddingForMember] = useState<string | null>(null);
  const [newDescription, setNewDescription] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newUnitPrice, setNewUnitPrice] = useState('');
  const [newApplyGst, setNewApplyGst] = useState(true);
  const [newApplyPst, setNewApplyPst] = useState(false);

  const [selYear, selMonthNum] = selectedMonth.split('-').map(Number);
  const selectedDate = new Date(selYear, selMonthNum - 1, 1);
  const periodStart = format(selectedDate, 'yyyy-MM-dd');
  const periodEnd = format(endOfMonth(selectedDate), 'yyyy-MM-dd');

  const prevDate = subMonths(selectedDate, 1);
  const prevPeriodStart = format(prevDate, 'yyyy-MM-dd');
  const prevPeriodEnd = format(endOfMonth(prevDate), 'yyyy-MM-dd');

  // Is this period in the past (closed)?
  const periodIsClosed = isAfter(new Date(), endOfMonth(selectedDate));

  const { data: members = [] } = useQuery({
    queryKey: ['coroast-billing-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, coroast_tier, is_active, billing_email, coroast_joined_date')
        .contains('programs', ['COROASTING'])
        .eq('is_active', true)
        .order('account_name');
      if (error) throw error;
      return (data ?? []).map((a: any) => ({
        id: a.id,
        business_name: a.account_name,
        tier: a.coroast_tier ?? 'MEMBER',
        is_active: a.is_active,
        contact_email: a.billing_email,
        joined_date: a.coroast_joined_date,
      }));
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

    const monthEndDate = endOfMonth(selectedDate);
    const membersWithoutPeriod = members.filter((m) => {
      const alreadyHasPeriod = billingPeriods.some((bp) => ((bp as any).account_id === m.id || bp.member_id === m.id));
      if (alreadyHasPeriod) return false;
      if (!m.joined_date) return true;
      const joined = new Date(m.joined_date + 'T00:00:00');
      return joined <= monthEndDate;
    });

    if (membersWithoutPeriod.length === 0) return;

    const monthStart = format(startOfMonth(selectedDate), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(selectedDate), 'yyyy-MM-dd');

    const createMissing = async () => {
      const inserts = [];
      for (const m of membersWithoutPeriod) {
        const tier = m.tier ?? 'MEMBER';
        const rates = await resolveAccountRates(m.id, tier);

        // Proration logic
        let baseFee = rates.base;
        let proratedBaseFee: number | null = null;
        let prorationNote: string | null = null;

        const joinedDate = (m as any).joined_date as string | null;
        if (joinedDate) {
          const joinedD = new Date(joinedDate + 'T00:00:00');
          const joinedYear = joinedD.getFullYear();
          const joinedMonth = joinedD.getMonth();
          if (joinedYear === selYear && joinedMonth === selMonthNum - 1) {
            const dayOfMonth = joinedD.getDate();
            const daysRemaining = 30 - (dayOfMonth - 1);
            proratedBaseFee = Math.round(((daysRemaining / 30) * rates.base) * 100) / 100;
            baseFee = proratedBaseFee;
            prorationNote = `Prorated — joined ${format(joinedD, 'MMM d')}, ${daysRemaining}/30 days`;
          }
        }

        inserts.push({
          account_id: m.id,
          period_start: monthStart,
          period_end: monthEnd,
          tier_snapshot: tier,
          included_hours: rates.includedHours,
          overage_rate_per_hr: rates.overageRate,
          base_fee: baseFee,
          prorated_base_fee: proratedBaseFee,
          proration_note: prorationNote,
          is_closed: periodIsClosed,
        });
      }

      const { error } = await supabase.from('coroast_billing_periods').insert(inserts as any);
      if (error) {
        console.error('Failed to auto-create billing periods:', error);
        return;
      }
      refetchPeriods();
    };

    createMissing();
  }, [members, billingPeriods, selectedMonth, refetchPeriods]);

  // Auto-close past periods that aren't marked closed yet
  useEffect(() => {
    if (!periodIsClosed || billingPeriods.length === 0) return;
    const unclosed = billingPeriods.filter((bp) => !(bp as any).is_closed);
    if (unclosed.length === 0) return;

    const closeUnclosed = async () => {
      const { error } = await supabase
        .from('coroast_billing_periods')
        .update({ is_closed: true } as any)
        .in('id', unclosed.map((bp) => bp.id));
      if (error) console.error('Failed to close periods:', error);
      else refetchPeriods();
    };
    closeUnclosed();
  }, [billingPeriods, periodIsClosed]);

  // Query bookings directly with billable status filter for current month
  const { data: bookings = [] } = useQuery({
    queryKey: ['coroast-billing-bookings', periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, member_id, account_id, booking_date, start_time, end_time, duration_hours, status')
        .gte('booking_date', periodStart)
        .lte('booking_date', periodEnd)
        .in('status', BILLABLE_STATUSES);
      if (error) throw error;
      return data;
    },
  });

  // Query bookings for previous month (for upgrade recommendation)
  const { data: prevBookings = [] } = useQuery({
    queryKey: ['coroast-billing-bookings-prev', prevPeriodStart, prevPeriodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, member_id, account_id, start_time, end_time, duration_hours, status')
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
      const bpIds = billingPeriods.map((bp) => bp.id);
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

  // Auto-create storage allocations for members missing one for this period
  useEffect(() => {
    if (billingPeriods.length === 0 || members.length === 0) return;

    const membersWithoutStorage = members.filter((m) => {
      const bp = billingPeriods.find((bp) => ((bp as any).account_id === m.id || bp.member_id === m.id));
      if (!bp) return false;
      return !storageAllocations.some((s) => ((s as any).account_id === m.id || s.member_id === m.id) && s.billing_period_id === bp.id);
    });

    if (membersWithoutStorage.length === 0) return;

    const createMissingStorage = async () => {
      const inserts = [];
      for (const m of membersWithoutStorage) {
        const tier = m.tier ?? 'MEMBER';
        const rates = await resolveAccountRates(m.id, tier);
        const bp = billingPeriods.find((bp) => ((bp as any).account_id === m.id || bp.member_id === m.id))!;
        inserts.push({
          account_id: m.id,
          billing_period_id: bp.id,
          included_pallets: rates.includedPallets,
          paid_pallets: 0,
          pallets_in_use: 0,
          rate_per_add_pallet: rates.storageRate,
        });
      }

      const { error } = await supabase.from('coroast_storage_allocations').insert(inserts as any);
      if (error) {
        console.error('Failed to auto-create storage allocations:', error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['coroast-billing-storage', selectedMonth] });
    };

    createMissingStorage();
  }, [billingPeriods, members, storageAllocations, selectedMonth]);

  const { data: invoices = [], refetch: refetchInvoices } = useQuery({
    queryKey: ['coroast-invoices', selectedMonth],
    queryFn: async () => {
      const bpIds = billingPeriods.map((bp) => bp.id);
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

  // Fetch extras for billing periods
  const { data: allExtras = [] } = useQuery({
    queryKey: ['coroast-billing-extras', selectedMonth],
    queryFn: async () => {
      const bpIds = billingPeriods.map((bp) => bp.id);
      if (bpIds.length === 0) return [];
      const { data, error } = await supabase
        .from('coroast_billing_extras')
        .select('id, billing_period_id, description, qty, unit_price, apply_gst, apply_pst')
        .in('billing_period_id', bpIds)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as ExtraRow[];
    },
    enabled: billingPeriods.length > 0,
  });

  function calcBookingHours(bk: { duration_hours: number | null; start_time: string; end_time: string }) {
    const dh = Number(bk.duration_hours);
    if (!isNaN(dh) && dh > 0) return dh;
    const diff = (timeToMinutes(bk.end_time) - timeToMinutes(bk.start_time)) / 60;
    return diff > 0 ? diff : 0;
  }

  const memberHoursUsed = useMemo(() => {
    const map = new Map<string, number>();
    for (const bk of bookings) {
      const hours = calcBookingHours(bk);
      map.set(((bk as any).account_id ?? bk.member_id), (map.get(((bk as any).account_id ?? bk.member_id)) ?? 0) + hours);
    }
    return map;
  }, [bookings]);

  const prevMemberHoursUsed = useMemo(() => {
    const map = new Map<string, number>();
    for (const bk of prevBookings) {
      const hours = calcBookingHours(bk as any);
      map.set(((bk as any).account_id ?? bk.member_id), (map.get(((bk as any).account_id ?? bk.member_id)) ?? 0) + hours);
    }
    return map;
  }, [prevBookings]);

  const memberBillingData = useMemo(() => {
    return members.map((m) => {
      const tier = m.tier ?? 'MEMBER';
      const rates = TIER_RATES[tier] ?? TIER_RATES.MEMBER;
      const bp = billingPeriods.find((bp) => ((bp as any).account_id === m.id || bp.member_id === m.id));

      // Use prorated base fee if available, otherwise full rate
      const proratedBaseFee = bp ? (bp as any).prorated_base_fee as number | null : null;
      const prorationNote = bp ? (bp as any).proration_note as string | null : null;
      const baseFee = proratedBaseFee ?? (bp ? Number(bp.base_fee) : rates.base);
      const includedHours = bp ? Number(bp.included_hours) : rates.includedHours;
      const isClosed = bp ? !!(bp as any).is_closed : periodIsClosed;

      // For closed periods with an invoice, use snapshotted values
      const invoice = bp ? invoices.find((inv: any) => (inv.account_id === m.id || inv.member_id === m.id) && inv.billing_period_id === bp.id) : null;

      let usedHours: number;
      let overageHours: number;
      let overageCharge: number;

      if (isClosed && invoice) {
        // Use snapshotted values from invoice
        usedHours = Number(invoice.used_hours);
        overageHours = Number(invoice.overage_hours);
        overageCharge = Number(invoice.overage_charge);
      } else {
        // Live calculation from bookings
        usedHours = memberHoursUsed.get(m.id) ?? 0;
        overageHours = Math.max(0, usedHours - includedHours);
        overageCharge = overageHours * rates.overageRate;
      }

      const storage = storageAllocations.find((s) => ((s as any).account_id === m.id || s.member_id === m.id));
      const includedPallets = storage?.included_pallets ?? 0;
      const paidPallets = storage?.paid_pallets ?? 0;
      const palletRate = Number(storage?.rate_per_add_pallet ?? 0);
      const storageCharge = paidPallets * palletRate;

      // Extras for this member's billing period
      const memberExtras = bp ? allExtras.filter((ex) => ex.billing_period_id === bp.id) : [];
      let extrasSubtotal = 0;
      let extrasGst = 0;
      let extrasPst = 0;
      for (const ex of memberExtras) {
        const lineTotal = Number(ex.qty) * Number(ex.unit_price);
        extrasSubtotal += lineTotal;
        if (ex.apply_gst) extrasGst += lineTotal * GST_RATE;
        if (ex.apply_pst) extrasPst += lineTotal * PST_RATE;
      }

      const coreSubtotal = baseFee + overageCharge + storageCharge;
      const subtotal = coreSubtotal + extrasSubtotal;
      const gst = coreSubtotal * GST_RATE + extrasGst;
      const grandTotal = subtotal + gst + extrasPst;

      const prevUsed = prevMemberHoursUsed.get(m.id) ?? 0;
      const nudgeMemberToGrowth = tier === 'MEMBER' && usedHours > 6 && prevUsed > 6;
      const nudgeGrowthToProduction = tier === 'GROWTH' && usedHours > 10 && prevUsed > 10;
      const upgradeRecommended = nudgeMemberToGrowth || nudgeGrowthToProduction;
      const upgradeLabel = nudgeGrowthToProduction ? 'Upgrade to Production Recommended' : 'Upgrade to Growth Recommended';

      return {
        member: m,
        tier,
        bp,
        baseFee,
        proratedBaseFee,
        prorationNote,
        includedHours,
        usedHours,
        overageHours,
        overageRate: rates.overageRate,
        overageCharge,
        includedPallets,
        paidPallets,
        palletRate,
        storageCharge,
        extras: memberExtras,
        extrasSubtotal,
        extrasGst,
        extrasPst,
        subtotal,
        gst,
        grandTotal,
        invoice,
        upgradeRecommended,
        upgradeLabel,
        isClosed,
        contactEmail: (m as any).contact_email ?? null,
      };
    });
  }, [members, billingPeriods, memberHoursUsed, prevMemberHoursUsed, storageAllocations, invoices, periodIsClosed, allExtras]);

  const totals = useMemo(() => {
    let baseFees = 0, overageCharges = 0, storageCharges = 0, extrasTotal = 0, subtotal = 0, gst = 0, grandTotal = 0;
    for (const d of memberBillingData) {
      baseFees += d.baseFee;
      overageCharges += d.overageCharge;
      storageCharges += d.storageCharge;
      extrasTotal += d.extrasSubtotal;
      subtotal += d.subtotal;
      gst += d.gst;
      grandTotal += d.grandTotal;
    }
    return { baseFees, overageCharges, storageCharges, extrasTotal, subtotal, gst, grandTotal };
  }, [memberBillingData]);

  const markReadyMutation = useMutation({
    mutationFn: async (data: (typeof memberBillingData)[number]) => {
      if (!data.bp) throw new Error('No billing period found for this member');
      const { error } = await supabase.from('coroast_invoices').insert({
        account_id: data.member.id,
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
      toast.success('Invoice recorded');
      refetchInvoices();
      setModalData(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const undoInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.from('coroast_invoices').delete().eq('id', invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invoice record removed');
      refetchInvoices();
      setUndoInvoiceId(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setUndoInvoiceId(null);
    },
  });

  const addExtraMutation = useMutation({
    mutationFn: async (payload: { billing_period_id: string; description: string; qty: number; unit_price: number; apply_gst: boolean; apply_pst: boolean }) => {
      const { error } = await supabase.from('coroast_billing_extras').insert({
        ...payload,
        created_by: authUser?.id ?? null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Extra charge added');
      queryClient.invalidateQueries({ queryKey: ['coroast-billing-extras', selectedMonth] });
      resetAddForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteExtraMutation = useMutation({
    mutationFn: async (extraId: string) => {
      const { error } = await supabase.from('coroast_billing_extras').delete().eq('id', extraId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Extra charge removed');
      queryClient.invalidateQueries({ queryKey: ['coroast-billing-extras', selectedMonth] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function resetAddForm() {
    setAddingForMember(null);
    setNewDescription('');
    setNewQty('1');
    setNewUnitPrice('');
    setNewApplyGst(true);
    setNewApplyPst(false);
  }

  function handleSaveExtra(bpId: string) {
    const qty = Number(newQty);
    const unitPrice = Number(newUnitPrice);
    if (!newDescription.trim() || isNaN(qty) || qty <= 0 || isNaN(unitPrice)) {
      toast.error('Please fill in all fields correctly');
      return;
    }
    addExtraMutation.mutate({ billing_period_id: bpId, description: newDescription.trim(), qty, unit_price: unitPrice, apply_gst: newApplyGst, apply_pst: newApplyPst });
  }

  const fmt = (n: number) => n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Co-Roasting Billing</h1>
          <p className="text-sm text-muted-foreground">
            Monthly billing summary for all co-roasting members
          </p>
        </div>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
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
        {memberBillingData.map((d) => (
          <Card key={d.member.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{d.member.business_name}</CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {TIER_RATES[d.tier]?.label ?? d.tier}
                  </Badge>
                  {d.isClosed && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Lock className="h-3 w-3" />
                      Closed
                    </Badge>
                  )}
                  {d.upgradeRecommended && (
                    <Badge
                      variant="outline"
                      className="text-xs border-amber-400 text-amber-600 bg-amber-50"
                    >
                      <TrendingUp className="h-3 w-3 mr-1" />
                      {d.upgradeLabel}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {d.invoice ? (
                    <div className="flex items-center gap-2">
                      <Badge className="text-xs bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Invoice Recorded {format(new Date(d.invoice.created_at), 'MMM d, yyyy')}
                      </Badge>
                      {undoInvoiceId === d.invoice.id ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground">Reopen?</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() => setUndoInvoiceId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 px-2 text-xs"
                            onClick={() => undoInvoiceMutation.mutate(d.invoice.id)}
                            disabled={undoInvoiceMutation.isPending}
                          >
                            Confirm
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setUndoInvoiceId(d.invoice.id)}
                        >
                          Undo
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button size="sm" onClick={() => setModalData(d)} disabled={!d.bp}>
                      Record Invoice
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Base Fee</p>
                  <p className="font-semibold">${fmt(d.baseFee)}</p>
                  {d.prorationNote && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">{d.prorationNote}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Hours Used / Included</p>
                  <p className="font-semibold">
                    {d.usedHours.toFixed(1)}h / {d.includedHours}h
                    {d.overageHours > 0 && (
                      <span className="text-destructive ml-1">
                        (+{d.overageHours.toFixed(1)}h overage)
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Overage Charge</p>
                  <p className="font-semibold">
                    {d.overageCharge > 0 ? `$${fmt(d.overageCharge)}` : '—'}
                    {d.overageCharge > 0 && (
                      <span className="text-muted-foreground text-xs ml-1">
                        @ ${d.overageRate}/hr
                      </span>
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
                          <span className="text-destructive ml-1">
                            (${fmt(d.storageCharge)})
                          </span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </p>
                </div>
              </div>

              {/* Extras section */}
              {(d.extras.length > 0 || (!d.isClosed && !d.invoice)) && (
                <div className="mt-3">
                  <Separator className="mb-3" />
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Extras</p>

                  {d.extras.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {d.extras.map((ex) => {
                        const lineTotal = Number(ex.qty) * Number(ex.unit_price);
                        return (
                          <div key={ex.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span>{ex.description}</span>
                              <span className="text-muted-foreground text-xs">
                                {Number(ex.qty)} × ${fmt(Number(ex.unit_price))} = ${fmt(lineTotal)}
                              </span>
                              {ex.apply_gst && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">GST</Badge>
                              )}
                              {ex.apply_pst && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">PST</Badge>
                              )}
                            </div>
                            {!d.isClosed && !d.invoice && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteExtraMutation.mutate(ex.id)}
                                disabled={deleteExtraMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Inline add form */}
                  {!d.isClosed && !d.invoice && d.bp && (
                    <>
                      {addingForMember === d.member.id ? (
                        <div className="space-y-2 p-2 rounded-md border bg-muted/30">
                          <Input
                            placeholder="Description"
                            value={newDescription}
                            onChange={(e) => setNewDescription(e.target.value)}
                            className="h-8 text-sm"
                          />
                          <div className="flex items-center gap-2">
                            <div className="w-20">
                              <Input
                                type="number"
                                placeholder="Qty"
                                value={newQty}
                                onChange={(e) => setNewQty(e.target.value)}
                                className="h-8 text-sm"
                                min={0}
                                step="any"
                              />
                            </div>
                            <div className="relative w-28">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                              <Input
                                type="number"
                                placeholder="Unit Price"
                                value={newUnitPrice}
                                onChange={(e) => setNewUnitPrice(e.target.value)}
                                className="h-8 text-sm pl-5"
                                min={0}
                                step="any"
                              />
                            </div>
                            <label className="flex items-center gap-1 text-xs">
                              <Checkbox
                                checked={newApplyGst}
                                onCheckedChange={(v) => setNewApplyGst(!!v)}
                                className="h-3.5 w-3.5"
                              />
                              GST 5%
                            </label>
                            <label className="flex items-center gap-1 text-xs">
                              <Checkbox
                                checked={newApplyPst}
                                onCheckedChange={(v) => setNewApplyPst(!!v)}
                                className="h-3.5 w-3.5"
                              />
                              PST 7%
                            </label>
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleSaveExtra(d.bp!.id)}
                              disabled={addExtraMutation.isPending}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={resetAddForm}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1 text-muted-foreground"
                          onClick={() => {
                            resetAddForm();
                            setAddingForMember(d.member.id);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Charge
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}

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
                {d.extrasPst > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">PST (7%)</span>
                    <span className="text-sm font-semibold">${fmt(d.extrasPst)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Total incl. tax</span>
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
                <p className="font-bold text-lg">${fmt(totals.baseFees)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Overage Charges</p>
                <p className="font-bold text-lg">${fmt(totals.overageCharges)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Storage Charges</p>
                <p className="font-bold text-lg">${fmt(totals.storageCharges)}</p>
              </div>
              {totals.extrasTotal > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs">Total Extras</p>
                  <p className="font-bold text-lg">${fmt(totals.extrasTotal)}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs">Subtotal</p>
                <p className="font-bold text-lg">${fmt(totals.subtotal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Tax</p>
                <p className="font-bold text-lg">${fmt(totals.gst)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Grand Total incl. Tax</p>
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
          extras={modalData.extras.map((ex: ExtraRow) => ({
            description: ex.description,
            qty: Number(ex.qty),
            unit_price: Number(ex.unit_price),
            apply_gst: ex.apply_gst,
            apply_pst: ex.apply_pst,
          }))}
          extrasGst={modalData.extrasGst}
          extrasPst={modalData.extrasPst}
        />
      )}
    </div>
  );
}
