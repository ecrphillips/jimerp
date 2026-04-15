import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Pencil, Trash2, Repeat, List, CalendarDays, Clock } from 'lucide-react';
import { PendingReminders } from '@/components/bookings/PendingReminders';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  LoringBlock, BookingWithMember,
  BLOCK_TYPE_LABELS, BLOCK_TYPE_BADGE_VARIANT, formatTime,
  DAYS_OF_WEEK, DAY_LABELS,
} from '@/components/coroast/types';
import { timeToMinutes } from '@/components/bookings/bookingUtils';
import { BlockFormDialog } from '@/components/coroast/BlockFormDialog';
import { BlockDeleteDialog } from '@/components/coroast/BlockDeleteDialog';
import { BlockCalendarView } from '@/components/coroast/BlockCalendarView';
import { BlockWeekView } from '@/components/coroast/BlockWeekView';
import type { AvailabilityWindow } from '@/components/bookings/bookingUtils';

// Time options for the window form (30-min increments, 5 AM – 10 PM)
const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let h = 5; h <= 22; h++) {
  for (let m = 0; m < 60; m += 30) {
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h >= 12 ? 'PM' : 'AM';
    TIME_OPTIONS.push({ value, label: `${h12}:${String(m).padStart(2, '0')} ${ampm}` });
  }
}

