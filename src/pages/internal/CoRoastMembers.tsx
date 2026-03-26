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
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, ShieldCheck, FileText, Link2 } from 'lucide-react';
import { TIER_RATES } from '@/components/bookings/bookingUtils';
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
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [waiverMember, setWaiverMember] = useState<CoroastMember | null>(null);

  // Create form state
  const [formBusinessName, setFormBusinessName] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formContactPhone, setFormContactPhone] = useState('');
  const [formTier, setFormTier] = useState<CoroastTier>('MEMBER');
  const [formNotes, setFormNotes] = useState('');

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
    setFormTier('MEMBER');
    setFormNotes('');
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

  const handleSubmit = () => {
    if (!formBusinessName.trim()) {
      toast.error('Business name is required');
      return;
    }
    createMutation.mutate();
  };

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Co-Roasting Members</h1>
        <Button onClick={() => { resetForm(); setShowDialog(true); }}>
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
                <li
                  key={m.id}
                  className={`border-b pb-3 last:border-0 cursor-pointer hover:bg-muted/50 rounded-md px-2 py-2 -mx-2 transition-colors ${!m.is_active ? 'opacity-60' : ''}`}
                  onClick={() => navigate(`/co-roasting/members/${m.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-mono text-xs">
                        {TIER_RATES[m.tier]?.label ?? m.tier}
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
                          onClick={(e) => { e.stopPropagation(); navigate('/clients'); }}
                        >
                          <Link2 className="h-3 w-3" />
                          View Client Account
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
                      <Button variant="ghost" size="sm" onClick={() => setWaiverMember(m)} title="Waiver history">
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/co-roasting/members/${m.id}`)}>
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

      {/* Create Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Member</DialogTitle>
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
                  <SelectItem value="MEMBER">Member</SelectItem>
                  <SelectItem value="GROWTH">Growth</SelectItem>
                  <SelectItem value="PRODUCTION">Production</SelectItem>
                </SelectContent>
              </Select>
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
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving…' : 'Create'}
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
