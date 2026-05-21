import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Building2, MapPin, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrderContextBannerProps {
  accountId: string | null | undefined;
  locationId: string | null | undefined;
  className?: string;
}

export function OrderContextBanner({ accountId, locationId, className }: OrderContextBannerProps) {
  const { data: account } = useQuery({
    queryKey: ['account', accountId],
    queryFn: async () => {
      if (!accountId) return null;
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!accountId,
  });

  const { data: location } = useQuery({
    queryKey: ['account-location', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('account_locations')
        .select('id, location_name, location_code')
        .eq('id', locationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId,
  });

  if (!accountId) return null;

  const missingLocation = !locationId;

  return (
    <div
      className={cn(
        'sticky top-0 z-20 mb-4 rounded-md border bg-background/95 backdrop-blur px-4 py-2 shadow-sm',
        missingLocation ? 'border-amber-400 bg-amber-50/70' : 'border-primary/30',
        className,
      )}
    >
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Creating order for
        </span>
        <Badge variant="secondary" className="gap-1">
          <Building2 className="h-3 w-3" />
          {account?.account_name ?? '…'}
        </Badge>
        {location ? (
          <Badge variant="outline" className="gap-1">
            <MapPin className="h-3 w-3" />
            <span className="font-mono text-xs">{location.location_code}</span>
            <span>{location.location_name}</span>
          </Badge>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-700">
            <AlertCircle className="h-3 w-3" />
            Select a location below
          </span>
        )}
      </div>
    </div>
  );
}
