import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { defaultLotSplits, type LotSplit } from '@/lib/greenUse';
import { useRoastGroupBasketLots } from '@/hooks/roastGroupBasketLots';
import { useGreenDeductionEnabled } from '@/hooks/useGreenDeductionSetting';
import { printBatchLabel } from '@/lib/batchLabelData';
import { AlertTriangle, Loader2, Printer, X } from 'lucide-react';
import { toast } from 'sonner';

type Machine = 'LORING' | 'SAMIAC';

/** Roasted-out estimate from a green weight and the roast group's yield-loss %. */
function expectedRoastedFrom(greenStr: string, lossPct: number): string {
  const g = parseFloat(greenStr);
  if (!Number.isFinite(g) || g <= 0) return '';
  return String(+(g * (1 - lossPct / 100)).toFixed(2));
}

export interface MarkRoastedBatch {
  id: string;
  roast_group: string;
  planned_output_kg: number | null;
  assigned_roaster: Machine | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: MarkRoastedBatch | null;
  roastGroupName: string;
  standardBatchKg: number;
  expectedYieldLossPct: number;
  /** A split the roaster already edited on the batch row (else the roast group's default). */
  initialSplits?: LotSplit[] | null;
  /** Called after the batch is saved (label is already printing). */
  onSaved: (batchNumber: string | null) => void;
}

/**
 * Tablet-friendly "Mark Roasted" panel: machine, green in, roasted out, green lots,
 * one button that saves the batch (assigns its number) and prints the bin label.
 */
