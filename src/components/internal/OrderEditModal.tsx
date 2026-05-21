import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Edit, Truck } from 'lucide-react';
import { CreatedByBadge } from '@/components/orders/CreatedByBadge';
import type { Database } from '@/integrations/supabase/types';

type DeliveryMethod = Database['public']['Enums']['delivery_method'];
type GrindOption = Database['public']['Enums']['grind_option'];
type OrderStatus = Database['public']['Enums']['order_status'];

interface LineItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity_units: number;
  grind: GrindOption | null;
  unit_price_locked: number;
  shipment_id: string | null;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface ShipmentDraft {
  id: string;             // real UUID, or `tmp-...` for unsaved rows
  isNew: boolean;
  isDeleted: boolean;
  shipment_number: number;
  delivery_method: DeliveryMethod;
  ship_to_name: string;
  ship_to_address_line1: string;
  ship_to_address_line2: string;
  ship_to_city: string;
  ship_to_region: string;
  ship_to_postal: string;
  notes: string;
}

interface OrderData {
  id: string;
  order_number: string;
  requested_ship_date: string | null;
  delivery_method: DeliveryMethod;
  status: OrderStatus;
  account_id: string;
  updated_at?: string;
  created_by_admin?: boolean;
  created_by_user_id?: string | null;
}

interface OrderEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderData;
  lineItems: LineItem[];
  clientId: string;
}

const newTmpId = (): string => `tmp-${Math.random().toString(36).slice(2, 9)}`;

