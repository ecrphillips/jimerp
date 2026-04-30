import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

export type AdjustmentType = 'MULTIPLIER' | 'PER_KG_FEE' | 'MARGIN_TARGET';

export interface TierRow {
  id: string;
  name: string;
  profile_id: string;
  markup_adjustment_type: AdjustmentType;
  markup_multiplier: number | null;
  per_kg_fee: number | null;
  target_margin_pct: number | null;
  is_default: boolean;
  display_order: number;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tier: TierRow | null; // null => create mode
  /** Used when creating a tier: next display_order to assign. */
  nextDisplayOrder?: number;
  /** Total tier count, used to determine if this is the only tier. */
  tierCount?: number;
}

export function TierFormModal({ open, onOpenChange, tier, nextDisplayOrder = 1 }: Props) {
  const queryClient = useQueryClient();
  const isEdit = !!tier;

  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('MULTIPLIER');
  const [multiplier, setMultiplier] = useState('1.00');
  const [perKgFee, setPerKgFee] = useState('0.00');
  const [marginPct, setMarginPct] = useState('35.0');
  const [isDefault, setIsDefault] = useState(false);
  const [notes, setNotes] = useState('');

  const { data: profiles } = useQuery({
    queryKey: ['pricing_rule_profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_rule_profiles')
        .select('id, name, is_default')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  // Reset form on open / tier change
  useEffect(() => {
    if (!open) return;
    if (tier) {
      setName(tier.name);
      setProfileId(tier.profile_id);
      setAdjustmentType(tier.markup_adjustment_type);
      setMultiplier(tier.markup_multiplier != null ? String(tier.markup_multiplier) : '1.00');
      setPerKgFee(tier.per_kg_fee != null ? String(tier.per_kg_fee) : '0.00');
      setMarginPct(tier.target_margin_pct != null ? String(tier.target_margin_pct) : '35.0');
      setIsDefault(tier.is_default);
      setNotes(tier.notes ?? '');
    } else {
      setName('');
      setProfileId(profiles?.find((p) => p.is_default)?.id ?? profiles?.[0]?.id ?? '');
      setAdjustmentType('MULTIPLIER');
      setMultiplier('1.00');
      setPerKgFee('0.00');
      setMarginPct('35.0');
      setIsDefault(false);
      setNotes('');
    }
  }, [open, tier, profiles]);

  // Default-pick a profile in create mode once profiles load
  useEffect(() => {
    if (!open || tier) return;
    if (!profileId && profiles && profiles.length > 0) {
      setProfileId(profiles.find((p) => p.is_default)?.id ?? profiles[0].id);
    }
  }, [profiles, open, tier, profileId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name is required');
      if (!profileId) throw new Error('Profile is required');

      // Validate the right value field is present
      if (adjustmentType === 'MULTIPLIER' && (!multiplier.trim() || isNaN(Number(multiplier)))) {
        throw new Error('Multiplier value is required');
      }
      if (adjustmentType === 'PER_KG_FEE' && (!perKgFee.trim() || isNaN(Number(perKgFee)))) {
        throw new Error('Per-kg fee value is required');
      }
      if (adjustmentType === 'MARGIN_TARGET' && (!marginPct.trim() || isNaN(Number(marginPct)))) {
        throw new Error('Margin target value is required');
      }

      const payload = {
        name: trimmed,
        profile_id: profileId,
        markup_adjustment_type: adjustmentType,
        markup_multiplier: adjustmentType === 'MULTIPLIER' ? Number(multiplier) : null,
        per_kg_fee: adjustmentType === 'PER_KG_FEE' ? Number(perKgFee) : null,
        target_margin_pct: adjustmentType === 'MARGIN_TARGET' ? Number(marginPct) : null,
        is_default: isDefault,
        notes: notes.trim() || null,
      };

      if (isEdit && tier) {
        const { error } = await supabase
          .from('pricing_tiers')
          .update(payload)
          .eq('id', tier.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('pricing_tiers')
          .insert({ ...payload, display_order: nextDisplayOrder });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Tier updated' : 'Tier created');
      queryClient.invalidateQueries({ queryKey: ['pricing_tiers'] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      const msg = String(err?.message ?? '');
      if (msg.includes('pricing_tiers_name_key') || msg.toLowerCase().includes('duplicate')) {
        toast.error('A tier with that name already exists');
      } else {
        toast.error(msg || 'Failed to save tier');
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Tier' : 'New Tier'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="tier-name">Name</Label>
            <Input
              id="tier-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Wholesale 1"
            />
          </div>

          <div>
            <Label htmlFor="tier-profile">Profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="tier-profile">
                <SelectValue placeholder="Select profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.is_default ? '  •  default' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Markup approach</Label>
            <RadioGroup
              value={adjustmentType}
              onValueChange={(v) => setAdjustmentType(v as AdjustmentType)}
              className="space-y-3"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="MULTIPLIER" id="adj-mult" />
                  <Label htmlFor="adj-mult" className="font-normal">Multiplier</Label>
                </div>
                {adjustmentType === 'MULTIPLIER' && (
                  <div className="ml-6">
                    <Input
                      type="number"
                      step="0.01"
                      value={multiplier}
                      onChange={(e) => setMultiplier(e.target.value)}
                      className="max-w-[160px]"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Multiplier applied to the profile's calculated price. 1.0 = no adjustment, 0.85 = 15% discount, 1.10 = 10% premium.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="PER_KG_FEE" id="adj-fee" />
                  <Label htmlFor="adj-fee" className="font-normal">Per-kg fee</Label>
                </div>
                {adjustmentType === 'PER_KG_FEE' && (
                  <div className="ml-6">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={perKgFee}
                        onChange={(e) => setPerKgFee(e.target.value)}
                        className="max-w-[160px]"
                      />
                      <span className="text-sm text-muted-foreground">/kg</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Fixed CAD per kg added on top of the profile's calculated cost. Useful for bulk pricing where the markup is a flat roast fee.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="MARGIN_TARGET" id="adj-margin" />
                  <Label htmlFor="adj-margin" className="font-normal">Margin target</Label>
                </div>
                {adjustmentType === 'MARGIN_TARGET' && (
                  <div className="ml-6">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.1"
                        value={marginPct}
                        onChange={(e) => setMarginPct(e.target.value)}
                        className="max-w-[160px]"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Overrides the profile's target margin for this tier. Used by the margin-target reverse-calc approach.
                    </p>
                  </div>
                )}
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm">Set as default tier</Label>
              <p className="text-xs text-muted-foreground">
                Only one tier can be the default at a time.
              </p>
            </div>
            <Switch
              checked={isDefault}
              onCheckedChange={setIsDefault}
              disabled={tier?.is_default === true}
            />
          </div>

          <div>
            <Label htmlFor="tier-notes">Notes (optional)</Label>
            <Textarea
              id="tier-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !name.trim() || !profileId}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
