import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ownerRpc } from './ownerRpc';
import { toast } from 'sonner';

interface Props {
  accountId: string;
}

export function PricingVisibilityCard({ accountId }: Props) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['account-pricing-visibility', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('hide_pricing_from_non_owners')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      return !!(data as { hide_pricing_from_non_owners?: boolean } | null)?.hide_pricing_from_non_owners;
    },
  });

  const mutation = useMutation({
    mutationFn: async (hide: boolean) => {
      const { error } = await ownerRpc('owner_set_account_pricing_visibility', {
        p_account_id: accountId,
        p_hidden: hide,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Pricing visibility updated');
      queryClient.invalidateQueries({ queryKey: ['account-pricing-visibility', accountId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="h-5 w-5" /> Pricing visibility
        </CardTitle>
        <CardDescription>
          Control whether your team members can see product prices and order totals.
          Account owners always see pricing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="hide-pricing" className="flex-1 cursor-pointer">
              Hide pricing from non-owner users
              <p className="text-xs font-normal text-muted-foreground mt-1">
                When on, only account owners see dollar amounts in the portal.
              </p>
            </Label>
            <Switch
              id="hide-pricing"
              checked={!!data}
              onCheckedChange={(checked) => mutation.mutate(checked)}
              disabled={mutation.isPending}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