export function OrderEditModal({
  open,
  onOpenChange,
  order,
  lineItems: initialLineItems,
  clientId,
}: OrderEditModalProps) {
  const queryClient = useQueryClient();

  const [requestedShipDate, setRequestedShipDate] = useState(order.requested_ship_date ?? '');
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [editedLineItems, setEditedLineItems] = useState<LineItem[]>([]);
  const [editedShipments, setEditedShipments] = useState<ShipmentDraft[]>([]);
  const [newLineProductId, setNewLineProductId] = useState<string>('');
  const [newLineQuantity, setNewLineQuantity] = useState<number>(1);
  const [newLineGrind, setNewLineGrind] = useState<GrindOption>('WHOLE_BEAN');

  // Load existing shipments when the modal opens.
  const { data: existingShipments } = useQuery({
    queryKey: ['order-shipments-edit', order.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_shipments')
        .select(
          'id, shipment_number, delivery_method, ship_to_name, ship_to_address_line1, ship_to_address_line2, ship_to_city, ship_to_region, ship_to_postal, notes',
        )
        .eq('order_id', order.id)
        .order('shipment_number');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  // Reset form state when the modal opens or upstream data changes.
  useEffect(() => {
    if (!open) return;
    setRequestedShipDate(order.requested_ship_date ?? '');
    setStatus(order.status);
    setEditedLineItems(initialLineItems.map((li) => ({ ...li, isNew: false, isDeleted: false })));
    if (existingShipments) {
      setEditedShipments(
        existingShipments.map((s) => ({
          id: s.id,
          isNew: false,
          isDeleted: false,
          shipment_number: s.shipment_number,
          delivery_method: s.delivery_method,
          ship_to_name: s.ship_to_name ?? '',
          ship_to_address_line1: s.ship_to_address_line1 ?? '',
          ship_to_address_line2: s.ship_to_address_line2 ?? '',
          ship_to_city: s.ship_to_city ?? '',
          ship_to_region: s.ship_to_region ?? '',
          ship_to_postal: s.ship_to_postal ?? '',
          notes: s.notes ?? '',
        })),
      );
    }
  }, [open, order, initialLineItems, existingShipments]);

  const { data: availableProducts } = useQuery({
    queryKey: ['products-for-client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, bag_size_g')
        .eq('account_id', clientId)
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!clientId,
  });

  const { data: prices } = useQuery({
    queryKey: ['prices-for-client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price')
        .order('effective_date', { ascending: false });
      if (error) throw error;
      const priceMap: Record<string, number> = {};
      for (const p of data ?? []) {
        if (!(p.product_id in priceMap)) {
          priceMap[p.product_id] = p.unit_price;
        }
      }
      return priceMap;
    },
    enabled: open && !!clientId,
  });

  const activeShipments = editedShipments.filter((s) => !s.isDeleted);

  const updateOrderMutation = useMutation({
    mutationFn: async () => {
      // 1. Save shipments first so we can resolve tmp ids before writing lines.
      //    Order: deletes → updates → inserts (so number conflicts settle).
      for (const s of editedShipments) {
        if (s.isDeleted && !s.isNew) {
          const { error } = await supabase.from('order_shipments').delete().eq('id', s.id);
          if (error) throw error;
        }
      }
      for (const s of editedShipments) {
        if (!s.isDeleted && !s.isNew) {
          const { error } = await supabase
            .from('order_shipments')
            .update({
              shipment_number: s.shipment_number,
              delivery_method: s.delivery_method,
              ship_to_name: s.ship_to_name || null,
              ship_to_address_line1: s.ship_to_address_line1 || null,
              ship_to_address_line2: s.ship_to_address_line2 || null,
              ship_to_city: s.ship_to_city || null,
              ship_to_region: s.ship_to_region || null,
              ship_to_postal: s.ship_to_postal || null,
              notes: s.notes || null,
            })
            .eq('id', s.id);
          if (error) throw error;
        }
      }
      const tmpToReal: Record<string, string> = {};
      for (const s of editedShipments) {
        if (s.isNew && !s.isDeleted) {
          const { data, error } = await supabase
            .from('order_shipments')
            .insert({
              order_id: order.id,
              shipment_number: s.shipment_number,
              delivery_method: s.delivery_method,
              ship_to_name: s.ship_to_name || null,
              ship_to_address_line1: s.ship_to_address_line1 || null,
              ship_to_address_line2: s.ship_to_address_line2 || null,
              ship_to_city: s.ship_to_city || null,
              ship_to_region: s.ship_to_region || null,
              ship_to_postal: s.ship_to_postal || null,
              notes: s.notes || null,
            })
            .select('id')
            .single();
          if (error) throw error;
          if (data?.id) tmpToReal[s.id] = data.id;
        }
      }

      // 2. Keep orders.delivery_method in sync with shipment 1 for legacy paths.
      const primary = editedShipments.find(
        (s) => !s.isDeleted && s.shipment_number === 1,
      );
      const { error: orderError } = await supabase
        .from('orders')
        .update({
          requested_ship_date: requestedShipDate || null,
          delivery_method: primary?.delivery_method ?? order.delivery_method,
          status,
        })
        .eq('id', order.id);
      if (orderError) throw orderError;

      // 3. Line items: delete → insert → update. Resolve tmp shipment ids first.
      const resolveShipmentId = (sid: string | null): string | null => {
        if (!sid) return null;
        if (tmpToReal[sid]) return tmpToReal[sid];
        return sid;
      };

      for (const li of editedLineItems) {
        if (li.isDeleted && !li.isNew) {
          const { error } = await supabase.from('order_line_items').delete().eq('id', li.id);
          if (error) throw error;
        } else if (li.isNew && !li.isDeleted) {
          const { error } = await supabase.from('order_line_items').insert({
            order_id: order.id,
            product_id: li.product_id,
            quantity_units: li.quantity_units,
            grind: li.grind,
            unit_price_locked: li.unit_price_locked,
            shipment_id: resolveShipmentId(li.shipment_id),
          });
          if (error) throw error;
        } else if (!li.isNew && !li.isDeleted) {
          const { error } = await supabase
            .from('order_line_items')
            .update({
              quantity_units: li.quantity_units,
              grind: li.grind,
              shipment_id: resolveShipmentId(li.shipment_id),
            })
            .eq('id', li.id);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      if (status === 'CONFIRMED') {
        supabase.functions
          .invoke('confirm-order-email', { body: { order_id: order.id } })
          .then(({ error }) => {
            if (error) console.warn('[confirm-order-email] Failed to invoke:', error);
          })
          .catch((err) => console.warn('[confirm-order-email] Invocation error:', err));
      }
      toast.success('Order updated successfully');
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['order-line-items', order.id] });
      queryClient.invalidateQueries({ queryKey: ['order-shipments', order.id] });
      queryClient.invalidateQueries({ queryKey: ['order-shipments-edit', order.id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['shippable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shippable-orders-all'] });
      queryClient.invalidateQueries({ queryKey: ['pack-demand'] });
      queryClient.invalidateQueries({ queryKey: ['roast-demand'] });
      queryClient.invalidateQueries({ queryKey: ['ship-demand'] });
      onOpenChange(false);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update order');
    },
  });

  const handleAddShipment = () => {
    const nextNumber =
      (Math.max(0, ...editedShipments.filter((s) => !s.isDeleted).map((s) => s.shipment_number)) ||
        0) + 1;
    setEditedShipments((prev) => [
      ...prev,
      {
        id: newTmpId(),
        isNew: true,
        isDeleted: false,
        shipment_number: nextNumber,
        delivery_method: 'DELIVERY',
        ship_to_name: '',
        ship_to_address_line1: '',
        ship_to_address_line2: '',
        ship_to_city: '',
        ship_to_region: '',
        ship_to_postal: '',
        notes: '',
      },
    ]);
  };

  const handleRemoveShipment = (id: string) => {
    if (activeShipments.length <= 1) {
      toast.error('Order must have at least one shipment');
      return;
    }
    setEditedShipments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isDeleted: true } : s)),
    );
    // Reassign any lines pointing at the removed shipment to the lowest remaining.
    const remaining = activeShipments.find((s) => s.id !== id);
    if (remaining) {
      setEditedLineItems((prev) =>
        prev.map((li) =>
          li.shipment_id === id ? { ...li, shipment_id: remaining.id } : li,
        ),
      );
    }
  };

  const updateShipmentField = <K extends keyof ShipmentDraft>(
    id: string,
    key: K,
    value: ShipmentDraft[K],
  ) => {
    setEditedShipments((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
  };

  const handleAddLineItem = () => {
    if (!newLineProductId) return;
    const product = availableProducts?.find((p) => p.id === newLineProductId);
    if (!product) return;
    const price = prices?.[newLineProductId] ?? 0;
    const defaultShipmentId = activeShipments[0]?.id ?? null;
    setEditedLineItems([
      ...editedLineItems,
      {
        id: `new-${Date.now()}`,
        product_id: newLineProductId,
        product_name: product.product_name,
        quantity_units: newLineQuantity,
        grind: newLineGrind,
        unit_price_locked: price,
        shipment_id: defaultShipmentId,
        isNew: true,
        isDeleted: false,
      },
    ]);
    setNewLineProductId('');
    setNewLineQuantity(1);
    setNewLineGrind('WHOLE_BEAN');
  };

  const handleRemoveLineItem = (itemId: string) => {
    setEditedLineItems((items) =>
      items.map((li) => (li.id === itemId ? { ...li, isDeleted: true } : li)),
    );
  };

  const handleQuantityChange = (itemId: string, quantity: number) => {
    setEditedLineItems((items) =>
      items.map((li) => (li.id === itemId ? { ...li, quantity_units: Math.max(1, quantity) } : li)),
    );
  };

  const handleGrindChange = (itemId: string, grind: GrindOption | null) => {
    setEditedLineItems((items) =>
      items.map((li) => (li.id === itemId ? { ...li, grind } : li)),
    );
  };

  const handleLineShipmentChange = (itemId: string, shipmentId: string) => {
    setEditedLineItems((items) =>
      items.map((li) => (li.id === itemId ? { ...li, shipment_id: shipmentId } : li)),
    );
  };

  const activeLineItems = editedLineItems.filter((li) => !li.isDeleted);

  const allStatuses: OrderStatus[] = [
    'DRAFT',
    'SUBMITTED',
    'CONFIRMED',
    'IN_PRODUCTION',
    'READY',
    'SHIPPED',
    'CANCELLED',
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Edit Order {order.order_number}
            {order.created_by_admin && (
              <CreatedByBadge userId={order.created_by_user_id} variant="modal" />
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shipDate">Requested Ship Date</Label>
              <Input
                id="shipDate"
                type="date"
                value={requestedShipDate}
                onChange={(e) => setRequestedShipDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Shipments */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4" /> Shipments ({activeShipments.length})
              </Label>
              <Button size="sm" variant="outline" onClick={handleAddShipment} className="h-8">
                <Plus className="h-4 w-4 mr-1" /> Add shipment
              </Button>
            </div>

            <div className="space-y-3">
              {activeShipments.map((s) => (
                <div
                  key={s.id}
                  className={`border rounded-md p-3 space-y-2 ${
                    s.isNew ? 'bg-green-50 border-green-200' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Shipment #{s.shipment_number}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <Select
                        value={s.delivery_method}
                        onValueChange={(v) =>
                          updateShipmentField(s.id, 'delivery_method', v as DeliveryMethod)
                        }
                      >
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PICKUP">Pickup</SelectItem>
                          <SelectItem value="DELIVERY">Delivery</SelectItem>
                          <SelectItem value="COURIER">Courier</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveShipment(s.id)}
                        disabled={activeShipments.length <= 1}
                        title={
                          activeShipments.length <= 1
                            ? 'Order must have at least one shipment'
                            : 'Remove shipment'
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-2">
                    <Input
                      placeholder="Ship-to name"
                      value={s.ship_to_name}
                      onChange={(e) => updateShipmentField(s.id, 'ship_to_name', e.target.value)}
                      className="h-8"
                    />
                    <Input
                      placeholder="Address line 1"
                      value={s.ship_to_address_line1}
                      onChange={(e) =>
                        updateShipmentField(s.id, 'ship_to_address_line1', e.target.value)
                      }
                      className="h-8"
                    />
                    <Input
                      placeholder="Address line 2"
                      value={s.ship_to_address_line2}
                      onChange={(e) =>
                        updateShipmentField(s.id, 'ship_to_address_line2', e.target.value)
                      }
                      className="h-8"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        placeholder="City"
                        value={s.ship_to_city}
                        onChange={(e) => updateShipmentField(s.id, 'ship_to_city', e.target.value)}
                        className="h-8"
                      />
                      <Input
                        placeholder="Region"
                        value={s.ship_to_region}
                        onChange={(e) =>
                          updateShipmentField(s.id, 'ship_to_region', e.target.value)
                        }
                        className="h-8"
                      />
                      <Input
                        placeholder="Postal"
                        value={s.ship_to_postal}
                        onChange={(e) =>
                          updateShipmentField(s.id, 'ship_to_postal', e.target.value)
                        }
                        className="h-8"
                      />
                    </div>
                  </div>
                  <Input
                    placeholder="Shipment notes"
                    value={s.notes}
                    onChange={(e) => updateShipmentField(s.id, 'notes', e.target.value)}
                    className="h-8"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Line Items</Label>

            {activeLineItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No line items. Add products below.</p>
            ) : (
              <div className="space-y-2">
                {activeLineItems.map((li) => (
                  <div
                    key={li.id}
                    className={`flex items-center gap-2 p-2 border rounded ${
                      li.isNew ? 'bg-green-50 border-green-200' : ''
                    }`}
                  >
                    <span className="flex-1 font-medium text-sm">{li.product_name}</span>

                    <Input
                      type="number"
                      min="1"
                      value={li.quantity_units}
                      onChange={(e) =>
                        handleQuantityChange(li.id, parseInt(e.target.value) || 1)
                      }
                      className="w-20 h-8"
                    />

                    <Select
                      value={li.grind ?? 'WHOLE_BEAN'}
                      onValueChange={(v) => handleGrindChange(li.id, v as GrindOption)}
                    >
                      <SelectTrigger className="w-28 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WHOLE_BEAN">Whole Bean</SelectItem>
                        <SelectItem value="ESPRESSO">Espresso</SelectItem>
                        <SelectItem value="FILTER">Filter</SelectItem>
                      </SelectContent>
                    </Select>

                    {activeShipments.length > 0 && (
                      <Select
                        value={li.shipment_id ?? activeShipments[0]?.id ?? ''}
                        onValueChange={(v) => handleLineShipmentChange(li.id, v)}
                      >
                        <SelectTrigger className="w-28 h-8">
                          <SelectValue placeholder="Ship #" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeShipments.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              Ship #{s.shipment_number}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    <span className="text-sm text-muted-foreground w-16 text-right">
                      ${li.unit_price_locked.toFixed(2)}
                    </span>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleRemoveLineItem(li.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 pt-2 border-t">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Product</Label>
                <Select value={newLineProductId} onValueChange={setNewLineProductId}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Select product..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProducts?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.product_name} ({p.bag_size_g}g)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-20 space-y-1">
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  min="1"
                  value={newLineQuantity}
                  onChange={(e) => setNewLineQuantity(parseInt(e.target.value) || 1)}
                  className="h-8"
                />
              </div>

              <div className="w-28 space-y-1">
                <Label className="text-xs">Grind</Label>
                <Select
                  value={newLineGrind}
                  onValueChange={(v) => setNewLineGrind(v as GrindOption)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WHOLE_BEAN">Whole Bean</SelectItem>
                    <SelectItem value="ESPRESSO">Espresso</SelectItem>
                    <SelectItem value="FILTER">Filter</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={handleAddLineItem}
                disabled={!newLineProductId}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => updateOrderMutation.mutate()}
            disabled={updateOrderMutation.isPending || activeLineItems.length === 0}
          >
            {updateOrderMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
