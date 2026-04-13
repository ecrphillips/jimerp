import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { X, FileText } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_OPTIONS = ['NEW', 'ACKNOWLEDGED', 'BUILDING', 'DONE', 'WONT_DO'] as const;
const CATEGORY_OPTIONS = ['BUG', 'UX_IMPROVEMENT', 'FEATURE_REQUEST', 'OTHER'] as const;

const STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ACKNOWLEDGED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  BUILDING: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  DONE: 'bg-muted text-muted-foreground',
  WONT_DO: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  ACKNOWLEDGED: 'Acknowledged',
  BUILDING: 'Building',
  DONE: 'Done',
  WONT_DO: "Won't Do",
};

const CATEGORY_LABELS: Record<string, string> = {
  BUG: 'Bug',
  UX_IMPROVEMENT: 'UX',
  FEATURE_REQUEST: 'Feature',
  OTHER: 'Other',
};

export default function AdminFeedback() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNote, setEditNote] = useState('');

  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['admin-feedback', statusFilter, categoryFilter],
    queryFn: async () => {
      let q = supabase
        .from('feedback_submissions')
        .select('id, created_at, category, status, message, admin_note, updated_at, created_by')
        .order('created_at', { ascending: false });

      if (statusFilter !== 'ALL') q = q.eq('status', statusFilter);
      if (categoryFilter !== 'ALL') q = q.eq('category', categoryFilter);

      const { data, error } = await q;
      if (error) { console.error('Feedback query error:', error); throw error; }
      return data ?? [];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, admin_note }: { id: string; status: string; admin_note: string }) => {
      const { error } = await supabase
        .from('feedback_submissions')
        .update({
          status,
          admin_note: admin_note || null,
          updated_at: new Date().toISOString(),
          updated_by: authUser?.id,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] });
      queryClient.invalidateQueries({ queryKey: ['feedback-new-count'] });
      setSelectedId(null);
    },
  });

  const selected = submissions.find((s: any) => s.id === selectedId);

  const openDetail = (item: any) => {
    setSelectedId(item.id);
    setEditStatus(item.status);
    setEditNote(item.admin_note ?? '');
  };
  const [briefFallbackText, setBriefFallbackText] = useState<string | null>(null);

  const handleBriefMe = async () => {
    const { data, error } = await supabase
      .from('feedback_submissions')
      .select('id, created_at, category, status, message')
      .not('status', 'in', '("DONE","WONT_DO")')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Failed to load feedback');
      return;
    }

    const BRIEF_STATUS_ORDER = ['NEW', 'ACKNOWLEDGED', 'BUILDING'] as const;
    const BRIEF_STATUS_LABELS: Record<string, string> = { NEW: 'New', ACKNOWLEDGED: 'Acknowledged', BUILDING: 'In Progress' };
    const BRIEF_CAT_ORDER = ['BUG', 'UX_IMPROVEMENT', 'FEATURE_REQUEST', 'OTHER'] as const;
    const BRIEF_CAT_LABELS: Record<string, string> = { BUG: 'Bugs', UX_IMPROVEMENT: 'UX Improvements', FEATURE_REQUEST: 'Feature Requests', OTHER: 'Other' };

    let lines: string[] = ['--- JIM Feedback Brief ---', '', `Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}`, ''];

    for (const st of BRIEF_STATUS_ORDER) {
      const byStatus = (data ?? []).filter((d: any) => d.status === st);
      if (byStatus.length === 0) continue;
      lines.push(`=== ${BRIEF_STATUS_LABELS[st]?.toUpperCase() ?? st} ===`, '');
      for (const cat of BRIEF_CAT_ORDER) {
        const byCat = byStatus.filter((d: any) => d.category === cat);
        if (byCat.length === 0) continue;
        lines.push(`${BRIEF_CAT_LABELS[cat]} (${byCat.length})`, '');
        for (const item of byCat) {
          lines.push(`- ${(item as any).message}`);
        }
        lines.push('');
      }
    }

    const text = lines.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      setBriefFallbackText(text);
    }
  };


    <div className="flex h-full">
      <div className={cn('flex-1 p-6 space-y-4', selected && 'hidden lg:block')}>
        <h1 className="text-xl font-bold">Feedback & Suggestions</h1>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Categories</SelectItem>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleBriefMe}>
            <FileText className="h-4 w-4 mr-1.5" />
            Brief Me
          </Button>
        </div>

        {/* Brief fallback modal */}
        <Dialog open={!!briefFallbackText} onOpenChange={() => setBriefFallbackText(null)}>
          <DialogContent className="max-w-lg max-h-[70vh]">
            <DialogHeader><DialogTitle>Feedback Brief</DialogTitle></DialogHeader>
            <Textarea readOnly value={briefFallbackText ?? ''} rows={18} className="font-mono text-xs" />
          </DialogContent>
        </Dialog>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions found.</p>
        ) : (
          <div className="space-y-2">
            {submissions.map((item: any) => (
              <button
                key={item.id}
                onClick={() => openDetail(item)}
                className={cn(
                  'w-full text-left rounded-lg border p-4 transition-colors hover:bg-muted/50',
                  selectedId === item.id && 'ring-2 ring-primary'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">Team member</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(item.created_at), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <p className="text-sm text-foreground line-clamp-2">{item.message}</p>
                    {item.admin_note && (
                      <p className="text-xs text-muted-foreground italic line-clamp-1">Admin: {item.admin_note}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </Badge>
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', STATUS_COLORS[item.status])}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-full lg:w-96 border-l bg-background p-6 space-y-4 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Detail</h2>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedId(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Team member · {format(new Date(selected.created_at), 'MMM d, yyyy h:mm a')}
            </p>
            <Badge variant="outline" className="text-[10px]">
              {CATEGORY_LABELS[selected.category] ?? selected.category}
            </Badge>
          </div>
          <p className="text-sm whitespace-pre-wrap">{selected.message}</p>

          <div className="space-y-3 pt-2 border-t">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Admin Note</label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="Optional note..."
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ id: selected.id, status: editStatus, admin_note: editNote })}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
