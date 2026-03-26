import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Copy, Check, FileText, Plus, CheckCircle2, ExternalLink } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type ProspectStream = Database['public']['Enums']['prospect_stream'];
type ProspectStage = Database['public']['Enums']['prospect_stage'];

const STREAM_CONFIG: { value: ProspectStream; label: string; description: string }[] = [
  { value: 'CO_ROAST', label: 'Co-Roast', description: 'Potential co-roasting member looking to rent Loring time' },
  { value: 'CONTRACT', label: 'Contract Manufacturing', description: 'Potential client looking to outsource roasting and/or packing' },
  { value: 'BOTH', label: 'Both', description: 'Could be a fit for either co-roasting or contract manufacturing' },
  { value: 'INDUSTRY_CONTACT', label: 'Industry Contact', description: 'Not a likely customer — a relationship worth tracking (importers, other roasters, retailers, industry connections)' },
];

const STAGE_OPTIONS: { value: ProspectStage; label: string }[] = [
  { value: 'AWARE', label: 'Aware' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'CONVERSATION', label: 'Conversation' },
  { value: 'AGREEMENT_SENT', label: 'Agreement Sent' },
  { value: 'ONBOARDED', label: 'Onboarded' },
];

const streamLabel = (s: ProspectStream) => STREAM_CONFIG.find(c => c.value === s)?.label ?? s;

interface Note {
  id: string;
  note_text: string;
  follow_up_by: string | null;
  created_by: string;
  created_at: string;
  author_name?: string;
}

