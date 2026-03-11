import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserPlus, MoreHorizontal, Mail, Edit, Ban, CheckCircle, Loader2, Filter, Link2, Copy, ShieldCheck, ShoppingCart, Flame } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { AppRole } from '@/types/database';

interface UserWithDetails {
  user_id: string;
  email: string;
  name: string | null;
  role: AppRole;
  client_id: string | null;
  client_name: string | null;
  is_active: boolean;
  created_at: string;
  last_sign_in: string | null;
}

export default function UsersAccess() {
  const queryClient = useQueryClient();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithDetails | null>(null);
  const [roleFilter, setRoleFilter] = useState<AppRole | 'ALL'>('ALL');
  
  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('OPS');
  const [inviteClientId, setInviteClientId] = useState<string>('');
  const [inviteMemberId, setInviteMemberId] = useState<string>('');
  const [isInviting, setIsInviting] = useState(false);

  // Edit form state
  const [editRole, setEditRole] = useState<AppRole>('OPS');
  const [editClientId, setEditClientId] = useState<string>('');
  const [editMemberId, setEditMemberId] = useState<string>('');
  const [editName, setEditName] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Fetch users with roles and profiles
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      // Get user_roles with profiles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          role,
          client_id,
          clients:client_id (name)
        `);

      if (rolesError) throw rolesError;

      // Get profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, name, email, is_active, created_at');

      if (profilesError) throw profilesError;

      // Merge data
      const userMap = new Map<string, UserWithDetails>();

      for (const role of roles || []) {
        const profile = profiles?.find(p => p.user_id === role.user_id);
        userMap.set(role.user_id, {
          user_id: role.user_id,
          email: profile?.email || 'Unknown',
          name: profile?.name || null,
          role: role.role as AppRole,
          client_id: role.client_id,
          client_name: (role.clients as any)?.name || null,
          is_active: profile?.is_active ?? true,
          created_at: profile?.created_at || new Date().toISOString(),
          last_sign_in: null, // Would need auth admin API
        });
      }

      return Array.from(userMap.values()).sort((a, b) => {
        // Sort active users first, then by role (ADMIN first, then OPS, then CLIENT)
        if (a.is_active !== b.is_active) {
          return a.is_active ? -1 : 1;
        }
        const roleOrder = { ADMIN: 0, OPS: 1, CLIENT: 2 };
        return roleOrder[a.role] - roleOrder[b.role];
      });
    },
  });

  // Filter users by role
  const filteredUsers = users?.filter(user => 
    roleFilter === 'ALL' || user.role === roleFilter
  );

  // Fetch clients for dropdown
  const { data: clients } = useQuery({
    queryKey: ['admin-clients-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data;
    },
  });

  // Fetch active co-roast members for linking
  const { data: coroastMembers } = useQuery({
    queryKey: ['admin-coroast-members-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_members')
        .select('id, business_name, client_id')
        .eq('is_active', true)
        .order('business_name');

      if (error) throw error;
      return data;
    },
  });

  // Fetch account users (invited via invite-account-user edge function)
  const { data: accountUsers, isLoading: accountUsersLoading } = useQuery({
    queryKey: ['admin-account-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_users')
        .select(`
          id,
          user_id,
          account_id,
          is_owner,
          can_place_orders,
          can_book_roaster,
          can_manage_locations,
          can_invite_users,
          location_access,
          is_active,
          created_at,
          accounts:account_id (account_name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get profiles for these users
      const userIds = data?.map(au => au.user_id) || [];
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name, email')
        .in('user_id', userIds);

      return (data || []).map(au => ({
        ...au,
        account_name: (au.accounts as any)?.account_name || 'Unknown',
        email: profiles?.find(p => p.user_id === au.user_id)?.email || 'Unknown',
        name: profiles?.find(p => p.user_id === au.user_id)?.name || null,
      }));
    },
  });

  const handleInvite = async () => {
    if (!inviteEmail || !inviteRole) {
      toast.error('Email and role are required');
      return;
    }

    if (inviteRole === 'CLIENT' && !inviteClientId) {
      toast.error('Please select a client for CLIENT role');
      return;
    }

    setIsInviting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        toast.error('Not authenticated');
        return;
      }

      const response = await supabase.functions.invoke('invite-user', {
        body: {
          email: inviteEmail,
          role: inviteRole,
          client_id: inviteRole === 'CLIENT' ? inviteClientId : undefined,
          coroast_member_id: inviteRole === 'CLIENT' && inviteMemberId ? inviteMemberId : undefined,
          name: inviteName || undefined,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to invite user');
      }

      const data = response.data;

      // Handle specific error codes
      if (data?.error === 'USER_EXISTS_WITH_ROLE' || data?.error === 'USER_EXISTS_NO_ROLE') {
        toast.error(data.message, {
          action: {
            label: 'Resend Invite',
            onClick: () => {
              if (data.user_id) {
                handleResendInviteById(data.user_id);
              }
            }
          },
          duration: 10000,
        });
        return;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Verify email was actually sent
      if (!data?.email_sent) {
        toast.warning('User created but invitation email may not have been sent. Check email configuration.');
      } else {
        toast.success(data?.message || 'Invitation email sent successfully');
      }
      
      setShowInviteModal(false);
      resetInviteForm();
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (error: any) {
      console.error('Invite error:', error);
      toast.error(error.message || 'Failed to invite user');
    } finally {
      setIsInviting(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedUser) return;

    if (editRole === 'CLIENT' && !editClientId) {
      toast.error('Please select a client for CLIENT role');
      return;
    }

    setIsEditing(true);
    try {
      const response = await supabase.functions.invoke('update-user', {
        body: {
          user_id: selectedUser.user_id,
          role: editRole,
          client_id: editRole === 'CLIENT' ? editClientId : null,
          coroast_member_id: editRole === 'CLIENT' && editMemberId ? editMemberId : null,
          name: editName || undefined,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to update user');
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      toast.success('User updated successfully');
      setShowEditModal(false);
      setSelectedUser(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (error: any) {
      console.error('Update error:', error);
      toast.error(error.message || 'Failed to update user');
    } finally {
      setIsEditing(false);
    }
  };

  const handleToggleActive = async (user: UserWithDetails) => {
    try {
      const response = await supabase.functions.invoke('update-user', {
        body: {
          user_id: user.user_id,
          is_active: !user.is_active,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      toast.success(user.is_active ? 'User disabled' : 'User enabled');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (error: any) {
      toast.error(error.message || 'Failed to update user');
    }
  };

  const handleResendInvite = async (user: UserWithDetails) => {
    await handleResendInviteById(user.user_id);
  };

  const handleResendInviteById = async (userId: string) => {
    try {
      const response = await supabase.functions.invoke('resend-invite', {
        body: { user_id: userId },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const data = response.data;

      if (data?.error) {
        throw new Error(data.error);
      }

      if (!data?.email_sent) {
        toast.warning('Resend attempted but email may not have been sent.');
      } else {
        toast.success(data?.message || 'Invitation email sent');
      }
    } catch (error: any) {
      console.error('Resend invite error:', error);
      toast.error(error.message || 'Failed to resend invite');
    }
  };

  // DEV: Copy invite link to clipboard for debugging email issues
  const handleCopyInviteLink = async (user: UserWithDetails) => {
    try {
      const response = await supabase.functions.invoke('resend-invite', {
        body: { user_id: user.user_id, generate_link_only: true },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const data = response.data;

      if (data?.error) {
        throw new Error(data.error);
      }

      if (data?.link) {
        await navigator.clipboard.writeText(data.link);
        toast.success('Invite link copied to clipboard', {
          description: 'This link is for debugging only. Expires in 24h.',
          duration: 5000,
        });
      } else {
        toast.error('No link returned from server');
      }
    } catch (error: any) {
      console.error('Copy link error:', error);
      toast.error(error.message || 'Failed to generate invite link');
    }
  };

  // DEV: Copy reset link with full debug info
  const handleCopyResetLinkDebug = async (user: UserWithDetails) => {
    try {
      const response = await supabase.functions.invoke('resend-invite', {
        body: { user_id: user.user_id, generate_link_only: true, debug_mode: true },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const data = response.data;

      if (data?.error) {
        throw new Error(data.error);
      }

      if (data?.link) {
        await navigator.clipboard.writeText(data.link);
        
        // Show debug info in console
        console.log('=== AUTH LINK DEBUG ===');
        console.log('Link:', data.link);
        if (data.debug) {
          console.log('SITE_URL:', data.debug.site_url);
          console.log('redirectTo requested:', data.debug.redirect_to_requested);
          console.log('Supabase URL:', data.debug.supabase_url);
          console.log('Link host:', data.debug.link_host);
          console.log('Link redirect_to param:', data.debug.link_redirect_to);
        }
        console.log('=======================');
        
        // Show debug in toast
        const debugInfo = data.debug 
          ? `Site: ${data.debug.site_url}\nRedirectTo: ${data.debug.link_redirect_to || 'NOT SET'}`
          : 'No debug info';
        
        toast.success('Reset link copied (debug mode)', {
          description: debugInfo,
          duration: 10000,
        });
      } else {
        toast.error('No link returned from server');
      }
    } catch (error: any) {
      console.error('Copy reset link debug error:', error);
      toast.error(error.message || 'Failed to generate reset link');
    }
  };

  const resetInviteForm = () => {
    setInviteEmail('');
    setInviteName('');
    setInviteRole('OPS');
    setInviteClientId('');
    setInviteMemberId('');
  };

  const openEditModal = (user: UserWithDetails) => {
    setSelectedUser(user);
    setEditRole(user.role);
    setEditClientId(user.client_id || '');
    setEditName(user.name || '');
    // Find if this client is linked to a coroast member
    const linkedMember = coroastMembers?.find(m => m.client_id === user.client_id);
    setEditMemberId(linkedMember?.id || '');
    setShowEditModal(true);
  };

  const getRoleBadgeVariant = (role: AppRole) => {
    switch (role) {
      case 'ADMIN': return 'destructive';
      case 'OPS': return 'default';
      case 'CLIENT': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users & Access</h1>
          <p className="text-muted-foreground">
            Manage user accounts and access permissions
          </p>
        </div>
        <Button onClick={() => setShowInviteModal(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Invite User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Users</CardTitle>
              <CardDescription>
                {filteredUsers?.length || 0} of {users?.length || 0} users
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <ToggleGroup 
                type="single" 
                value={roleFilter} 
                onValueChange={(value) => value && setRoleFilter(value as AppRole | 'ALL')}
                className="justify-start"
              >
                <ToggleGroupItem value="ALL" aria-label="All roles" className="text-xs px-3">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem value="ADMIN" aria-label="Admin only" className="text-xs px-3">
                  Admin
                </ToggleGroupItem>
                <ToggleGroupItem value="OPS" aria-label="Ops only" className="text-xs px-3">
                  Ops
                </ToggleGroupItem>
                <ToggleGroupItem value="CLIENT" aria-label="Client only" className="text-xs px-3">
                  Client
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers?.map((user) => (
                  <TableRow key={user.user_id} className={!user.is_active ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>{user.name || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.client_name || (user.role === 'CLIENT' ? <span className="text-destructive">Not assigned</span> : '—')}
                    </TableCell>
                    <TableCell>
                      {user.is_active ? (
                        <Badge variant="outline" className="text-primary border-primary">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          <Ban className="h-3 w-3 mr-1" />
                          Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(user.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditModal(user)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleResendInvite(user)}>
                            <Mail className="h-4 w-4 mr-2" />
                            Resend Invite
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopyInviteLink(user)} className="text-muted-foreground">
                            <Copy className="h-4 w-4 mr-2" />
                            Copy Invite Link
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopyResetLinkDebug(user)} className="text-muted-foreground">
                            <Link2 className="h-4 w-4 mr-2" />
                            Copy Reset Link (debug)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleToggleActive(user)}
                            className={user.is_active ? 'text-destructive' : ''}
                          >
                            {user.is_active ? (
                              <>
                                <Ban className="h-4 w-4 mr-2" />
                                Disable
                              </>
                            ) : (
                              <>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Enable
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {!filteredUsers?.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {roleFilter === 'ALL' ? 'No users found' : `No ${roleFilter.toLowerCase()} users found`}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Account Users Section */}
      <Card>
        <CardHeader>
          <CardTitle>Account Users</CardTitle>
          <CardDescription>
            Users invited via account management — linked to specific accounts with granular permissions.
            {accountUsers?.length ? ` ${accountUsers.length} account user${accountUsers.length === 1 ? '' : 's'}.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accountUsersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !accountUsers?.length ? (
            <p className="text-center text-muted-foreground py-8">No account users found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountUsers.map((au) => (
                  <TableRow key={au.id} className={!au.is_active ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{au.email}</TableCell>
                    <TableCell>{au.name || '—'}</TableCell>
                    <TableCell>{au.account_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {au.is_owner && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Owner</Badge>
                              </TooltipTrigger>
                              <TooltipContent>Account Owner</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {au.can_place_orders && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>Can place orders</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {au.can_book_roaster && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Flame className="h-3.5 w-3.5 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>Can book roaster</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {au.is_active ? (
                        <Badge variant="outline" className="text-primary border-primary">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          <Ban className="h-3 w-3 mr-1" />
                          Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(au.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invite User Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Send an invitation email to add a new user to the system.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email *</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name">Name</Label>
              <Input
                id="invite-name"
                placeholder="John Doe"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role *</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin (full access)</SelectItem>
                  <SelectItem value="OPS">Ops (operational access)</SelectItem>
                  <SelectItem value="CLIENT">Client (portal access only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteRole === 'CLIENT' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="invite-client">Client *</Label>
                  <Select value={inviteClientId} onValueChange={setInviteClientId}>
                    <SelectTrigger id="invite-client">
                      <SelectValue placeholder="Select a client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-member">Link to Co-Roast Member</Label>
                  <Select value={inviteMemberId || 'none'} onValueChange={(v) => setInviteMemberId(v === 'none' ? '' : v)}>
                    <SelectTrigger id="invite-member">
                      <SelectValue placeholder="None (standard client)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (standard client)</SelectItem>
                      {coroastMembers?.filter(m => !m.client_id || m.client_id === inviteClientId).map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.business_name}
                          {member.client_id ? ' (already linked)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Links this user to the member portal for co-roasting scheduling and billing.
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={isInviting}>
              {isInviting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Inviting...
                </>
              ) : (
                'Send Invite'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user role and permissions for {selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select value={editRole} onValueChange={(v) => setEditRole(v as AppRole)}>
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin (full access)</SelectItem>
                  <SelectItem value="OPS">Ops (operational access)</SelectItem>
                  <SelectItem value="CLIENT">Client (portal access only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editRole === 'CLIENT' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-client">Client</Label>
                  <Select value={editClientId} onValueChange={setEditClientId}>
                    <SelectTrigger id="edit-client">
                      <SelectValue placeholder="Select a client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-member">Link to Co-Roast Member</Label>
                  <Select value={editMemberId || 'none'} onValueChange={(v) => setEditMemberId(v === 'none' ? '' : v)}>
                    <SelectTrigger id="edit-member">
                      <SelectValue placeholder="None (standard client)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (standard client)</SelectItem>
                      {coroastMembers?.filter(m => !m.client_id || m.client_id === editClientId).map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.business_name}
                          {member.client_id ? ' (already linked)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Links this user to the member portal for co-roasting scheduling and billing.
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isEditing}>
              {isEditing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
