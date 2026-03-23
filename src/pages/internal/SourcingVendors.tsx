import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Search, Plus, Check, FileText, Trash2 } from 'lucide-react';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';

interface Vendor {
  id: string;
  name: string;
  abbreviation: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  payment_terms_days: number | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface VendorNote {
  id: string;
  vendor_id: string;
  note: string;
  created_by: string;
  created_at: string;
  author_name?: string;
}

export default function SourcingVendors() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ['green-vendors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendors')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const filtered = vendors.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-container space-y-6">
      <GreenCoffeeAlerts />
      <div className="page-header">
        <div>
          <h1 className="page-title">Vendors</h1>
          <p className="text-sm text-muted-foreground">Green coffee suppliers</p>
        </div>
        <Button onClick={() => setAddModalOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Vendor
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search vendors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search ? 'No vendors match your search.' : 'No vendors yet. Add one to get started.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              onView={() => setSelectedVendorId(vendor.id)}
            />
          ))}
        </div>
      )}

      <VendorDetailPanel
        vendorId={selectedVendorId}
        onClose={() => setSelectedVendorId(null)}
      />

      <AddVendorModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
      />
    </div>
  );
}

// ─── Vendor Card ───────────────────────────────────────────

function VendorCard({ vendor, onView }: { vendor: Vendor; onView: () => void }) {
  return (
    <Card className={vendor.is_active ? '' : 'opacity-50'}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-base leading-tight">{vendor.name}</h3>
          <Badge variant={vendor.is_active ? 'default' : 'secondary'} className="shrink-0 text-xs">
            {vendor.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        {(vendor.contact_name || vendor.contact_email) && (
          <p className="text-sm text-muted-foreground truncate">
            {[vendor.contact_name, vendor.contact_email].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {vendor.payment_terms_days ? `Net ${vendor.payment_terms_days}` : 'Terms not set'}
        </p>
        <div className="pt-1">
          <Button variant="outline" size="sm" onClick={onView}>View</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Vendor Detail Panel ───────────────────────────────────

function VendorDetailPanel({ vendorId, onClose }: { vendorId: string | null; onClose: () => void }) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const open = !!vendorId;

  const { data: vendor } = useQuery({
    queryKey: ['green-vendor', vendorId],
    enabled: !!vendorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendors')
        .select('*')
        .eq('id', vendorId!)
        .single();
      if (error) throw error;
      return data as Vendor;
    },
  });

  const { data: contractStats } = useQuery({
    queryKey: ['vendor-contract-stats', vendorId],
    enabled: !!vendorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_contracts')
        .select('id, status')
        .eq('vendor_id', vendorId!);
      if (error) throw error;
      const total = data?.length || 0;
      const active = data?.filter(c => c.status === 'ACTIVE').length || 0;
      return { total, active };
    },
  });

  const { data: notes = [] } = useQuery({
    queryKey: ['vendor-notes', vendorId],
    enabled: !!vendorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendor_notes')
        .select('*')
        .eq('vendor_id', vendorId!)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const userIds = [...new Set((data ?? []).map((n: any) => n.created_by).filter(Boolean))];
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
      })) as VendorNote[];
    },
  });

  const [form, setForm] = React.useState<Partial<Vendor>>({});
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (vendor) {
      setForm({
        name: vendor.name,
        abbreviation: vendor.abbreviation,
        contact_name: vendor.contact_name,
        contact_email: vendor.contact_email,
        contact_phone: vendor.contact_phone,
        payment_terms_days: vendor.payment_terms_days,
        notes: vendor.notes,
        is_active: vendor.is_active,
      });
      setDirty(false);
    }
  }, [vendor]);

  const updateField = (key: string, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('green_vendors')
        .update({
          name: (form.name || '').trim(),
          contact_name: form.contact_name?.trim() || null,
          contact_email: form.contact_email?.trim() || null,
          contact_phone: form.contact_phone?.trim() || null,
          payment_terms_days: form.payment_terms_days || null,
          notes: form.notes?.trim() || null,
          is_active: form.is_active ?? true,
        })
        .eq('id', vendorId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Vendor updated');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['green-vendor', vendorId] });
      queryClient.invalidateQueries({ queryKey: ['green-vendors'] });
    },
    onError: () => toast.error('Failed to update vendor'),
  });

  const [noteText, setNoteText] = React.useState('');

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('green_vendor_notes').insert({
        vendor_id: vendorId!,
        note: noteText.trim(),
        created_by: authUser!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-notes', vendorId] });
      setNoteText('');
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  const [briefCopied, setBriefCopied] = React.useState(false);

  const handleBriefMe = async () => {
    if (!vendor) return;
    const lines: string[] = [];
    lines.push(`Vendor: ${vendor.name}`);
    if (vendor.contact_name) lines.push(`Contact: ${vendor.contact_name}`);
    if (vendor.contact_email) lines.push(`Email: ${vendor.contact_email}`);
    if (vendor.contact_phone) lines.push(`Phone: ${vendor.contact_phone}`);
    lines.push(`Payment Terms: ${vendor.payment_terms_days ? `Net ${vendor.payment_terms_days}` : 'Not set'}`);
    lines.push(`Status: ${vendor.is_active ? 'Active' : 'Inactive'}`);
    lines.push(`Total Contracts: ${contractStats?.total ?? 0}`);
    lines.push(`Active Contracts: ${contractStats?.active ?? 0}`);

    const { data: allNotes } = await supabase
      .from('green_vendor_notes')
      .select('note, created_by, created_at')
      .eq('vendor_id', vendorId!)
      .order('created_at', { ascending: true });

    if (allNotes && allNotes.length > 0) {
      const userIds = [...new Set(allNotes.map(n => n.created_by).filter(Boolean))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name')
          .in('user_id', userIds);
        if (profiles) profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.name]));
      }
      lines.push('');
      lines.push('--- Notes ---');
      for (const n of allNotes) {
        const author = profileMap[n.created_by] || 'Unknown';
        const date = format(new Date(n.created_at), 'MMM d, yyyy');
        lines.push(`[${date}] (${author}) ${n.note}`);
      }
    } else {
      lines.push('');
      lines.push('No notes yet.');
    }

    await navigator.clipboard.writeText(lines.join('\n'));
    setBriefCopied(true);
    toast.success('Vendor brief copied to clipboard');
    setTimeout(() => setBriefCopied(false), 2000);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex-row items-center justify-between gap-2 pr-2">
          <SheetTitle className="text-lg">{vendor?.name || 'Vendor'}</SheetTitle>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={handleBriefMe}>
            {briefCopied ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            {briefCopied ? 'Copied' : 'Brief Me'}
          </Button>
        </SheetHeader>

        {vendor && (
          <div className="space-y-6 pt-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name *</Label>
                  <Input value={form.name || ''} onChange={(e) => updateField('name', e.target.value)} />
                </div>
                <div>
                  <Label>Abbreviation</Label>
                  {vendor.abbreviation ? (
                    <>
                      <p className="text-sm font-medium mt-1">{vendor.abbreviation}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Abbreviation cannot be changed after creation.</p>
                    </>
                  ) : (
                    <VendorAbbreviationEditor vendorId={vendor.id} />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Contact Name</Label>
                  <Input value={form.contact_name || ''} onChange={(e) => updateField('contact_name', e.target.value)} />
                </div>
                <div>
                  <Label>Contact Email</Label>
                  <Input value={form.contact_email || ''} onChange={(e) => updateField('contact_email', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Contact Phone</Label>
                  <Input value={form.contact_phone || ''} onChange={(e) => updateField('contact_phone', e.target.value)} />
                </div>
                <div>
                  <Label>Payment Terms (days)</Label>
                  <Input
                    type="number"
                    value={form.payment_terms_days ?? ''}
                    onChange={(e) => updateField('payment_terms_days', e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="e.g. 30"
                  />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea
                  value={form.notes || ''}
                  onChange={(e) => updateField('notes', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.is_active ?? true}
                  onCheckedChange={(v) => updateField('is_active', v)}
                />
                <Label className="mb-0">Active</Label>
              </div>

              {dirty && (
                <div className="flex justify-end">
                  <Button
                    disabled={!(form.name || '').trim() || saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-2">Activity</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <p className="text-2xl font-bold">{contractStats?.total ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Total Contracts</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="text-2xl font-bold">{contractStats?.active ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Active Contracts</p>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-3">Notes</h3>
              <div className="space-y-3">
                {notes.map((n) => (
                  <div key={n.id} className="text-sm border-l-2 border-muted pl-3 py-1">
                    <p>{n.note}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {n.author_name} · {format(new Date(n.created_at), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                ))}
                {notes.length === 0 && (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <Input
                  placeholder="Add a note…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && noteText.trim()) addNoteMutation.mutate();
                  }}
                />
                <Button
                  size="sm"
                  disabled={!noteText.trim() || addNoteMutation.isPending}
                  onClick={() => addNoteMutation.mutate()}
                >
                  Add Note
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Vendor Abbreviation Editor (for vendors missing abbreviation) ──────

function VendorAbbreviationEditor({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChange = async (raw: string) => {
    const upper = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    setValue(upper);
    setError('');
    if (upper.length === 3) {
      const { data } = await supabase
        .from('green_vendors')
        .select('id')
        .eq('abbreviation', upper)
        .neq('id', vendorId)
        .limit(1);
      if (data && data.length > 0) setError('Already in use');
    }
  };

  const handleSave = async () => {
    if (value.length !== 3 || error) return;
    setSaving(true);
    const { error: saveErr } = await supabase
      .from('green_vendors')
      .update({ abbreviation: value })
      .eq('id', vendorId);
    setSaving(false);
    if (saveErr) {
      toast.error('Failed to save abbreviation');
      return;
    }
    toast.success('Abbreviation saved');
    queryClient.invalidateQueries({ queryKey: ['green-vendor', vendorId] });
    queryClient.invalidateQueries({ queryKey: ['green-vendors'] });
  };

  return (
    <div className="mt-1 space-y-1">
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="ABC"
          maxLength={3}
          className="w-20 uppercase"
        />
        <Button
          size="sm"
          disabled={value.length !== 3 || !!error || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">3 uppercase letters, locked after save.</p>
    </div>
  );
}

// ─── Add Vendor Modal ──────────────────────────────────────

function AddVendorModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [abbreviation, setAbbreviation] = useState('');
  const [abbrTouched, setAbbrTouched] = useState(false);
  const [abbrError, setAbbrError] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setName('');
    setAbbreviation('');
    setAbbrTouched(false);
    setAbbrError('');
    setSubmitAttempted(false);
    setContactName('');
    setContactEmail('');
    setContactPhone('');
    setPaymentTerms('');
    setNotes('');
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!abbrTouched) {
      setAbbreviation(val.replace(/\s/g, '').slice(0, 3).toUpperCase());
      setAbbrError('');
    }
  };

  const handleAbbrChange = (val: string) => {
    const upper = val.toUpperCase().slice(0, 3);
    setAbbreviation(upper);
    setAbbrTouched(true);
    setAbbrError('');
  };

  const handleAbbrBlur = async () => {
    const trimmed = abbreviation.trim();
    if (!trimmed) return;
    const { data } = await supabase
      .from('green_vendors')
      .select('id')
      .eq('abbreviation', trimmed)
      .limit(1);
    if (data && data.length > 0) {
      setAbbrError('This abbreviation is already in use — please choose another.');
    }
  };

  const canSubmit = name.trim() && abbreviation.trim() && !abbrError;

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: vendor, error } = await supabase
        .from('green_vendors')
        .insert({
          name: name.trim(),
          abbreviation: abbreviation.trim(),
          contact_name: contactName.trim() || null,
          contact_email: contactEmail.trim() || null,
          contact_phone: contactPhone.trim() || null,
          payment_terms_days: paymentTerms ? parseInt(paymentTerms) : null,
          notes: null,
        })
        .select('id')
        .single();
      if (error) throw error;

      if (notes.trim() && vendor) {
        await supabase.from('green_vendor_notes').insert({
          vendor_id: vendor.id,
          note: notes.trim(),
          created_by: authUser!.id,
        });
      }
    },
    onSuccess: () => {
      toast.success('Vendor created');
      queryClient.invalidateQueries({ queryKey: ['green-vendors'] });
      reset();
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to create vendor'),
  });

  const handleSubmit = () => {
    setSubmitAttempted(true);
    if (!canSubmit) return;
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Vendor</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Vendor name" />
            </div>
            <div>
              <Label>Abbreviation *</Label>
              <Input
                value={abbreviation}
                onChange={(e) => handleAbbrChange(e.target.value)}
                onBlur={handleAbbrBlur}
                placeholder="e.g. CON"
                maxLength={3}
                className={abbrError || (submitAttempted && !abbreviation.trim()) ? 'border-destructive' : ''}
              />
              {abbrError && (
                <p className="text-xs text-destructive mt-1">{abbrError}</p>
              )}
              {submitAttempted && !abbreviation.trim() && !abbrError && (
                <p className="text-xs text-destructive mt-1">Abbreviation is required.</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contact Name</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div>
              <Label>Contact Email</Label>
              <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contact Phone</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <div>
              <Label>Payment Terms (days)</Label>
              <Input type="number" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 30" />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional first note…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button disabled={createMutation.isPending} onClick={handleSubmit}>
            {createMutation.isPending ? 'Creating…' : 'Create Vendor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
