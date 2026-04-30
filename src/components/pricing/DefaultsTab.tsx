import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { NewProfileModal } from './NewProfileModal';

interface Profile {
  id: string;
  name: string;
  is_default: boolean;
  notes: string | null;
}

interface Rules {
  id: string;
  profile_id: string;
  carry_risk_premium_pct: number;
  green_markup_multiplier: number;
  yield_loss_pct: number;
  process_rate_per_kg: number;
  overhead_per_kg: number;
  target_margin_pct: number;
}

export function DefaultsTab() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // form state
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [carryRiskPremium, setCarryRiskPremium] = useState('8.0');
  const [greenMarkup, setGreenMarkup] = useState('1.00');
  const [yieldLoss, setYieldLoss] = useState('15.0');
  const [processRate, setProcessRate] = useState('0.00');
  const [overhead, setOverhead] = useState('0.00');
  const [targetMargin, setTargetMargin] = useState('35.0');

  // ---- queries ----
  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ['pricing_rule_profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_rule_profiles')
        .select('id, name, is_default, notes')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  // pick selected (default to is_default profile, then first)
  useEffect(() => {
    if (!profiles || profiles.length === 0) return;
    if (selectedId && profiles.some((p) => p.id === selectedId)) return;
    const def = profiles.find((p) => p.is_default) ?? profiles[0];
    setSelectedId(def.id);
  }, [profiles, selectedId]);

  const selectedProfile = useMemo(
    () => profiles?.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  const { data: rules } = useQuery({
    queryKey: ['pricing_rules', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_rules')
        .select('*')
        .eq('profile_id', selectedId!)
        .maybeSingle();
      if (error) throw error;
      return data as Rules | null;
    },
  });

  // sync form when selected profile or rules change
  useEffect(() => {
    if (!selectedProfile) return;
    setName(selectedProfile.name);
    setNotes(selectedProfile.notes ?? '');
    setIsDefault(selectedProfile.is_default);
  }, [selectedProfile]);

  useEffect(() => {
    if (!rules) return;
    setCarryRiskPremium(String(rules.carry_risk_premium_pct ?? '8.0'));
    setGreenMarkup(String(rules.green_markup_multiplier));
    setYieldLoss(String(rules.yield_loss_pct));
    setProcessRate(String(rules.process_rate_per_kg));
    setOverhead(String(rules.overhead_per_kg));
    setTargetMargin(String(rules.target_margin_pct));
  }, [rules]);

  // ---- save ----
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('No profile selected');
      const userResp = await supabase.auth.getUser();
      const userId = userResp.data.user?.id ?? null;

      // 1) update profile metadata (name, notes, is_default)
      const { error: pErr } = await supabase
        .from('pricing_rule_profiles')
        .update({
          name: name.trim(),
          notes: notes.trim() || null,
          is_default: isDefault,
        })
        .eq('id', selectedId);
      if (pErr) throw pErr;

      // 2) update rules
      const { error: rErr } = await supabase
        .from('pricing_rules')
        .update({
          carry_risk_premium_pct: Number(carryRiskPremium),
          green_markup_multiplier: Number(greenMarkup),
          yield_loss_pct: Number(yieldLoss),
          process_rate_per_kg: Number(processRate),
          overhead_per_kg: Number(overhead),
          target_margin_pct: Number(targetMargin),
          updated_by: userId,
        })
        .eq('profile_id', selectedId);
      if (rErr) throw rErr;
    },
    onSuccess: () => {
      toast.success('Saved');
      queryClient.invalidateQueries({ queryKey: ['pricing_rule_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['pricing_rules'] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to save'),
  });

  // ---- delete ----
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error('No profile selected');
      const { error } = await supabase
        .from('pricing_rule_profiles')
        .delete()
        .eq('id', selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Profile deleted');
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ['pricing_rule_profiles'] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to delete'),
  });

  const onlyOneProfile = (profiles?.length ?? 0) <= 1;
  const isDefaultProfile = selectedProfile?.is_default === true;
  const deleteDisabled = !selectedProfile || onlyOneProfile || isDefaultProfile;

  if (profilesLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label className="mb-2 block">Profile</Label>
              <Select
                value={selectedId ?? ''}
                onValueChange={(v) => setSelectedId(v)}
              >
                <SelectTrigger>
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
            <Button variant="outline" onClick={() => setNewProfileOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedProfile && (
        <>
          {/* Rules form */}
          <Card>
            <CardContent className="pt-6 space-y-5">
              <RuleField
                id="carry-risk-premium"
                label="Carry/risk premium %"
                helper="Percentage uplift applied to green book value (book value × (1 + this %)) to produce a de-risked green cost. Covers financing, carry, and risk that should not sit in book value. Used for every lot under this profile unless the lot has its own override."
                value={carryRiskPremium}
                onChange={setCarryRiskPremium}
                step="0.1"
                suffix="%"
              />
              <RuleField
                id="green-markup"
                label="Green markup multiplier"
                helper="Multiplier applied to the de-risked green cost per kg (after the carry/risk premium has been added). 1.0 = pass through, 2.0 = 100% markup."
                value={greenMarkup}
                onChange={setGreenMarkup}
                step="0.01"
              />
              <RuleField
                id="yield-loss"
                label="Yield loss %"
                helper="Expected weight lost during roasting. Used to gross up green needed per finished kg."
                value={yieldLoss}
                onChange={setYieldLoss}
                step="0.1"
                suffix="%"
              />
              <RuleField
                id="process-rate"
                label="Process rate per kg"
                helper="Fixed roast and process fee per kg of roasted output."
                value={processRate}
                onChange={setProcessRate}
                step="0.01"
                prefix="$"
              />
              <RuleField
                id="overhead"
                label="Overhead per kg"
                helper="Overhead allocation per kg of roasted output."
                value={overhead}
                onChange={setOverhead}
                step="0.01"
                prefix="$"
              />
              <RuleField
                id="target-margin"
                label="Target margin %"
                helper="Default target margin used when working backwards from a price."
                value={targetMargin}
                onChange={setTargetMargin}
                step="0.1"
                suffix="%"
              />
            </CardContent>
          </Card>

          {/* Profile metadata */}
          <Card>
            <CardContent className="pt-6 space-y-5">
              <div>
                <Label htmlFor="meta-name">Name</Label>
                <Input
                  id="meta-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="meta-notes">Notes</Label>
                <Textarea
                  id="meta-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="text-sm">Set as default profile</Label>
                  <p className="text-xs text-muted-foreground">
                    Only one profile can be the default at a time.
                  </p>
                </div>
                <Switch
                  checked={isDefault}
                  onCheckedChange={setIsDefault}
                  disabled={selectedProfile.is_default}
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={deleteDisabled}
                  title={
                    isDefaultProfile
                      ? 'Cannot delete the default profile'
                      : onlyOneProfile
                        ? 'Cannot delete the only profile'
                        : undefined
                  }
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete Profile
                </Button>
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <NewProfileModal
        open={newProfileOpen}
        onOpenChange={setNewProfileOpen}
        onCreated={(id) => setSelectedId(id)}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the profile and its rules. Any future feature
              that references it will fall back to the default profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RuleField({
  id,
  label,
  helper,
  value,
  onChange,
  step,
  prefix,
  suffix,
}: {
  id: string;
  label: string;
  helper: string;
  value: string;
  onChange: (v: string) => void;
  step: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        {prefix && (
          <span className="text-sm text-muted-foreground">{prefix}</span>
        )}
        <Input
          id={id}
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-[200px]"
        />
        {suffix && (
          <span className="text-sm text-muted-foreground">{suffix}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{helper}</p>
    </div>
  );
}
