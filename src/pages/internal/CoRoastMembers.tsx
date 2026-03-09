import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Pencil, ShieldCheck, FileText, Link2, ExternalLink, ChevronsUpDown, X } from 'lucide-react';
import { WaiverHistoryPanel } from '@/components/bookings/WaiverHistoryPanel';
import { useNavigate } from 'react-router-dom';
import type { Database } from '@/integrations/supabase/types';

type CoroastTier = Database['public']['Enums']['coroast_tier'];

interface CoroastMember {
  id: string;
  business_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  tier: CoroastTier;
  is_active: boolean;
  certified: boolean;
  certified_date: string | null;
  certified_by: string | null;
  joined_date: string;
  notes_internal: string | null;
  client_id: string | null;
}

interface SimpleClient {
  id: string;
  name: string;
  client_code: string;
  is_active: boolean;
}

export default function CoRoastMembers() {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const [editingMember, setEditingMember] = useState<CoroastMember | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [waiverMember, setWaiverMember] = useState<CoroastMember | null>(null);

  // Form state
  const [formBusinessName, setFormBusinessName] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formContactPhone, setFormContactPhone] = useState('');
  const [formTier, setFormTier] = useState<CoroastTier>('ACCESS');
  const [formNotes, setFormNotes] = useState('');
  const [formClientId, setFormClientId] = useState<string | null>(null);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);

  const { data: members, isLoading, error } = useQuery({
    queryKey: ['coroast-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_members')
        .select('*')
        .order('business_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CoroastMember[];
    },
  });

  const { data: clients } = useQuery({
    queryKey: ['clients-for-linking'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, client_code, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as SimpleClient[];
    },
  });

  // Build a map of client_id -> client for display
  const clientMap = useMemo(() => {
    const map = new Map<string, SimpleClient>();
    clients?.forEach(c => map.set(c.id, c));
    return map;
  }, [clients]);

  const displayedMembers = useMemo(() => {
    if (!members) return [];
    return showInactive ? members : members.filter(m => m.is_active);
  }, [members, showInactive]);

  const inactiveCount = useMemo(() => {
    return members?.filter(m => !m.is_active).length ?? 0;
  }, [members]);

  const resetForm = useCallback(() => {
    setFormBusinessName('');
    setFormContactName('');
    setFormContactEmail('');
    setFormContactPhone('');
    setFormTier('ACCESS');
    setFormNotes('');
    setFormClientId(null);
    setEditingMember(null);
  }, []);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setShowDialog(true);
  }, [resetForm]);

  const openEditDialog = useCallback((member: CoroastMember) => {
    setEditingMember(member);
    setFormBusinessName(member.business_name);
    setFormContactName(member.contact_name ?? '');
    setFormContactEmail(member.contact_email ?? '');
    setFormContactPhone(member.contact_phone ?? '');
    setFormTier(member.tier);
    setFormNotes(member.notes_internal ?? '');
    setFormClientId(member.client_id);
    setShowDialog(true);
  }, []);

  const closeDialog = useCallback(() => {
    setShowDialog(false);
    resetForm();
  }, [resetForm]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('coroast_members')
        .insert({
          business_name: formBusinessName.trim(),
          contact_name: formContactName.trim() || null,
          contact_email: formContactEmail.trim() || null,
          contact_phone: formContactPhone.trim() || null,
          tier: formTier,
          notes_internal: formNotes.trim() || null,
          client_id: formClientId,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Member created');
      queryClient.invalidateQueries({ queryKey: ['coroast-members'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to create member');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingMember) return;
      const { error } = await supabase
        .from('coroast_members')
        .update({
          business_name: formBusinessName.trim(),
          contact_name: formContactName.trim() || null,
          contact_email: formContactEmail.trim() || null,
          contact_phone: formContactPhone.trim() || null,
          tier: formTier,
          notes_internal: formNotes.trim() || null,
          client_id: formClientId,
        })
        .eq('id', editingMember.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Member updated');
      queryClient.invalidateQueries({ queryKey: ['coroast-members'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update member');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('coroast_members')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.is_active ? 'Member reactivated' : 'Member deactivated');
      queryClient.invalidateQueries({ queryKey: ['coroast-members'] });
    },
    onError: () => toast.error('Failed to update member status'),
  });

  const toggleCertifiedMutation = useMutation({
    mutationFn: async ({ id, certified }: { id: string; certified: boolean }) => {
      const updates: Record<string, unknown> = { certified };
      if (certified) {
        updates.certified_date = new Date().toISOString().split('T')[0];
        updates.certified_by = authUser?.id ?? null;
      } else {
        updates.certified_date = null;
        updates.certified_by = null;
      }
      const { error } = await supabase
        .from('coroast_members')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.certified ? 'Member certified' : 'Certification removed');
      queryClient.invalidateQueries({ queryKey: ['coroast-members'] });
    },
    onError: () => toast.error('Failed to update certification'),
  });

  const handleSubmit = () => {
    if (!formBusinessName.trim()) {
      toast.error('Business name is required');
      return;
    }
    if (editingMember) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const selectedClientName = formClientId ? clientMap.get(formClientId)?.name : null;

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Co-Roasting Members</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Member
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Members</CardTitle>
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={showInactive}
                onCheckedChange={(checked) => setShowInactive(!!checked)}
              />
              Show inactive ({inactiveCount})
            </label>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : displayedMembers.length === 0 ? (
            <p className="text-muted-foreground">No members to display.</p>
          ) : (
            <ul className="space-y-3">
              {displayedMembers.map((m) => (
                <li key={m.id} className={`border-b pb-3 last:border-0 ${!m.is_active ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono text-xs">
                        {m.tier}
                      </Badge>
                      <div>
                        <span className="font-medium">{m.business_name}</span>
                        {m.contact_name && (
                          <span className="ml-2 text-sm text-muted-foreground">{m.contact_name}</span>
                        )}
                        {m.contact_email && (
                          <span className="ml-2 text-sm text-muted-foreground">{m.contact_email}</span>
                        )}
                      </div>
                      {m.client_id && clientMap.get(m.client_id) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1 h-7"
                          onClick={() => navigate('/clients')}
                        >
                          <Link2 className="h-3 w-3" />
                          View Client Account
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {m.certified ? (
                        <Badge variant="default" className="text-xs gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Certified
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Not Certified</Badge>
                      )}
                      {!m.is_active && (
                        <Badge variant="secondary" className="text-xs">Inactive</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        title={m.certified ? 'Remove certification' : 'Mark as certified'}
                        onClick={() => toggleCertifiedMutation.mutate({ id: m.id, certified: !m.certified })}
                      >
                        <ShieldCheck className={`h-4 w-4 ${m.certified ? 'text-primary' : 'text-muted-foreground'}`} />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setWaiverMember(m)} title="Waiver history">
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(m)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActiveMutation.mutate({ id: m.id, is_active: !m.is_active })}
                        className={m.is_active ? 'text-destructive hover:text-destructive hover:bg-destructive/10' : 'text-primary'}
                      >
                        {m.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingMember ? 'Edit Member' : 'Add New Member'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="businessName">Business Name *</Label>
              <Input
                id="businessName"
                value={formBusinessName}
                onChange={(e) => setFormBusinessName(e.target.value)}
                placeholder="Acme Roasters"
              />
            </div>
            <div>
              <Label htmlFor="contactName">Contact Name</Label>
              <Input
                id="contactName"
                value={formContactName}
                onChange={(e) => setFormContactName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="contactEmail">Contact Email</Label>
              <Input
                id="contactEmail"
                type="email"
                value={formContactEmail}
                onChange={(e) => setFormContactEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="contactPhone">Contact Phone</Label>
              <Input
                id="contactPhone"
                value={formContactPhone}
                onChange={(e) => setFormContactPhone(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="tier">Tier</Label>
              <Select value={formTier} onValueChange={(v) => setFormTier(v as CoroastTier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACCESS">Access</SelectItem>
                  <SelectItem value="GROWTH">Growth</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Link to Client Account</Label>
              <div className="flex items-center gap-2">
                <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between font-normal"
                    >
                      {selectedClientName ?? 'No client linked'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search clients…" />
                      <CommandList>
                        <CommandEmpty>No clients found.</CommandEmpty>
                        <CommandGroup>
                          {clients?.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={c.name}
                              onSelect={() => {
                                setFormClientId(c.id);
                                setClientPopoverOpen(false);
                              }}
                            >
                              <span className="font-mono text-xs mr-2 text-muted-foreground">{c.client_code}</span>
                              {c.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {formClientId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setFormClientId(null)}
                    title="Remove link"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Optional — link this member to a contract manufacturing client account.
              </p>
            </div>
            <div>
              <Label htmlFor="notes">Internal Notes</Label>
              <Textarea
                id="notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={isPending}>
                {isPending ? 'Saving…' : editingMember ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <WaiverHistoryPanel
        open={!!waiverMember}
        onOpenChange={(o) => { if (!o) setWaiverMember(null); }}
        memberId={waiverMember?.id ?? ''}
        memberName={waiverMember?.business_name ?? ''}
      />
    </div>
  );
}
