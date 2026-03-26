import React, { useState, useMemo, useCallback } from 'react';
import { formatMoney } from '@/lib/formatMoney';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, startOfYear, subMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Link2, X, ChevronsUpDown, ShieldCheck, Copy, Check, FileText, Plus } from 'lucide-react';
import MemberStorageSection from '@/components/coroast/MemberStorageSection';
import { TIER_RATES } from '@/components/bookings/bookingUtils';
import type { Database } from '@/integrations/supabase/types';

type CoroastTier = Database['public']['Enums']['coroast_tier'];

const CHECKLIST_LABELS: Record<number, string> = {
  1: 'Member Agreement signed',
  2: 'Certificate of Insurance on file (minimum $5M per occurrence)',
  3: 'WCB Coverage confirmation on file',
  4: 'Equipment orientation session completed (minimum 2 hours, conducted by Home Island Coffee Partners staff)',
  5: 'Roast proficiency demonstrated and signed off by Home Island Coffee Partners staff (startup, monitoring, drop, cool-down)',
  6: 'Facility safety walkthrough completed (fire suppression, emergency shut-off, first aid)',
  7: 'Supervised roast session completed to Home Island Coffee Partners satisfaction',
};

export default function CoRoastMemberDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { authUser } = useAuth();

  // Form state
  const [formBusinessName, setFormBusinessName] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formContactPhone, setFormContactPhone] = useState('');
  const [formTier, setFormTier] = useState<CoroastTier>('MEMBER');
  const [formNotes, setFormNotes] = useState('');
  const [formClientId, setFormClientId] = useState<string | null>(null);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);

  // Notes state
  const [newNoteText, setNewNoteText] = useState('');
  const [showNoteForm, setShowNoteForm] = useState(false);

  // Brief Me state
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);

  // Member data
  const { data: member, isLoading, error } = useQuery({
    queryKey: ['coroast-member', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_members')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Populate form when member loads
  React.useEffect(() => {
    if (member && !formDirty) {
      setFormBusinessName(member.business_name);
      setFormContactName(member.contact_name ?? '');
      setFormContactEmail(member.contact_email ?? '');
      setFormContactPhone(member.contact_phone ?? '');
      setFormTier(member.tier);
      setFormNotes(member.notes_internal ?? '');
      setFormClientId(member.client_id);
    }
  }, [member]);

  // Clients for linking
  const { data: clients } = useQuery({
    queryKey: ['clients-for-linking'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, client_code, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const clientMap = useMemo(() => {
    const map = new Map<string, { name: string; client_code: string }>();
    clients?.forEach(c => map.set(c.id, c));
    return map;
  }, [clients]);

  // Profiles for checklist completed_by dropdown
  const { data: adminOpsProfiles } = useQuery({
    queryKey: ['admin-ops-profiles'],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['ADMIN', 'OPS']);
      if (!roles || roles.length === 0) return [];
      const userIds = roles.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name, is_active')
        .in('user_id', userIds)
        .eq('is_active', true);
      return profiles ?? [];
    },
  });

  // Checklist data
  const { data: checklistItems } = useQuery({
    queryKey: ['coroast-checklist', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_member_checklist')
        .select('*')
        .eq('member_id', id!)
        .order('item_number');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  // Member notes
  const { data: memberNotes } = useQuery({
    queryKey: ['coroast-member-notes', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_member_notes')
        .select('*')
        .eq('member_id', id!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Fetch author names
      const userIds = [...new Set((data ?? []).map(n => n.created_by))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', userIds);
        if (profiles) {
          profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.name]));
        }
      }
      return (data ?? []).map(n => ({ ...n, author_name: profileMap[n.created_by] || 'Unknown' }));
    },
    enabled: !!id,
  });

  // Client notes (if linked)
  const { data: clientNotes } = useQuery({
    queryKey: ['client-notes-for-member', member?.client_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_notes')
        .select('*')
        .eq('client_id', member!.client_id!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const userIds = [...new Set((data ?? []).map(n => n.created_by))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', userIds);
        if (profiles) {
          profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.name]));
        }
      }
      return (data ?? []).map(n => ({ ...n, author_name: profileMap[n.created_by] || 'Unknown' }));
    },
    enabled: !!member?.client_id,
  });

  // Stats
  const { data: stats } = useQuery({
    queryKey: ['coroast-member-stats', id],
    queryFn: async () => {
      const now = new Date();
      const todayStr = format(now, 'yyyy-MM-dd');
      const ytdStart = format(startOfYear(now), 'yyyy-MM-dd');
      const t12Start = format(subMonths(now, 12), 'yyyy-MM-dd');

      // Bookings
      const { data: bookings } = await supabase
        .from('coroast_bookings')
        .select('booking_date, status, duration_hours')
        .eq('member_id', id!)
        .in('status', ['CONFIRMED', 'COMPLETED', 'NO_SHOW']);

      const allBookings = bookings ?? [];
      const totalSessions = allBookings.length;
      const totalHours = allBookings.reduce((sum, b) => sum + (Number(b.duration_hours) || 0), 0);

      const futureConfirmed = allBookings
        .filter(b => b.booking_date >= todayStr && b.status === 'CONFIRMED')
        .sort((a, b) => a.booking_date.localeCompare(b.booking_date));
      const lastScheduled = futureConfirmed.length > 0 ? futureConfirmed[futureConfirmed.length - 1].booking_date : null;

      const pastCompleted = allBookings
        .filter(b => b.booking_date < todayStr && b.status === 'COMPLETED')
        .sort((a, b) => b.booking_date.localeCompare(a.booking_date));
      const lastCompleted = pastCompleted.length > 0 ? pastCompleted[0].booking_date : null;

      // Billing
      const { data: invoices } = await supabase
        .from('coroast_invoices')
        .select('total_amount, period_start, period_end')
        .eq('member_id', id!);

      const allInvoices = invoices ?? [];
      const totalBilledAllTime = allInvoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
      const totalBilledT12 = allInvoices
        .filter(inv => inv.period_end >= t12Start)
        .reduce((sum, inv) => sum + Number(inv.total_amount), 0);
      const totalBilledYTD = allInvoices
        .filter(inv => inv.period_end >= ytdStart)
        .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

      return {
        totalSessions,
        totalHours,
        lastScheduled,
        lastCompleted,
        totalBilledAllTime,
        totalBilledT12,
        totalBilledYTD,
      };
    },
    enabled: !!id,
  });

  // Update member mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
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
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Member updated');
      setFormDirty(false);
      queryClient.invalidateQueries({ queryKey: ['coroast-member', id] });
      queryClient.invalidateQueries({ queryKey: ['coroast-members'] });
    },
    onError: () => toast.error('Failed to update member'),
  });

  // Checklist toggle mutation
  const checklistMutation = useMutation({
    mutationFn: async ({ itemNumber, completed }: { itemNumber: number; completed: boolean }) => {
      const updates = {
        completed,
        completed_date: completed ? format(new Date(), 'yyyy-MM-dd') : null,
        completed_by: completed ? authUser?.id ?? null : null,
        updated_at: new Date().toISOString(),
      };

      // Upsert the checklist item
      const { error } = await supabase
        .from('coroast_member_checklist')
        .upsert({
          member_id: id!,
          item_number: itemNumber,
          ...updates,
        }, { onConflict: 'member_id,item_number' });
      if (error) throw error;

      // Check if all 7 items are now completed
      const { data: allItems } = await supabase
        .from('coroast_member_checklist')
        .select('item_number, completed')
        .eq('member_id', id!);

      const completedMap = new Map((allItems ?? []).map(i => [i.item_number, i.completed]));
      // Override with current change
      completedMap.set(itemNumber, completed);

      const allCompleted = [1, 2, 3, 4, 5, 6, 7].every(n => completedMap.get(n) === true);

      // Update certified status on member
      const certUpdates: Record<string, unknown> = { certified: allCompleted };
      if (allCompleted) {
        certUpdates.certified_date = format(new Date(), 'yyyy-MM-dd');
        certUpdates.certified_by = authUser?.id ?? null;
      } else {
        certUpdates.certified_date = null;
        certUpdates.certified_by = null;
      }

      const { error: certError } = await supabase
        .from('coroast_members')
        .update(certUpdates)
        .eq('id', id!);
      if (certError) throw certError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coroast-checklist', id] });
      queryClient.invalidateQueries({ queryKey: ['coroast-member', id] });
      queryClient.invalidateQueries({ queryKey: ['coroast-members'] });
    },
    onError: () => toast.error('Failed to update checklist'),
  });

  // Add note mutation
  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('coroast_member_notes')
        .insert({
          member_id: id!,
          note_text: newNoteText.trim(),
          created_by: authUser!.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewNoteText('');
      setShowNoteForm(false);
      toast.success('Note added');
      queryClient.invalidateQueries({ queryKey: ['coroast-member-notes', id] });
    },
    onError: () => toast.error('Failed to add note'),
  });

  // Build checklist state map
  const checklistMap = useMemo(() => {
    const map = new Map<number, { completed: boolean; completed_date: string | null; completed_by: string | null }>();
    checklistItems?.forEach(item => {
      map.set(item.item_number, {
        completed: item.completed,
        completed_date: item.completed_date,
        completed_by: item.completed_by,
      });
    });
    return map;
  }, [checklistItems]);

  const profileNameMap = useMemo(() => {
    const map = new Map<string, string>();
    adminOpsProfiles?.forEach(p => map.set(p.user_id, p.name));
    return map;
  }, [adminOpsProfiles]);

  // Brief Me text builder
  const { data: briefText } = useQuery({
    queryKey: ['coroast-member-brief', id],
    enabled: briefOpen,
    queryFn: async () => {
      if (!member || !stats) return 'Loading...';
      const lines: string[] = [];
      lines.push(`Co-Roasting Member: ${member.business_name}`);
      if (member.contact_name) lines.push(`Contact: ${member.contact_name}`);
      if (member.contact_email) lines.push(`Email: ${member.contact_email}`);
      lines.push(`Tier: ${TIER_RATES[member.tier]?.label ?? member.tier}`);
      lines.push(`Certified: ${member.certified ? 'Yes' : 'No'}`);
      lines.push(`Account Created: ${format(new Date(member.created_at), 'MMM d, yyyy')}`);
      lines.push(`Status: ${member.is_active ? 'Active' : 'Inactive'}`);

      // Checklist
      const completedCount = [1, 2, 3, 4, 5, 6, 7].filter(n => checklistMap.get(n)?.completed).length;
      lines.push(`Checklist: ${completedCount}/7 items completed`);
      for (let i = 1; i <= 7; i++) {
        const item = checklistMap.get(i);
        const status = item?.completed ? 'Done' : 'Pending';
        lines.push(`  ${i}. ${CHECKLIST_LABELS[i]} - ${status}`);
      }

      // Stats
      lines.push('');
      lines.push('--- Statistics ---');
      if (stats.lastScheduled) lines.push(`Last Scheduled Booking: ${format(new Date(stats.lastScheduled + 'T00:00:00'), 'MMM d, yyyy')}`);
      if (stats.lastCompleted) lines.push(`Last Completed Session: ${format(new Date(stats.lastCompleted + 'T00:00:00'), 'MMM d, yyyy')}`);
      lines.push(`Total Sessions: ${stats.totalSessions}`);
      lines.push(`Total Hours Scheduled: ${stats.totalHours.toFixed(1)}h`);
      lines.push(`Total Billed (All Time): ${formatMoney(stats.totalBilledAllTime)}`);
      lines.push(`Total Billed (Last 12 Months): ${formatMoney(stats.totalBilledT12)}`);
      lines.push(`Total Billed (YTD): ${formatMoney(stats.totalBilledYTD)}`);

      // Linked client
      if (member.client_id && clientMap.get(member.client_id)) {
        lines.push('');
        lines.push(`Linked Client Account: ${clientMap.get(member.client_id)!.name}`);
      }

      // Notes
      if (memberNotes && memberNotes.length > 0) {
        lines.push('');
        lines.push('--- Member Notes ---');
        for (const n of [...memberNotes].reverse()) {
          lines.push(`[${format(new Date(n.created_at), 'MMM d, yyyy')}] (${n.author_name}) ${n.note_text}`);
        }
      }

      if (clientNotes && clientNotes.length > 0) {
        lines.push('');
        lines.push('--- Notes from Client Account ---');
        for (const n of [...clientNotes].reverse()) {
          lines.push(`[${format(new Date(n.created_at), 'MMM d, yyyy')}] (${n.author_name}) ${n.note_text}`);
        }
      }

      return lines.join('\n');
    },
  });

  const handleCopyBrief = async () => {
    if (briefText) {
      await navigator.clipboard.writeText(briefText);
      setBriefCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setBriefCopied(false), 2000);
    }
  };

  const selectedClientName = formClientId ? clientMap.get(formClientId)?.name : null;

  const markFormDirty = useCallback(() => setFormDirty(true), []);

  if (isLoading) return <div className="page-container"><p className="text-muted-foreground">Loading…</p></div>;
  if (error || !member) return <div className="page-container"><p className="text-destructive">Member not found.</p></div>;

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/co-roasting/members')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="page-title">{member.business_name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="font-mono text-xs">{TIER_RATES[member.tier]?.label ?? member.tier}</Badge>
            {member.certified && (
              <Badge variant="default" className="text-xs gap-1">
                <ShieldCheck className="h-3 w-3" />
                Certified
              </Badge>
            )}
            {!member.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBriefOpen(true)}>
          <FileText className="h-4 w-4" />
          Brief Me
        </Button>
      </div>

      {/* SECTION 1 — Member Info */}
      <Card>
        <CardHeader>
          <CardTitle>Member Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Business Name *</Label>
              <Input value={formBusinessName} onChange={(e) => { setFormBusinessName(e.target.value); markFormDirty(); }} />
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input value={formContactName} onChange={(e) => { setFormContactName(e.target.value); markFormDirty(); }} />
            </div>
            <div>
              <Label>Contact Email</Label>
              <Input type="email" value={formContactEmail} onChange={(e) => { setFormContactEmail(e.target.value); markFormDirty(); }} />
            </div>
            <div>
              <Label>Contact Phone</Label>
              <Input value={formContactPhone} onChange={(e) => { setFormContactPhone(e.target.value); markFormDirty(); }} />
            </div>
            <div>
              <Label>Tier</Label>
              <Select value={formTier} onValueChange={(v) => { setFormTier(v as CoroastTier); markFormDirty(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member</SelectItem>
                  <SelectItem value="GROWTH">Growth</SelectItem>
                  <SelectItem value="PRODUCTION">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Link to Client Account</Label>
              <div className="flex items-center gap-2">
                <Popover open={clientPopoverOpen} onOpenChange={setClientPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
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
                          {clients?.map(c => (
                            <CommandItem key={c.id} value={c.name} onSelect={() => { setFormClientId(c.id); setClientPopoverOpen(false); markFormDirty(); }}>
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
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => { setFormClientId(null); markFormDirty(); }}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {member.client_id && clientMap.get(member.client_id) && (
                <Button variant="outline" size="sm" className="mt-2 text-xs gap-1" onClick={() => navigate('/clients')}>
                  <Link2 className="h-3 w-3" />
                  View Client Account
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label>Internal Notes</Label>
            <Textarea value={formNotes} onChange={(e) => { setFormNotes(e.target.value); markFormDirty(); }} rows={3} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Created {format(new Date(member.created_at), 'MMM d, yyyy')}
            </p>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending || !formDirty}>
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2 — Certification Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Certification Checklist
            {member.certified && (
              <Badge variant="default" className="text-xs gap-1">
                <ShieldCheck className="h-3 w-3" />
                All items complete — Certified
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4">
            {[1, 2, 3, 4, 5, 6, 7].map(itemNum => {
              const item = checklistMap.get(itemNum);
              const isCompleted = item?.completed ?? false;
              return (
                <li key={itemNum} className="flex items-start gap-3 border-b pb-3 last:border-0">
                  <Checkbox
                    checked={isCompleted}
                    onCheckedChange={(checked) => {
                      checklistMutation.mutate({ itemNumber: itemNum, completed: !!checked });
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                      {CHECKLIST_LABELS[itemNum]}
                    </p>
                    {isCompleted && item?.completed_date && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Completed {format(new Date(item.completed_date + 'T00:00:00'), 'MMM d, yyyy')}
                        {item.completed_by && profileNameMap.get(item.completed_by)
                          ? ` by ${profileNameMap.get(item.completed_by)}`
                          : ''}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* SECTION 3 — Storage */}
      <MemberStorageSection memberId={id!} tier={member.tier} />

      {/* SECTION 4 — Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showNoteForm ? (
            <Button variant="outline" size="sm" onClick={() => setShowNoteForm(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add Note
            </Button>
          ) : (
            <div className="space-y-2 border rounded-md p-3 bg-muted/30">
              <Textarea
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder="Type your note…"
                className="min-h-[60px] text-sm"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setShowNoteForm(false); setNewNoteText(''); }}>Cancel</Button>
                <Button size="sm" disabled={!newNoteText.trim() || addNoteMutation.isPending} onClick={() => addNoteMutation.mutate()}>
                  {addNoteMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          )}

          {memberNotes && memberNotes.length > 0 ? (
            <ul className="space-y-2">
              {memberNotes.map(note => (
                <li key={note.id} className="border-l-2 border-muted-foreground/20 pl-3 py-1">
                  <p className="text-sm whitespace-pre-wrap">{note.note_text}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{note.author_name}</span>
                    <span>{format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground italic">No notes yet.</p>
          )}

          {/* Client Account Notes */}
          {member.client_id && (
            <div className="mt-6 pt-4 border-t">
              <h4 className="text-sm font-medium mb-3">Notes from Client Account</h4>
              {clientNotes && clientNotes.length > 0 ? (
                <ul className="space-y-2">
                  {clientNotes.map(note => (
                    <li key={note.id} className="border-l-2 border-muted-foreground/20 pl-3 py-1">
                      <p className="text-sm whitespace-pre-wrap">{note.note_text}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{note.author_name}</span>
                        <span>{format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">No client notes.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SECTION 4 — Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          {stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatItem label="Account Created" value={format(new Date(member.created_at), 'MMM d, yyyy')} />
              <StatItem label="Last Scheduled Booking" value={stats.lastScheduled ? format(new Date(stats.lastScheduled + 'T00:00:00'), 'MMM d, yyyy') : 'None'} />
              <StatItem label="Last Completed Session" value={stats.lastCompleted ? format(new Date(stats.lastCompleted + 'T00:00:00'), 'MMM d, yyyy') : 'None'} />
              <StatItem label="Total Sessions" value={String(stats.totalSessions)} />
              <StatItem label="Total Hours Scheduled" value={`${stats.totalHours.toFixed(1)}h`} />
              <StatItem label="Total Billed (All Time)" value={formatMoney(stats.totalBilledAllTime)} />
              <StatItem label="Total Billed (T12)" value={formatMoney(stats.totalBilledT12)} />
              <StatItem label="Total Billed (YTD)" value={formatMoney(stats.totalBilledYTD)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading stats…</p>
          )}
        </CardContent>
      </Card>

      {/* SECTION 5 — Invoice History */}
      <InvoiceHistorySection memberId={id!} />

      {/* Brief Me Dialog */}
      <Dialog open={briefOpen} onOpenChange={setBriefOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Brief: {member.business_name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground bg-muted/30 rounded-md p-4">
              {briefText || 'Compiling brief...'}
            </pre>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setBriefOpen(false)}>Close</Button>
            <Button onClick={handleCopyBrief} className="gap-1.5">
              {briefCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {briefCopied ? 'Copied' : 'Copy to Clipboard'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}

function InvoiceHistorySection({ memberId }: { memberId: string }) {
  const { data: invoiceHistory, isLoading } = useQuery({
    queryKey: ['coroast-invoice-history', memberId],
    queryFn: async () => {
      const { data: invoices, error } = await supabase
        .from('coroast_invoices')
        .select('id, period_start, period_end, total_amount, created_at, created_by')
        .eq('member_id', memberId)
        .order('period_start', { ascending: false });
      if (error) throw error;

      // Resolve creator names
      const creatorIds = [...new Set((invoices ?? []).map((i) => i.created_by).filter(Boolean))] as string[];
      let profileMap: Record<string, string> = {};
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', creatorIds);
        if (profiles) {
          profileMap = Object.fromEntries(profiles.map((p) => [p.user_id, p.name]));
        }
      }

      return (invoices ?? []).map((inv) => ({
        ...inv,
        creator_name: inv.created_by ? profileMap[inv.created_by] || 'Unknown' : 'System',
      }));
    },
    enabled: !!memberId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !invoiceHistory || invoiceHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No invoices recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {invoiceHistory.map((inv) => {
              const periodLabel = format(new Date(inv.period_start + 'T00:00:00'), 'MMMM yyyy');
              return (
                <div key={inv.id} className="flex items-center justify-between border-b last:border-0 py-2">
                  <div>
                    <p className="text-sm font-medium">{periodLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      Recorded {format(new Date(inv.created_at), 'MMM d, yyyy')} by {inv.creator_name}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">${Number(inv.total_amount).toFixed(2)}</p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
