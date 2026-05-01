import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { Scale } from 'lucide-react';
import { WipAdjustmentModal } from '@/components/inventory/WipAdjustmentModal';

interface Props {
  roastGroupKey: string;
  displayName: string;
}

/**
 * WIP summary + Adjust button, shown on the roast-group detail page (ADMIN/OPS only).
 *
 * WIP balance is computed the same way as Inventory Levels:
 *   sum(inventory_transactions.quantity_kg for {ROAST_OUTPUT, PACK_CONSUME_WIP, ADJUSTMENT, LOSS})
 *   + sum(wip_adjustments.kg_delta)
 */
export function RoastGroupWipSection({ roastGroupKey, displayName }: Props) {
  const { authUser } = useAuth();
  const isAdminOrOps = authUser?.role === 'ADMIN' || authUser?.role === 'OPS';
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['roast-group-wip', roastGroupKey],
    queryFn: async () => {
      const [txRes, adjRes] = await Promise.all([
        supabase
          .from('inventory_transactions')
          .select('quantity_kg, transaction_type')
          .eq('roast_group', roastGroupKey)
          .in('transaction_type', ['ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'ADJUSTMENT', 'LOSS']),
        supabase
          .from('wip_adjustments')
          .select('kg_delta, reason, notes, created_at, created_by')
          .eq('roast_group', roastGroupKey)
          .order('created_at', { ascending: false }),
      ]);
      if (txRes.error) throw txRes.error;
      if (adjRes.error) throw adjRes.error;

      let txSum = 0;
      for (const r of txRes.data ?? []) {
        const kg = Number(r.quantity_kg) || 0;
        if (r.transaction_type === 'LOSS') {
          // LOSS rows reduce WIP — ledger writes are typically negative,
          // but if positive we still subtract magnitude to mirror Inventory math.
          txSum -= Math.abs(kg);
        } else {
          txSum += kg;
        }
      }
      let adjSum = 0;
      for (const a of adjRes.data ?? []) adjSum += Number(a.kg_delta) || 0;

      const lastAdj = (adjRes.data ?? [])[0] ?? null;
      return { balance: txSum + adjSum, lastAdj };
    },
  });

  if (!isAdminOrOps) return null;

  const balance = data?.balance ?? 0;
  const lastAdj = data?.lastAdj;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          WIP Inventory
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs text-muted-foreground">Current WIP</div>
            <div className="text-2xl font-semibold tabular-nums">
              {isLoading ? '…' : `${balance.toFixed(1)} kg`}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={isLoading}
          >
            Adjust WIP
          </Button>
        </div>

        {lastAdj && (
          <p className="text-xs text-muted-foreground">
            Last adjusted{' '}
            {format(new Date(lastAdj.created_at), 'MMM d, yyyy h:mm a')}
            {lastAdj.reason ? ` (${lastAdj.reason})` : ''}
          </p>
        )}
      </CardContent>

      <WipAdjustmentModal
        open={open}
        onOpenChange={setOpen}
        roastGroup={roastGroupKey}
        roastGroupDisplayName={displayName}
        currentBalanceKg={balance}
      />
    </Card>
  );
}
