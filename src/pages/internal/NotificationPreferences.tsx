import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Loader2, Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { NotificationRoutingSettings } from '@/components/admin/NotificationRoutingSettings';

const EVENTS = [
  { key: 'ORDER_SUBMITTED', label: 'New client order submitted' },
  { key: 'ORDER_CONFIRMED', label: 'Order confirmed' },
  { key: 'BOOKING_CREATED', label: 'Co-roast booking created' },
  { key: 'BOOKING_CANCELLED', label: 'Co-roast booking cancelled' },
] as const;

const CHANNELS = [
  { key: 'IN_APP', label: 'In-app' },
  { key: 'EMAIL', label: 'Email' },
] as const;

type EventKey = typeof EVENTS[number]['key'];
type ChannelKey = typeof CHANNELS[number]['key'];

interface PrefRow {
  id: string;
  event_type: EventKey;
  channel: ChannelKey;
  enabled: boolean;
}

export default function NotificationPreferences() {
  const { authUser } = useAuth();
  const role = authUser?.role;
  const queryClient = useQueryClient();
  const isAdmin = role === 'ADMIN';

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['user-notification-preferences', authUser?.id],
    queryFn: async () => {
      if (!authUser?.id) return [];
      const { data, error } = await supabase
        .from('user_notification_preferences' as never)
        .select('id, event_type, channel, enabled')
        .eq('user_id', authUser.id);
      if (error) throw error;
      return (data as unknown as PrefRow[]) ?? [];
    },
    enabled: !!authUser?.id,
  });

  const upsertMutation = useMutation({
    mutationFn: async (input: { event_type: EventKey; channel: ChannelKey; enabled: boolean }) => {
      if (!authUser?.id) throw new Error('Not signed in');
      const { error } = await supabase
        .from('user_notification_preferences')
        .upsert(
          {
            user_id: authUser.id,
            event_type: input.event_type,
            channel: input.channel,
            enabled: input.enabled,
          },
          { onConflict: 'user_id,event_type,channel' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-notification-preferences', authUser?.id] });
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  });

  const getPref = (event: EventKey, channel: ChannelKey): boolean => {
    const row = prefs?.find(p => p.event_type === event && p.channel === channel);
    // Default: IN_APP on, EMAIL off
    if (!row) return channel === 'IN_APP';
    return row.enabled;
  };

  return (
    <div className="page-container space-y-6">
      <div className="page-header">
        <h1 className="page-title">Notification preferences</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> Your notifications
          </CardTitle>
          <CardDescription>
            Pick which events you want to be notified about and how.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4">Event</th>
                    {CHANNELS.map(c => (
                      <th key={c.key} className="text-center py-2 px-2 w-24">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EVENTS.map(e => (
                    <tr key={e.key} className="border-b last:border-0">
                      <td className="py-3 pr-4">{e.label}</td>
                      {CHANNELS.map(c => {
                        const enabled = getPref(e.key, c.key);
                        return (
                          <td key={c.key} className="text-center py-3 px-2">
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) =>
                                upsertMutation.mutate({
                                  event_type: e.key,
                                  channel: c.key,
                                  enabled: checked,
                                })
                              }
                              disabled={upsertMutation.isPending}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && <NotificationRoutingSettings />}
    </div>
  );
}
