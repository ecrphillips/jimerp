import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePreview } from '@/contexts/PreviewContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ShieldCheck, CalendarDays } from 'lucide-react';
import { AccountInfoForm } from '@/components/account-management/AccountInfoForm';
import { TeamMemberList } from '@/components/account-management/TeamMemberList';

export default function MemberAccount() {
  const { authUser } = useAuth();
  const { previewAccountId } = usePreview();
  const effectiveAccountId = previewAccountId ?? authUser?.accountId ?? null;
  const isPreviewMode = !!previewAccountId;

  const { data: account, isLoading } = useQuery({
    queryKey: ['my-coroast-account', effectiveAccountId],
    enabled: !!effectiveAccountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, programs, coroast_tier, coroast_certified, coroast_joined_date, billing_contact_name, billing_email, billing_phone, billing_address')
        .eq('id', effectiveAccountId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!authUser) return null;

  if (isLoading) {
    return <div className="p-6"><p className="text-muted-foreground">Loading…</p></div>;
  }

  if (!account || !effectiveAccountId) {
    return <div className="p-6"><p className="text-destructive">No account record found.</p></div>;
  }

  const programs: string[] = (account.programs as string[] | null) ?? [];
  const canEdit = authUser.isOwner && !isPreviewMode;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
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
        <CardContent>
          {account.coroast_joined_date && (
            <div className="flex items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Member since</span>
              <span className="font-medium">
                {format(new Date(account.coroast_joined_date + 'T00:00:00'), 'MMMM d, yyyy')}
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            To change your tier or membership status, contact Home Island Coffee Partners.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="info" className="space-y-4">
        <TabsList>
          <TabsTrigger value="info">Account Info</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <AccountInfoForm
            accountId={effectiveAccountId}
            initialValues={{
              account_name: account.account_name,
              billing_contact_name: account.billing_contact_name,
              billing_email: account.billing_email,
              billing_phone: account.billing_phone,
              billing_address: account.billing_address,
            }}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="team">
          <TeamMemberList
            accountId={effectiveAccountId}
            programs={programs}
            currentUserId={authUser.id}
            isOwner={authUser.isOwner}
            canInviteUsers={authUser.canInviteUsers}
            readOnly={isPreviewMode}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
