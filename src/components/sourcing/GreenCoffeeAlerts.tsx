import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, PackageCheck, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarWidget } from '@/components/ui/calendar';
import { useNavigate } from 'react-router-dom';

interface AlertLot {
  id: string;
  lot_number: string;
  expected_delivery_date: string | null;
  contract_id: string;
  contract_name?: string;
  status: string;
}

export function GreenCoffeeAlerts() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  // Overdue EN_ROUTE lots
  const { data: overdueLots = [] } = useQuery({
    queryKey: ['green-alerts-overdue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select('id, lot_number, expected_delivery_date, contract_id, status, arrival_snoozed_until')
        .eq('status', 'EN_ROUTE')
        .lte('expected_delivery_date', today);
      if (error) throw error;
      // Filter out snoozed
      const filtered = (data ?? []).filter(l =>
        !l.arrival_snoozed_until || l.arrival_snoozed_until <= today
      );
      // Get contract names
      const contractIds = [...new Set(filtered.map(l => l.contract_id))];
      if (contractIds.length === 0) return [];
      const { data: contracts } = await supabase
        .from('green_contracts')
        .select('id, name')
        .in('id', contractIds);
      const cMap = Object.fromEntries((contracts ?? []).map(c => [c.id, c.name]));
      return filtered.map(l => ({ ...l, contract_name: cMap[l.contract_id] || 'Unknown' })) as AlertLot[];
    },
    refetchInterval: 60000,
  });

  // Costing incomplete lots
  const { data: costingLots = [] } = useQuery({
    queryKey: ['green-alerts-costing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select('id, lot_number, contract_id, status, expected_delivery_date, costing_status')
        .eq('costing_status', 'INCOMPLETE')
        .eq('status', 'RECEIVED');
      if (error) throw error;
      const contractIds = [...new Set((data ?? []).map(l => l.contract_id))];
      if (contractIds.length === 0) return [];
      const { data: contracts } = await supabase
        .from('green_contracts')
        .select('id, name')
        .in('id', contractIds);
      const cMap = Object.fromEntries((contracts ?? []).map(c => [c.id, c.name]));
      return (data ?? []).map(l => ({ ...l, contract_name: cMap[l.contract_id] || 'Unknown' })) as AlertLot[];
    },
    refetchInterval: 60000,
  });

  const [receiveLotId, setReceiveLotId] = useState<string | null>(null);
  const [snoozeLotId, setSnoozeLotId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState<Date | undefined>();

  // Snooze mutation
  const snoozeMutation = useMutation({
    mutationFn: async ({ lotId, date }: { lotId: string; date: string }) => {
      const { error } = await supabase
        .from('green_lots')
        .update({ arrival_snoozed_until: date } as any)
        .eq('id', lotId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Alert snoozed');
      setSnoozeLotId(null);
      setSnoozeDate(undefined);
      queryClient.invalidateQueries({ queryKey: ['green-alerts-overdue'] });
    },
  });

  // Receive lot modal state
  const [receiveAsExpected, setReceiveAsExpected] = useState(true);
  const [exceptionsNotes, setExceptionsNotes] = useState('');

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!receiveLotId) return;
      const updateData: any = {
        status: 'COSTING_INCOMPLETE',
        received_date: today,
      };
      if (!receiveAsExpected) {
        updateData.exceptions_noted = true;
        updateData.exceptions_notes = exceptionsNotes.trim();
      }
      const { error } = await supabase
        .from('green_lots')
        .update(updateData)
        .eq('id', receiveLotId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lot marked as received');
      setReceiveLotId(null);
      setReceiveAsExpected(true);
      setExceptionsNotes('');
      queryClient.invalidateQueries({ queryKey: ['green-alerts-overdue'] });
      queryClient.invalidateQueries({ queryKey: ['green-alerts-costing'] });
      queryClient.invalidateQueries({ queryKey: ['green-lots'] });
      queryClient.invalidateQueries({ queryKey: ['green-contract-lots'] });
    },
    onError: () => toast.error('Failed to mark lot as received'),
  });

  if (overdueLots.length === 0 && costingLots.length === 0) return null;

  const receivingLot = overdueLots.find(l => l.id === receiveLotId);

  return (
    <>
      <div className="space-y-2 mb-4">
        {/* Overdue arrivals — amber */}
        {overdueLots.map(lot => (
          <div key={lot.id} className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm flex-1">
              <span className="font-semibold">{lot.lot_number}</span> — {lot.contract_name} was expected to arrive{' '}
              {lot.expected_delivery_date ? format(new Date(lot.expected_delivery_date + 'T00:00:00'), 'MMM d, yyyy') : 'unknown date'}.{' '}
              Has it arrived?
            </p>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                setReceiveLotId(lot.id);
                setReceiveAsExpected(true);
                setExceptionsNotes('');
              }}>
                <PackageCheck className="h-3.5 w-3.5 mr-1" /> Mark Received
              </Button>
              <Popover open={snoozeLotId === lot.id} onOpenChange={(o) => { if (!o) setSnoozeLotId(null); }}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSnoozeLotId(lot.id)}>
                    <Calendar className="h-3.5 w-3.5 mr-1" /> Snooze
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <CalendarWidget
                    mode="single"
                    selected={snoozeDate}
                    onSelect={(d) => {
                      if (d) {
                        setSnoozeDate(d);
                        snoozeMutation.mutate({ lotId: lot.id, date: format(d, 'yyyy-MM-dd') });
                      }
                    }}
                    disabled={(d) => d <= new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        ))}

        {/* Costing incomplete — warm orange */}
        {costingLots.map(lot => (
          <div key={lot.id} className="flex items-center gap-3 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
            <p className="text-sm flex-1">
              <span className="font-semibold">{lot.lot_number}</span> — {lot.contract_name} is on the floor with incomplete costing. Please complete the cost confirmation.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={() => navigate('/sourcing/lots')}
            >
              Complete Costing
            </Button>
          </div>
        ))}
      </div>

      {/* Receive Lot Modal */}
      <Dialog open={!!receiveLotId} onOpenChange={(o) => { if (!o) setReceiveLotId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receive Lot — {receivingLot?.lot_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={receiveAsExpected}
                onCheckedChange={(v) => setReceiveAsExpected(!!v)}
              />
              <Label className="mb-0">Everything arrived as expected</Label>
            </div>
            {!receiveAsExpected && (
              <div>
                <Label>Arrived with exceptions</Label>
                <Textarea
                  value={exceptionsNotes}
                  onChange={(e) => setExceptionsNotes(e.target.value)}
                  placeholder="Describe the exceptions…"
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveLotId(null)}>Cancel</Button>
            <Button
              disabled={(!receiveAsExpected && !exceptionsNotes.trim()) || receiveMutation.isPending}
              onClick={() => receiveMutation.mutate()}
            >
              {receiveMutation.isPending ? 'Saving…' : 'Confirm Received'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
