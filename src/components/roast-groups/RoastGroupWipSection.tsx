import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useOrderCreator } from '@/hooks/useOrderCreator';
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
 * WIP balance is computed the same way as Inventory Levels, entirely from the
 * inventory_transactions ledger:
 *   sum(quantity_kg for {ROAST_OUTPUT, PACK_CONSUME_WIP, BLEND, ADJUSTMENT, LOSS})
 * Manual floor-count / recount adjustments are ADJUSTMENT rows here now (the
 * separate wip_adjustments table is retired).
 */
export function RoastGroupWipSection({ roastGroupKey, displayName }: Props) {
  const { authUser } = useAuth();
  const isAdminOrOps = authUser?.role === 'ADMIN' || authUser?.role === 'OPS';
  const [modalMode, setModalMode] = useState<'adjust' | 'zero' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['roast-group-wip', roastGroupKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('quantity_kg, transaction_type, notes, created_at, created_by')
        .eq('roast_group', roastGroupKey)
        .in('transaction_type', ['ROAST_OUTPUT', 'PACK_CONSUME_WIP', 'BLEND', 'ADJUSTMENT', 'LOSS'])
        .order('created_at', { ascending: false });
      if (error) throw error;

      let txSum = 0;
      for (const r of data ?? []) {
        const kg = Number(r.quantity_kg) || 0;
        if (r.transaction_type === 'LOSS') {
          // LOSS rows reduce WIP — ledger writes are typically negative,
          // but if positive we still subtract magnitude to mirror Inventory math.
          txSum -= Math.abs(kg);
        } else {
          txSum += kg;
        }
      }

      // Most recent manual adjustment (floor count / recount) for the footnote.
      const lastAdj = (data ?? []).find((r) => r.transaction_type === 'ADJUSTMENT') ?? null;
      return { balance: txSum, lastAdj };
    },
  });

  const balance = data?.balance ?? 0;
  const lastAdj = data?.lastAdj;
  const { data: lastAdjProfile } = useOrderCreator(lastAdj?.created_by);
  const lastAdjBy = lastAdjProfile?.name?.trim() || lastAdjProfile?.email || null;

  if (!isAdminOrOps) return null;

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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalMode('adjust')}
              disabled={isLoading}
            >
              Adjust WIP
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setModalMode('zero')}
              disabled={isLoading || balance === 0}
            >
              Zero inventory
            </Button>
          </div>
        </div>

        {lastAdj && (
          <p className="text-xs text-muted-foreground">
            Last counted{lastAdjBy ? ` by ${lastAdjBy}` : ''} at{' '}
            {format(new Date(lastAdj.created_at), 'MMM d, yyyy h:mm a')}
            {lastAdj.notes ? ` (${lastAdj.notes})` : ''}
          </p>
        )}
      </CardContent>

      <WipAdjustmentModal
        open={modalMode !== null}
        onOpenChange={(o) => setModalMode(o ? modalMode : null)}
        roastGroup={roastGroupKey}
        roastGroupDisplayName={displayName}
        currentBalanceKg={balance}
        mode={modalMode ?? 'adjust'}
      />
    </Card>
  );
}
