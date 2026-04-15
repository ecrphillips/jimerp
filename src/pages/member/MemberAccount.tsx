import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ShieldCheck, Mail, Building2, CalendarDays } from 'lucide-react';

export default function MemberAccount() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const effectiveAccountId = previewAccountId ?? authUser?.accountId;
  const { data: account, isLoading } = useQuery({
    queryKey: ['my-coroast-account', effectiveAccountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, coroast_tier, coroast_certified, coroast_joined_date, billing_contact_name, billing_email')
        .eq('id', effectiveAccountId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveAccountId,
  });

  if (isLoading) {
    return <div className="p-6"><p className="text-muted-foreground">Loading…</p></div>;
  }

  if (!account) {
    return <div className="p-6"><p className="text-destructive">No account record found.</p></div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Account</h1>
        <p className="text-sm text-muted-foreground">Your co-roasting membership details</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{account.account_name}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">{account.coroast_tier || '—'}</Badge>
              {account.coroast_certified && (
                <Badge variant="default" className="text-xs gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  Certified
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {account.billing_contact_name && (
              <div className="flex items-start gap-3">
                <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Billing Contact</p>
                  <p className="text-sm font-medium">{account.billing_contact_name}</p>
                </div>
              </div>
            )}
            {account.billing_email && (
              <div className="flex items-start gap-3">
                <Mail className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="text-sm font-medium">{account.billing_email}</p>
                </div>
              </div>
            )}
            {account.coroast_joined_date && (
              <div className="flex items-start gap-3">
                <CalendarDays className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Member Since</p>
                  <p className="text-sm font-medium">
                    {format(new Date(account.coroast_joined_date + 'T00:00:00'), 'MMMM d, yyyy')}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-4 mt-4">
            <p className="text-sm text-muted-foreground">
              To update your account details, tier, or membership status, please contact Home Island Coffee Partners directly.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
