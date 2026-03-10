import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Package, AlertCircle } from 'lucide-react';
import { STORAGE_RATES } from '@/components/bookings/bookingUtils';

interface MemberStorageSectionProps {
  memberId: string;
  tier: string;
}

export default function MemberStorageSection({ memberId, tier }: MemberStorageSectionProps) {
  const queryClient = useQueryClient();
  const now = new Date();
  const currentMonthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const currentMonthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

  // Get current billing period
  const { data: currentBp } = useQuery({
    queryKey: ['coroast-storage-bp', memberId, currentMonthStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_billing_periods')
        .select('id')
        .eq('member_id', memberId)
        .gte('period_start', currentMonthStart)
        .lte('period_start', currentMonthEnd)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Get current storage allocation
  const { data: currentStorage, refetch: refetchStorage } = useQuery({
    queryKey: ['coroast-storage-current', memberId, currentBp?.id],
    queryFn: async () => {
      if (!currentBp) return null;
      const { data, error } = await supabase
        .from('coroast_storage_allocations')
        .select('*')
        .eq('member_id', memberId)
        .eq('billing_period_id', currentBp.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentBp,
  });

  // Auto-create storage allocation if missing
  useEffect(() => {
    if (!currentBp || currentStorage !== null || currentStorage === undefined) return;
    // currentStorage is null means query ran and found nothing
    const sRates = STORAGE_RATES[tier] ?? STORAGE_RATES.ACCESS;
    const create = async () => {
      const { error } = await supabase.from('coroast_storage_allocations').insert({
        member_id: memberId,
        billing_period_id: currentBp.id,
        included_pallets: sRates.includedPallets,
        paid_pallets: 0,
        pallets_in_use: 0,
        rate_per_add_pallet: sRates.ratePerPallet,
      });
      if (error) {
        console.error('Failed to auto-create storage allocation:', error);
        return;
      }
      refetchStorage();
    };
    create();
  }, [currentBp, currentStorage, memberId, tier]);

  // Storage history
  const { data: storageHistory = [] } = useQuery({
    queryKey: ['coroast-storage-history', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_storage_allocations')
        .select('*, coroast_billing_periods!inner(period_start, period_end)')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // Edit state
  const [editPaidPallets, setEditPaidPallets] = useState<number | null>(null);
  const [editPalletsInUse, setEditPalletsInUse] = useState<number | null>(null);

  useEffect(() => {
    if (currentStorage) {
      setEditPaidPallets(currentStorage.paid_pallets);
      setEditPalletsInUse(currentStorage.pallets_in_use);
    }
  }, [currentStorage]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!currentStorage) return;
      const { error } = await supabase
        .from('coroast_storage_allocations')
        .update({
          paid_pallets: editPaidPallets ?? 0,
          pallets_in_use: editPalletsInUse ?? 0,
        })
        .eq('id', currentStorage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Storage updated');
      refetchStorage();
      queryClient.invalidateQueries({ queryKey: ['coroast-storage-history', memberId] });
    },
    onError: () => toast.error('Failed to update storage'),
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      if (!currentStorage) return;
      const { error } = await supabase
        .from('coroast_storage_allocations')
        .update({ release_requested: true })
        .eq('id', currentStorage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Release requested');
      refetchStorage();
    },
    onError: () => toast.error('Failed to request release'),
  });

  const sRates = STORAGE_RATES[tier] ?? STORAGE_RATES.ACCESS;
  const includedPallets = currentStorage?.included_pallets ?? sRates.includedPallets;
  const paidPallets = editPaidPallets ?? currentStorage?.paid_pallets ?? 0;
  const palletsInUse = editPalletsInUse ?? currentStorage?.pallets_in_use ?? 0;
  const totalAllocated = includedPallets + paidPallets;
  const storageCharge = paidPallets * (currentStorage?.rate_per_add_pallet ?? sRates.ratePerPallet);
  const usagePct = totalAllocated > 0 ? Math.min(100, (palletsInUse / totalAllocated) * 100) : 0;

  const canRelease = currentStorage && !currentStorage.release_requested
    && paidPallets > 0
    && palletsInUse < totalAllocated;

  const isDirty = currentStorage
    && (editPaidPallets !== currentStorage.paid_pallets || editPalletsInUse !== currentStorage.pallets_in_use);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-4 w-4" />
          Storage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Month Summary */}
        <div>
          <h4 className="text-sm font-medium mb-3">
            {format(now, 'MMMM yyyy')} — Current Period
          </h4>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <Label className="text-xs text-muted-foreground">Included Pallets</Label>
              <p className="text-sm font-semibold mt-0.5">{includedPallets}</p>
              <p className="text-xs text-muted-foreground">{tier} tier</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Paid Additional Pallets</Label>
              <Input
                type="number"
                min={0}
                value={editPaidPallets ?? 0}
                onChange={(e) => setEditPaidPallets(Math.max(0, parseInt(e.target.value) || 0))}
                className="mt-0.5 h-8 w-20"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Pallets In Use</Label>
              <Input
                type="number"
                min={0}
                value={editPalletsInUse ?? 0}
                onChange={(e) => setEditPalletsInUse(Math.max(0, parseInt(e.target.value) || 0))}
                className="mt-0.5 h-8 w-20"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Monthly Storage Charge</Label>
              <p className="text-sm font-semibold mt-0.5">
                {storageCharge > 0 ? `$${storageCharge.toFixed(2)}` : '$0.00'}
              </p>
              {paidPallets > 0 && (
                <p className="text-xs text-muted-foreground">
                  @ ${Number(currentStorage?.rate_per_add_pallet ?? sRates.ratePerPallet)}/pallet
                </p>
              )}
            </div>
          </div>

          {/* Usage bar */}
          {totalAllocated > 0 && (
            <div className="space-y-1.5 mb-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Usage</span>
                <span className="font-medium">{palletsInUse} of {totalAllocated} pallets in use</span>
              </div>
              <Progress value={usagePct} className="h-2" />
              {palletsInUse > totalAllocated && (
                <div className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  Over allocated capacity
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {isDirty && (
              <Button
                size="sm"
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            )}
            {canRelease ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => releaseMutation.mutate()}
                disabled={releaseMutation.isPending}
              >
                Release Pallet
              </Button>
            ) : currentStorage?.release_requested ? (
              <Badge variant="secondary" className="text-xs">
                Release requested for next billing period
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Storage History */}
        {storageHistory.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Storage History</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 font-medium">Period</th>
                    <th className="text-right py-2 font-medium">Included</th>
                    <th className="text-right py-2 font-medium">Paid</th>
                    <th className="text-right py-2 font-medium">In Use</th>
                    <th className="text-right py-2 font-medium">Charge</th>
                  </tr>
                </thead>
                <tbody>
                  {storageHistory.map((s: any) => {
                    const periodLabel = s.coroast_billing_periods?.period_start
                      ? format(new Date(s.coroast_billing_periods.period_start + 'T00:00:00'), 'MMM yyyy')
                      : '—';
                    const charge = s.paid_pallets * Number(s.rate_per_add_pallet);
                    return (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="py-2">{periodLabel}</td>
                        <td className="py-2 text-right">{s.included_pallets}</td>
                        <td className="py-2 text-right">{s.paid_pallets}</td>
                        <td className="py-2 text-right">{s.pallets_in_use}</td>
                        <td className="py-2 text-right">
                          {charge > 0 ? `$${charge.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
