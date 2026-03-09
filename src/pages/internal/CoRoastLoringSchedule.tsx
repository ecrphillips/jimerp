import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Pencil, Trash2, Repeat, List, CalendarDays, Clock } from 'lucide-react';
import { format } from 'date-fns';
import {
  LoringBlock, BookingWithMember,
  BLOCK_TYPE_LABELS, BLOCK_TYPE_BADGE_VARIANT, formatTime,
} from '@/components/coroast/types';
import { BlockFormDialog } from '@/components/coroast/BlockFormDialog';
import { BlockDeleteDialog } from '@/components/coroast/BlockDeleteDialog';
import { BlockCalendarView } from '@/components/coroast/BlockCalendarView';
import { BlockWeekView } from '@/components/coroast/BlockWeekView';

export default function CoRoastLoringSchedule() {
  const today = new Date().toISOString().split('T')[0];
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'week'>('list');
  const [showPastBlocks, setShowPastBlocks] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [editingBlock, setEditingBlock] = useState<LoringBlock | null>(null);
  const [deletingBlock, setDeletingBlock] = useState<LoringBlock | null>(null);

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
      return (data ?? []) as BookingWithMember[];
    },
  });

  const displayedBlocks = useMemo(() => {
    if (!blocks) return [];
    return showPastBlocks ? blocks : blocks.filter(b => b.block_date >= today);
  }, [blocks, showPastBlocks, today]);

  const pastBlockCount = useMemo(() => {
    return blocks?.filter(b => b.block_date < today).length ?? 0;
  }, [blocks, today]);

  const openCreate = () => { setEditingBlock(null); setShowBlockDialog(true); };
  const openEdit = (block: LoringBlock) => { setEditingBlock(block); setShowBlockDialog(true); };

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
    </div>
  );
}