export default function ProspectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { authUser } = useAuth();

  // Form state
  const [formBusinessName, setFormBusinessName] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formContactInfo, setFormContactInfo] = useState('');
  const [formStream, setFormStream] = useState<ProspectStream>('CO_ROAST');
  const [formStage, setFormStage] = useState<ProspectStage>('AWARE');
  const [formDirty, setFormDirty] = useState(false);

  // Notes
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [followUpBy, setFollowUpBy] = useState('');

  // Brief Me
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);

  // Convert modal
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertName, setConvertName] = useState('');
  const [convertMfg, setConvertMfg] = useState(false);
  const [convertCoroast, setConvertCoroast] = useState(false);
  const [convertTier, setConvertTier] = useState('MEMBER');
  const [convertLoading, setConvertLoading] = useState(false);

  const { data: prospect, isLoading } = useQuery({
    queryKey: ['prospect', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospects')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Created-by profile
  const { data: createdByProfile } = useQuery({
    queryKey: ['profile', prospect?.created_by],
    enabled: !!prospect?.created_by,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('name')
        .eq('user_id', prospect!.created_by)
        .single();
      return data;
    },
  });

  // Linked account
  const { data: linkedAccount } = useQuery({
    queryKey: ['account-name', prospect?.converted_to_account_id],
    enabled: !!prospect?.converted_to_account_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('id', prospect!.converted_to_account_id!)
        .single();
      return data;
    },
  });

  // Legacy linked member/client (for old conversions)
  const { data: linkedMember } = useQuery({
    queryKey: ['coroast-member-name', prospect?.converted_to_member_id],
    enabled: !!prospect?.converted_to_member_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('coroast_members')
        .select('id, business_name')
        .eq('id', prospect!.converted_to_member_id!)
        .single();
      return data;
    },
  });

  const { data: linkedClient } = useQuery({
    queryKey: ['client-name', prospect?.converted_to_client_id],
    enabled: !!prospect?.converted_to_client_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', prospect!.converted_to_client_id!)
        .single();
      return data;
    },
  });

  // Notes
  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['prospect-notes', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospect_notes')
        .select('*')
        .eq('prospect_id', id!)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const userIds = [...new Set((data ?? []).map((n: any) => n.created_by))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', userIds);
        if (profiles) profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.name]));
      }

      return (data ?? []).map((n: any) => ({
        ...n,
        author_name: profileMap[n.created_by] || 'Unknown',
      })) as Note[];
    },
  });

  // Initialize form when prospect loads
  useEffect(() => {
    if (prospect && !formDirty) {
      setFormBusinessName(prospect.business_name);
      setFormContactName(prospect.contact_name || '');
      setFormContactInfo(prospect.contact_info || '');
      setFormStream(prospect.stream as ProspectStream);
      setFormStage(prospect.stage as ProspectStage);
    }
  }, [prospect, formDirty]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('prospects')
        .update({
          business_name: formBusinessName.trim(),
          contact_name: formContactName.trim() || null,
          contact_info: formContactInfo.trim() || null,
          stream: formStream,
          stage: formStage,
        })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Prospect updated');
      setFormDirty(false);
      queryClient.invalidateQueries({ queryKey: ['prospect', id] });
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
    },
    onError: () => toast.error('Failed to update'),
  });

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('prospect_notes').insert({
        prospect_id: id!,
        note_text: noteText.trim(),
        created_by: authUser!.id,
        follow_up_by: followUpBy || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prospect-notes', id] });
      setNoteText('');
      setFollowUpBy('');
      setShowNoteForm(false);
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  const openConvertModal = () => {
    if (!prospect) return;
    setConvertName(prospect.business_name);
    const stream = prospect.stream as ProspectStream;
    setConvertMfg(stream === 'CONTRACT' || stream === 'BOTH');
    setConvertCoroast(stream === 'CO_ROAST' || stream === 'BOTH');
    setConvertTier('MEMBER');
    setConvertOpen(true);
  };

  const handleConvertToAccount = async () => {
    if (!prospect || (!convertMfg && !convertCoroast)) return;
    setConvertLoading(true);
    try {
      const programs: string[] = [];
      if (convertMfg) programs.push('MANUFACTURING');
      if (convertCoroast) programs.push('COROASTING');

      const payload: Record<string, unknown> = {
        account_name: convertName.trim(),
        programs,
        is_active: true,
        relationship_id: prospect.id,
      };
      if (convertCoroast) {
        payload.coroast_tier = convertTier;
        payload.coroast_joined_date = new Date().toISOString().split('T')[0];
      }

      const { data: account, error } = await supabase
        .from('accounts')
        .insert(payload as any)
        .select('id')
        .single();
      if (error) throw error;

      await supabase
        .from('prospects')
        .update({ converted: true, converted_to_account_id: account.id } as any)
        .eq('id', id!);

      toast.success('Converted to Account');
      navigate(`/accounts/${account.id}`);
    } catch {
      toast.error('Failed to convert');
    } finally {
      setConvertLoading(false);
    }
  };

  // Brief text
  const { data: briefText = '' } = useQuery({
    queryKey: ['prospect-brief', id],
    enabled: briefOpen,
    queryFn: async () => {
      if (!prospect) return '';
      const lines: string[] = [];
      lines.push(`Prospect: ${prospect.business_name}`);
      if (prospect.contact_name) lines.push(`Contact: ${prospect.contact_name}`);
      if (prospect.contact_info) lines.push(`Contact Info: ${prospect.contact_info}`);
      lines.push(`Stream: ${streamLabel(prospect.stream as ProspectStream)}`);
      lines.push(`Stage: ${STAGE_OPTIONS.find(s => s.value === prospect.stage)?.label || prospect.stage}`);
      lines.push(`Added: ${format(new Date(prospect.created_at), 'MMM d, yyyy')}`);
      if (prospect.converted) lines.push(`Status: Converted`);

      // Get all notes chronologically
      const { data: allNotes } = await supabase
        .from('prospect_notes')
        .select('note_text, created_by, created_at')
        .eq('prospect_id', id!)
        .order('created_at', { ascending: true });

      if (allNotes && allNotes.length > 0) {
        const userIds = [...new Set(allNotes.map(n => n.created_by))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', userIds);
        const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p.name]));

        lines.push('');
        lines.push('--- Notes ---');
        for (const n of allNotes) {
          const author = profileMap[n.created_by] || 'Unknown';
          const date = format(new Date(n.created_at), 'MMM d, yyyy');
          lines.push(`[${date}] (${author}) ${n.note_text}`);
        }
      } else {
        lines.push('');
        lines.push('No notes yet.');
      }

      return lines.join('\n');
    },
  });

  const handleCopyBrief = async () => {
    await navigator.clipboard.writeText(briefText);
    setBriefCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setBriefCopied(false), 2000);
  };

  if (isLoading) return <div className="page-container"><p className="text-muted-foreground">Loading…</p></div>;
  if (!prospect) return <div className="page-container"><p className="text-muted-foreground">Prospect not found.</p></div>;

  const showConvert = !prospect.converted && prospect.stream !== 'INDUSTRY_CONTACT';

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/prospects')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="page-title">{prospect.business_name}</h1>
        {prospect.converted && (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Converted
          </Badge>
        )}
      </div>

      {/* Section 1: Contact Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Business Name *</Label>
              <Input
                value={formBusinessName}
                onChange={(e) => { setFormBusinessName(e.target.value); setFormDirty(true); }}
              />
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input
                value={formContactName}
                onChange={(e) => { setFormContactName(e.target.value); setFormDirty(true); }}
              />
            </div>
            <div>
              <Label>Email / Phone</Label>
              <Input
                value={formContactInfo}
                onChange={(e) => { setFormContactInfo(e.target.value); setFormDirty(true); }}
                placeholder="email@example.com | 604-555-1234"
              />
            </div>
            <div>
              <Label>Stream</Label>
              <Select value={formStream} onValueChange={(v) => { setFormStream(v as ProspectStream); setFormDirty(true); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STREAM_CONFIG.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <div>
                        <span className="font-medium">{s.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground/70">{s.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={formStage} onValueChange={(v) => { setFormStage(v as ProspectStage); setFormDirty(true); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Created {format(new Date(prospect.created_at), 'MMM d, yyyy')}
            {createdByProfile && ` by ${createdByProfile.name}`}
          </div>

          {/* Conversion links */}
          {prospect.converted_to_account_id && linkedAccount && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Account</Badge>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(`/accounts/${linkedAccount.id}`)}>
                {linkedAccount.account_name} <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
          )}
          {prospect.converted_to_member_id && linkedMember && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Co-Roasting Member (legacy)</Badge>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(`/co-roasting/members/${linkedMember.id}`)}>
                {linkedMember.business_name} <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
          )}
          {prospect.converted_to_client_id && linkedClient && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Client (legacy)</Badge>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(`/clients`)}>
                {linkedClient.name} <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
          )}

          {formDirty && (
            <div className="flex justify-end">
              <Button
                disabled={!formBusinessName.trim() || updateMutation.isPending}
                onClick={() => updateMutation.mutate()}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {!showNoteForm ? (
              <Button variant="outline" size="sm" onClick={() => setShowNoteForm(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add Note
              </Button>
            ) : (
              <div className="space-y-2 border rounded-md p-3 bg-muted/30">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Type your note…"
                  className="min-h-[60px] text-sm"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Follow up by</Label>
                  <Input
                    type="date"
                    value={followUpBy}
                    onChange={(e) => setFollowUpBy(e.target.value)}
                    className="h-8 text-xs w-40"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => { setShowNoteForm(false); setNoteText(''); setFollowUpBy(''); }}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={!noteText.trim() || addNoteMutation.isPending} onClick={() => addNoteMutation.mutate()}>
                    {addNoteMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            )}

            {notesLoading ? (
              <p className="text-xs text-muted-foreground">Loading notes…</p>
            ) : notes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No notes yet.</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((note) => (
                  <li key={note.id} className="border-l-2 border-muted-foreground/20 pl-3 py-1">
                    <p className="text-sm whitespace-pre-wrap">{note.note_text}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{note.author_name}</span>
                      <span>{format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}</span>
                      {note.follow_up_by && (
                        <span className="text-primary font-medium">
                          Follow up: {format(new Date(note.follow_up_by + 'T00:00:00'), 'MMM d, yyyy')}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Brief Me */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brief Me</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBriefOpen(true)}>
            <FileText className="h-3.5 w-3.5" />
            Generate Brief
          </Button>
        </CardContent>
      </Card>

      {/* Section 4: Convert */}
      {(showConvert || prospect.converted) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversion</CardTitle>
          </CardHeader>
          <CardContent>
            {prospect.converted ? (
              <p className="text-sm text-muted-foreground">This relationship has been converted.</p>
            ) : (
              <Button variant="outline" onClick={openConvertModal}>
                Convert to Account
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Convert to Account Modal */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convert to Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Account Name</Label>
              <Input value={convertName} onChange={e => setConvertName(e.target.value)} />
            </div>
            <div>
              <Label className="mb-2 block">Programs</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={convertMfg} onChange={e => setConvertMfg(e.target.checked)} className="rounded" />
                  Manufacturing
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={convertCoroast} onChange={e => setConvertCoroast(e.target.checked)} className="rounded" />
                  Co-Roasting
                </label>
              </div>
            </div>
            {convertCoroast && (
              <div>
                <Label>Tier</Label>
                <Select value={convertTier} onValueChange={setConvertTier}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEMBER">Member</SelectItem>
                    <SelectItem value="GROWTH">Growth</SelectItem>
                    <SelectItem value="PRODUCTION">Production</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setConvertOpen(false)}>Cancel</Button>
              <Button
                disabled={!convertName.trim() || (!convertMfg && !convertCoroast) || convertLoading}
                onClick={handleConvertToAccount}
              >
                {convertLoading ? 'Converting…' : 'Convert'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Brief Me Modal */}
      <Dialog open={briefOpen} onOpenChange={setBriefOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Brief: {prospect.business_name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed text-foreground bg-muted/30 rounded-md p-4">
              {briefText || 'Compiling brief…'}
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
