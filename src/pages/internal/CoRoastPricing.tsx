import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Pencil, Save, X, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney } from '@/lib/formatMoney';
import { format } from 'date-fns';

const SETTINGS_KEY = 'coroast_tier_rates';

interface TierRates {
  base: number;
  includedHours: number;
  overageRate: number;
  includedPallets: number;
  storageRate: number;
}

type AllTierRates = Record<string, TierRates>;

const DEFAULT_RATES: AllTierRates = {
  MEMBER: { base: 399, includedHours: 3, overageRate: 160, includedPallets: 0, storageRate: 175 },
  GROWTH: { base: 859, includedHours: 7, overageRate: 145, includedPallets: 1, storageRate: 175 },
  PRODUCTION: { base: 1399, includedHours: 12, overageRate: 130, includedPallets: 2, storageRate: 175 },
};

const TIER_LABELS: Record<string, string> = {
  MEMBER: 'Member',
  GROWTH: 'Growth',
  PRODUCTION: 'Production',
};

const TIER_COLORS: Record<string, string> = {
  MEMBER: 'border-blue-500 text-blue-600',
  GROWTH: 'border-amber-500 text-amber-600',
  PRODUCTION: 'border-green-500 text-green-600',
};

export default function CoRoastPricing() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: settingsRow, isLoading } = useQuery({
    queryKey: ['app-settings', SETTINGS_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('*')
        .eq('key', SETTINGS_KEY)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Fetch updater profile name
  const { data: updaterProfile } = useQuery({
    queryKey: ['settings-updater', settingsRow?.updated_by],
    queryFn: async () => {
      if (!settingsRow?.updated_by) return null;
      const { data } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', settingsRow.updated_by)
        .maybeSingle();
      return data;
    },
    enabled: !!settingsRow?.updated_by,
  });

  const currentRates: AllTierRates = settingsRow?.value_json
    ? { ...DEFAULT_RATES, ...(settingsRow.value_json as unknown as AllTierRates) }
    : DEFAULT_RATES;

  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TierRates>({ base: 0, includedHours: 0, overageRate: 0, includedPallets: 0, storageRate: 0 });

  const startEdit = (tier: string) => {
    setEditForm({ ...currentRates[tier] });
    setEditingTier(tier);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editingTier) return;
      const updated = { ...currentRates, [editingTier]: editForm };

      if (settingsRow) {
        const { error } = await supabase
          .from('app_settings')
          .update({
            value_json: updated as any,
            updated_at: new Date().toISOString(),
            updated_by: authUser?.id ?? null,
          })
          .eq('key', SETTINGS_KEY);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('app_settings')
          .insert({
            key: SETTINGS_KEY,
            value_json: updated as any,
            updated_by: authUser?.id ?? null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings', SETTINGS_KEY] });
      toast.success(`${TIER_LABELS[editingTier!]} rates updated`);
      setEditingTier(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Co-Roasting Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Manage global tier rates for co-roasting billing periods.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading rates…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {['MEMBER', 'GROWTH', 'PRODUCTION'].map((tier) => {
            const rates = currentRates[tier];
            const isEditing = editingTier === tier;

            return (
              <Card key={tier}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={TIER_COLORS[tier]}>
                      {TIER_LABELS[tier]}
                    </Badge>
                    {!isEditing && authUser?.role === 'ADMIN' && (
                      <Button variant="ghost" size="sm" onClick={() => startEdit(tier)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isEditing ? (
                    <>
                      <div>
                        <Label className="text-xs">Base Fee ($/month)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.base}
                          onChange={(e) => setEditForm({ ...editForm, base: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Included Hours</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={editForm.includedHours}
                          onChange={(e) => setEditForm({ ...editForm, includedHours: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Overage Rate ($/hr)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.overageRate}
                          onChange={(e) => setEditForm({ ...editForm, overageRate: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Included Pallets</Label>
                        <Input
                          type="number"
                          step="1"
                          value={editForm.includedPallets}
                          onChange={(e) => setEditForm({ ...editForm, includedPallets: Number(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Storage Rate ($/pallet/month)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.storageRate}
                          onChange={(e) => setEditForm({ ...editForm, storageRate: Number(e.target.value) })}
                        />
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                          <Save className="h-3.5 w-3.5 mr-1" /> {saveMutation.isPending ? 'Saving…' : 'Save'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingTier(null)}>
                          <X className="h-3.5 w-3.5 mr-1" /> Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Base fee</span>
                        <span className="font-medium">${rates.base.toLocaleString()}/mo</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Included hours</span>
                        <span className="font-medium">{rates.includedHours} hrs</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Overage rate</span>
                        <span className="font-medium">${rates.overageRate}/hr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Included pallets</span>
                        <span className="font-medium">{rates.includedPallets}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Storage rate</span>
                        <span className="font-medium">${rates.storageRate}/pallet/mo</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {settingsRow?.updated_at && (
        <p className="text-xs text-muted-foreground">
          Last updated: {format(new Date(settingsRow.updated_at), 'PPp')}
          {updaterProfile?.name ? ` by ${updaterProfile.name}` : ''}
        </p>
      )}

      <Card className="border-muted">
        <CardContent className="py-4 flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Changes to global rates only affect <strong>new</strong> billing periods created after the change.
            Existing billing periods retain the rates they were created with.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
