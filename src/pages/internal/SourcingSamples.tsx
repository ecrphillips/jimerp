import React, { useState, useEffect, useMemo } from 'react';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, Check, FileText, X } from 'lucide-react';

type SampleStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type GreenCategory = 'BULK_BLENDER' | 'SINGLE_ORIGIN' | 'SUPER_NICE';

interface Sample {
  id: string;
  vendor_id: string | null;
  name: string;
  origin: string | null;
  region: string | null;
  producer: string | null;
  variety: string | null;
  category: GreenCategory;
  indicative_price_usd: number | null;
  indicative_price_currency: string | null;
  bag_size_kg: number | null;
  num_bags: number | null;
  warehouse_location: string | null;
  score: number | null;
  tasting_notes: string | null;
  status: SampleStatus;
  rejected_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface Vendor {
  id: string;
  name: string;
}

interface RoastGroup {
  roast_group: string;
  display_name: string;
  is_active: boolean;
}

interface SampleNote {
  id: string;
  sample_id: string;
  note: string;
  created_by: string;
  created_at: string;
  author_name?: string;
}

const CATEGORY_LABELS: Record<GreenCategory, string> = {
  BULK_BLENDER: 'Bulk Blender',
  SINGLE_ORIGIN: 'Single Origin',
  SUPER_NICE: 'Super Nice',
};

const CATEGORY_COLORS: Record<GreenCategory, string> = {
  BULK_BLENDER: 'secondary',
  SINGLE_ORIGIN: 'default',
  SUPER_NICE: 'outline',
};

const STATUS_LABELS: Record<SampleStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

function StatusBadge({ status }: { status: SampleStatus }) {
  const cls =
    status === 'PENDING'
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      : status === 'APPROVED'
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : 'bg-red-100 text-red-400 dark:bg-red-900/40 dark:text-red-300';
  return <Badge variant="outline" className={`${cls} border-0 text-xs`}>{STATUS_LABELS[status]}</Badge>;
}

function CategoryBadge({ category }: { category: GreenCategory }) {
  const cls =
    category === 'BULK_BLENDER'
      ? 'bg-muted text-muted-foreground'
      : category === 'SINGLE_ORIGIN'
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  return <Badge variant="outline" className={`${cls} border-0 text-xs`}>{CATEGORY_LABELS[category]}</Badge>;
}

// ─── Main Page ─────────────────────────────────────────────

export default function SourcingSamples() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SampleStatus | 'ALL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<GreenCategory | 'ALL'>('ALL');
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const { data: vendors = [] } = useQuery({
    queryKey: ['green-vendors-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendors')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const vendorMap = useMemo(() => Object.fromEntries(vendors.map(v => [v.id, v.name])), [vendors]);

  const { data: samples = [], isLoading } = useQuery({
    queryKey: ['green-samples'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_samples')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Sample[];
    },
  });

  // Fetch roast group links for all samples
  const { data: allLinks = [] } = useQuery({
    queryKey: ['sample-roast-links-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_sample_roast_profile_links')
        .select('sample_id, roast_group');
      if (error) throw error;
      return data as { sample_id: string; roast_group: string }[];
    },
  });

  const { data: roastGroups = [] } = useQuery({
    queryKey: ['roast-groups-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group, display_name, is_active')
        .eq('is_active', true)
        .order('display_name');
      if (error) throw error;
      return data as RoastGroup[];
    },
  });

  const rgMap = useMemo(() => Object.fromEntries(roastGroups.map(rg => [rg.roast_group, rg.display_name])), [roastGroups]);

