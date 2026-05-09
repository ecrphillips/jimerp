import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { AccountInfoForm } from '@/components/account-management/AccountInfoForm';
import { TeamMemberList } from '@/components/account-management/TeamMemberList';
import { LocationManagementSection } from '@/components/account-management/LocationManagementSection';

export default function Account() {
  const { authUser } = useAuth();
  const accountId = authUser?.accountId ?? null;

  const { data: account, isLoading } = useQuery({
    queryKey: ['client-account', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      if (!accountId) return null;
      const { data, error } = await supabase
        .from('accounts')
        .select('account_name, billing_contact_name, billing_email, billing_phone, billing_address, programs')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!authUser) return null;

  const programs: string[] = (account?.programs as string[] | null) ?? authUser.programs ?? [];
  const showLocations = programs.includes('MANUFACTURING');

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account information, team, and locations.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Your Profile</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <div><span className="text-muted-foreground">Name:</span> {authUser.profile?.name || '—'}</div>
          <div><span className="text-muted-foreground">Email:</span> {authUser.email}</div>
          <div>
            <span className="text-muted-foreground">Role:</span>{' '}
            {authUser.isOwner ? 'Account Owner' : 'Team Member'}
          </div>
        </CardContent>
      </Card>

      {!accountId ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Your user is not linked to an account. Please contact your account administrator.
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : !account ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">No account information available.</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="info" className="space-y-4">
          <TabsList>
            <TabsTrigger value="info">Account Info</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            {showLocations && <TabsTrigger value="locations">Locations</TabsTrigger>}
          </TabsList>

          <TabsContent value="info">
            <AccountInfoForm
              accountId={accountId}
              initialValues={{
                account_name: account.account_name,
                billing_contact_name: account.billing_contact_name,
                billing_email: account.billing_email,
                billing_phone: account.billing_phone,
                billing_address: account.billing_address,
              }}
              canEdit={authUser.isOwner}
            />
          </TabsContent>

          <TabsContent value="team">
            <TeamMemberList
              accountId={accountId}
              programs={programs}
              currentUserId={authUser.id}
              isOwner={authUser.isOwner}
              canInviteUsers={authUser.canInviteUsers}
            />
          </TabsContent>

          {showLocations && (
            <TabsContent value="locations">
              <LocationManagementSection
                accountId={accountId}
                canManage={authUser.isOwner || authUser.canManageLocations}
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
