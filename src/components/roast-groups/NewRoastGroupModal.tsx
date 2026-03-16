import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { createOrReuseRoastGroup } from '@/lib/roastGroupCreation';
import { RoastGroupPreview } from '@/components/products/RoastGroupPreview';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewRoastGroupModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState('');
  const [isBlend, setIsBlend] = useState(false);
  const [blendType, setBlendType] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [isSeasonal, setIsSeasonal] = useState(false);
  const [defaultRoaster, setDefaultRoaster] = useState<string>('EITHER');
  const [batchKg, setBatchKg] = useState(20);
  const [yieldLoss, setYieldLoss] = useState(16);
  const [cropsterRef, setCropsterRef] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch existing keys/codes for preview
  const { data: existingData } = useQuery({
    queryKey: ['roast-group-keys'],
    queryFn: async () => {
      const { data } = await supabase
        .from('roast_groups')
        .select('roast_group, roast_group_code');
      const keys = new Set<string>();
      const codes = new Set<string>();
      (data ?? []).forEach((r: any) => {
        keys.add(r.roast_group);
        if (r.roast_group_code) codes.add(r.roast_group_code.toUpperCase());
      });
      return { keys, codes };
    },
    enabled: open,
  });

  const reset = () => {
    setDisplayName('');
    setIsBlend(false);
    setBlendType(null);
    setOrigin('');
    setIsSeasonal(false);
    setDefaultRoaster('EITHER');
    setBatchKg(20);
    setYieldLoss(16);
    setCropsterRef('');
    setNotes('');
  };

  const handleSave = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) { toast.error('Display name is required'); return; }

    setSaving(true);
    try {
      const result = await createOrReuseRoastGroup({
        displayName: trimmed,
        isBlend,
        origin: isBlend ? null : origin || null,
        cropsterProfileRef: cropsterRef || null,
        notes: notes || null,
      });

      if (result.error) { toast.error(result.error); return; }

      // Update extra fields not handled by createOrReuseRoastGroup
      if (result.created) {
        await supabase
          .from('roast_groups')
          .update({
            is_seasonal: isSeasonal,
            default_roaster: defaultRoaster as any,
            standard_batch_kg: batchKg,
            expected_yield_loss_pct: yieldLoss,
            blend_type: isBlend ? blendType : null,
          })
          .eq('roast_group', result.roastGroupKey);
      }

      toast.success(result.created ? 'Roast group created' : 'Existing roast group reused');
      queryClient.invalidateQueries({ queryKey: ['roast-groups-list'] });
      onOpenChange(false);
      reset();
      navigate(`/roast-groups/${encodeURIComponent(result.roastGroupKey)}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create roast group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Roast Group</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Display name */}
          <div>
            <Label>Display Name</Label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Guatemala Huehuetenango" />
            {existingData && displayName.trim() && (
              <RoastGroupPreview
                displayName={displayName}
                existingKeys={existingData.keys}
                existingCodes={existingData.codes}
              />
            )}
          </div>

          {/* Type */}
          <div>
            <Label>Type</Label>
            <RadioGroup
              value={isBlend ? 'blend' : 'single'}
              onValueChange={v => setIsBlend(v === 'blend')}
              className="flex gap-4 mt-1"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="single" id="rg-single" />
                <Label htmlFor="rg-single" className="font-normal cursor-pointer">Single Origin</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="blend" id="rg-blend" />
                <Label htmlFor="rg-blend" className="font-normal cursor-pointer">Blend</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Origin (single origin only) */}
          {!isBlend && (
            <div>
              <Label>Origin Country</Label>
              <Input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="e.g. Guatemala" />
            </div>
          )}

          {/* Lifecycle */}
          <div>
            <Label>Lifecycle</Label>
            <RadioGroup
              value={isSeasonal ? 'seasonal' : 'perennial'}
              onValueChange={v => setIsSeasonal(v === 'seasonal')}
              className="flex gap-4 mt-1"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="perennial" id="rg-perennial" />
                <Label htmlFor="rg-perennial" className="font-normal cursor-pointer">Perennial</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="seasonal" id="rg-seasonal" />
                <Label htmlFor="rg-seasonal" className="font-normal cursor-pointer">Seasonal</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Default roaster */}
          <div>
            <Label>Default Roaster</Label>
            <Select value={defaultRoaster} onValueChange={setDefaultRoaster}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EITHER">Either</SelectItem>
                <SelectItem value="SAMIAC">Samiac</SelectItem>
                <SelectItem value="LORING">Loring</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Batch & yield */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Standard Batch (kg)</Label>
              <Input type="number" value={batchKg} onChange={e => setBatchKg(Number(e.target.value))} min={1} />
            </div>
            <div>
              <Label>Yield Loss (%)</Label>
              <Input type="number" value={yieldLoss} onChange={e => setYieldLoss(Number(e.target.value))} min={0} max={50} step={0.5} />
            </div>
          </div>

          {/* Cropster */}
          <div>
            <Label>Cropster Profile Ref (optional)</Label>
            <Input value={cropsterRef} onChange={e => setCropsterRef(e.target.value)} placeholder="Profile ID" />
          </div>

          {/* Notes */}
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !displayName.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