  const linksBySample = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const l of allLinks) {
      if (!map[l.sample_id]) map[l.sample_id] = [];
      map[l.sample_id].push(l.roast_group);
    }
    return map;
  }, [allLinks]);

  const filtered = useMemo(() => {
    let list = samples;
    if (statusFilter !== 'ALL') list = list.filter(s => s.status === statusFilter);
    if (categoryFilter !== 'ALL') list = list.filter(s => s.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => {
        const vendorName = s.vendor_id ? (vendorMap[s.vendor_id] || '') : '';
        return (
          s.name.toLowerCase().includes(q) ||
          vendorName.toLowerCase().includes(q) ||
          (s.origin || '').toLowerCase().includes(q) ||
          (s.region || '').toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [samples, statusFilter, categoryFilter, search, vendorMap]);

  return (
    <div className="page-container space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Samples</h1>
          <p className="text-sm text-muted-foreground">Coffee sample evaluation</p>
        </div>
        <Button onClick={() => setAddModalOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Sample
        </Button>
      </div>

      {/* Filter bar */}
      <div className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by vendor, origin, region, or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map(s => (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === 'ALL' ? 'All Status' : STATUS_LABELS[s]}
            </Button>
          ))}
          <span className="border-l mx-1" />
          {(['ALL', 'BULK_BLENDER', 'SINGLE_ORIGIN', 'SUPER_NICE'] as const).map(c => (
            <Button
              key={c}
              variant={categoryFilter === c ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategoryFilter(c)}
            >
              {c === 'ALL' ? 'All Categories' : CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search || statusFilter !== 'ALL' || categoryFilter !== 'ALL' ? 'No samples match your filters.' : 'No samples yet. Add one to get started.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((sample) => (
            <SampleCard
              key={sample.id}
              sample={sample}
              vendorName={sample.vendor_id ? vendorMap[sample.vendor_id] : null}
              roastGroupNames={(linksBySample[sample.id] || []).map(rg => rgMap[rg] || rg)}
              onView={() => setSelectedSampleId(sample.id)}
            />
          ))}
        </div>
      )}

      <SampleDetailPanel
        sampleId={selectedSampleId}
        onClose={() => setSelectedSampleId(null)}
        vendors={vendors}
        roastGroups={roastGroups}
      />

      <AddSampleModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        vendors={vendors}
        roastGroups={roastGroups}
      />
    </div>
  );
}

// ─── Sample Card ───────────────────────────────────────────

function SampleCard({
  sample,
  vendorName,
  roastGroupNames,
  onView,
}: {
  sample: Sample;
  vendorName: string | null;
  roastGroupNames: string[];
  onView: () => void;
}) {
  const muted = sample.status === 'REJECTED';
  return (
    <Card className={muted ? 'opacity-50' : ''}>
      <CardContent className="p-4 space-y-1.5">
        <p className="font-semibold text-base leading-tight">
          {vendorName || <span className="text-muted-foreground">No vendor</span>}
        </p>
        {(sample.origin || sample.region) && (
          <p className="text-sm text-muted-foreground">
            {[sample.origin, sample.region].filter(Boolean).join(' — ')}
          </p>
        )}
        <p className="text-sm">{sample.name}</p>
        {sample.producer && <p className="text-xs text-muted-foreground">Producer: {sample.producer}</p>}
        {sample.variety && <p className="text-xs text-muted-foreground">Variety: {sample.variety}</p>}
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <CategoryBadge category={sample.category} />
          <StatusBadge status={sample.status} />
        </div>
        {roastGroupNames.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {roastGroupNames.map(n => (
              <Badge key={n} variant="secondary" className="text-[10px]">{n}</Badge>
            ))}
          </div>
        )}
        <div className="pt-1">
          <Button variant="outline" size="sm" onClick={onView}>View</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Sample Detail Panel ───────────────────────────────────

function SampleDetailPanel({
  sampleId,
  onClose,
  vendors,
  roastGroups,
}: {
  sampleId: string | null;
  onClose: () => void;
  vendors: Vendor[];
  roastGroups: RoastGroup[];
}) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const open = !!sampleId;

  const { data: sample } = useQuery({
    queryKey: ['green-sample', sampleId],
    enabled: !!sampleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_samples')
        .select('*')
        .eq('id', sampleId!)
        .single();
      if (error) throw error;
      return data as Sample;
    },
  });

  // Roast group links
  const { data: links = [] } = useQuery({
    queryKey: ['sample-roast-links', sampleId],
    enabled: !!sampleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_sample_roast_profile_links')
        .select('id, roast_group')
        .eq('sample_id', sampleId!);
      if (error) throw error;
      return data as { id: string; roast_group: string }[];
    },
  });

  // Notes
  const { data: notes = [] } = useQuery({
    queryKey: ['sample-notes', sampleId],
    enabled: !!sampleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_sample_notes')
        .select('*')
        .eq('sample_id', sampleId!)
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
      })) as SampleNote[];
    },
  });

  // Form state
  const [form, setForm] = useState<Partial<Sample>>({});
  const [dirty, setDirty] = useState(false);
  const [priceUnit, setPriceUnit] = useState<'usd_kg' | 'usd_lb' | 'cad_kg'>('usd_kg');

  useEffect(() => {
    if (sample) {
      setForm({
        vendor_id: sample.vendor_id,
        origin: sample.origin,
        region: sample.region,
        name: sample.name,
        producer: sample.producer,
        variety: sample.variety,
        category: sample.category,
        indicative_price_usd: sample.indicative_price_usd,
        warehouse_location: sample.warehouse_location,
        bag_size_kg: sample.bag_size_kg,
        num_bags: sample.num_bags,
        score: sample.score,
        tasting_notes: sample.tasting_notes,
      });
      setDirty(false);
      setPriceUnit(sample.indicative_price_currency === 'CAD' ? 'cad_kg' : 'usd_kg');
    }
  }, [sample]);

  const updateField = (key: string, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const getPriceForStorage = () => {
    const val = form.indicative_price_usd;
    if (val == null) return { price: null, currency: 'USD' };
    if (priceUnit === 'usd_lb') return { price: val * 2.20462, currency: 'USD' };
    if (priceUnit === 'cad_kg') return { price: val, currency: 'CAD' };
    return { price: val, currency: 'USD' };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { price: storagePrice, currency } = getPriceForStorage();
      const { error } = await supabase
        .from('green_samples')
        .update({
          vendor_id: form.vendor_id || null,
          origin: form.origin?.trim() || null,
          region: (form as any).region?.trim() || null,
          name: (form.name || '').trim(),
          producer: form.producer?.trim() || null,
          variety: form.variety?.trim() || null,
          category: form.category!,
          indicative_price_usd: storagePrice,
          indicative_price_currency: storagePrice != null ? currency : null,
          warehouse_location: form.warehouse_location?.trim() || null,
          bag_size_kg: form.bag_size_kg ?? null,
          num_bags: (form as any).num_bags ?? null,
          score: form.score ?? null,
          tasting_notes: form.tasting_notes?.trim() || null,
        } as any)
        .eq('id', sampleId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Sample updated');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['green-sample', sampleId] });
      queryClient.invalidateQueries({ queryKey: ['green-samples'] });
    },
    onError: () => toast.error('Failed to update sample'),
  });

  // Status actions
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const statusMutation = useMutation({
    mutationFn: async ({ status, rejected_reason }: { status: SampleStatus; rejected_reason?: string }) => {
      const update: any = { status };
      if (status === 'REJECTED') update.rejected_reason = rejected_reason || null;
      if (status !== 'REJECTED') update.rejected_reason = null;
      const { error } = await supabase.from('green_samples').update(update).eq('id', sampleId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Status updated');
      setShowRejectInput(false);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['green-sample', sampleId] });
      queryClient.invalidateQueries({ queryKey: ['green-samples'] });
    },
    onError: () => toast.error('Failed to update status'),
  });

  // Roast group link/unlink
  const addLinkMutation = useMutation({
    mutationFn: async (roast_group: string) => {
      const { error } = await supabase.from('green_sample_roast_profile_links').insert({
        sample_id: sampleId!,
        roast_group,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sample-roast-links', sampleId] });
      queryClient.invalidateQueries({ queryKey: ['sample-roast-links-all'] });
    },
    onError: () => toast.error('Failed to link roast group'),
  });

  const removeLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.from('green_sample_roast_profile_links').delete().eq('id', linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sample-roast-links', sampleId] });
      queryClient.invalidateQueries({ queryKey: ['sample-roast-links-all'] });
    },
    onError: () => toast.error('Failed to remove link'),
  });

  // Notes
  const [noteText, setNoteText] = useState('');
  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('green_sample_notes').insert({
        sample_id: sampleId!,
        note: noteText.trim(),
        created_by: authUser!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sample-notes', sampleId] });
      setNoteText('');
      toast.success('Note added');
    },
    onError: () => toast.error('Failed to add note'),
  });

  // Brief Me
  const [briefCopied, setBriefCopied] = useState(false);

  const handleBriefMe = async () => {
    if (!sample) return;
    const vendorName = sample.vendor_id ? (vendors.find(v => v.id === sample.vendor_id)?.name || 'Unknown') : 'No vendor';
    const lines: string[] = [];
    lines.push(`Vendor: ${vendorName}`);
    lines.push(`Origin: ${[sample.origin, sample.region].filter(Boolean).join(', ') || 'Not set'}`);
    lines.push(`Sample Name: ${sample.name}`);
    if (sample.producer) lines.push(`Producer: ${sample.producer}`);
    if (sample.variety) lines.push(`Variety: ${sample.variety}`);
    lines.push(`Category: ${CATEGORY_LABELS[sample.category]}`);
    lines.push(`Status: ${STATUS_LABELS[sample.status]}`);
    if (sample.indicative_price_usd != null) {
      const curr = (sample as any).indicative_price_currency || 'USD';
      lines.push(`Indicative Price: ${curr} $${sample.indicative_price_usd.toFixed(4)}/kg`);
    }
    if (sample.bag_size_kg != null) lines.push(`Bag Size: ${sample.bag_size_kg} kg`);
    if (sample.num_bags != null) lines.push(`Number of Bags: ${sample.num_bags}`);
    if (sample.bag_size_kg != null && sample.num_bags != null) lines.push(`Total: ${sample.bag_size_kg * sample.num_bags} kg`);
    if (sample.warehouse_location) lines.push(`Warehouse: ${sample.warehouse_location}`);
    if (sample.score != null) lines.push(`Cupping Score: ${sample.score}`);
    if (sample.tasting_notes) lines.push(`Tasting Notes: ${sample.tasting_notes}`);

    const linkedRgNames = links.map(l => {
      const rg = roastGroups.find(r => r.roast_group === l.roast_group);
      return rg?.display_name || l.roast_group;
    });
    if (linkedRgNames.length > 0) lines.push(`Roast Groups: ${linkedRgNames.join(', ')}`);

    // Fetch all notes chronologically
    const { data: allNotes } = await supabase
      .from('green_sample_notes')
      .select('note, created_by, created_at')
      .eq('sample_id', sampleId!)
      .order('created_at', { ascending: true });

    if (allNotes && allNotes.length > 0) {
      const userIds = [...new Set(allNotes.map(n => n.created_by).filter(Boolean))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, name').in('user_id', userIds);
        if (profiles) profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.name]));
      }
      lines.push('');
      lines.push('--- Notes ---');
      for (const n of allNotes) {
        const author = profileMap[n.created_by] || 'Unknown';
        const date = format(new Date(n.created_at), 'MMM d, yyyy');
        lines.push(`[${date}] (${author}) ${n.note}`);
      }
    }

    await navigator.clipboard.writeText(lines.join('\n'));
    setBriefCopied(true);
    toast.success('Sample brief copied to clipboard');
    setTimeout(() => setBriefCopied(false), 2000);
  };

  const rgMap = useMemo(() => Object.fromEntries(roastGroups.map(rg => [rg.roast_group, rg.display_name])), [roastGroups]);
  const linkedRgKeys = new Set(links.map(l => l.roast_group));
  const availableRgs = roastGroups.filter(rg => !linkedRgKeys.has(rg.roast_group));

  const totalKg = (form.bag_size_kg ?? 0) && (form.num_bags ?? 0) ? Number(form.bag_size_kg) * Number(form.num_bags) : null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex-row items-center justify-between gap-2 pr-2">
          <div className="flex items-center gap-2 min-w-0">
            <SheetTitle className="text-lg truncate">{sample?.name || 'Sample'}</SheetTitle>
            {sample && <StatusBadge status={sample.status} />}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={handleBriefMe}>
            {briefCopied ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            {briefCopied ? 'Copied' : 'Brief Me'}
          </Button>
        </SheetHeader>

        {sample && (
          <div className="space-y-6 pt-4">
            {/* Editable fields */}
            <div className="space-y-4">
              <div>
                <Label>Vendor</Label>
                <Select
                  value={form.vendor_id || '__none__'}
                  onValueChange={(v) => updateField('vendor_id', v === '__none__' ? null : v)}
                >
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No vendor</SelectItem>
                    {vendors.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Origin</Label>
                  <Input value={form.origin || ''} onChange={(e) => updateField('origin', e.target.value)} placeholder="e.g. Colombia" />
                </div>
                <div>
                  <Label>Region</Label>
                  <Input value={(form as any).region || ''} onChange={(e) => updateField('region', e.target.value)} placeholder="e.g. Huila" />
                </div>
              </div>
              <div>
                <Label>Name *</Label>
                <Input value={form.name || ''} onChange={(e) => updateField('name', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Producer</Label>
                  <Input value={form.producer || ''} onChange={(e) => updateField('producer', e.target.value)} />
                </div>
                <div>
                  <Label>Variety</Label>
                  <Input value={form.variety || ''} onChange={(e) => updateField('variety', e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Category *</Label>
                <Select value={form.category || ''} onValueChange={(v) => updateField('category', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BULK_BLENDER">Bulk Blender</SelectItem>
                    <SelectItem value="SINGLE_ORIGIN">Single Origin</SelectItem>
                    <SelectItem value="SUPER_NICE">Super Nice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Indicative Price</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.indicative_price_usd ?? ''}
                    onChange={(e) => updateField('indicative_price_usd', e.target.value ? parseFloat(e.target.value) : null)}
                    className="flex-1"
                  />
                  <div className="flex border rounded-md overflow-hidden">
                    <button
                      type="button"
                      className={`px-3 py-2 text-sm ${priceUnit === 'kg' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                      onClick={() => { setPriceUnit('kg'); setDirty(true); }}
                    >
                      $/kg
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-2 text-sm ${priceUnit === 'lb' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                      onClick={() => { setPriceUnit('lb'); setDirty(true); }}
                    >
                      $/lb
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Stored: ${getPriceForStorage()?.toFixed(4) ?? '-'} / kg
                </p>
              </div>
              <div>
                <Label>Warehouse Location</Label>
                <Input value={form.warehouse_location || ''} onChange={(e) => updateField('warehouse_location', e.target.value)} />
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Bag Size (kg)</Label>
                  <Input
                    type="number"
                    value={form.bag_size_kg ?? ''}
                    onChange={(e) => updateField('bag_size_kg', e.target.value ? parseFloat(e.target.value) : null)}
                  />
                </div>
                <div className="flex-1">
                  <Label>Number of Bags</Label>
                  <Input
                    type="number"
                    value={(form as any).num_bags ?? ''}
                    onChange={(e) => updateField('num_bags', e.target.value ? parseInt(e.target.value) : null)}
                  />
                </div>
                <div className="shrink-0 pb-2 text-sm text-muted-foreground">
                  {totalKg != null ? `Total: ${totalKg} kg` : ''}
                </div>
              </div>
              <div>
                <Label>Cupping Score</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={form.score ?? ''}
                  onChange={(e) => updateField('score', e.target.value ? parseFloat(e.target.value) : null)}
                />
              </div>
              <div>
                <Label>Tasting Notes</Label>
                <Textarea
                  value={form.tasting_notes || ''}
                  onChange={(e) => updateField('tasting_notes', e.target.value)}
                  rows={3}
                />
              </div>

              {dirty && (
                <div className="flex justify-end">
                  <Button
                    disabled={!(form.name || '').trim() || !form.category || saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              )}
            </div>

            {/* Roast Group Links */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-2">Roast Group Links</h3>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {links.map(l => (
                  <Badge key={l.id} variant="secondary" className="gap-1 pr-1">
                    {rgMap[l.roast_group] || l.roast_group}
                    <button
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      onClick={() => removeLinkMutation.mutate(l.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {links.length === 0 && <p className="text-xs text-muted-foreground">No roast groups linked.</p>}
              </div>
              {availableRgs.length > 0 && (
                <Select onValueChange={(v) => addLinkMutation.mutate(v)}>
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder="Link Roast Group" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRgs.map(rg => (
                      <SelectItem key={rg.roast_group} value={rg.roast_group}>{rg.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Status Actions */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-2">Status Actions</h3>
              <div className="flex flex-wrap gap-2">
                {sample.status !== 'APPROVED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-900/30"
                    onClick={() => statusMutation.mutate({ status: 'APPROVED' })}
                    disabled={statusMutation.isPending}
                  >
                    Approve
                  </Button>
                )}
                {sample.status !== 'REJECTED' && !showRejectInput && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/30"
                    onClick={() => setShowRejectInput(true)}
                    disabled={statusMutation.isPending}
                  >
                    Reject
                  </Button>
                )}
                {sample.status !== 'PENDING' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ status: 'PENDING' })}
                    disabled={statusMutation.isPending}
                  >
                    Reset to Pending
                  </Button>
                )}
              </div>
              {showRejectInput && (
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="Reason for rejection (optional)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => statusMutation.mutate({ status: 'REJECTED', rejected_reason: rejectReason })}
                    disabled={statusMutation.isPending}
                  >
                    Confirm Reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowRejectInput(false); setRejectReason(''); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            {/* Notes feed */}
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
                {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
              </div>
              <div className="mt-4 flex gap-2">
                <Input
                  placeholder="Add a note…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && noteText.trim()) addNoteMutation.mutate(); }}
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

// ─── Add Sample Modal ──────────────────────────────────────

function AddSampleModal({
  open,
  onOpenChange,
  vendors,
  roastGroups,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendors: Vendor[];
  roastGroups: RoastGroup[];
}) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [region, setRegion] = useState('');
  const [producer, setProducer] = useState('');
  const [variety, setVariety] = useState('');
  const [category, setCategory] = useState<GreenCategory | ''>('');
  const [price, setPrice] = useState('');
  const [priceUnit, setPriceUnit] = useState<'kg' | 'lb'>('kg');
  const [warehouse, setWarehouse] = useState('');
  const [bagSize, setBagSize] = useState('');
  const [numBags, setNumBags] = useState('');
  const [score, setScore] = useState('');
  const [tastingNotes, setTastingNotes] = useState('');
  const [selectedRgs, setSelectedRgs] = useState<string[]>([]);
  const [otherNotes, setOtherNotes] = useState('');

  const reset = () => {
    setName(''); setVendorId(null); setOrigin(''); setRegion('');
    setProducer(''); setVariety(''); setCategory(''); setPrice(''); setPriceUnit('kg');
    setWarehouse(''); setBagSize(''); setNumBags(''); setScore('');
    setTastingNotes(''); setSelectedRgs([]); setOtherNotes('');
  };

  const totalKg = bagSize && numBags ? parseFloat(bagSize) * parseInt(numBags) : null;

  const createMutation = useMutation({
    mutationFn: async () => {
      // Convert price to $/kg for storage
      const priceVal = price ? parseFloat(price) : null;
      const storagePrice = priceVal && priceUnit === 'lb' ? priceVal * 2.20462 : priceVal;

      const { data: sample, error } = await supabase
        .from('green_samples')
        .insert({
          name: name.trim(),
          vendor_id: vendorId || null,
          origin: origin.trim() || null,
          region: region.trim() || null,
          producer: producer.trim() || null,
          variety: variety.trim() || null,
          category: category as GreenCategory,
          indicative_price_usd: storagePrice,
          warehouse_location: warehouse.trim() || null,
          bag_size_kg: bagSize ? parseFloat(bagSize) : null,
          num_bags: numBags ? parseInt(numBags) : null,
          score: score ? parseFloat(score) : null,
          tasting_notes: tastingNotes.trim() || null,
          status: 'PENDING' as SampleStatus,
          created_by: authUser!.id,
        })
        .select('id')
        .single();
      if (error) throw error;

      // Roast group links
      if (selectedRgs.length > 0) {
        const { error: linkErr } = await supabase
          .from('green_sample_roast_profile_links')
          .insert(selectedRgs.map(rg => ({ sample_id: sample.id, roast_group: rg })));
        if (linkErr) throw linkErr;
      }

      // Other notes
      if (otherNotes.trim()) {
        const { error: noteErr } = await supabase
          .from('green_sample_notes')
          .insert({ sample_id: sample.id, note: otherNotes.trim(), created_by: authUser!.id });
        if (noteErr) throw noteErr;
      }
    },
    onSuccess: () => {
      toast.success('Sample created');
      queryClient.invalidateQueries({ queryKey: ['green-samples'] });
      queryClient.invalidateQueries({ queryKey: ['sample-roast-links-all'] });
      reset();
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to create sample'),
  });

  const toggleRg = (rg: string) => {
    setSelectedRgs(prev => prev.includes(rg) ? prev.filter(r => r !== rg) : [...prev, rg]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Sample</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Vendor</Label>
            <Select value={vendorId || '__none__'} onValueChange={(v) => setVendorId(v === '__none__' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No vendor</SelectItem>
                {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Origin</Label>
              <Input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="e.g. Colombia" />
            </div>
            <div>
              <Label>Region</Label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Huila" />
            </div>
          </div>
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Farm, mill, or lot name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Producer</Label>
              <Input value={producer} onChange={(e) => setProducer(e.target.value)} />
            </div>
            <div>
              <Label>Variety</Label>
              <Input value={variety} onChange={(e) => setVariety(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as GreenCategory)}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BULK_BLENDER">Bulk Blender</SelectItem>
                <SelectItem value="SINGLE_ORIGIN">Single Origin</SelectItem>
                <SelectItem value="SUPER_NICE">Super Nice</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Indicative Price</Label>
            <div className="flex items-center gap-2">
              <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="flex-1" />
              <div className="flex border rounded-md overflow-hidden">
                <button
                  type="button"
                  className={`px-3 py-2 text-sm ${priceUnit === 'kg' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                  onClick={() => setPriceUnit('kg')}
                >
                  $/kg
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm ${priceUnit === 'lb' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                  onClick={() => setPriceUnit('lb')}
                >
                  $/lb
                </button>
              </div>
            </div>
            {price && (
              <p className="text-xs text-muted-foreground mt-1">
                Stored: ${(priceUnit === 'lb' ? parseFloat(price) * 2.20462 : parseFloat(price)).toFixed(4)} / kg
              </p>
            )}
          </div>
          <div>
            <Label>Warehouse Location</Label>
            <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label>Bag Size (kg)</Label>
              <Input type="number" value={bagSize} onChange={(e) => setBagSize(e.target.value)} />
            </div>
            <div className="flex-1">
              <Label>Number of Bags</Label>
              <Input type="number" value={numBags} onChange={(e) => setNumBags(e.target.value)} />
            </div>
            <div className="shrink-0 pb-2 text-sm text-muted-foreground">
              {totalKg != null ? `Total: ${totalKg} kg` : ''}
            </div>
          </div>
          <div>
            <Label>Roast Group Links</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {roastGroups.map(rg => (
                <Badge
                  key={rg.roast_group}
                  variant={selectedRgs.includes(rg.roast_group) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleRg(rg.roast_group)}
                >
                  {rg.display_name}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <Label>Cupping Score</Label>
            <Input type="number" step="0.5" value={score} onChange={(e) => setScore(e.target.value)} />
          </div>
          <div>
            <Label>Tasting Notes</Label>
            <Textarea value={tastingNotes} onChange={(e) => setTastingNotes(e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Other Notes</Label>
            <Input value={otherNotes} onChange={(e) => setOtherNotes(e.target.value)} placeholder="Any other notes on arrival…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button
            disabled={!name.trim() || !category || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Sample'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
