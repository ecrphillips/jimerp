import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Mailbox, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const EVENT_TYPES = [
  { key: 'ORDER_SUBMITTED', label: 'New client order submitted' },
  { key: 'ORDER_CONFIRMED', label: 'Order confirmed' },
  { key: 'BOOKING_CREATED', label: 'Co-roast booking created' },
  { key: 'BOOKING_CANCELLED', label: 'Co-roast booking cancelled' },
] as const;

type EventKey = typeof EVENT_TYPES[number]['key'];

interface RouteValue {
  shared_email: string;
  enabled: boolean;
}

export function NotificationRoutingSettings() {
  const queryClient = useQueryClient();

  const { data: routes, isLoading } = useQuery({
    queryKey: ['app-settings', 'notification_routes'],
    queryFn: async () => {
      const keys = EVENT_TYPES.map(e => `notification_routes.${e.key}`);
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value_json')
        .in('key', keys);
      if (error) throw error;
      const map: Record<EventKey, RouteValue> = {} as Record<EventKey, RouteValue>;
      for (const row of data ?? []) {
        const eventKey = row.key.replace('notification_routes.', '') as EventKey;
        map[eventKey] = (row.value_json as unknown as RouteValue) ?? { shared_email: '', enabled: false };
      }
      // fill defaults for any missing
      for (const e of EVENT_TYPES) {
        if (!map[e.key]) map[e.key] = { shared_email: '', enabled: false };
      }
      return map;
    },
  });

  const [draft, setDraft] = useState<Record<EventKey, RouteValue>>({} as Record<EventKey, RouteValue>);

  useEffect(() => {
    if (routes) setDraft(routes);
  }, [routes]);

  const saveMutation = useMutation({
    mutationFn: async (event: EventKey) => {
      const value = draft[event];
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('app_settings')
        .upsert({
          key: `notification_routes.${event}`,
          value_json: value as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
          updated_by: user.user?.id || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings', 'notification_routes'] });
      toast.success('Route saved');
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mailbox className="h-5 w-5" /> Shared mailbox routing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mailbox className="h-5 w-5" /> Shared mailbox routing
        </CardTitle>
        <CardDescription>
          Route notifications for each event type to a shared mailbox (e.g. orders@homeislandcoffee.com).
          Email also fans out to individual users who have email enabled for that event.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {EVENT_TYPES.map((e) => {
          const value = draft[e.key] ?? { shared_email: '', enabled: false };
          return (
            <div key={e.key} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="font-medium">{e.label}</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {value.enabled ? 'On' : 'Off'}
                  </span>
                  <Switch
                    checked={value.enabled}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, [e.key]: { ...value, enabled: checked } }))
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="orders@homeislandcoffee.com"
                  value={value.shared_email}
                  onChange={(ev) =>
                    setDraft((prev) => ({
                      ...prev,
                      [e.key]: { ...value, shared_email: ev.target.value },
                    }))
                  }
                />
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate(e.key)}
                  disabled={saveMutation.isPending}
                >
                  Save
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
