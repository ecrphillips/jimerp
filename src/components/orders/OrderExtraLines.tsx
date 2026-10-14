import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

export interface OrderExtraLine {
  id: string;
  order_id: string;
  label: string;
  quantity: number;
  unit_price: number;
}

export const extraLinesKey = (orderId: string) => ['order-extra-lines', orderId];

/** Free-text invoice lines (e.g. "Extra Bags") shared by the Invoicing tab and Order Detail. */
export function useOrderExtraLines(orderId: string | undefined) {
  return useQuery({
    queryKey: extraLinesKey(orderId ?? ''),
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_extra_lines')
        .select('id, order_id, label, quantity, unit_price')
        .eq('order_id', orderId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, quantity: Number(r.quantity), unit_price: Number(r.unit_price) })) as OrderExtraLine[];
    },
  });
}

function useInvalidate(orderId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: extraLinesKey(orderId) });
    qc.invalidateQueries({ queryKey: ['shipped-awaiting-invoice'] });
  };
}

export function useDeleteExtraLine(orderId: string) {
  const invalidate = useInvalidate(orderId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('order_extra_lines').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: () => toast.error('Failed to remove line'),
  });
}

export function AddExtraLineForm({ orderId }: { orderId: string }) {
  const invalidate = useInvalidate(orderId);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');

  const q = Number(qty);
  const p = Number(price);
  const valid = label.trim() !== '' && Number.isFinite(q) && q >= 0 && price.trim() !== '' && Number.isFinite(p) && p >= 0;

  const add = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from('order_extra_lines').insert({
        order_id: orderId, label: label.trim(), quantity: q, unit_price: p, created_by: u.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Line added');
      setLabel(''); setQty('1'); setPrice(''); setOpen(false);
      invalidate();
    },
    onError: () => toast.error('Failed to add line'),
  });

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> Add line
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Label</label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Extra Bags" />
      </div>
      <div className="w-20 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Qty</label>
        <Input type="number" min="0" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      <div className="w-28 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Unit price</label>
        <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
      </div>
      <div className="w-24 pb-2 text-right text-sm tabular-nums">
        ${valid ? (q * p).toFixed(2) : '0.00'}
      </div>
      <Button type="button" size="sm" onClick={() => add.mutate()} disabled={!valid || add.isPending}>Add</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
