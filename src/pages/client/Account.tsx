import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export default function Account() {
  const { authUser } = useAuth();

  const { data: client, isLoading } = useQuery({
    queryKey: ['client-account', authUser?.clientId],
    queryFn: async () => {
      if (!authUser?.clientId) return null;
      const { data, error } = await supabase
        .from('clients')
        .select('name, billing_contact_name, billing_email, shipping_address')
        .eq('id', authUser.clientId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!authUser?.clientId,
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Account</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Your Information</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><strong>Name:</strong> {authUser?.profile?.name || 'N/A'}</div>
            <div><strong>Email:</strong> {authUser?.email || 'N/A'}</div>
            <div><strong>Role:</strong> {authUser?.role || 'N/A'}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Company Information</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : client ? (
              <>
                <div><strong>Company:</strong> {client.name}</div>
                <div><strong>Billing Contact:</strong> {client.billing_contact_name || '—'}</div>
                <div><strong>Billing Email:</strong> {client.billing_email || '—'}</div>
                <div>
                  <strong>Shipping Address:</strong>
                  <p className="text-muted-foreground whitespace-pre-wrap">{client.shipping_address || '—'}</p>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No company information available.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Need Changes?</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            To update your account or company information, please contact your account manager.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
