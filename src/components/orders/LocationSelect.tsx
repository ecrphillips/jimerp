import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MapPin } from 'lucide-react';

interface AccountLocation {
  id: string;
  location_name: string;
  location_code: string;
}

interface LocationSelectProps {
  /** Account ID (a.k.a. client/account in the unified model). */
  clientId: string;
  value: string;
  onChange: (locationId: string) => void;
  required?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
}

/**
 * Permission-aware location picker.
 *
 * - Owners and users with location_access = 'ALL' see every active location on the account.
 * - Users with location_access = 'ASSIGNED' see only locations linked to them via
 *   account_user_locations.
 * - Internal users (ADMIN/OPS) see all active locations.
 * - When exactly one location is visible, auto-selects it and renders a read-only chip.
 */
export function LocationSelect({
  clientId,
  value,
  onChange,
  required = false,
  disabled = false,
  showLabel = true,
}: LocationSelectProps) {
  const { authUser, isInternal } = useAuth();

  const { data: locations, isLoading } = useQuery({
    queryKey: ['account-locations-allowed', clientId, authUser?.id, isInternal],
    enabled: !!clientId,
    queryFn: async (): Promise<AccountLocation[]> => {
      // Fetch all active locations for the account.
      const { data: allLocs, error: locErr } = await supabase
        .from('account_locations')
        .select('id, location_name, location_code')
        .eq('account_id', clientId)
        .eq('is_active', true)
        .order('location_code', { ascending: true });
      if (locErr) throw locErr;
      const all = (allLocs ?? []) as AccountLocation[];

      // Internal users see everything; same for the no-user/loading edge case.
      if (isInternal || !authUser?.id) return all;

      // Look up this user's membership on the account.
      const { data: membership, error: memErr } = await supabase
        .from('account_users')
        .select('id, is_owner, location_access')
        .eq('account_id', clientId)
        .eq('user_id', authUser.id)
        .eq('is_active', true)
        .maybeSingle();
      if (memErr) throw memErr;

      // No membership → no access. Owners or ALL → every location.
      if (!membership) return [];
      if (membership.is_owner || membership.location_access === 'ALL') return all;

      // ASSIGNED → filter by the account_user_locations join.
      const { data: assigned, error: assErr } = await supabase
        .from('account_user_locations')
        .select('location_id')
        .eq('account_user_id', membership.id);
      if (assErr) throw assErr;
      const allowed = new Set((assigned ?? []).map((r) => r.location_id));
      return all.filter((l) => allowed.has(l.id));
    },
  });

  // Auto-select when only one location is available.
  React.useEffect(() => {
    if (!locations || locations.length !== 1) return;
    if (value === locations[0].id) return;
    onChange(locations[0].id);
  }, [locations, value, onChange]);

  if (!isLoading && (!locations || locations.length === 0)) {
    return null;
  }

  // Single-location: show as a read-only chip so the user knows which store
  // the order is for, but doesn't need to pick.
  if (locations && locations.length === 1) {
    const only = locations[0];
    return (
      <div>
        {showLabel && (
          <Label className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            Ordering for
          </Label>
        )}
        <div className="mt-1 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <Badge variant="outline" className="font-mono text-xs">
            {only.location_code}
          </Badge>
          <span className="font-medium">{only.location_name}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {showLabel && (
        <Label htmlFor="location" className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          Ordering for {required && <span className="text-destructive">*</span>}
        </Label>
      )}
      <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
        <SelectTrigger id="location" className="w-full">
          <SelectValue placeholder={isLoading ? 'Loading…' : 'Select a location…'} />
        </SelectTrigger>
        <SelectContent>
          {locations?.map((loc) => (
            <SelectItem key={loc.id} value={loc.id}>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {loc.location_code}
                </Badge>
                {loc.location_name}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display helpers used by order lists / detail screens
// ---------------------------------------------------------------------------

interface LocationBadgeProps {
  locationId: string | null;
  className?: string;
}

function useAccountLocationLookup(locationId: string | null | undefined) {
  return useQuery({
    queryKey: ['account-location', locationId],
    enabled: !!locationId,
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('account_locations')
        .select('location_name, location_code')
        .eq('id', locationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function LocationBadge({ locationId, className }: LocationBadgeProps) {
  const { data: location } = useAccountLocationLookup(locationId);
  if (!location) return null;
  return (
    <Badge variant="secondary" className={`font-normal text-xs ${className ?? ''}`}>
      <MapPin className="h-3 w-3 mr-1" />
      {location.location_name}
    </Badge>
  );
}

interface LocationCodeDisplayProps {
  locationId: string | null;
}

export function LocationCodeDisplay({ locationId }: LocationCodeDisplayProps) {
  const { data: location } = useAccountLocationLookup(locationId);
  if (!location) return null;
  return (
    <span className="text-sm text-muted-foreground" title={location.location_name}>
      @ {location.location_name}
    </span>
  );
}
