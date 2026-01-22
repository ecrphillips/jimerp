import React, { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { HistoricalEditWarningModal } from '@/components/internal/HistoricalEditWarningModal';

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: order, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          requested_ship_date,
          delivery_method,
          client_po,
          client_notes,
          internal_ops_notes,
          roasted,
          packed,
          shipped_or_ready,
          invoiced,
          created_by_admin,
          client:clients(name)
        `)
        .eq('id', id!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: lineItems } = useQuery({
    queryKey: ['order-line-items', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          quantity_units,
          grind,
          unit_price_locked,
          line_notes,
          product:products(product_name)
        `)
        .eq('order_id', id!)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  const [opsNotes, setOpsNotes] = useState('');
  const [opsNotesLoaded, setOpsNotesLoaded] = useState(false);
  
  // Historical edit warning modal state
  const [showHistoricalWarning, setShowHistoricalWarning] = useState(false);
  const [pendingChecklistUpdate, setPendingChecklistUpdate] = useState<{
    roasted?: boolean;
    packed?: boolean;
    shipped_or_ready?: boolean;
    invoiced?: boolean;
  } | null>(null);

  // Check if order is in a "historical" state that requires confirmation
  const isHistoricalStatus = order?.status === 'SHIPPED' || order?.status === 'CANCELLED';

  // Initialize ops notes when order loads
  React.useEffect(() => {
    if (order && !opsNotesLoaded) {
      setOpsNotes(order.internal_ops_notes ?? '');
      setOpsNotesLoaded(true);
    }
  }, [order, opsNotesLoaded]);

  // Handler for checklist changes - shows warning for historical orders
  const handleChecklistChange = useCallback((updates: {
    roasted?: boolean;
    packed?: boolean;
    shipped_or_ready?: boolean;
    invoiced?: boolean;
  }) => {
    if (isHistoricalStatus) {
      setPendingChecklistUpdate(updates);
      setShowHistoricalWarning(true);
    } else {
      updateChecklistMutation.mutate(updates);
    }
  }, [isHistoricalStatus]);

  // Confirm the historical edit
  const confirmHistoricalEdit = useCallback(() => {
    if (pendingChecklistUpdate) {
      updateChecklistMutation.mutate(pendingChecklistUpdate);
      setPendingChecklistUpdate(null);
    }
    setShowHistoricalWarning(false);
  }, [pendingChecklistUpdate]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'CONFIRMED' })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Order confirmed');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to confirm order');
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: async (notes: string) => {
      const { error } = await supabase
        .from('orders')
        .update({ internal_ops_notes: notes })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Notes saved');
      queryClient.invalidateQueries({ queryKey: ['order', id] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to save notes');
    },
  });

  const updateChecklistMutation = useMutation({
    mutationFn: async (updates: { 
      roasted?: boolean; 
      packed?: boolean; 
      shipped_or_ready?: boolean; 
      invoiced?: boolean; 
    }) => {
      const { error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update checklist');
    },
  });

  if (isLoading) {
    return (
      <div className="page-container">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <p className="text-destructive">Failed to load order: {error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="page-container">
        <p className="text-muted-foreground">Order not found.</p>
        <Link to="/orders">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Orders
          </Button>
        </Link>
      </div>
    );
  }

  const lineTotal = lineItems?.reduce((sum, li) => sum + li.quantity_units * li.unit_price_locked, 0) ?? 0;

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/orders">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="page-title">{order.order_number}</h1>
          <span className={`rounded px-2 py-1 text-xs font-medium ${order.status === 'SUBMITTED' ? 'bg-amber-100 text-amber-800' : order.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}>
            {order.status}
          </span>
          {order.created_by_admin && (
            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <UserPlus className="h-3 w-3" />
              Admin Created
            </span>
          )}
        </div>
        {order.status === 'SUBMITTED' && (
          <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
            {confirmMutation.isPending ? 'Confirming…' : 'Confirm Order'}
          </Button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Order Info</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><strong>Client:</strong> {order.client?.name ?? 'Unknown'}</div>
            <div><strong>Status:</strong> {order.status}</div>
            <div><strong>Delivery:</strong> {order.delivery_method}</div>
            <div><strong>Client PO:</strong> {order.client_po || '—'}</div>
            <div>
              <strong>Requested Ship Date:</strong>{' '}
              {order.requested_ship_date
                ? format(new Date(order.requested_ship_date), 'MMM d, yyyy')
                : '—'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Fulfillment Checklist
              {isHistoricalStatus && (
                <span className="text-xs font-normal text-muted-foreground">(edits require confirmation)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="roasted" 
                checked={order.roasted}
                onCheckedChange={(checked) => handleChecklistChange({ roasted: !!checked })}
              />
              <Label htmlFor="roasted" className="cursor-pointer">Roasted</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="packed" 
                checked={order.packed}
                onCheckedChange={(checked) => handleChecklistChange({ packed: !!checked })}
              />
              <Label htmlFor="packed" className="cursor-pointer">Packed</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="shipped_or_ready" 
                checked={order.shipped_or_ready}
                onCheckedChange={(checked) => handleChecklistChange({ shipped_or_ready: !!checked })}
              />
              <Label htmlFor="shipped_or_ready" className="cursor-pointer">Shipped / Ready for Pickup</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="invoiced" 
                checked={order.invoiced}
                onCheckedChange={(checked) => handleChecklistChange({ invoiced: !!checked })}
              />
              <Label htmlFor="invoiced" className="cursor-pointer">Invoiced</Label>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        <Card>
          <CardHeader><CardTitle>Client Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{order.client_notes || '—'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Internal Ops Notes</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              id="opsNotes"
              value={opsNotes}
              onChange={(e) => setOpsNotes(e.target.value)}
              rows={3}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveNotesMutation.mutate(opsNotes)}
              disabled={saveNotesMutation.isPending}
            >
              {saveNotesMutation.isPending ? 'Saving…' : 'Save Notes'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Line Items</CardTitle></CardHeader>
        <CardContent>
          {!lineItems || lineItems.length === 0 ? (
            <p className="text-muted-foreground">No line items.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2">Product</th>
                    <th className="pb-2">Qty</th>
                    <th className="pb-2">Grind</th>
                    <th className="pb-2">Unit Price</th>
                    <th className="pb-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li) => (
                    <tr key={li.id} className="border-b last:border-0">
                      <td className="py-2">{li.product?.product_name ?? 'Unknown'}</td>
                      <td className="py-2">{li.quantity_units}</td>
                      <td className="py-2">{li.grind ?? '—'}</td>
                      <td className="py-2">${li.unit_price_locked.toFixed(2)}</td>
                      <td className="py-2 text-right">${(li.quantity_units * li.unit_price_locked).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="pt-4 text-right font-medium">Total:</td>
                    <td className="pt-4 text-right font-medium">${lineTotal.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Historical edit warning modal */}
      <HistoricalEditWarningModal
        open={showHistoricalWarning}
        onOpenChange={(open) => {
          setShowHistoricalWarning(open);
          if (!open) setPendingChecklistUpdate(null);
        }}
        orderStatus={order.status}
        onConfirm={confirmHistoricalEdit}
      />
    </div>
  );
}
