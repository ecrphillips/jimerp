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
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Edit, UserPlus } from 'lucide-react';
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
  isNew?: boolean;
  isDeleted?: boolean;
}

interface OrderData {
  id: string;
  order_number: string;
  requested_ship_date: string | null;
  delivery_method: DeliveryMethod;
  status: OrderStatus;
  client_id: string;
  updated_at?: string;
  created_by_admin?: boolean;
}

interface OrderEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderData;
  lineItems: LineItem[];
  clientId: string;
}

export function OrderEditModal({
  open,
  onOpenChange,
  order,
  lineItems: initialLineItems,
  clientId,
}: OrderEditModalProps) {
  const queryClient = useQueryClient();
  
  // Form state
  const [requestedShipDate, setRequestedShipDate] = useState(order.requested_ship_date ?? '');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>(order.delivery_method);
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [editedLineItems, setEditedLineItems] = useState<LineItem[]>([]);
  const [newLineProductId, setNewLineProductId] = useState<string>('');
  const [newLineQuantity, setNewLineQuantity] = useState<number>(1);
  const [newLineGrind, setNewLineGrind] = useState<GrindOption>('WHOLE_BEAN');
  
  // Reset form state when modal opens
  useEffect(() => {
    if (open) {
      setRequestedShipDate(order.requested_ship_date ?? '');
      setDeliveryMethod(order.delivery_method);
      setStatus(order.status);
      setEditedLineItems(initialLineItems.map(li => ({ ...li, isNew: false, isDeleted: false })));
    }
  }, [open, order, initialLineItems]);
  
  // Fetch products for the client to allow adding new line items
  const { data: availableProducts } = useQuery({
    queryKey: ['products-for-client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, bag_size_g')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('product_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!clientId,
  });
  
  // Fetch prices for products
  const { data: prices } = useQuery({
    queryKey: ['prices-for-client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price')
        .order('effective_date', { ascending: false });
      if (error) throw error;
      // Return latest price per product
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

  // Save mutations
  const updateOrderMutation = useMutation({
    mutationFn: async () => {
      // Update order details
      const { error: orderError } = await supabase
        .from('orders')
        .update({
          requested_ship_date: requestedShipDate || null,
          delivery_method: deliveryMethod,
          status,
        })
        .eq('id', order.id);
      if (orderError) throw orderError;
      
      // Handle line item changes
      for (const li of editedLineItems) {
        if (li.isDeleted && !li.isNew) {
          // Delete existing line item
          const { error } = await supabase
            .from('order_line_items')
            .delete()
            .eq('id', li.id);
          if (error) throw error;
        } else if (li.isNew && !li.isDeleted) {
          // Insert new line item
          const { error } = await supabase
            .from('order_line_items')
            .insert({
              order_id: order.id,
              product_id: li.product_id,
              quantity_units: li.quantity_units,
              grind: li.grind,
              unit_price_locked: li.unit_price_locked,
            });
          if (error) throw error;
        } else if (!li.isNew && !li.isDeleted) {
          // Update existing line item
          const { error } = await supabase
            .from('order_line_items')
            .update({
              quantity_units: li.quantity_units,
              grind: li.grind,
            })
            .eq('id', li.id);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success('Order updated successfully');
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['order-line-items', order.id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['shippable-orders'] });
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

  const handleAddLineItem = () => {
    if (!newLineProductId) return;
    
    const product = availableProducts?.find(p => p.id === newLineProductId);
    if (!product) return;
    
    const price = prices?.[newLineProductId] ?? 0;
    
    setEditedLineItems([
      ...editedLineItems,
      {
        id: `new-${Date.now()}`,
        product_id: newLineProductId,
        product_name: product.product_name,
        quantity_units: newLineQuantity,
        grind: newLineGrind,
        unit_price_locked: price,
        isNew: true,
        isDeleted: false,
      },
    ]);
    
    setNewLineProductId('');
    setNewLineQuantity(1);
    setNewLineGrind('WHOLE_BEAN');
  };

  const handleRemoveLineItem = (itemId: string) => {
    setEditedLineItems(items => 
      items.map(li => 
        li.id === itemId ? { ...li, isDeleted: true } : li
      )
    );
  };

  const handleQuantityChange = (itemId: string, quantity: number) => {
    setEditedLineItems(items =>
      items.map(li =>
        li.id === itemId ? { ...li, quantity_units: Math.max(1, quantity) } : li
      )
    );
  };

  const handleGrindChange = (itemId: string, grind: GrindOption | null) => {
    setEditedLineItems(items =>
      items.map(li =>
        li.id === itemId ? { ...li, grind } : li
      )
    );
  };

  const activeLineItems = editedLineItems.filter(li => !li.isDeleted);
  
  const allStatuses: OrderStatus[] = ['DRAFT', 'SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED', 'CANCELLED'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Edit Order {order.order_number}
            {order.created_by_admin && (
              <Badge variant="outline" className="ml-2 text-xs">
                <UserPlus className="h-3 w-3 mr-1" />
                Admin Created
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Order Details */}
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
              <Label htmlFor="deliveryMethod">Delivery Method</Label>
              <Select value={deliveryMethod} onValueChange={(v) => setDeliveryMethod(v as DeliveryMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PICKUP">Pickup</SelectItem>
                  <SelectItem value="DELIVERY">Delivery</SelectItem>
                  <SelectItem value="COURIER">Courier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allStatuses.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Line Items */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Line Items</Label>
            
            {activeLineItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No line items. Add products below.</p>
            ) : (
              <div className="space-y-2">
                {activeLineItems.map((li) => (
                  <div key={li.id} className={`flex items-center gap-2 p-2 border rounded ${li.isNew ? 'bg-green-50 border-green-200' : ''}`}>
                    <span className="flex-1 font-medium text-sm">{li.product_name}</span>
                    
                    <Input
                      type="number"
                      min="1"
                      value={li.quantity_units}
                      onChange={(e) => handleQuantityChange(li.id, parseInt(e.target.value) || 1)}
                      className="w-20 h-8"
                    />
                    
                    <Select value={li.grind ?? 'WHOLE_BEAN'} onValueChange={(v) => handleGrindChange(li.id, v as GrindOption)}>
                      <SelectTrigger className="w-28 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WHOLE_BEAN">Whole Bean</SelectItem>
                        <SelectItem value="ESPRESSO">Espresso</SelectItem>
                        <SelectItem value="FILTER">Filter</SelectItem>
                      </SelectContent>
                    </Select>
                    
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
            
            {/* Add new line item */}
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
                <Select value={newLineGrind} onValueChange={(v) => setNewLineGrind(v as GrindOption)}>
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