import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { getDisplayName } from '@/lib/roastGroupUtils';
import { cn } from '@/lib/utils';
import { RoastGroupDetailsSection } from '@/components/roast-groups/RoastGroupDetailsSection';
import { BlendCompositionSection } from '@/components/roast-groups/BlendCompositionSection';
import { GreenLotMappingSection } from '@/components/roast-groups/GreenLotMappingSection';
import { ProductsFamilyTreeSection } from '@/components/roast-groups/ProductsFamilyTreeSection';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function RoastGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: rg, isLoading } = useQuery({
    queryKey: ['roast-group-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('*')
        .eq('roast_group', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Preflight impact check
  const { data: impact, isLoading: impactLoading } = useQuery({
    queryKey: ['roast-group-delete-impact', id],
    queryFn: async () => {
      // Products count
      const { count: productCount } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('roast_group', id!);

      // Active orders referencing these products
      let activeOrderCount = 0;
      if ((productCount ?? 0) > 0) {
        const { data: productIds } = await supabase
          .from('products')
          .select('id')
          .eq('roast_group', id!);
        if (productIds && productIds.length > 0) {
          const pIds = productIds.map(p => p.id);
          const { data: lineItems } = await supabase
            .from('order_line_items')
            .select('order_id, orders!inner(status)')
            .in('product_id', pIds);
          if (lineItems) {
            const activeOrderIds = new Set(
              lineItems
                .filter((li: any) => !['SHIPPED', 'CANCELLED'].includes(li.orders?.status))
                .map((li: any) => li.order_id)
            );
            activeOrderCount = activeOrderIds.size;
          }
        }
      }

      // WIP inventory
      let wipKg = 0;
      const { data: inv } = await supabase
        .from('roast_group_inventory_levels')
        .select('wip_kg')
        .eq('roast_group', id!)
        .maybeSingle();
      if (inv) wipKg = Number(inv.wip_kg) || 0;

      return { productCount: productCount ?? 0, activeOrderCount, wipKg };
    },
    enabled: deleteOpen && !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Unlink products first
      const { error: unlinkErr } = await supabase
        .from('products')
        .update({ roast_group: null })
        .eq('roast_group', id!);
      if (unlinkErr) throw unlinkErr;

      // Delete roast group (cascades components, inventory levels)
      const { error: delErr } = await supabase
        .from('roast_groups')
        .delete()
        .eq('roast_group', id!);
      if (delErr) throw delErr;
    },
    onSuccess: () => {
      toast.success('Roast group deleted');
      queryClient.invalidateQueries({ queryKey: ['roast-groups-list'] });
      navigate('/roast-groups');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete roast group'),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!rg) return <div className="p-6 text-sm text-muted-foreground">Roast group not found.</div>;

  const displayName = getDisplayName(rg.display_name, rg.roast_group);
  const isAdmin = authUser?.role === 'ADMIN';
  const hasActiveOrders = (impact?.activeOrderCount ?? 0) > 0;
  const isClean = impact && impact.productCount === 0 && impact.activeOrderCount === 0 && impact.wipKg === 0;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/roast-groups')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Roast Groups
      </Button>

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">{displayName}</h1>
        <Badge variant="outline" className={cn(
          'text-xs',
          rg.is_blend
            ? 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300'
            : 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300'
        )}>
          {rg.is_blend ? 'Blend' : 'Single Origin'}
        </Badge>
        <Badge variant="outline" className={cn(
          'text-xs',
          rg.is_seasonal
            ? 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300'
            : 'border-border text-muted-foreground'
        )}>
          {rg.is_seasonal ? 'Seasonal' : 'Perennial'}
        </Badge>
        {!rg.is_active && (
          <Badge variant="secondary" className="text-xs">Inactive</Badge>
        )}

        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Delete Roast Group
          </Button>
        )}
      </div>

      {/* Section 1: Details */}
      <RoastGroupDetailsSection roastGroupKey={rg.roast_group} initialData={rg} />

      {/* Section 2: Blend Composition (post-roast blends only) */}
      {rg.is_blend && rg.blend_type === 'POST_ROAST' && (
        <BlendCompositionSection roastGroupKey={rg.roast_group} />
      )}

      {/* Section 3: Green Lot Mapping (single origins and pre-roast blends) */}
      {rg.blend_type !== 'POST_ROAST' && (
        <GreenLotMappingSection roastGroupKey={rg.roast_group} />
      )}

      {/* Section 4: Products Family Tree */}
      <ProductsFamilyTreeSection roastGroupKey={rg.roast_group} displayName={displayName} />

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{displayName}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {impactLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking for linked data…
                  </div>
                ) : impact ? (
                  <>
                    {isClean && (
                      <p className="text-green-600 dark:text-green-400">
                        No products, orders, or inventory linked. Safe to delete.
                      </p>
                    )}
                    {impact.productCount > 0 && (
                      <p className="text-muted-foreground">
                        {impact.productCount} product{impact.productCount !== 1 ? 's' : ''} linked — will be unlinked (not deleted).
                      </p>
                    )}
                    {impact.activeOrderCount > 0 && (
                      <p className="flex items-center gap-1.5 text-destructive font-medium">
                        <AlertTriangle className="h-4 w-4" />
                        {impact.activeOrderCount} active order{impact.activeOrderCount !== 1 ? 's' : ''} reference this roast group's products. Cannot delete.
                      </p>
                    )}
                    {impact.wipKg > 0 && (
                      <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4" />
                        {impact.wipKg} kg WIP inventory will be lost.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={impactLoading || hasActiveOrders || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Delete Roast Group
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}