import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { TierFormModal, type TierRow } from './TierFormModal';

interface TierWithProfile extends TierRow {
  pricing_rule_profiles: { id: string; name: string } | null;
}

export function TiersTab() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<TierRow | null>(null);
  const [deletingTier, setDeletingTier] = useState<TierRow | null>(null);

  const { data: tiers, isLoading } = useQuery({
    queryKey: ['pricing_tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_tiers')
        .select('*, pricing_rule_profiles(id, name)')
        .order('display_order');
      if (error) throw error;
      return (data ?? []) as TierWithProfile[];
    },
  });

  const nextDisplayOrder = useMemo(() => {
    if (!tiers || tiers.length === 0) return 1;
    return Math.max(...tiers.map((t) => t.display_order)) + 1;
  }, [tiers]);

  const reorderMutation = useMutation({
    mutationFn: async (updates: { id: string; display_order: number }[]) => {
      for (const u of updates) {
        const { error } = await supabase
          .from('pricing_tiers')
          .update({ display_order: u.display_order })
          .eq('id', u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pricing_tiers'] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to reorder'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pricing_tiers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Tier deleted');
      setDeletingTier(null);
      queryClient.invalidateQueries({ queryKey: ['pricing_tiers'] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to delete tier'),
  });

  const handleMove = (idx: number, dir: -1 | 1) => {
    if (!tiers) return;
    const target = idx + dir;
    if (target < 0 || target >= tiers.length) return;
    const a = tiers[idx];
    const b = tiers[target];
    reorderMutation.mutate([
      { id: a.id, display_order: b.display_order },
      { id: b.id, display_order: a.display_order },
    ]);
  };

  const onlyOneTier = (tiers?.length ?? 0) <= 1;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pricing Tiers</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Tiers map clients to a pricing profile and a markup approach. The default tier is applied to any account without an explicit assignment.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingTier(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> New Tier
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {tiers && tiers.length > 0 ? (
            <ul className="divide-y">
              {tiers.map((tier, idx) => {
                const profileName = tier.pricing_rule_profiles?.name ?? '—';
                return (
                  <li
                    key={tier.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleMove(idx, -1)}
                        disabled={idx === 0 || reorderMutation.isPending}
                        aria-label="Move up"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleMove(idx, 1)}
                        disabled={idx === tiers.length - 1 || reorderMutation.isPending}
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{tier.name}</span>
                        {tier.is_default && (
                          <Badge variant="secondary" className="text-[10px]">Default</Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {formatMarkup(tier)}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Profile:{' '}
                        <Link
                          to="/accounts/pricing"
                          className="underline hover:text-foreground"
                          title="Open Defaults tab"
                        >
                          {profileName}
                        </Link>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingTier(tier);
                          setFormOpen(true);
                        }}
                        aria-label="Edit tier"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeletingTier(tier)}
                        disabled={tier.is_default || onlyOneTier}
                        title={
                          tier.is_default
                            ? 'Cannot delete the default tier'
                            : onlyOneTier
                              ? 'Cannot delete the only tier'
                              : undefined
                        }
                        aria-label="Delete tier"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No tiers yet. Click "New Tier" to get started.
            </div>
          )}
        </CardContent>
      </Card>

      <TierFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        tier={editingTier}
        nextDisplayOrder={nextDisplayOrder}
        tierCount={tiers?.length ?? 0}
      />

      <AlertDialog
        open={!!deletingTier}
        onOpenChange={(open) => !open && setDeletingTier(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this tier?</AlertDialogTitle>
            <AlertDialogDescription>
              Any accounts currently assigned to this tier will revert to the default tier on their next price calculation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingTier && deleteMutation.mutate(deletingTier.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function formatMarkup(tier: TierRow): string {
  switch (tier.markup_adjustment_type) {
    case 'MULTIPLIER':
      return `× ${(tier.markup_multiplier ?? 0).toFixed(2)} (Multiplier)`;
    case 'PER_KG_FEE': {
      const v = tier.per_kg_fee ?? 0;
      const sign = v >= 0 ? '+' : '−';
      return `${sign}$${Math.abs(v).toFixed(2)}/kg (Per-kg fee)`;
    }
    case 'MARGIN_TARGET':
      return `Target ${(tier.target_margin_pct ?? 0).toFixed(1)}% (Margin)`;
    default:
      return '—';
  }
}