export function MarkRoastedPanel({
  open,
  onOpenChange,
  batch,
  roastGroupName,
  standardBatchKg,
  expectedYieldLossPct,
  initialSplits,
  onSaved,
}: Props) {
  const greenDeductionOn = useGreenDeductionEnabled();
  const roastGroup = batch?.roast_group ?? null;

  // Default split from the batch's own roast group (linked lots + baskets).
  const { data: links, isFetched: linksLoaded } = useQuery({
    queryKey: ['mark-roasted-links', roastGroup],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lot_roast_group_links')
        .select('lot_id, pct_of_lot, green_lots!green_lot_roast_group_links_lot_id_fkey(lot_number)')
        .eq('roast_group', roastGroup!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!roastGroup,
  });
  const { data: basketLots = [], isFetched: basketsLoaded } = useRoastGroupBasketLots(open ? roastGroup : null);
  const defaultSplits = useMemo(
    () => defaultLotSplits(
      (links ?? [])
        .filter(l => l.green_lots)
        .map(l => ({ lot_id: l.lot_id, lot_number: (l.green_lots as { lot_number: string }).lot_number, pct_of_lot: l.pct_of_lot ?? null })),
      basketLots,
    ),
    [links, basketLots],
  );
  const splitsReady = linksLoaded && basketsLoaded;

  const [machine, setMachine] = useState<Machine | null>(null);
  const [greenKg, setGreenKg] = useState('');
  const [roastedKg, setRoastedKg] = useState('');
  const [splits, setSplits] = useState<LotSplit[]>([]);
  const [recordLoss, setRecordLoss] = useState(false);
  const [lossNote, setLossNote] = useState('');
  const [printLabelOnSave, setPrintLabelOnSave] = useState(true);
  const [roastedTouched, setRoastedTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [splitsTouched, setSplitsTouched] = useState(false);

  useEffect(() => {
    if (!open || !batch) return;
    setMachine(batch.assigned_roaster);
    const g = batch.planned_output_kg && batch.planned_output_kg > 0 ? batch.planned_output_kg : standardBatchKg;
    setGreenKg(String(g));
    setRoastedKg(expectedRoastedFrom(String(g), expectedYieldLossPct));
    setRoastedTouched(false);
    setRecordLoss(false);
    setLossNote('');
    setPrintLabelOnSave(true);
    setSaving(false);
    setSplitsTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batch?.id]);

  // Fill the lot split once the roast group's sources have loaded (until the roaster edits it).
  useEffect(() => {
    if (!open || splitsTouched) return;
    if (initialSplits && initialSplits.length > 0) setSplits(initialSplits.map(s => ({ ...s })));
    else if (splitsReady) setSplits(defaultSplits.map(s => ({ ...s })));
  }, [open, splitsTouched, initialSplits, splitsReady, defaultSplits]);

  // Every in-store lot, so the roaster can pick one the roast group isn't linked to.
  const { data: allLots = [] } = useQuery({
    queryKey: ['mark-roasted-lot-choices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select('id, lot_number, kg_on_hand, status, is_placeholder')
        .neq('status', 'EN_ROUTE')
        .eq('is_placeholder', false)
        .order('lot_number');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
    staleTime: 60_000,
  });
  const addableLots = useMemo(
    () => allLots.filter(l => !splits.some(s => s.lot_id === l.id)),
    [allLots, splits],
  );

  const green = parseFloat(greenKg);
  const roasted = parseFloat(roastedKg);
  const greenOk = Number.isFinite(green) && green > 0;
  const roastedOk = roastedKg.trim() !== '' && Number.isFinite(roasted) && roasted >= 0;
  const lossPct = greenOk && roastedOk && roasted > 0 ? (1 - roasted / green) * 100 : null;
  const lossUnusual = lossPct !== null && (lossPct < 10 || lossPct > 20);
  const expectedOut = greenOk ? green * (1 - expectedYieldLossPct / 100) : 0;
  const extraLossKg = Math.max(0, expectedOut - (roastedOk ? roasted : 0));
  const pctTotal = splits.reduce((a, s) => a + (s.pct > 0 ? s.pct : 0), 0);

  const canSave = !!machine && greenOk && roastedOk && !saving && (!recordLoss || lossNote.trim().length > 0);

  const save = async () => {
    if (!batch || !canSave) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('mark_batch_roasted', {
        p_batch_id: batch.id,
        p_actual_output_kg: roasted,
        p_green_kg: green,
        p_machine: machine!,
        p_lot_splits: splits.filter(s => s.pct > 0).map(s => ({ lot_id: s.lot_id, pct: s.pct })),
        ...(recordLoss && extraLossKg > 0 ? { p_loss_kg: extraLossKg, p_loss_note: lossNote.trim() } : {}),
      });
      if (error) throw error;
      const result = (data ?? {}) as { ok?: boolean; batch_number?: string | null };
      if (!result.ok) {
        toast.info(`Batch was already roasted${result.batch_number ? ` (${result.batch_number})` : ''}`);
        onSaved(result.batch_number ?? null);
        onOpenChange(false);
        return;
      }
      toast.success(`Roasted ${roasted.toFixed(1)} kg — batch ${result.batch_number}`);
      onSaved(result.batch_number ?? null);
      onOpenChange(false);
      if (printLabelOnSave) {
        try {
          await printBatchLabel(batch.id);
        } catch (e) {
          toast.error(`Saved, but the label didn't print: ${(e as Error).message}. Use Reprint.`);
        }
      }
    } catch (e) {
      console.error(e);
      toast.error((e as Error).message || 'Failed to mark batch as roasted');
      setSaving(false);
    }
  };

  const bigBtn = 'h-14 flex-1 text-lg font-semibold';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-xl">Roasted: {roastGroupName}</DialogTitle>
          <DialogDescription>Check the numbers, then save and print the bin label.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Machine */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Machine</p>
            <div className="flex gap-3">
              {(['LORING', 'SAMIAC'] as Machine[]).map(m => (
                <Button
                  key={m}
                  type="button"
                  variant={machine === m ? 'default' : 'outline'}
                  className={bigBtn}
                  onClick={() => setMachine(m)}
                >
                  {m === 'LORING' ? 'Loring' : 'Samiac'}
                </Button>
              ))}
            </div>
          </div>

          {/* Weights */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2">
              <span className="text-sm font-medium">Green kg in</span>
              <Input
                type="text"
                inputMode="decimal"
                className="h-14 text-2xl font-semibold text-center"
                value={greenKg}
                onChange={(e) => setGreenKg(e.target.value)}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium">Roasted kg out</span>
              <Input
                type="text"
                inputMode="decimal"
                autoFocus
                placeholder="Required"
                className={cn('h-14 text-2xl font-semibold text-center', !roastedOk && 'border-primary')}
                value={roastedKg}
                onChange={(e) => setRoastedKg(e.target.value)}
              />
            </label>
          </div>
          {lossPct !== null && (
            <p className={cn('text-sm', lossUnusual ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted-foreground')}>
              Weight loss {lossPct.toFixed(1)}%{lossUnusual ? ' — outside the usual 10–20%. Check both weights.' : ''}
            </p>
          )}
          {lossUnusual && extraLossKg > 0.01 && (
            <div className="rounded-md border p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={recordLoss} onCheckedChange={(v) => setRecordLoss(v === true)} />
                Record {extraLossKg.toFixed(2)} kg as a loss (needs a note)
              </label>
              {recordLoss && (
                <Textarea
                  placeholder="What happened (e.g. destoner spill)"
                  value={lossNote}
                  onChange={(e) => setLossNote(e.target.value)}
                  className="min-h-[60px]"
                />
              )}
            </div>
          )}

          {/* Green lots */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Green lots</p>
            {splits.length === 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                No green lot linked to this roast group. Pick one below, or save without one.
              </p>
            ) : (
              <div className="space-y-2">
                {splits.map(s => (
                  <div key={s.lot_id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-medium truncate">{s.lot_number}</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="w-20 h-11 text-lg text-center"
                      value={String(Math.round(s.pct * 10) / 10)}
                      onChange={(e) => {
                        const v = Math.max(0, parseFloat(e.target.value) || 0);
                        setSplitsTouched(true);
                        setSplits(prev => prev.map(x => x.lot_id === s.lot_id ? { ...x, pct: v } : x));
                      }}
                      aria-label={`Percent from ${s.lot_number}`}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                    {greenOk && pctTotal > 0 && (
                      <span className="w-16 text-right text-sm text-muted-foreground tabular-nums">
                        {((green * s.pct) / pctTotal).toFixed(1)} kg
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 w-11 p-0"
                      onClick={() => { setSplitsTouched(true); setSplits(prev => prev.filter(x => x.lot_id !== s.lot_id)); }}
                      aria-label={`Remove ${s.lot_number}`}
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {addableLots.length > 0 && (
              <Select
                value=""
                onValueChange={(id) => {
                  const lot = allLots.find(l => l.id === id);
                  if (!lot) return;
                  setSplitsTouched(true);
                  setSplits(prev => [...prev, { lot_id: lot.id, lot_number: lot.lot_number, pct: prev.length === 0 ? 100 : 0 }]);
                }}
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Add a green lot…" />
                </SelectTrigger>
                <SelectContent>
                  {addableLots.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.lot_number} · {Number(l.kg_on_hand).toFixed(0)} kg
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!greenDeductionOn && (
              <p className="text-xs text-muted-foreground">
                Green deduction is off (Admin Tools), so the lots are recorded but nothing comes off stock yet.
              </p>
            )}
          </div>

          {!machine && (
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> Pick the machine.
            </p>
          )}

          <label className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={printLabelOnSave} onCheckedChange={(v) => setPrintLabelOnSave(v === true)} />
            Print the bin label when saving
          </label>

          <Button className="h-16 w-full text-xl font-bold gap-2" disabled={!canSave} onClick={save}>
            {saving ? <Loader2 className="h-6 w-6 animate-spin" /> : <Printer className="h-6 w-6" />}
            {printLabelOnSave ? 'Save &amp; print label' : 'Save without printing'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
