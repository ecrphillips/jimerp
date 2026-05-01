import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type TierProfileValue = {
  tier_id_override: string | null;
  profile_id_override: string | null;
};

interface TierProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: TierProfileValue;
  onSave: (v: TierProfileValue) => void;
}

const NONE = '__none__';

export function TierProfileModal({ open, onOpenChange, initial, onSave }: TierProfileModalProps) {
  const [tierId, setTierId] = useState<string>(initial.tier_id_override ?? NONE);
  const [profileId, setProfileId] = useState<string>(initial.profile_id_override ?? NONE);

  useEffect(() => {
    if (!open) return;
    setTierId(initial.tier_id_override ?? NONE);
    setProfileId(initial.profile_id_override ?? NONE);
  }, [open, initial]);

  const { data: tiers } = useQuery({
    queryKey: ['quote-tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_tiers')
        .select('id, name, is_default')
        .order('display_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ['quote-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_rule_profiles')
        .select('id, name, is_default')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleSave = () => {
    onSave({
      tier_id_override: tierId === NONE ? null : tierId,
      profile_id_override: profileId === NONE ? null : profileId,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tier &amp; Profile overrides</DialogTitle>
          <DialogDescription>
            Per-line override of pricing tier and/or rule profile. Leave blank to inherit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Pricing tier</Label>
            <Select value={tierId} onValueChange={setTierId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Inherit from account / default —</SelectItem>
                {tiers?.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{t.is_default ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rule profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Inherit from tier / default —</SelectItem>
                {profiles?.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{p.is_default ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
