import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Loader2, Users } from 'lucide-react';
import { ownerRpc } from './ownerRpc';
import { toast } from 'sonner';

const EVENTS = [
  { key: 'ORDER_SUBMITTED', label: 'Order submitted' },
  { key: 'ORDER_CONFIRMED', label: 'Order confirmed' },
  { key: 'ORDER_SHIPPED', label: 'Order shipped' },
  { key: 'ORDER_CANCELLED', label: 'Order cancelled' },
  { key: 'ORDER_CLIENT_EDITED', label: 'Order edited' },
] as const;

type EventKey = typeof EVENTS[number]['key'];

interface TeamPrefRow {
  user_id: string;
  email: string;
  name: string | null;
  is_owner: boolean;
  prefs: Array<{ event_type: EventKey; channel: 'IN_APP' | 'EMAIL'; enabled: boolean }>;
}

interface Props {
  accountId: string;
  currentUserId: string;
}

export function TeamNotificationPrefs({ accountId, currentUserId }: Props) {
  const queryClient = useQueryClient();

  const { data: team, isLoading } = useQuery({
    queryKey: ['team-notification-prefs', accountId],
    queryFn: async () => {
      const { data, error } = await ownerRpc('owner_list_team_notification_prefs', {
        p_account_id: accountId,
      });
      if (error) throw error;
      return (data as unknown as TeamPrefRow[]) ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: async (input: { userId: string; eventType: EventKey; enabled: boolean }) => {
      const { error } = await ownerRpc('owner_set_user_notification_pref', {
        p_account_id: accountId,
        p_user_id: input.userId,
        p_event_type: input.eventType,
        p_channel: 'EMAIL',
        p_enabled: input.enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-notification-prefs', accountId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Save failed'),
  });

  const getEmailPref = (row: TeamPrefRow, eventType: EventKey): boolean => {
    const pref = (row.prefs ?? []).find(p => p.event_type === eventType && p.channel === 'EMAIL');
    return pref ? pref.enabled : false; // EMAIL default off
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> Team email notifications
        </CardTitle>
        <CardDescription>
          As an account owner, toggle which order emails each team member receives.
          Team members can still adjust their own preferences here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (() => {
          const others = (team ?? []).filter(r => r.user_id !== currentUserId);
          if (others.length === 0) {
            return <p className="text-sm text-muted-foreground">No other team members yet.</p>;
          }
          return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4">User</th>
                  {EVENTS.map(e => (
                    <th key={e.key} className="text-center py-2 px-2 text-xs font-normal">
                      {e.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {others.map(row => (
                  <tr key={row.user_id} className="border-b last:border-0">
                    <td className="py-3 pr-4">
                      <div className="font-medium">
                        {row.name || row.email}
                        {row.is_owner && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Owner</span>
                        )}
                      </div>
                      {row.name && (
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      )}
                    </td>
                    {EVENTS.map(e => {
                      const enabled = getEmailPref(row, e.key);
                      return (
                        <td key={e.key} className="text-center py-3 px-2">
                          <Switch
                            checked={enabled}
                            onCheckedChange={(checked) =>
                              mutation.mutate({
                                userId: row.user_id,
                                eventType: e.key,
                                enabled: checked,
                              })
                            }
                            disabled={mutation.isPending}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          );
        })()}
      </CardContent>

    </Card>
  );
}
