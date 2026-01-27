import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { MapPin } from 'lucide-react';

interface ClientLocation {
  id: string;
  name: string;
  location_code: string;
}

interface LocationSelectProps {
  clientId: string;
  value: string;
  onChange: (locationId: string) => void;
  required?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
}

export function LocationSelect({ 
  clientId, 
  value, 
  onChange, 
  required = false,
  disabled = false,
  showLabel = true
}: LocationSelectProps) {
  const { data: locations, isLoading } = useQuery({
    queryKey: ['client-locations', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_locations')
        .select('id, name, location_code')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      return (data ?? []) as ClientLocation[];
    },
    enabled: !!clientId,
  });

  // If no locations exist for this client, don't render anything
  if (!isLoading && (!locations || locations.length === 0)) {
    return null;
  }

  return (
    <div>
      {showLabel && (
        <Label htmlFor="location" className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          Location {required && '*'}
        </Label>
      )}
      <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
        <SelectTrigger id="location" className="w-full">
          <SelectValue placeholder={isLoading ? 'Loading...' : 'Select location...'} />
        </SelectTrigger>
        <SelectContent>
          {locations?.map((loc) => (
            <SelectItem key={loc.id} value={loc.id}>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {loc.location_code}
                </Badge>
                {loc.name}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Display component for showing location in lists/details
interface LocationBadgeProps {
  locationId: string | null;
  className?: string;
}

export function LocationBadge({ locationId, className }: LocationBadgeProps) {
  const { data: location } = useQuery({
    queryKey: ['client-location', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('client_locations')
        .select('name, location_code')
        .eq('id', locationId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!locationId,
  });

  if (!location) return null;

  return (
    <Badge variant="secondary" className={`font-normal text-xs ${className}`}>
      <MapPin className="h-3 w-3 mr-1" />
      {location.name}
    </Badge>
  );
}

// Inline display for order lists
interface LocationCodeDisplayProps {
  locationId: string | null;
}

export function LocationCodeDisplay({ locationId }: LocationCodeDisplayProps) {
  const { data: location } = useQuery({
    queryKey: ['client-location', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('client_locations')
        .select('name, location_code')
        .eq('id', locationId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!locationId,
  });

  if (!location) return null;

  return (
    <span className="text-xs text-muted-foreground" title={location.name}>
      @ {location.name}
    </span>
  );
}