function formatTimeDisplay(t: string): string {
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

export default function CoRoastLoringSchedule() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split('T')[0];
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'week'>('list');
  const [showPastBlocks, setShowPastBlocks] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [editingBlock, setEditingBlock] = useState<LoringBlock | null>(null);
  const [deletingBlock, setDeletingBlock] = useState<LoringBlock | null>(null);

  // Availability window dialog state
  const [showWindowDialog, setShowWindowDialog] = useState(false);
  const [editingWindowDay, setEditingWindowDay] = useState<string>('MON');
  const [windowOpenTime, setWindowOpenTime] = useState('07:00');
  const [windowCloseTime, setWindowCloseTime] = useState('15:00');
  const [windowNotes, setWindowNotes] = useState('');
  const [editingWindowId, setEditingWindowId] = useState<string | null>(null);

  const { data: blocks, isLoading: blocksLoading } = useQuery({
    queryKey: ['coroast-loring-blocks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_loring_blocks')
        .select('*')
        .order('block_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LoringBlock[];
    },
  });

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
      return (data ?? []) as unknown as BookingWithMember[];
    },
  });

  const { data: windows = [], isLoading: windowsLoading } = useQuery({
    queryKey: ['coroast-availability-windows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coroast_availability_windows')
        .select('*');
      if (error) throw error;
      return (data ?? []) as AvailabilityWindow[];
    },
  });

  const windowsByDay = useMemo(() => {
    const map: Record<string, AvailabilityWindow> = {};
    for (const w of windows) {
      map[w.day_of_week] = w;
    }
    return map;
  }, [windows]);

  const displayedBlocks = useMemo(() => {
    if (!blocks) return [];
    return showPastBlocks ? blocks : blocks.filter(b => b.block_date >= today);
  }, [blocks, showPastBlocks, today]);

  const pastBlockCount = useMemo(() => {
    return blocks?.filter(b => b.block_date < today).length ?? 0;
  }, [blocks, today]);

  const openCreate = () => { setEditingBlock(null); setShowBlockDialog(true); };
  const openEdit = (block: LoringBlock) => { setEditingBlock(block); setShowBlockDialog(true); };

  // Window mutations
  const saveWindowMutation = useMutation({
    mutationFn: async () => {
      if (timeToMinutes(windowCloseTime) <= timeToMinutes(windowOpenTime)) throw new Error('Close time must be after open time');
      if (editingWindowId) {
        const { error } = await supabase
          .from('coroast_availability_windows')
          .update({
            open_time: windowOpenTime,
            close_time: windowCloseTime,
            notes: windowNotes.trim() || null,
          })
          .eq('id', editingWindowId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('coroast_availability_windows')
          .insert({
            day_of_week: editingWindowDay,
            open_time: windowOpenTime,
            close_time: windowCloseTime,
            notes: windowNotes.trim() || null,
          } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingWindowId ? 'Window updated' : 'Window added');
      queryClient.invalidateQueries({ queryKey: ['coroast-availability-windows'] });
      setShowWindowDialog(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleWindowMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('coroast_availability_windows')
        .update({ is_active: isActive })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coroast-availability-windows'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteWindowMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('coroast_availability_windows')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Window removed');
      queryClient.invalidateQueries({ queryKey: ['coroast-availability-windows'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openAddWindow(day: string) {
    setEditingWindowId(null);
    setEditingWindowDay(day);
    setWindowOpenTime('07:00');
    setWindowCloseTime('15:00');
    setWindowNotes('');
    setShowWindowDialog(true);
  }

  function openEditWindow(w: AvailabilityWindow) {
    setEditingWindowId(w.id);
    setEditingWindowDay(w.day_of_week);
    setWindowOpenTime(w.open_time);
    setWindowCloseTime(w.close_time);
    setWindowNotes(w.notes ?? '');
    setShowWindowDialog(true);
  }

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <h1 className="page-title">Loring Schedule</h1>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md overflow-hidden">
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4 mr-1" /> List
            </Button>
            <Button
              variant={viewMode === 'week' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setViewMode('week')}
            >
              <Clock className="h-4 w-4 mr-1" /> Week
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-none"
              onClick={() => setViewMode('calendar')}
            >
              <CalendarDays className="h-4 w-4 mr-1" /> Month
            </Button>
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> Add Block
          </Button>
        </div>
      </div>

      {viewMode === 'week' ? (
        <Card>
          <CardContent className="pt-6">
            {blocksLoading || bookingsLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : (
              <BlockWeekView
                blocks={blocks ?? []}
                bookings={bookings ?? []}
                onEditBlock={openEdit}
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Booking Hours */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Booking Hours</CardTitle>
            </CardHeader>
            <CardContent>
              {windowsLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <div className="space-y-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const w = windowsByDay[day];
                    return (
                      <div key={day} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                        <span className={`w-10 text-sm font-medium ${w && w.is_active ? '' : 'text-muted-foreground'}`}>
                          {DAY_LABELS[day]}
                        </span>
                        {w ? (
                          <>
                            <span className={`text-sm ${w.is_active ? '' : 'text-muted-foreground line-through'}`}>
                              {formatTimeDisplay(w.open_time)} – {formatTimeDisplay(w.close_time)}
                            </span>
                            {w.notes && (
                              <span className="text-xs text-muted-foreground italic ml-1">— {w.notes}</span>
                            )}
                            <div className="ml-auto flex items-center gap-2">
                              <Switch
                                checked={w.is_active}
                                onCheckedChange={(checked) => toggleWindowMutation.mutate({ id: w.id, isActive: checked })}
                              />
                              <Button variant="ghost" size="sm" onClick={() => openEditWindow(w)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => deleteWindowMutation.mutate(w.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-sm text-muted-foreground">No hours set</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="ml-auto h-7 text-xs"
                              onClick={() => openAddWindow(day)}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Add
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Availability Blocks */}
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Unavailability Blocks</CardTitle>
              {viewMode === 'list' && pastBlockCount > 0 && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={showPastBlocks} onCheckedChange={(c) => setShowPastBlocks(!!c)} />
                  Show past ({pastBlockCount})
                </label>
              )}
            </CardHeader>
            <CardContent>
              {blocksLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : viewMode === 'calendar' ? (
                <BlockCalendarView
                  blocks={blocks ?? []}
                  onEditBlock={openEdit}
                  onDeleteBlock={(b) => setDeletingBlock(b)}
                />
              ) : displayedBlocks.length === 0 ? (
                <p className="text-muted-foreground">No blocks to display.</p>
              ) : (
                <ul className="space-y-3">
                  {displayedBlocks.map((b) => (
                    <li key={b.id} className={`border-b pb-3 last:border-0 ${b.block_date < today ? 'opacity-50' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge variant={BLOCK_TYPE_BADGE_VARIANT[b.block_type]} className="text-xs whitespace-nowrap">
                            {BLOCK_TYPE_LABELS[b.block_type]}
                          </Badge>
                          <div className="flex items-center gap-1.5">
                            {b.recurring_series_id && (
                              <span title="Part of a recurring series"><Repeat className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /></span>
                            )}
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
                          <Button variant="ghost" size="sm" onClick={() => openEdit(b)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeletingBlock(b)}
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

          {/* Member Bookings */}
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
                          <Badge variant="outline" className="text-xs">{bk.status}</Badge>
                          <div>
                            <span className="font-medium">{bk.coroast_members?.business_name ?? 'Unknown Member'}</span>
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
        </>
      )}

      {/* Pending Reminders */}
      <PendingReminders />

      {/* Form Dialog */}
      <BlockFormDialog
        open={showBlockDialog}
        onOpenChange={setShowBlockDialog}
        editingBlock={editingBlock}
        onSuccess={() => {}}
      />

      {/* Delete Dialog */}
      <BlockDeleteDialog
        block={deletingBlock}
        open={!!deletingBlock}
        onOpenChange={(open) => !open && setDeletingBlock(null)}
        onSuccess={() => setDeletingBlock(null)}
      />

      {/* Availability Window Dialog */}
      <Dialog open={showWindowDialog} onOpenChange={setShowWindowDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingWindowId ? 'Edit' : 'Add'} Booking Hours — {DAY_LABELS[editingWindowDay]}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editingWindowId && (
              <div>
                <Label>Day of Week</Label>
                <Select value={editingWindowDay} onValueChange={setEditingWindowDay}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map(d => (
                      <SelectItem key={d} value={d} disabled={!!windowsByDay[d]}>
                        {DAY_LABELS[d]} {windowsByDay[d] ? '(already set)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Opens</Label>
                <Select value={windowOpenTime} onValueChange={setWindowOpenTime}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {TIME_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Closes</Label>
                <Select value={windowCloseTime} onValueChange={setWindowCloseTime}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {TIME_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Input value={windowNotes} onChange={(e) => setWindowNotes(e.target.value)} placeholder="e.g. reduced hours" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowWindowDialog(false)}>Cancel</Button>
              <Button onClick={() => saveWindowMutation.mutate()} disabled={saveWindowMutation.isPending}>
                {saveWindowMutation.isPending ? 'Saving…' : editingWindowId ? 'Update' : 'Add'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
