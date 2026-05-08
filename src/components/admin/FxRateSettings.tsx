import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

interface FxRateValue {
  rate: number;
  date: string | null;
  source: string;
  fetched_at: string | null;
}

export function FxRateSettings() {
  const queryClient = useQueryClient();

  const { data: setting, isLoading } = useQuery({
    queryKey: ['app_settings', 'fx_rate_usd_to_cad'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value_json, updated_at')
        .eq('key', 'fx_rate_usd_to_cad')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const fxValue = setting?.value_json as unknown as FxRateValue | undefined;
  const isLive = fxValue?.source === 'bank-of-canada';

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('fetch-fx-rate');
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'Unknown error from fetch-fx-rate');
      return data as { ok: true; rate: number; date: string; fetched_at: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['app_settings', 'fx_rate_usd_to_cad'] });
      toast.success(`Rate updated: 1 USD = ${data.rate.toFixed(4)} CAD (${data.date})`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh rate: ${err.message}`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">USD/CAD Exchange Rate</CardTitle>
        </div>
        <CardDescription>
          Daily rate from the Bank of Canada, used for USD cost conversions in green lot sourcing.
          Refreshes automatically at 5:30 PM UTC on business days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : fxValue ? (
              <>
                <p className="text-2xl font-semibold tabular-nums">
                  {fxValue.rate.toFixed(4)}
                  <span className="text-base font-normal text-muted-foreground ml-2">CAD / USD</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {isLive && fxValue.date
                    ? `Bank of Canada rate for ${fxValue.date}`
                    : 'Seed / placeholder value — not yet fetched from Bank of Canada'}
                  {fxValue.fetched_at && (
                    <span className="ml-2">
                      · Last fetched {format(parseISO(fxValue.fetched_at), 'MMM d, yyyy h:mm a')}
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No rate found in app_settings.</p>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            {refreshMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh Now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
