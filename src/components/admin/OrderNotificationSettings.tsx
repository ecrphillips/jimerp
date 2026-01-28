import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Bell, Send, CheckCircle2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface NotificationSettings {
  enabled: boolean;
}

export function OrderNotificationSettings() {
  const queryClient = useQueryClient();
  const [isTesting, setIsTesting] = useState(false);

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings', 'order_submit_notification'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value_json')
        .eq('key', 'order_submit_notification')
        .maybeSingle();

      if (error) throw error;
      const json = data?.value_json as unknown as NotificationSettings | null;
      return json || { enabled: true };
    },
  });

  // Save settings mutation
  const saveMutation = useMutation({
    mutationFn: async (newSettings: NotificationSettings) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('app_settings')
        .update({
          value_json: newSettings,
          updated_at: new Date().toISOString(),
          updated_by: user.user?.id || null,
        } as Record<string, unknown>)
        .eq('key', 'order_submit_notification');
      if (error) throw error;
      return newSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-settings', 'order_submit_notification'] });
      toast.success('Notification settings saved');
    },
    onError: (err: Error) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const handleToggleEnabled = () => {
    if (!settings) return;
    saveMutation.mutate({ ...settings, enabled: !settings.enabled });
  };

  const handleSendTest = async () => {
    setIsTesting(true);
    try {
      // Find a recent order to use as test
      const { data: recentOrder } = await supabase
        .from('orders')
        .select('id, order_number')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!recentOrder) {
        toast.error('No orders found to use for test notification');
        return;
      }

      const { data, error } = await supabase.functions.invoke('notify-new-order', {
        body: { order_id: recentOrder.id, test: true },
      });

      if (error) throw error;

      if (data?.ok) {
        toast.success('Test notification sent! Check for a toast in the app.');
      } else {
        toast.error(data?.error || 'Unknown error');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send test notification';
      console.error('Test notification failed:', err);
      toast.error(message);
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Order Submit Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Order Submit Notifications
            </CardTitle>
            <CardDescription>
              Get notified when clients submit new orders
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="notification-enabled" className="text-sm text-muted-foreground">
              {settings?.enabled ? 'Enabled' : 'Disabled'}
            </Label>
            <Switch
              id="notification-enabled"
              checked={settings?.enabled ?? false}
              onCheckedChange={handleToggleEnabled}
              disabled={saveMutation.isPending}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            When enabled, all logged-in OPS and ADMIN users will see an in-app notification 
            whenever a client submits a new order. The notification appears as a toast with 
            a link to view the order.
          </AlertDescription>
        </Alert>

        {/* Status indicator */}
        <div className="flex items-center gap-2 pt-2 text-sm">
        {settings?.enabled ? (
            <span className="flex items-center gap-1 text-primary">
              <CheckCircle2 className="h-4 w-4" />
              In-app notifications are active
            </span>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Bell className="h-4 w-4" />
              Notifications are disabled
            </span>
          )}
        </div>

        {/* Test button */}
        <div className="pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendTest}
            disabled={isTesting || !settings?.enabled}
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Test Notification
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Sends a test notification using the most recent order. You'll see it as a toast.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
