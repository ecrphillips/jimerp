import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GreenLotPickerModal } from '@/components/roast-groups/GreenLotPickerModal';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import type { DepletionImpact } from '@/hooks/useGreenLotDepletion';

export interface DepletionSwap {
  link_id: string;
  lot_id: string; // depleted lot id (the one being replaced)
  successor_lot_id: string; // new lot to link
  pct_of_lot: number | null; // copied from the depleted link
  roast_group: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roastGroupKey: string;
  roastGroupDisplayName: string;
  impacts: DepletionImpact[];
  /** Original pct_of_lot for each link, keyed by link_id, so swaps inherit pct. */
  pctByLinkId: Record<string, number | null>;
  onProceed: (swaps: DepletionSwap[]) => void | Promise<void>;
  onCancel: () => void;
  isProceeding?: boolean;
}

interface SuccessorPickerContext {
  linkId: string;
  currentLotId: string;
  currentLotNumber: string;
  currentContractId: string | null;
  currentOriginCountry: string | null;
  currentOriginText: string | null;
  currentSuccessorLotId: string | null;
  excludeLotIds: Set<string>;
}

export function DepletionWarningModal({
  open,
  onOpenChange,
  roastGroupKey,
  roastGroupDisplayName,
  impacts,
  pctByLinkId,
  onProceed,
  onCancel,
  isProceeding = false,
}: Props) {
  const queryClient = useQueryClient();
  // swap toggles keyed by link_id, default ON when a RECEIVED successor exists
  const [swapToggles, setSwapToggles] = useState<Record<string, boolean>>({});
  const [pickerCtx, setPickerCtx] = useState<SuccessorPickerContext | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, boolean> = {};
    impacts.forEach(i => {
      const ready = i.successor_lot && i.successor_lot.status === 'RECEIVED';
      initial[i.link_id] = !!ready;
    });
    setSwapToggles(initial);
  }, [open, impacts]);

  async function openSuccessorPicker(impact: DepletionImpact) {
    // Fetch contextual info for sorting in the picker
    const { data, error } = await supabase
      .from('green_lots')
      .select(`
        id, lot_number, contract_id,
        green_contracts ( origin, origin_country )
      `)
      .eq('id', impact.lot_id)
      .maybeSingle();
    if (error || !data) return;

    // Fetch the set of lots already linked to this RG (to exclude)
    const { data: linksData } = await supabase
      .from('green_lot_roast_group_links')
      .select('lot_id')
      .eq('roast_group', roastGroupKey);
    const exclude = new Set<string>((linksData ?? []).map((r: any) => r.lot_id));

    setPickerCtx({
      linkId: impact.link_id,
      currentLotId: impact.lot_id,
      currentLotNumber: impact.lot_number,
      currentContractId: data.contract_id ?? null,
      currentOriginCountry: (data as any).green_contracts?.origin_country ?? null,
      currentOriginText: (data as any).green_contracts?.origin ?? null,
      currentSuccessorLotId: impact.successor_lot_id,
      excludeLotIds: exclude,
    });
  }

  async function handleProceed() {
    const swaps: DepletionSwap[] = impacts
      .filter(i => swapToggles[i.link_id] && i.successor_lot && i.successor_lot.status === 'RECEIVED')
      .map(i => ({
        link_id: i.link_id,
        lot_id: i.lot_id,
        successor_lot_id: i.successor_lot!.id,
        pct_of_lot: pctByLinkId[i.link_id] ?? null,
        roast_group: roastGroupKey,
      }));
    await onProceed(swaps);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); onOpenChange(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Green lot depletion warning — {roastGroupDisplayName}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Planning this batch would tip {impacts.length === 1 ? 'a linked lot' : `${impacts.length} linked lots`} below 10 kg of projected remaining inventory. Review successor coverage below before proceeding.
          </p>

          <div className="space-y-3 mt-2">
            {impacts.map(impact => (
              <ImpactCard
                key={impact.link_id}
                impact={impact}
                swapOn={!!swapToggles[impact.link_id]}
                onToggleSwap={(v) => setSwapToggles(prev => ({ ...prev, [impact.link_id]: v }))}
                onOpenPicker={() => openSuccessorPicker(impact)}
              />
            ))}
          </div>

          <DialogFooter className="gap-2 pt-3 border-t mt-4">
            <Button variant="ghost" onClick={onCancel} disabled={isProceeding}>
              Cancel
            </Button>
            <Button onClick={handleProceed} disabled={isProceeding}>
              {isProceeding ? 'Working…' : 'Plan batch anyway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pickerCtx && (
        <GreenLotPickerModal
          open={!!pickerCtx}
          onOpenChange={(o) => {
            if (!o) {
              setPickerCtx(null);
              // Refresh impacts source-of-truth queries after picker change
              queryClient.invalidateQueries({ queryKey: ['depletion-links', roastGroupKey] });
              queryClient.invalidateQueries({ queryKey: ['roast-group-lot-links', roastGroupKey] });
            }
          }}
          roastGroupDisplayName={roastGroupDisplayName}
          mode={{
            kind: 'SUCCESSOR',
            linkId: pickerCtx.linkId,
            currentLotId: pickerCtx.currentLotId,
            currentLotNumber: pickerCtx.currentLotNumber,
            currentContractId: pickerCtx.currentContractId,
            currentOriginCountry: pickerCtx.currentOriginCountry,
            currentOriginText: pickerCtx.currentOriginText,
            currentSuccessorLotId: pickerCtx.currentSuccessorLotId,
            excludeLotIds: pickerCtx.excludeLotIds,
            roastGroupKey,
          }}
        />
      )}
    </>
  );
}

