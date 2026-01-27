import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { PackagingBadge, type PackagingVariant } from '@/components/PackagingBadge';
import { UnusualOrderModal, type FlaggedItem } from '@/components/client/UnusualOrderModal';
import { LocationSelect } from '@/components/orders/LocationSelect';
import type { GrindOption, DeliveryMethod } from '@/types/database';

interface LineItem {
  productId: string;
  productName: string;
  quantity: number;
  grind: GrindOption | null;
  grindOptions: GrindOption[];
  price: number | null;
  packagingVariant: PackagingVariant | null;
}

interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  format: string;
  grind_options: GrindOption[];
  is_perennial: boolean;
  packaging_variant: PackagingVariant | null;
}

export default function NewOrder() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  // Ship preference: 'SOONEST' or 'SPECIFIC'
  const [shipPreference, setShipPreference] = useState<'SOONEST' | 'SPECIFIC'>('SOONEST');
  const [requestedShipDate, setRequestedShipDate] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('PICKUP');
  const [clientPo, setClientPo] = useState('');
  const [clientNotes, setClientNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Calculate minimum date for specific date option (today + 3 days)
  const minSpecificDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date.toISOString().split('T')[0];
  }, []);

  // Unusual order modal state
  const [showUnusualModal, setShowUnusualModal] = useState(false);
  const [flaggedItems, setFlaggedItems] = useState<FlaggedItem[]>([]);
  const [totalFlag, setTotalFlag] = useState<{
    lastTotal: number;
    currentTotal: number;
    multiplier: number;
  } | null>(null);
  // Fetch products for this client (RLS filters automatically)
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['client-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, format, grind_options, is_perennial, packaging_variant')
        .eq('is_active', true)
        .order('product_name', { ascending: true });

      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  // Fetch current prices for all products
  const { data: prices } = useQuery({
    queryKey: ['client-prices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .order('effective_date', { ascending: false });

      if (error) throw error;

      // Build map of product_id -> latest price
      const priceMap: Record<string, number> = {};
      for (const p of data ?? []) {
        if (!priceMap[p.product_id]) {
          priceMap[p.product_id] = p.unit_price;
        }
      }
      return priceMap;
    },
  });

  // Group products by perennial status
  const { perennialProducts, seasonalProducts } = useMemo(() => {
    const perennial: Product[] = [];
    const seasonal: Product[] = [];
    for (const p of products ?? []) {
      if (p.is_perennial) {
        perennial.push(p);
      } else {
        seasonal.push(p);
      }
    }
    return { perennialProducts: perennial, seasonalProducts: seasonal };
  }, [products]);

  const getLineItem = (productId: string) => lineItems.find((li) => li.productId === productId);

  const addOrIncrementProduct = (productId: string) => {
    const existing = getLineItem(productId);
    if (existing) {
      updateQuantity(productId, existing.quantity + 1);
      return;
    }

    const product = products?.find((p) => p.id === productId);
    if (!product) return;

    const grindOpts = (product.grind_options ?? []) as GrindOption[];
    setLineItems([
      ...lineItems,
      {
        productId: product.id,
        productName: product.product_name,
        quantity: 1,
        grind: grindOpts.length > 0 ? grindOpts[0] : null,
        grindOptions: grindOpts,
        price: prices?.[product.id] ?? null,
        packagingVariant: product.packaging_variant,
      },
    ]);
  };

  const updateQuantity = (productId: string, qty: number) => {
    if (qty <= 0) {
      removeLine(productId);
      return;
    }
    setLineItems((prev) =>
      prev.map((li) => (li.productId === productId ? { ...li, quantity: qty } : li))
    );
  };

  const updateGrind = (productId: string, grind: GrindOption) => {
    setLineItems((prev) =>
      prev.map((li) => (li.productId === productId ? { ...li, grind } : li))
    );
  };

  const removeLine = (productId: string) => {
    setLineItems((prev) => prev.filter((li) => li.productId !== productId));
  };

  const orderTotal = useMemo(() => {
    return lineItems.reduce((sum, li) => sum + (li.price ?? 0) * li.quantity, 0);
  }, [lineItems]);

  // Check for unusual order size against last order + packaging baseline
  const checkUnusualOrderSize = async (): Promise<boolean> => {
    if (!authUser?.clientId) return false;

    try {
      // Fetch most recent prior order (not CANCELLED or DRAFT)
      const { data: lastOrder } = await supabase
        .from('orders')
        .select('id, order_line_items(product_id, quantity_units)')
        .eq('client_id', authUser.clientId)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Fetch recent orders (last 5) for packaging baseline
      const { data: recentOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('client_id', authUser.clientId)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED'])
        .order('created_at', { ascending: false })
        .limit(5);

      // Fetch line items from recent orders with product packaging info
      let packagingBaselines: Record<string, number[]> = {};
      if (recentOrders && recentOrders.length > 0) {
        const orderIds = recentOrders.map((o) => o.id);
        const { data: recentLineItems } = await supabase
          .from('order_line_items')
          .select('product_id, quantity_units, products(packaging_variant)')
          .in('order_id', orderIds);

        // Group quantities by packaging_variant
        for (const li of recentLineItems ?? []) {
          const variant = (li.products as { packaging_variant: string } | null)?.packaging_variant;
          if (variant) {
            if (!packagingBaselines[variant]) packagingBaselines[variant] = [];
            packagingBaselines[variant].push(li.quantity_units);
          }
        }
      }

      // Helper to compute median
      const median = (arr: number[]): number => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };

      // Build map of product_id -> last quantity
      const lastQtyMap: Record<string, number> = {};
      let lastTotalUnits = 0;
      if (lastOrder?.order_line_items) {
        for (const li of lastOrder.order_line_items) {
          lastQtyMap[li.product_id] = (lastQtyMap[li.product_id] || 0) + li.quantity_units;
          lastTotalUnits += li.quantity_units;
        }
      }

      // Calculate current totals
      const currentTotalUnits = lineItems.reduce((sum, li) => sum + li.quantity, 0);

      // Check per-product thresholds
      const flagged: FlaggedItem[] = [];
      for (const li of lineItems) {
        const lastQty = lastQtyMap[li.productId] || 0;

        // Rule A: If last_qty > 0: flag if draft_qty >= 10 × last_qty AND draft_qty >= 10
        if (lastQty > 0 && li.quantity >= 10 && li.quantity >= lastQty * 10) {
          flagged.push({
            productName: li.productName,
            packagingVariant: li.packagingVariant,
            lastQty,
            currentQty: li.quantity,
            multiplier: li.quantity / lastQty,
            baselineLabel: 'last order',
          });
        }
        // Rule B: If last_qty is 0 or missing
        else if (lastQty === 0) {
          const variant = li.packagingVariant;
          const baselineQtys = variant ? packagingBaselines[variant] : undefined;
          const baselineQty = baselineQtys ? median(baselineQtys) : 0;

          // B1: If packaging baseline exists: flag if draft_qty >= 3 × baseline AND draft_qty >= 10
          if (baselineQty > 0 && li.quantity >= 10 && li.quantity >= baselineQty * 3) {
            flagged.push({
              productName: li.productName,
              packagingVariant: li.packagingVariant,
              lastQty: Math.round(baselineQty),
              currentQty: li.quantity,
              multiplier: li.quantity / baselineQty,
              baselineLabel: `typical for ${variant?.replace('_', ' ')}`,
            });
          }
          // B2: No baseline - absolute guardrail: flag if draft_qty >= 50
          else if (baselineQty === 0 && li.quantity >= 50) {
            flagged.push({
              productName: li.productName,
              packagingVariant: li.packagingVariant,
              lastQty: 0,
              currentQty: li.quantity,
              multiplier: li.quantity,
              baselineLabel: 'large absolute quantity',
            });
          }
        }
      }

      // Check total threshold: total draft >= 5 × last total AND total draft >= 50 AND last total > 0
      let totalFlagData: { lastTotal: number; currentTotal: number; multiplier: number } | null = null;
      if (lastTotalUnits > 0 && currentTotalUnits >= 50 && currentTotalUnits >= lastTotalUnits * 5) {
        totalFlagData = {
          lastTotal: lastTotalUnits,
          currentTotal: currentTotalUnits,
          multiplier: currentTotalUnits / lastTotalUnits,
        };
      }

      if (flagged.length > 0 || totalFlagData) {
        setFlaggedItems(flagged);
        setTotalFlag(totalFlagData);
        return true;
      }

      return false;
    } catch (err) {
      console.error('Error checking order size:', err);
      return false;
    }
  };

  const handleSubmitClick = async () => {
    if (!authUser?.clientId) {
      toast.error('No client linked to your account');
      return;
    }
    if (lineItems.length === 0) {
      toast.error('Add at least one product');
      return;
    }

    // Check all items have prices (null means no price_list row; 0 is valid)
    const missingPrice = lineItems.find((li) => li.price === null);
    if (missingPrice) {
      toast.error(`"${missingPrice.productName}" has no price set. Ask ops to set a price.`);
      return;
    }

    // Check for unusual order size
    const isUnusual = await checkUnusualOrderSize();
    if (isUnusual) {
      setShowUnusualModal(true);
      return;
    }

    await submitOrder();
  };

  const submitOrder = async () => {
    if (!authUser?.clientId) return;

    setSubmitting(true);
    try {
      // Create order (order_number is auto-generated by DB trigger)
      // For 'SOONEST', we send null/empty and let Ops set the real date
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          client_id: authUser.clientId,
          location_id: selectedLocationId || null,
          order_number: '', // Trigger will replace with auto-generated value
          status: 'SUBMITTED',
          requested_ship_date: shipPreference === 'SPECIFIC' && requestedShipDate ? requestedShipDate : null,
          delivery_method: deliveryMethod,
          client_po: clientPo || null,
          client_notes: shipPreference === 'SOONEST' 
            ? `[Requested: Soonest possible]${clientNotes ? ` ${clientNotes}` : ''}`
            : clientNotes || null,
          created_by_user_id: authUser.id,
        })
        .select('id, order_number')
        .single();

      if (orderError) throw orderError;

      // Create line items
      const lineItemsData = lineItems.map((li) => ({
        order_id: order.id,
        product_id: li.productId,
        quantity_units: li.quantity,
        grind: li.grind,
        unit_price_locked: li.price!,
      }));

      const { error: lineError } = await supabase.from('order_line_items').insert(lineItemsData);
      if (lineError) throw lineError;

      toast.success(`Order ${order.order_number} submitted!`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate('/portal/orders');
    } catch (err) {
      console.error('Submit error:', err);
      toast.error('Failed to submit order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnusualConfirm = async () => {
    setShowUnusualModal(false);
    await submitOrder();
  };

  // Handle quantity input change (typing)
  const handleQuantityInputChange = (productId: string, value: string) => {
    // Remove non-numeric characters
    const numericValue = value.replace(/[^0-9]/g, '');
    const qty = numericValue === '' ? 0 : parseInt(numericValue, 10);

    if (qty <= 0) {
      removeLine(productId);
    } else {
      // If product not in line items yet, add it first
      const existing = getLineItem(productId);
      if (!existing) {
        const product = products?.find((p) => p.id === productId);
        if (!product) return;
        const grindOpts = (product.grind_options ?? []) as GrindOption[];
        setLineItems([
          ...lineItems,
          {
            productId: product.id,
            productName: product.product_name,
            quantity: qty,
            grind: grindOpts.length > 0 ? grindOpts[0] : null,
            grindOptions: grindOpts,
            price: prices?.[product.id] ?? null,
            packagingVariant: product.packaging_variant,
          },
        ]);
      } else {
        updateQuantity(productId, qty);
      }
    }
  };

  const renderProductRow = (p: Product) => {
    const lineItem = getLineItem(p.id);
    const hasPrice = prices && p.id in prices;
    const price = prices?.[p.id];

    return (
      <li key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium truncate">{p.product_name}</span>
          <PackagingBadge variant={p.packaging_variant} />
          {hasPrice ? (
            <span className="text-sm text-muted-foreground">${price!.toFixed(2)}</span>
          ) : (
            <span className="text-xs text-destructive">No price</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => updateQuantity(p.id, (lineItem?.quantity ?? 0) - 1)}
            disabled={!lineItem}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            type="text"
            inputMode="numeric"
            className="w-14 h-7 text-center text-sm px-1"
            value={lineItem?.quantity ?? ''}
            placeholder="0"
            onChange={(e) => handleQuantityInputChange(p.id, e.target.value)}
          />
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => addOrIncrementProduct(p.id)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">New Order</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
        {/* Left: Product List */}
        <Card>
          <CardHeader>
            <CardTitle>Products</CardTitle>
          </CardHeader>
          <CardContent>
            {productsLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : !products || products.length === 0 ? (
              <p className="text-muted-foreground">No products available.</p>
            ) : (
              <div className="space-y-4">
                {perennialProducts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Perennial
                    </p>
                    <ul>{perennialProducts.map(renderProductRow)}</ul>
                  </div>
                )}
                {perennialProducts.length > 0 && seasonalProducts.length > 0 && (
                  <Separator />
                )}
                {seasonalProducts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Seasonal
                    </p>
                    <ul>{seasonalProducts.map(renderProductRow)}</ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Order Summary (sticky) */}
        <div className="lg:sticky lg:top-4 lg:self-start space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary ({lineItems.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {lineItems.length === 0 ? (
                <p className="text-muted-foreground text-sm">No products added yet.</p>
              ) : (
                <ul className="space-y-3">
                  {lineItems.map((li) => (
                    <li key={li.productId} className="flex items-start justify-between gap-2 text-sm border-b pb-3 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{li.productName}</span>
                          <PackagingBadge variant={li.packagingVariant} />
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-6 w-6"
                              onClick={() => updateQuantity(li.productId, li.quantity - 1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input
                              type="text"
                              inputMode="numeric"
                              className="w-12 h-6 text-center text-xs px-1"
                              value={li.quantity}
                              onChange={(e) => handleQuantityInputChange(li.productId, e.target.value)}
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-6 w-6"
                              onClick={() => updateQuantity(li.productId, li.quantity + 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          {li.grindOptions.length > 0 && (
                            <Select
                              value={li.grind ?? ''}
                              onValueChange={(v) => updateGrind(li.productId, v as GrindOption)}
                            >
                              <SelectTrigger className="h-6 w-24 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {li.grindOptions.map((g) => (
                                  <SelectItem key={g} value={g}>
                                    {g}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <span className="text-muted-foreground">
                            {li.price !== null
                              ? `$${(li.price * li.quantity).toFixed(2)}`
                              : 'No price'}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removeLine(li.productId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {lineItems.length > 0 && (
                <div className="mt-4 pt-4 border-t flex justify-between font-medium">
                  <span>Total</span>
                  <span>${orderTotal.toFixed(2)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Location Selection (if client has locations) */}
              {authUser?.clientId && (
                <LocationSelect
                  clientId={authUser.clientId}
                  value={selectedLocationId}
                  onChange={setSelectedLocationId}
                  required
                />
              )}
              {/* Ship Timing Preference */}
              <div className="space-y-2">
                <Label>When do you need this order?</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={shipPreference === 'SOONEST' ? 'default' : 'outline'}
                    onClick={() => {
                      setShipPreference('SOONEST');
                      setRequestedShipDate('');
                    }}
                    className="flex-1"
                  >
                    Soonest possible
                  </Button>
                  <Button
                    type="button"
                    variant={shipPreference === 'SPECIFIC' ? 'default' : 'outline'}
                    onClick={() => setShipPreference('SPECIFIC')}
                    className="flex-1"
                  >
                    Specific date
                  </Button>
                </div>
                
                {shipPreference === 'SPECIFIC' && (
                  <div className="mt-2">
                    <Label htmlFor="shipDate" className="text-sm">
                      Select date (at least 3 days out)
                    </Label>
                    <Input
                      id="shipDate"
                      type="date"
                      value={requestedShipDate}
                      min={minSpecificDate}
                      onChange={(e) => setRequestedShipDate(e.target.value)}
                    />
                  </div>
                )}
                
                <p className="text-xs text-muted-foreground">
                  Final ship timing will be confirmed by the roastery.
                </p>
              </div>
              
              <div>
                <Label htmlFor="delivery">Delivery Method</Label>
                <Select value={deliveryMethod} onValueChange={(v) => setDeliveryMethod(v as DeliveryMethod)}>
                  <SelectTrigger id="delivery">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PICKUP">Pickup</SelectItem>
                    <SelectItem value="DELIVERY">Delivery</SelectItem>
                    <SelectItem value="COURIER">Courier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="po">PO Number (optional)</Label>
                <Input id="po" value={clientPo} onChange={(e) => setClientPo(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea id="notes" value={clientNotes} onChange={(e) => setClientNotes(e.target.value)} rows={2} />
              </div>
              <Button
                className="w-full"
                onClick={handleSubmitClick}
                disabled={submitting || lineItems.length === 0}
              >
                {submitting ? 'Submitting…' : 'Submit Order'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <UnusualOrderModal
        open={showUnusualModal}
        onClose={() => setShowUnusualModal(false)}
        onConfirm={handleUnusualConfirm}
        flaggedItems={flaggedItems}
        totalFlag={totalFlag}
      />
    </div>
  );
}
