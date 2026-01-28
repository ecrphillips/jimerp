import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Mail, Plus, X, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface NotificationSettings {
  enabled: boolean;
  emails: string[];
}

export function OrderNotificationSettings() {
  const queryClient = useQueryClient();
  const [newEmail, setNewEmail] = useState('');
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
      return json || { enabled: true, emails: [] };
    },
  });

  // Save settings mutation
  const saveMutation = useMutation({
    mutationFn: async (newSettings: NotificationSettings) => {
      const { data: user } = await supabase.auth.getUser();
      // Use raw update to avoid type issues with JSONB
      const { error } = await supabase
        .from('app_settings')
        .update({
          value_json: newSettings,
          updated_at: new Date().toISOString(),
          updated_by: user.user?.id || null,
        } as any)
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

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleAddEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;

    if (!isValidEmail(email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (settings?.emails.includes(email)) {
      toast.error('This email is already in the list');
      return;
    }

    const newEmails = [...(settings?.emails || []), email];
    saveMutation.mutate({ enabled: settings?.enabled ?? true, emails: newEmails });
    setNewEmail('');
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    if (!settings) return;
    const newEmails = settings.emails.filter((e) => e !== emailToRemove);
    saveMutation.mutate({ ...settings, emails: newEmails });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddEmail();
    }
  };

  const handleSendTest = async () => {
    if (!settings?.emails?.length) {
      toast.error('Add at least one email recipient first');
      return;
    }

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

      if (data?.ok && data?.email_sent) {
        toast.success(`Test notification sent to ${data.recipients} recipient(s)`);
      } else if (data?.skipped) {
        toast.info(`Skipped: ${data.reason}`);
      } else {
        toast.error(data?.error || 'Unknown error');
      }
    } catch (err: any) {
      console.error('Test notification failed:', err);
      toast.error(err.message || 'Failed to send test notification');
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
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
              <Mail className="h-5 w-5" />
              Order Submit Notifications
            </CardTitle>
            <CardDescription>
              Send email notifications when clients submit new orders
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
        {/* Email recipients */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Email Recipients</Label>
          <div className="flex flex-wrap gap-2 min-h-[32px]">
            {settings?.emails?.length === 0 ? (
              <span className="text-sm text-muted-foreground italic">No recipients configured</span>
            ) : (
              settings?.emails?.map((email) => (
                <Badge key={email} variant="secondary" className="gap-1 pr-1">
                  {email}
                  <button
                    type="button"
                    onClick={() => handleRemoveEmail(email)}
                    className="ml-1 rounded-full p-0.5 hover:bg-destructive/20"
                    disabled={saveMutation.isPending}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        </div>

        {/* Add email input */}
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="Add email address..."
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saveMutation.isPending}
            className="flex-1"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAddEmail}
            disabled={!newEmail.trim() || saveMutation.isPending}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-4 pt-2 text-sm">
          {settings?.enabled && settings?.emails?.length > 0 ? (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Ready to send notifications
            </span>
          ) : settings?.enabled && settings?.emails?.length === 0 ? (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              Add recipients to enable notifications
            </span>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
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
            disabled={isTesting || !settings?.enabled || !settings?.emails?.length}
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
            Sends a test email using the most recent order
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
