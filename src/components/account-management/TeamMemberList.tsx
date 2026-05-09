import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ownerRpc } from './ownerRpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Pencil, ShieldCheck, UserPlus, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { useAccountTeam, type AccountTeamMember } from '@/hooks/useAccountTeam';
import { EditUserPermissionsDialog } from './EditUserPermissionsDialog';
import { InviteUserDialog } from './InviteUserDialog';

interface Props {
  accountId: string;
  programs: string[];
  currentUserId: string;
  isOwner: boolean;
  canInviteUsers: boolean;
  readOnly?: boolean;
}

export function TeamMemberList({
  accountId,
  programs,
  currentUserId,
  isOwner,
  canInviteUsers,
  readOnly = false,
}: Props) {
  const queryClient = useQueryClient();
  const { data: members = [], isLoading } = useAccountTeam(accountId);

  const [editTarget, setEditTarget] = useState<AccountTeamMember | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AccountTeamMember | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const activeOwnerCount = members.filter((m) => m.is_owner && m.is_active).length;

  const deactivateMutation = useMutation({
    mutationFn: async (accountUserId: string) => {
      const { error } = await ownerRpc('owner_deactivate_user', {
        p_account_id: accountId,
        p_account_user_id: accountUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Team member deactivated');
      queryClient.invalidateQueries({ queryKey: ['account-team', accountId] });
      setDeactivateTarget(null);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to deactivate'),
  });

  const showInviteButton = !readOnly && (isOwner || canInviteUsers);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Team Members</CardTitle>
          {showInviteButton && (
            <Button size="sm" onClick={() => setShowInvite(true)}>
              <UserPlus className="h-3.5 w-3.5 mr-1" /> Invite
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members yet.</p>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isSelf={m.user_id === currentUserId}
                  canEdit={!readOnly && isOwner}
                  isOnlyOwner={m.is_owner && activeOwnerCount <= 1}
                  onEdit={() => setEditTarget(m)}
                  onDeactivate={() => setDeactivateTarget(m)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editTarget && (
        <EditUserPermissionsDialog
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          accountId={accountId}
          accountUserId={editTarget.id}
          targetName={editTarget.profile?.name || editTarget.profile?.email || 'user'}
          programs={programs}
          isOnlyOwner={editTarget.is_owner && activeOwnerCount <= 1}
          initialValues={{
            is_owner: editTarget.is_owner,
            can_place_orders: editTarget.can_place_orders,
            can_book_roaster: editTarget.can_book_roaster,
            can_manage_locations: editTarget.can_manage_locations,
            can_invite_users: editTarget.can_invite_users,
            location_access: editTarget.location_access,
            assigned_location_ids: editTarget.assigned_location_ids,
          }}
        />
      )}

      <InviteUserDialog
        open={showInvite}
        onOpenChange={setShowInvite}
        accountId={accountId}
        programs={programs}
      />

      <AlertDialog open={!!deactivateTarget} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate team member?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget?.profile?.name || deactivateTarget?.profile?.email} will lose
              access to this account immediately. You can re-invite them later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
              disabled={deactivateMutation.isPending}
            >
              {deactivateMutation.isPending ? 'Deactivating…' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface RowProps {
  member: AccountTeamMember;
  isSelf: boolean;
  canEdit: boolean;
  isOnlyOwner: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
}

function MemberRow({ member, isSelf, canEdit, isOnlyOwner, onEdit, onDeactivate }: RowProps) {
  const profile = member.profile;
  const profileMissing = !profile;
  const email = profile?.email || '';
  const name = profileMissing ? 'Unknown' : (profile?.name || 'Unknown');
  const isPending = !!email && name === email.split('@')[0];

  const permBadges: { label: string; on: boolean }[] = [
    { label: 'Orders', on: member.can_place_orders },
    { label: 'Roaster', on: member.can_book_roaster },
    { label: 'Locations', on: member.can_manage_locations },
    { label: 'Invite', on: member.can_invite_users },
  ];

  return (
    <div className="flex items-center gap-3 border rounded-md p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">{email}</span>
          {member.is_owner && (
            <Badge className="text-[10px] bg-primary">
              <ShieldCheck className="h-3 w-3 mr-0.5" /> Owner
            </Badge>
          )}
          {!member.is_active ? (
            <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
          ) : isPending ? (
            <Badge className="text-[10px] bg-amber-500 hover:bg-amber-500 text-white">Pending</Badge>
          ) : null}
          {isSelf && <Badge variant="outline" className="text-[10px]">You</Badge>}
        </div>
        <div className="flex gap-1 mt-1 flex-wrap">
          {permBadges.filter((p) => p.on).map((p) => (
            <Badge key={p.label} variant="secondary" className="text-[10px]">{p.label}</Badge>
          ))}
          <Badge variant="outline" className="text-[10px]">
            {member.location_access === 'ALL' ? 'All Locations' : 'Assigned Only'}
          </Badge>
        </div>
      </div>
      {canEdit && member.is_active && (
        <>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          {!isSelf && !isOnlyOwner && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onDeactivate}
              title="Deactivate"
            >
              <UserX className="h-3 w-3" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
