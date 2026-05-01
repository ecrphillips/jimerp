import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { lotLeadLabel } from '@/components/quotes/lotLabel';
import { useGreenLotsForPicker } from '@/hooks/useGreenLotsForPicker';
import { formatPerKg } from '@/lib/formatMoney';

export type GreenSourceValue =
  | { mode: 'single'; lot_id: string }
  | { mode: 'blend'; blend: Array<{ lot_id: string; ratio_pct: number }> };

interface GreenSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: GreenSourceValue | null;
  onSave: (v: GreenSourceValue) => void;
}

export function GreenSourceModal({ open, onOpenChange, initial, onSave }: GreenSourceModalProps) {
  const { data: lots } = useGreenLotsForPicker();

  const [mode, setMode] = useState<'single' | 'blend'>(initial?.mode ?? 'single');
  const [singleLotId, setSingleLotId] = useState<string>(
    initial?.mode === 'single' ? initial.lot_id : '',
  );
  const [blend, setBlend] = useState<Array<{ lot_id: string; ratio_pct: number }>>(
    initial?.mode === 'blend' && initial.blend.length >= 2
      ? initial.blend
      : [
          { lot_id: '', ratio_pct: 50 },
          { lot_id: '', ratio_pct: 50 },
        ],
  );

  useEffect(() => {
    if (!open) return;
    setMode(initial?.mode ?? 'single');
    setSingleLotId(initial?.mode === 'single' ? initial.lot_id : '');
    setBlend(
      initial?.mode === 'blend' && initial.blend.length >= 2
        ? initial.blend
        : [
            { lot_id: '', ratio_pct: 50 },
            { lot_id: '', ratio_pct: 50 },
          ],
    );
  }, [open, initial]);

  const blendSum = useMemo(
    () => blend.reduce((a, b) => a + (Number(b.ratio_pct) || 0), 0),
    [blend],
  );

  const valid =
    mode === 'single'
      ? !!singleLotId
      : blend.length >= 2 &&
        blend.every((b) => !!b.lot_id) &&
        Math.abs(blendSum - 100) < 0.001;

  const handleSave = () => {
    if (!valid) return;
    if (mode === 'single') {
      onSave({ mode: 'single', lot_id: singleLotId });
    } else {
      onSave({
        mode: 'blend',
        blend: blend.map((b) => ({ lot_id: b.lot_id, ratio_pct: Number(b.ratio_pct) })),
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Green source</DialogTitle>
          <DialogDescription>Pick a single lot or build a theoretical blend.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'single' | 'blend')} className="flex gap-6">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="single" id="gs-single" />
              <Label htmlFor="gs-single" className="font-normal cursor-pointer">Single lot</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="blend" id="gs-blend" />
              <Label htmlFor="gs-blend" className="font-normal cursor-pointer">Theoretical blend</Label>
            </div>
          </RadioGroup>

          {mode === 'single' ? (
            <Select value={singleLotId} onValueChange={setSingleLotId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a green lot" />
              </SelectTrigger>
              <SelectContent>
                {lots?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{lotLeadLabel(l)}</span>
                      <span className="text-muted-foreground text-xs">· {l.lot_number}</span>
                      <span className="text-muted-foreground text-xs">
                        · book {l.book_value_per_kg != null ? formatPerKg(Number(l.book_value_per_kg)) : 'n/a'}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="space-y-2">
              {blend.map((row, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <div className="flex-1">
                    <Select
                      value={row.lot_id}
                      onValueChange={(v) =>
                        setBlend((b) => b.map((r, i) => (i === idx ? { ...r, lot_id: v } : r)))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select lot" />
                      </SelectTrigger>
                      <SelectContent>
                        {lots?.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            <span className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{lotLeadLabel(l)}</span>
                              <span className="text-muted-foreground text-xs">· {l.lot_number}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    className="w-24"
                    value={row.ratio_pct}
                    onChange={(e) =>
                      setBlend((b) =>
                        b.map((r, i) => (i === idx ? { ...r, ratio_pct: Number(e.target.value) } : r)),
                      )
                    }
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setBlend((b) => (b.length <= 2 ? b : b.filter((_, i) => i !== idx)))}
                    disabled={blend.length <= 2}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex justify-between items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBlend((b) => [...b, { lot_id: '', ratio_pct: 0 }])}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add component
                </Button>
                <span
                  className={`text-sm font-mono ${
                    Math.abs(blendSum - 100) < 0.001
                      ? 'text-muted-foreground'
                      : 'text-destructive font-semibold'
                  }`}
                >
                  Sum: {blendSum.toFixed(2)}%
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!valid}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
