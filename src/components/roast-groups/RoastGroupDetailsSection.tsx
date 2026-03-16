import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Props {
  roastGroupKey: string;
  initialData: any;
}

export function RoastGroupDetailsSection({ roastGroupKey, initialData }: Props) {
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState(initialData.display_name || '');
  const [isBlend, setIsBlend] = useState(initialData.is_blend);
  const [origin, setOrigin] = useState(initialData.origin || '');
  const [isSeasonal, setIsSeasonal] = useState(initialData.is_seasonal ?? false);
  const [blendType, setBlendType] = useState(initialData.blend_type || null);
  const [defaultRoaster, setDefaultRoaster] = useState(initialData.default_roaster || 'EITHER');
  const [batchKg, setBatchKg] = useState(initialData.standard_batch_kg ?? 20);
  const [yieldLoss, setYieldLoss] = useState(initialData.expected_yield_loss_pct ?? 16);
  const [cropsterRef, setCropsterRef] = useState(initialData.cropster_profile_ref || '');
  const [notes, setNotes] = useState(initialData.notes || '');
  const [isActive, setIsActive] = useState(initialData.is_active);

  useEffect(() => {
    setDisplayName(initialData.display_name || '');
    setIsBlend(initialData.is_blend);
    setOrigin(initialData.origin || '');
    setIsSeasonal(initialData.is_seasonal ?? false);
    setBlendType(initialData.blend_type || null);
    setDefaultRoaster(initialData.default_roaster || 'EITHER');
    setBatchKg(initialData.standard_batch_kg ?? 20);
    setYieldLoss(initialData.expected_yield_loss_pct ?? 16);
    setCropsterRef(initialData.cropster_profile_ref || '');
    setNotes(initialData.notes || '');
    setIsActive(initialData.is_active);
  }, [initialData]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('roast_groups')
        .update({
          display_name: displayName.trim(),
          is_blend: isBlend,
          origin: isBlend ? null : origin || null,
          is_seasonal: isSeasonal,
          default_roaster: defaultRoaster as any,
          standard_batch_kg: batchKg,
          expected_yield_loss_pct: yieldLoss,
          cropster_profile_ref: cropsterRef || null,
          notes: notes || null,
          is_active: isActive,
        })
        .eq('roast_group', roastGroupKey);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Roast group updated');
      queryClient.invalidateQueries({ queryKey: ['roast-group-detail', roastGroupKey] });
      queryClient.invalidateQueries({ queryKey: ['roast-groups-list'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update'),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Display Name</Label>
          <Input value={displayName} onChange={e => setDisplayName(e.target.value)} />
        </div>

        <div>
          <Label>Type</Label>
          <RadioGroup value={isBlend ? 'blend' : 'single'} onValueChange={v => setIsBlend(v === 'blend')} className="flex gap-4 mt-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="single" id="det-single" />
              <Label htmlFor="det-single" className="font-normal cursor-pointer">Single Origin</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="blend" id="det-blend" />
              <Label htmlFor="det-blend" className="font-normal cursor-pointer">Blend</Label>
            </div>
          </RadioGroup>
        </div>

        {!isBlend && (
          <div>
            <Label>Origin</Label>
            <Input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="e.g. Guatemala" />
          </div>
        )}

        <div>
          <Label>Lifecycle</Label>
          <RadioGroup value={isSeasonal ? 'seasonal' : 'perennial'} onValueChange={v => setIsSeasonal(v === 'seasonal')} className="flex gap-4 mt-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="perennial" id="det-perennial" />
              <Label htmlFor="det-perennial" className="font-normal cursor-pointer">Perennial</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="seasonal" id="det-seasonal" />
              <Label htmlFor="det-seasonal" className="font-normal cursor-pointer">Seasonal</Label>
            </div>
          </RadioGroup>
        </div>

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

        <div>
          <Label>Cropster Profile Ref</Label>
          <Input value={cropsterRef} onChange={e => setCropsterRef(e.target.value)} placeholder="Optional" />
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={isActive} onCheckedChange={setIsActive} id="det-active" />
          <Label htmlFor="det-active" className="font-normal cursor-pointer">{isActive ? 'Active' : 'Inactive'}</Label>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !displayName.trim()}>
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
