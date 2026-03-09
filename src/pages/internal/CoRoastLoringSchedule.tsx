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
import { Calendar } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';

type LoringBlockType = Database['public']['Enums']['coroast_loring_block_type'];

interface LoringBlock {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  block_type: LoringBlockType;
  notes: string | null;
  created_at: string;
}

interface BookingWithMember {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_hours: number | null;
  status: string;
  coroast_members: { business_name: string } | null;
}

const blockTypeLabels: Record<LoringBlockType, string> = {
  INTERNAL_PRODUCTION: 'Internal Production',
  MAINTENANCE: 'Maintenance',
  CLOSED: 'Closed',
  OTHER: 'Other',
};

const blockTypeBadgeVariant: Record<LoringBlockType, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  INTERNAL_PRODUCTION: 'default',
  MAINTENANCE: 'secondary',
  CLOSED: 'destructive',
  OTHER: 'outline',
};

export default function CoRoastLoringSchedule() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split('T')[0];

  // Block form state
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [editingBlock, setEditingBlock] = useState<LoringBlock | null>(null);
  const [showPastBlocks, setShowPastBlocks] = useState(false);
  const [formDate, setFormDate] = useState<Date | undefined>(undefined);
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');
  const [formBlockType, setFormBlockType] = useState<LoringBlockType>('INTERNAL_PRODUCTION');
  const [formNotes, setFormNotes] = useState('');

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Fetch blocks
  const { data: blocks, isLoading: blocksLoading } = useQuery({
    queryKey: ['coroast-loring-blocks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_loring_blocks')
        .select('*')
        .order('block_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as LoringBlock[];
    },
  });

  // Fetch bookings with member name
  const { data: bookings, isLoading: bookingsLoading } = useQuery({
    queryKey: ['coroast-bookings-schedule'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_bookings')
        .select('id, booking_date, start_time, end_time, duration_hours, status, coroast_members(business_name)')
        .in('status', ['CONFIRMED', 'COMPLETED'])
        .gte('booking_date', today)
        .order('booking_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BookingWithMember[];
    },
  });

  const displayedBlocks = useMemo(() => {
    if (!blocks) return [];
    const filtered = showPastBlocks ? blocks : blocks.filter(b => b.block_date >= today);
    return filtered;
  }, [blocks, showPastBlocks, today]);

  const pastBlockCount = useMemo(() => {
    return blocks?.filter(b => b.block_date < today).length ?? 0;
  }, [blocks, today]);

  const resetForm = useCallback(() => {
    setFormDate(undefined);
    setFormStartTime('');
    setFormEndTime('');
    setFormBlockType('INTERNAL_PRODUCTION');
    setFormNotes('');
    setEditingBlock(null);
  }, []);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setShowBlockDialog(true);
  }, [resetForm]);

  const openEditDialog = useCallback((block: LoringBlock) => {
    setEditingBlock(block);
    setFormDate(new Date(block.block_date + 'T00:00:00'));
    setFormStartTime(block.start_time.slice(0, 5));
    setFormEndTime(block.end_time.slice(0, 5));
    setFormBlockType(block.block_type);
    setFormNotes(block.notes ?? '');
    setShowBlockDialog(true);
  }, []);

  const closeDialog = useCallback(() => {
    setShowBlockDialog(false);
    resetForm();
  }, [resetForm]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!formDate) throw new Error('Date required');
      const { error } = await supabase.from('coroast_loring_blocks').insert({
        block_date: format(formDate, 'yyyy-MM-dd'),
        start_time: formStartTime,
        end_time: formEndTime,
        block_type: formBlockType,
        notes: formNotes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Block created');
      queryClient.invalidateQueries({ queryKey: ['coroast-loring-blocks'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to create block');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingBlock || !formDate) return;
      const { error } = await supabase
        .from('coroast_loring_blocks')
        .update({
          block_date: format(formDate, 'yyyy-MM-dd'),
          start_time: formStartTime,
          end_time: formEndTime,
          block_type: formBlockType,
          notes: formNotes.trim() || null,
        })
        .eq('id', editingBlock.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Block updated');
      queryClient.invalidateQueries({ queryKey: ['coroast-loring-blocks'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update block');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('coroast_loring_blocks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Block deleted');
      queryClient.invalidateQueries({ queryKey: ['coroast-loring-blocks'] });
      setDeleteId(null);
    },
    onError: () => toast.error('Failed to delete block'),
  });

  const handleSubmit = () => {
    if (!formDate) { toast.error('Date is required'); return; }
    if (!formStartTime || !formEndTime) { toast.error('Start and end times are required'); return; }
    if (formEndTime <= formStartTime) { toast.error('End time must be after start time'); return; }
    if (editingBlock) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const formatTime = (t: string) => {
    const [h, m] = t.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${h12}:${m} ${ampm}`;
  };

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Loring Schedule</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Block
        </Button>
      </div>

      {/* SECTION 1: Availability Blocks */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Unavailability Blocks</CardTitle>
          {pastBlockCount > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={showPastBlocks}
                onCheckedChange={(checked) => setShowPastBlocks(!!checked)}
              />
              Show past ({pastBlockCount})
            </label>
          )}
        </CardHeader>
        <CardContent>
          {blocksLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : displayedBlocks.length === 0 ? (
            <p className="text-muted-foreground">No blocks to display.</p>
          ) : (
            <ul className="space-y-3">
              {displayedBlocks.map((b) => (
                <li key={b.id} className={`border-b pb-3 last:border-0 ${b.block_date < today ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant={blockTypeBadgeVariant[b.block_type]} className="text-xs whitespace-nowrap">
                        {blockTypeLabels[b.block_type]}
                      </Badge>
                      <div>
                        <span className="font-medium">{format(new Date(b.block_date + 'T00:00:00'), 'EEE, MMM d, yyyy')}</span>
                        <span className="ml-2 text-sm text-muted-foreground">
                          {formatTime(b.start_time)} – {formatTime(b.end_time)}
                        </span>
                        {b.notes && (
                          <span className="ml-2 text-sm text-muted-foreground italic">— {b.notes}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(b)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteId(b.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* SECTION 2: Member Bookings */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Member Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          {bookingsLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !bookings || bookings.length === 0 ? (
            <p className="text-muted-foreground">No upcoming bookings.</p>
          ) : (
            <ul className="space-y-3">
              {bookings.map((bk) => (
                <li key={bk.id} className="border-b pb-3 last:border-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">
                        {bk.status}
                      </Badge>
                      <div>
                        <span className="font-medium">
                          {bk.coroast_members?.business_name ?? 'Unknown Member'}
                        </span>
                        <span className="ml-2 text-sm text-muted-foreground">
                          {format(new Date(bk.booking_date + 'T00:00:00'), 'EEE, MMM d')}
                        </span>
                        <span className="ml-2 text-sm text-muted-foreground">
                          {formatTime(bk.start_time)} – {formatTime(bk.end_time)}
                        </span>
                        {bk.duration_hours != null && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({Number(bk.duration_hours).toFixed(1)}h)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Block Dialog */}
      <Dialog open={showBlockDialog} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBlock ? 'Edit Block' : 'Add Unavailability Block'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal', !formDate && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formDate ? format(formDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formDate}
                    onSelect={setFormDate}
                    initialFocus
                    className={cn('p-3 pointer-events-auto')}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startTime">Start Time *</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="endTime">End Time *</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={formEndTime}
                  onChange={(e) => setFormEndTime(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Block Type</Label>
              <Select value={formBlockType} onValueChange={(v) => setFormBlockType(v as LoringBlockType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(blockTypeLabels) as LoringBlockType[]).map((k) => (
                    <SelectItem key={k} value={k}>{blockTypeLabels[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="blockNotes">Notes</Label>
              <Textarea
                id="blockNotes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={isPending}>
                {isPending ? 'Saving…' : editingBlock ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Block</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this unavailability block? This cannot be undone.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
