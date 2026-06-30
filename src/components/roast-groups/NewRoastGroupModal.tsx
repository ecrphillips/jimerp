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
import { OriginSelect } from '@/components/products/OriginSelect';
import { ORIGIN_CUSTOM_SENTINEL } from '@/lib/originOptions';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewRoastGroupModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState('');
  const [groupType, setGroupType] = useState<'single' | 'blend' | 'generic'>('single');
  const [blendType, setBlendType] = useState<string | null>(null);
  const isBlend = groupType === 'blend';
  const isGeneric = groupType === 'generic';
  const [origin, setOrigin] = useState('');
  const [originCustom, setOriginCustom] = useState('');
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
    setGroupType('single');
    setBlendType(null);
    setOrigin('');
    setOriginCustom('');
    setIsSeasonal(false);
    setDefaultRoaster('EITHER');
    setBatchKg(20);
    setYieldLoss(16);
    setCropsterRef('');
    setNotes('');
  };

  const effectiveOrigin = origin === ORIGIN_CUSTOM_SENTINEL ? originCustom.trim() : origin;

  const handleSave = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) { toast.error('Display name is required'); return; }
    if (groupType === 'single' && !effectiveOrigin) {
      toast.error('Origin is required for single-origin roast groups');
      return;
    }

    setSaving(true);
    try {
      const result = await createOrReuseRoastGroup({
        displayName: trimmed,
        isBlend,
        isGeneric,
        origin: groupType === 'single' ? effectiveOrigin || null : null,
        cropsterProfileRef: cropsterRef || null,
        notes: notes || null,
      });

      if (result.error) { toast.error(result.error); return; }

      // Update extra fields not handled by createOrReuseRoastGroup
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
              value={groupType}
              onValueChange={v => { setGroupType(v as 'single' | 'blend' | 'generic'); if (v !== 'blend') setBlendType(null); }}
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
              <div className="flex items-center gap-2">
                <RadioGroupItem value="generic" id="rg-generic" />
                <Label htmlFor="rg-generic" className="font-normal cursor-pointer">Generic</Label>
              </div>
            </RadioGroup>
            {isGeneric && (
              <p className="text-xs text-muted-foreground mt-1">Placeholder product with no fixed origin (e.g. monthly subscription coffees). Not a blend; uses "GEN" in the SKU.</p>
            )}
          </div>

          {/* Blend Type (blends only) */}
          {isBlend && (
            <div>
              <Label>Blend Type</Label>
              <RadioGroup
                value={blendType ?? ''}
                onValueChange={setBlendType}
                className="mt-1 space-y-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="PRE_ROAST" id="rg-pre" />
                    <Label htmlFor="rg-pre" className="font-normal cursor-pointer">Pre-roast</Label>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">Green lots are scooped and charged together. One roast batch, one WIP pool.</p>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="POST_ROAST" id="rg-post" />
                    <Label htmlFor="rg-post" className="font-normal cursor-pointer">Post-roast</Label>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">Separate roast groups are blended after roasting. Each component is roasted independently.</p>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Origin (single origin only) */}
          {groupType === 'single' && (
            <div>
              <Label>Origin Country *</Label>
              <OriginSelect
                value={origin}
                customValue={originCustom}
                onChange={({ value, customValue }) => {
                  setOrigin(value);
                  setOriginCustom(customValue);
                }}
              />
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
            <Button onClick={handleSave} disabled={saving || !displayName.trim() || (groupType === 'single' && !effectiveOrigin)}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
