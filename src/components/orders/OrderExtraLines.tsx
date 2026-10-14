import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { TAX_CODES, type TaxCode, type TaxSuggestion } from '@/lib/salesTax';
import { TaxRateSelect, TaxSuggestionChip } from '@/components/orders/TaxRateSelect';

export interface OrderExtraLine {
  id: string;
  order_id: string;
  label: string;
  quantity: number;
  unit_price: number;
  tax_code: TaxCode;
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
        .select('id, order_id, label, quantity, unit_price, tax_code')
        .eq('order_id', orderId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, quantity: Number(r.quantity), unit_price: Number(r.unit_price), tax_code: (r.tax_code ?? 'NONE') as TaxCode })) as OrderExtraLine[];
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
  const [tax, setTax] = useState<TaxCode>('NONE');

  const q = Number(qty);
  const p = Number(price);
  const valid = label.trim() !== '' && Number.isFinite(q) && q >= 0 && price.trim() !== '' && Number.isFinite(p) && p >= 0;

  const add = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from('order_extra_lines').insert({
        order_id: orderId, label: label.trim(), quantity: q, unit_price: p, tax_code: tax, created_by: u.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Line added');
      setLabel(''); setQty('1'); setPrice(''); setTax('NONE'); setOpen(false);
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
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Tax</label>
        <TaxRateSelect value={tax} onChange={setTax} />
      </div>
      <div className="w-28 pb-2 text-right text-sm tabular-nums">
        ${valid ? (q * p).toFixed(2) : '0.00'}
        {valid && tax !== 'NONE' && <div className="text-xs text-muted-foreground">+ ${(q * p * TAX_CODES[tax].rate).toFixed(2)} tax</div>}
      </div>
      <Button type="button" size="sm" onClick={() => add.mutate()} disabled={!valid || add.isPending}>Add</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function useLineInvalidate(orderId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: extraLinesKey(orderId) });
    qc.invalidateQueries({ queryKey: ['shipped-awaiting-invoice'] });
    qc.invalidateQueries({ queryKey: ['order-shipping-cost', orderId] });
  };
}

/** Editable table row for an extra line on the order page (6 columns). */
export function EditableExtraLineRow({ line, orderId }: { line: OrderExtraLine; orderId: string }) {
  const invalidate = useLineInvalidate(orderId);
  const del = useDeleteExtraLine(orderId);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(line.label);
  const [qty, setQty] = useState(String(line.quantity));
  const [price, setPrice] = useState(String(line.unit_price));
  const [tax, setTax] = useState<TaxCode>(line.tax_code);
  const q = Number(qty), p = Number(price);
  const valid = label.trim() !== '' && Number.isFinite(q) && q >= 0 && Number.isFinite(p) && p >= 0 && price.trim() !== '';
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('order_extra_lines').update({ label: label.trim(), quantity: q, unit_price: p, tax_code: tax }).eq('id', line.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Line updated'); setEditing(false); invalidate(); },
    onError: () => toast.error('Failed to update line'),
  });
  const startEdit = () => { setLabel(line.label); setQty(String(line.quantity)); setPrice(String(line.unit_price)); setTax(line.tax_code); setEditing(true); };

  if (!editing) {
    return (
      <tr className="border-b last:border-0">
        <td className="py-2">
          <div className="flex items-center gap-2">
            <span>{line.label}</span>
            {line.tax_code !== 'NONE' && <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{TAX_CODES[line.tax_code].label}</span>}
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Edit line" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Remove line" onClick={() => del.mutate(line.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </td>
        <td className="py-2">{line.quantity}</td>
        <td className="py-2">—</td>
        <td className="py-2">—</td>
        <td className="py-2">${line.unit_price.toFixed(2)}</td>
        <td className="py-2 text-right">${(line.quantity * line.unit_price).toFixed(2)}</td>
      </tr>
    );
  }
  return (
    <tr className="border-b bg-muted/30 last:border-0">
      <td className="py-2 pr-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-9 min-w-40 flex-1" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label" />
          <TaxRateSelect value={tax} onChange={setTax} />
        </div>
      </td>
      <td className="py-2 pr-2"><Input className="h-9 w-20" type="number" min="0" step="1" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" /></td>
      <td className="py-2" colSpan={2}>
        <div className="flex gap-1">
          <Button size="sm" onClick={() => save.mutate()} disabled={!valid || save.isPending}><Check className="mr-1 h-4 w-4" />Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
        </div>
      </td>
      <td className="py-2 pr-2"><Input className="h-9 w-24" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Unit price" /></td>
      <td className="py-2 text-right tabular-nums">${valid ? (q * p).toFixed(2) : '0.00'}</td>
    </tr>
  );
}

/** Editable shipping row (add / edit / remove) for the order page. */
export function EditableShippingRow({ orderId, cost, taxCode, suggestion }: {
  orderId: string; cost: number | null; taxCode: TaxCode | null; suggestion: TaxSuggestion | undefined;
}) {
  const invalidate = useLineInvalidate(orderId);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState<TaxCode>('GST5');
  const effective: TaxCode = taxCode ?? suggestion?.code ?? 'GST5';
  const a = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(a) && a >= 0;
  const save = useMutation({
    mutationFn: async (vals: { cost: number | null; tax: TaxCode | null }) => {
      const { error } = await supabase.from('orders').update({ shipping_cost_cad: vals.cost, shipping_tax_code: vals.tax }).eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Shipping saved'); setEditing(false); invalidate(); },
    onError: () => toast.error('Failed to save shipping'),
  });
  const startEdit = () => { setAmount(cost == null ? '' : cost.toFixed(2)); setTax(effective); setEditing(true); };

  if (!editing) {
    if (cost == null) {
      return (
        <tr><td colSpan={6} className="py-2">
          <Button variant="outline" size="sm" onClick={startEdit}><Plus className="mr-1 h-4 w-4" /> Add shipping</Button>
        </td></tr>
      );
    }
    return (
      <tr className="border-b last:border-0">
        <td className="py-2">
          <div className="flex items-center gap-2">
            <span>Shipping</span>
            {effective !== 'NONE' && <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{TAX_CODES[effective].label}{taxCode ? '' : ' (suggested)'}</span>}
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Edit shipping" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Remove shipping" onClick={() => save.mutate({ cost: null, tax: null })}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </td>
        <td className="py-2">—</td><td className="py-2">—</td><td className="py-2">—</td><td className="py-2">—</td>
        <td className="py-2 text-right">${cost.toFixed(2)}</td>
      </tr>
    );
  }
  return (
    <>
      {suggestion && (
        <tr><td colSpan={6} className="pt-2"><TaxSuggestionChip suggestion={suggestion} current={tax} onApply={setTax} /></td></tr>
      )}
      <tr className="border-b bg-muted/30 last:border-0">
        <td className="py-2 pr-2">
          <div className="flex items-center gap-2"><span>Shipping</span><TaxRateSelect value={tax} onChange={setTax} /></div>
        </td>
        <td className="py-2" colSpan={3}>
          <div className="flex gap-1">
            <Button size="sm" onClick={() => save.mutate({ cost: a, tax })} disabled={!valid || save.isPending}><Check className="mr-1 h-4 w-4" />Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
          </div>
        </td>
        <td className="py-2" />
        <td className="py-2 text-right"><Input className="ml-auto h-9 w-28 text-right" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-label="Shipping cost (CAD)" /></td>
      </tr>
    </>
  );
}
