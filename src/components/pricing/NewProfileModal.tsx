import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (newProfileId: string) => void;
}

export function NewProfileModal({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name is required');

      // 1) Insert profile
      const { data: profile, error: pErr } = await supabase
        .from('pricing_rule_profiles')
        .insert({ name: trimmed, notes: notes.trim() || null, is_default: false })
        .select('id')
        .single();
      if (pErr) throw pErr;

      // 2) Insert paired pricing_rules with defaults
      const { error: rErr } = await supabase
        .from('pricing_rules')
        .insert({ profile_id: profile.id });
      if (rErr) throw rErr;

      return profile.id as string;
    },
    onSuccess: (newId) => {
      queryClient.invalidateQueries({ queryKey: ['pricing_rule_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['pricing_rules'] });
      toast.success('Profile created');
      setName('');
      setNotes('');
      onOpenChange(false);
      onCreated(newId);
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to create profile');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Pricing Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Premium Origins"
            />
          </div>
          <div>
            <Label htmlFor="profile-notes">Notes (optional)</Label>
            <Textarea
              id="profile-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Profile'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
