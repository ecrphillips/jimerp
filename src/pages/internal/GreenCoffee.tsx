import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface GreenLot {
  id: string;
  name: string;
  supplier: string | null;
  origin: string | null;
  received_date: string | null;
  kg_received: number;
  kg_on_hand: number;
  notes_internal: string | null;
  created_at: string;
}

export default function GreenCoffee() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLot, setEditingLot] = useState<GreenLot | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [supplier, setSupplier] = useState('');
  const [origin, setOrigin] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [kgReceived, setKgReceived] = useState(0);
  const [kgOnHand, setKgOnHand] = useState(0);
  const [notes, setNotes] = useState('');

  const { data: lots, isLoading } = useQuery({
    queryKey: ['green-coffee-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_coffee_lots')
        .select('*')
        .order('received_date', { ascending: false });

      if (error) throw error;
      return (data ?? []) as GreenLot[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        supplier: supplier || null,
        origin: origin || null,
        received_date: receivedDate || null,
        kg_received: kgReceived,
        kg_on_hand: kgOnHand,
        notes_internal: notes || null,
      };

      if (editingLot) {
        const { error } = await supabase
          .from('green_coffee_lots')
          .update(payload)
          .eq('id', editingLot.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('green_coffee_lots').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingLot ? 'Lot updated' : 'Lot created');
      queryClient.invalidateQueries({ queryKey: ['green-coffee-lots'] });
      closeDialog();
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save lot');
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async ({ id, newKg }: { id: string; newKg: number }) => {
      const { error } = await supabase
        .from('green_coffee_lots')
        .update({ kg_on_hand: newKg })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Inventory updated');
      queryClient.invalidateQueries({ queryKey: ['green-coffee-lots'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update inventory');
    },
  });

  const openNew = () => {
    setEditingLot(null);
    setName('');
    setSupplier('');
    setOrigin('');
    setReceivedDate(format(new Date(), 'yyyy-MM-dd'));
    setKgReceived(0);
    setKgOnHand(0);
    setNotes('');
    setDialogOpen(true);
  };

  const openEdit = (lot: GreenLot) => {
    setEditingLot(lot);
    setName(lot.name);
    setSupplier(lot.supplier ?? '');
    setOrigin(lot.origin ?? '');
    setReceivedDate(lot.received_date ?? '');
    setKgReceived(lot.kg_received);
    setKgOnHand(lot.kg_on_hand);
    setNotes(lot.notes_internal ?? '');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingLot(null);
  };

  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustValue, setAdjustValue] = useState('');

  const handleAdjust = (lot: GreenLot) => {
    setAdjustingId(lot.id);
    setAdjustValue(lot.kg_on_hand.toString());
  };

  const saveAdjust = (id: string) => {
    const newKg = parseFloat(adjustValue);
    if (!isNaN(newKg) && newKg >= 0) {
      adjustMutation.mutate({ id, newKg });
    }
    setAdjustingId(null);
  };

  const totalOnHand = lots?.reduce((sum, l) => sum + l.kg_on_hand, 0) ?? 0;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Green Coffee Lots</h1>
          <p className="text-sm text-muted-foreground">Total on hand: {totalOnHand.toFixed(1)} kg</p>
        </div>
        <Button onClick={openNew}>Add Lot</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Inventory</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !lots || lots.length === 0 ? (
            <p className="text-muted-foreground">No green coffee lots yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Origin</th>
                  <th className="pb-2">Supplier</th>
                  <th className="pb-2">Received</th>
                  <th className="pb-2">Received (kg)</th>
                  <th className="pb-2">On Hand (kg)</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <tr key={lot.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{lot.name}</td>
                    <td className="py-2">{lot.origin || '—'}</td>
                    <td className="py-2">{lot.supplier || '—'}</td>
                    <td className="py-2">
                      {lot.received_date ? format(new Date(lot.received_date), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="py-2">{lot.kg_received}</td>
                    <td className="py-2">
                      {adjustingId === lot.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            step="0.1"
                            className="w-24"
                            value={adjustValue}
                            onChange={(e) => setAdjustValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveAdjust(lot.id)}
                          />
                          <Button size="sm" onClick={() => saveAdjust(lot.id)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setAdjustingId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <span
                          className={`cursor-pointer hover:underline ${lot.kg_on_hand <= 5 ? 'text-destructive font-medium' : ''}`}
                          onClick={() => handleAdjust(lot)}
                        >
                          {lot.kg_on_hand}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(lot)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLot ? 'Edit Lot' : 'New Green Coffee Lot'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="origin">Origin</Label>
                <Input id="origin" value={origin} onChange={(e) => setOrigin(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="supplier">Supplier</Label>
                <Input id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="receivedDate">Received Date</Label>
              <Input
                id="receivedDate"
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="kgReceived">KG Received</Label>
                <Input
                  id="kgReceived"
                  type="number"
                  step="0.1"
                  value={kgReceived}
                  onChange={(e) => setKgReceived(parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label htmlFor="kgOnHand">KG On Hand</Label>
                <Input
                  id="kgOnHand"
                  type="number"
                  step="0.1"
                  value={kgOnHand}
                  onChange={(e) => setKgOnHand(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Internal Notes</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !name}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
