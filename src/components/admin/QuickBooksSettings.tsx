import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Link2, Link2Off, PlugZap, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

// Status columns only — token columns are blocked by column-level grants.
interface QboConnectionStatus {
  status: 'disconnected' | 'connected' | 'needs_reconnect';
  realm_id: string | null;
  company_name: string | null;
  connected_at: string | null;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
}

export function QuickBooksSettings() {
  const queryClient = useQueryClient();
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  // Cast needed until `quickbooks_connection` lands in the generated Supabase
  // types (regenerate after running the migration).
  const { data: connection, isLoading } = useQuery({
    queryKey: ['quickbooks-connection'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('quickbooks_connection')
        .select('status, realm_id, company_name, connected_at, token_expires_at, refresh_token_expires_at')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return data as QboConnectionStatus | null;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('quickbooks-oauth-start');
      if (error) throw error;
      if (!data?.ok || !data?.url) throw new Error(data?.error ?? 'Could not build the Intuit authorization URL');
      return data.url as string;
    },
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: Error) => {
      toast.error(`Failed to start QuickBooks connection: ${err.message}`);
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('quickbooks-test-connection');
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(
          data?.status === 'needs_reconnect'
            ? 'Refresh token expired — reconnect to QuickBooks'
            : data?.error ?? 'Connection test failed',
        );
      }
      return data as { ok: true; companyName: string | null; realmId: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['quickbooks-connection'] });
      toast.success(`Connected to sandbox company: ${data.companyName ?? data.realmId}`);
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ['quickbooks-connection'] });
      toast.error(err.message);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('quickbooks-disconnect');
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'Disconnect failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quickbooks-connection'] });
      setShowDisconnectModal(false);
      toast.success('QuickBooks disconnected');
    },
    onError: (err: Error) => {
      toast.error(`Failed to disconnect: ${err.message}`);
    },
  });

  const status = connection?.status ?? 'disconnected';
  const isConnected = status === 'connected';
  const needsReconnect = status === 'needs_reconnect';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <PlugZap className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">QuickBooks</CardTitle>
          <Badge variant="outline">Sandbox</Badge>
          {isConnected && <Badge className="bg-green-600 hover:bg-green-600">Connected</Badge>}
          {needsReconnect && <Badge variant="destructive">Reconnect required</Badge>}
        </div>
        <CardDescription>
          Connects JIM to a QuickBooks Online sandbox company for accounting integration.
          Connection and token lifecycle only — no invoices or customers are synced yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : isConnected ? (
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Company:</span>{' '}
                <span className="font-medium">
                  {connection?.company_name ?? 'Unknown — run “Test connection”'}
                </span>
                {connection?.realm_id && (
                  <span className="text-muted-foreground ml-2">· Realm {connection.realm_id}</span>
                )}
              </p>
              {connection?.connected_at && (
                <p className="text-xs text-muted-foreground">
                  Connected {format(parseISO(connection.connected_at), 'MMM d, yyyy h:mm a')}
                </p>
              )}
              {connection?.refresh_token_expires_at && (
                <p className="text-xs text-muted-foreground">
                  Refresh token valid until {format(parseISO(connection.refresh_token_expires_at), 'MMM d, yyyy')}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Test connection
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDisconnectModal(true)}
                disabled={disconnectMutation.isPending}
              >
                <Link2Off className="h-4 w-4 mr-2" />
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {needsReconnect
                ? 'The QuickBooks refresh token has expired. Reconnect to restore the integration.'
                : 'Not connected. Authorize JIM against your QuickBooks sandbox company to get started.'}
            </p>
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="gap-2"
            >
              {connectMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {needsReconnect ? 'Reconnect to QuickBooks' : 'Connect to QuickBooks'}
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={showDisconnectModal} onOpenChange={setShowDisconnectModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Disconnect QuickBooks?
            </DialogTitle>
            <DialogDescription>
              This revokes JIM's access to the sandbox company and deletes the stored tokens.
              You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDisconnectModal(false)}
              disabled={disconnectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