interface ImpactCardProps {
  impact: DepletionImpact;
  swapOn: boolean;
  onToggleSwap: (v: boolean) => void;
  onOpenPicker: () => void;
}

function ImpactCard({ impact, swapOn, onToggleSwap, onOpenPicker }: ImpactCardProps) {
  const successor = impact.successor_lot;
  const successorReady = successor && successor.status === 'RECEIVED';
  const successorPending = successor && successor.status !== 'RECEIVED';
  const noSuccessor = !successor;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-medium">{impact.lot_number}</div>
          <div className="text-xs text-muted-foreground">
            {impact.current_kg_on_hand.toFixed(1)} kg on hand · projected after batch:{' '}
            <span className={cn(
              'tabular-nums font-medium',
              impact.projected_remaining_after_batch < 0
                ? 'text-destructive'
                : 'text-amber-700 dark:text-amber-400',
            )}>
              {impact.projected_remaining_after_batch.toFixed(1)} kg
            </span>
          </div>
        </div>
      </div>

      {impact.already_depleted && (
        <div className="rounded bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>This lot is already at 0 kg. Planning more batches against it is unsupported until you swap to a successor.</span>
        </div>
      )}

      {successorReady && (
        <div className="rounded bg-green-50 dark:bg-green-950/30 border border-green-300 dark:border-green-800 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-green-800 dark:text-green-300 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Successor ready: {successor!.lot_number}
          </div>
          <div className="text-muted-foreground mt-0.5">
            {successor!.kg_on_hand.toFixed(1)} kg on hand
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-foreground">Swap to successor after this batch</span>
            <Switch checked={swapOn} onCheckedChange={onToggleSwap} />
          </div>
        </div>
      )}

      {successorPending && (
        <div className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 px-3 py-2 text-xs space-y-2">
          <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Successor <strong>{successor!.lot_number}</strong> hasn't arrived yet (status: {successor!.status}). This batch will still use {impact.lot_number}. Nominate a different successor or plan around the gap.
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenPicker}>
            Change successor
          </Button>
        </div>
      )}

      {noSuccessor && (
        <div className="rounded bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs space-y-2">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>No successor nominated. Nominate one now or this roast group will stall.</span>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenPicker}>
            Nominate successor
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Helper: execute approved successor swaps. Inserts new link rows for the successor
 * lots (inheriting pct), then deletes the depleted links. No ledger writes.
 */
export async function executeDepletionSwaps(swaps: DepletionSwap[]) {
  if (swaps.length === 0) return;

  // Insert successor link rows
  const inserts = swaps.map(s => ({
    roast_group: s.roast_group,
    lot_id: s.successor_lot_id,
    pct_of_lot: s.pct_of_lot,
  }));
  const { error: insertError } = await supabase
    .from('green_lot_roast_group_links')
    .insert(inserts);
  if (insertError) throw insertError;

  // Delete depleted links
  const linkIds = swaps.map(s => s.link_id);
  const { error: deleteError } = await supabase
    .from('green_lot_roast_group_links')
    .delete()
    .in('id', linkIds);
  if (deleteError) throw deleteError;
}
