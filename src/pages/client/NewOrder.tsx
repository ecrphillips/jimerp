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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Minus, Trash2, Package } from 'lucide-react';
import { GramPackagingBadge, formatGramsLabel } from '@/components/GramPackagingBadge';
import { UnusualOrderModal, type FlaggedItem } from '@/components/client/UnusualOrderModal';
import { LocationSelect } from '@/components/orders/LocationSelect';
import { CaseQuantityInput } from '@/components/orders/CaseQuantityInput';
import { useClientOrderingConstraints, validateCaseQuantity } from '@/hooks/useClientOrderingConstraints';
import type { GrindOption, DeliveryMethod } from '@/types/database';

interface LineItem {
  productId: string;
  productName: string;
  displayName: string;
  quantity: number;
  grind: GrindOption | null;
  grindOptions: GrindOption[];
  price: number | null;
  packagingTypeName: string | null;
  gramsPerUnit: number | null;
}

interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  bag_size_g: number;
  grams_per_unit: number | null;
  format: string;
  grind_options: GrindOption[];
  is_perennial: boolean;
  packaging_type_id: string | null;
  packaging_types: { name: string } | null;
}

// Helper to build display name with packaging info
function buildDisplayName(productName: string, packagingTypeName: string | null, gramsPerUnit: number | null): string {
  if (!packagingTypeName || !gramsPerUnit) {
    return productName;
  }
  const sizeLabel = formatGramsLabel(gramsPerUnit);
  return `${productName} — ${packagingTypeName} (${sizeLabel})`;
}

export default function NewOrder() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [shipPreference, setShipPreference] = useState<'SOONEST' | 'SPECIFIC'>('SOONEST');
  const [requestedShipDate, setRequestedShipDate] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('PICKUP');
  const [clientPo, setClientPo] = useState('');
  const [clientNotes, setClientNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const minSpecificDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date.toISOString().split('T')[0];
  }, []);

  const [showUnusualModal, setShowUnusualModal] = useState(false);
  const [flaggedItems, setFlaggedItems] = useState<FlaggedItem[]>([]);
  const [totalFlag, setTotalFlag] = useState<{
    lastTotal: number;
    currentTotal: number;
    multiplier: number;
  } | null>(null);

  const { constraints, isLoading: constraintsLoading } = useClientOrderingConstraints(authUser?.accountId);

  // Fetch allowed products with packaging type join
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['client-products', authUser?.accountId, constraints.allowedProductIds],
    queryFn: async () => {
      let query = supabase
        .from('products')
        .select('id, product_name, sku, bag_size_g, grams_per_unit, format, grind_options, is_perennial, packaging_type_id, packaging_types(name)')
        .eq('is_active', true)
        .order('product_name', { ascending: true });

      if (constraints.allowedProductIds && constraints.allowedProductIds.length > 0) {
        query = query.in('id', constraints.allowedProductIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Product[];
    },
    enabled: !constraintsLoading,
  });

  const { data: prices } = useQuery({
    queryKey: ['client-prices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .order('effective_date', { ascending: false });

      if (error) throw error;

      const priceMap: Record<string, number> = {};
      for (const p of data ?? []) {
        if (!priceMap[p.product_id]) {
          priceMap[p.product_id] = p.unit_price;
        }
      }
      return priceMap;
    },
  });

  // Group products by base product name, then by packaging variant
  const { groupedProducts, perennialProducts, seasonalProducts } = useMemo(() => {
    const perennial: Product[] = [];
    const seasonal: Product[] = [];
    const grouped: Map<string, Product[]> = new Map();

    for (const p of products ?? []) {
      // Group by base product name
      const baseName = p.product_name;
      if (!grouped.has(baseName)) {
        grouped.set(baseName, []);
      }
      grouped.get(baseName)!.push(p);

      // Also sort by perennial/seasonal
      if (p.is_perennial) {
        perennial.push(p);
      } else {
        seasonal.push(p);
      }
    }

    return { groupedProducts: grouped, perennialProducts: perennial, seasonalProducts: seasonal };
  }, [products]);

  const getLineItem = (productId: string) => lineItems.find((li) => li.productId === productId);

  const createLineItem = (product: Product, qty: number): LineItem => {
    const grindOpts = (product.grind_options ?? []) as GrindOption[];
    const packagingTypeName = product.packaging_types?.name ?? null;
    const gramsPerUnit = product.grams_per_unit;
    
    return {
      productId: product.id,
      productName: product.product_name,
      displayName: buildDisplayName(product.product_name, packagingTypeName, gramsPerUnit),
      quantity: qty,
      grind: grindOpts.length > 0 ? grindOpts[0] : null,
      grindOptions: grindOpts,
      price: prices?.[product.id] ?? null,
      packagingTypeName,
      gramsPerUnit,
    };
  };

  const addOrIncrementProduct = (productId: string) => {
    const existing = getLineItem(productId);
    const incrementAmount = constraints.caseOnly && constraints.caseSize ? constraints.caseSize : 1;
    
    if (existing) {
      updateQuantity(productId, existing.quantity + incrementAmount);
      return;
    }

    const product = products?.find((p) => p.id === productId);
    if (!product) return;

    const initialQty = constraints.caseOnly && constraints.caseSize ? constraints.caseSize : 1;
    setLineItems([...lineItems, createLineItem(product, initialQty)]);
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

  const checkUnusualOrderSize = async (): Promise<boolean> => {
    if (!authUser?.accountId) return false;

    try {
      const { data: lastOrder } = await supabase
        .from('orders')
        .select('id, order_line_items(product_id, quantity_units)')
        .eq('client_id', authUser.accountId)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: recentOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('client_id', authUser.accountId)
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'SHIPPED'])
        .order('created_at', { ascending: false })
        .limit(5);

      let packagingBaselines: Record<string, number[]> = {};
      if (recentOrders && recentOrders.length > 0) {
        const orderIds = recentOrders.map((o) => o.id);
        const { data: recentLineItems } = await supabase
          .from('order_line_items')
          .select('product_id, quantity_units, products(packaging_types(name), grams_per_unit)')
          .in('order_id', orderIds);

        for (const li of recentLineItems ?? []) {
          const typeName = (li.products as { packaging_types: { name: string } | null } | null)?.packaging_types?.name;
          if (typeName) {
            if (!packagingBaselines[typeName]) packagingBaselines[typeName] = [];
            packagingBaselines[typeName].push(li.quantity_units);
          }
        }
      }

      const median = (arr: number[]): number => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };

      const lastQtyMap: Record<string, number> = {};
      let lastTotalUnits = 0;
      if (lastOrder?.order_line_items) {
        for (const li of lastOrder.order_line_items) {
          lastQtyMap[li.product_id] = (lastQtyMap[li.product_id] || 0) + li.quantity_units;
          lastTotalUnits += li.quantity_units;
        }
      }

      const currentTotalUnits = lineItems.reduce((sum, li) => sum + li.quantity, 0);

      const flagged: FlaggedItem[] = [];
      for (const li of lineItems) {
        const lastQty = lastQtyMap[li.productId] || 0;

        if (lastQty > 0 && li.quantity >= 10 && li.quantity >= lastQty * 10) {
          flagged.push({
            productName: li.productName,
            packagingTypeName: li.packagingTypeName,
            gramsPerUnit: li.gramsPerUnit,
            lastQty,
            currentQty: li.quantity,
            multiplier: li.quantity / lastQty,
            baselineLabel: 'last order',
          });
        } else if (lastQty === 0) {
          const typeName = li.packagingTypeName;
          const baselineQtys = typeName ? packagingBaselines[typeName] : undefined;
          const baselineQty = baselineQtys ? median(baselineQtys) : 0;

          if (baselineQty > 0 && li.quantity >= 10 && li.quantity >= baselineQty * 3) {
            flagged.push({
              productName: li.productName,
              packagingTypeName: li.packagingTypeName,
              gramsPerUnit: li.gramsPerUnit,
              lastQty: Math.round(baselineQty),
              currentQty: li.quantity,
              multiplier: li.quantity / baselineQty,
              baselineLabel: `typical for ${typeName}`,
            });
          } else if (baselineQty === 0 && li.quantity >= 50) {
            flagged.push({
              productName: li.productName,
              packagingTypeName: li.packagingTypeName,
              gramsPerUnit: li.gramsPerUnit,
              lastQty: 0,
              currentQty: li.quantity,
              multiplier: li.quantity,
              baselineLabel: 'large absolute quantity',
            });
          }
        }
      }

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
    if (!authUser?.accountId) {
      toast.error('No account linked to your user');
      return;
    }
    if (lineItems.length === 0) {
      toast.error('Add at least one product');
      return;
    }

    const missingPrice = lineItems.find((li) => li.price === null);
    if (missingPrice) {
      toast.error(`"${missingPrice.displayName}" has no price set. Ask ops to set a price.`);
      return;
    }

    if (constraints.caseOnly && constraints.caseSize) {
      const invalidItem = lineItems.find((li) => {
        const error = validateCaseQuantity(li.quantity, constraints.caseOnly, constraints.caseSize);
        return error !== null;
      });
      if (invalidItem) {
        toast.error(`"${invalidItem.displayName}" quantity must be a multiple of ${constraints.caseSize} (case size).`);
        return;
      }
    }

    const isUnusual = await checkUnusualOrderSize();
    if (isUnusual) {
      setShowUnusualModal(true);
      return;
    }

    await submitOrder();
  };

  const submitOrder = async () => {
    if (!authUser?.accountId) return;

    setSubmitting(true);
    try {
      const { data: validationResult, error: validationError } = await supabase.functions.invoke(
        'validate-order-constraints',
        {
          body: {
            client_id: authUser.accountId,
            line_items: lineItems.map((li) => ({
              product_id: li.productId,
              quantity_units: li.quantity,
            })),
          },
        }
      );

      if (validationError) {
        console.error('Validation error:', validationError);
        toast.error('Failed to validate order');
        setSubmitting(false);
        return;
      }

      if (!validationResult.valid) {
        for (const error of validationResult.errors) {
          toast.error(error);
        }
        setSubmitting(false);
        return;
      }

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          client_id: authUser.accountId,
          location_id: selectedLocationId || null,
          order_number: '',
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

      const lineItemsData = lineItems.map((li) => ({
        order_id: order.id,
        product_id: li.productId,
        quantity_units: li.quantity,
        grind: li.grind,
        unit_price_locked: li.price!,
      }));

      const { error: lineError } = await supabase.from('order_line_items').insert(lineItemsData);
      if (lineError) throw lineError;

      supabase.functions.invoke('notify-new-order', {
        body: { order_id: order.id },
      }).then(({ data, error }) => {
        if (error) {
          console.warn('[notify-new-order] Failed to send notification:', error);
        } else {
          console.log('[notify-new-order] Notification result:', data);
        }
      }).catch((err) => {
        console.warn('[notify-new-order] Notification error:', err);
      });

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

  const handleQuantityInputChange = (productId: string, value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '');
    const qty = numericValue === '' ? 0 : parseInt(numericValue, 10);

    if (qty <= 0) {
      removeLine(productId);
    } else {
      const existing = getLineItem(productId);
      if (!existing) {
        const product = products?.find((p) => p.id === productId);
        if (!product) return;
        setLineItems([...lineItems, createLineItem(product, qty)]);
      } else {
        updateQuantity(productId, qty);
      }
    }
  };

  // Render a single product SKU row
  const renderProductRow = (p: Product) => {
    const lineItem = getLineItem(p.id);
    const hasPrice = prices && p.id in prices;
    const price = prices?.[p.id];
    const isCaseOnly = constraints.caseOnly && constraints.caseSize;
    const packagingTypeName = p.packaging_types?.name ?? null;
    const gramsPerUnit = p.grams_per_unit;

    const handleQuantityChange = (qty: number) => {
      if (qty <= 0) {
        removeLine(p.id);
        return;
      }
      const existing = getLineItem(p.id);
      if (!existing) {
        setLineItems([...lineItems, createLineItem(p, qty)]);
      } else {
        updateQuantity(p.id, qty);
      }
    };

    return (
      <li key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium truncate">{p.product_name}</span>
          <GramPackagingBadge packagingTypeName={packagingTypeName} gramsPerUnit={gramsPerUnit} />
          {hasPrice ? (
            <span className="text-sm text-muted-foreground">${price!.toFixed(2)}</span>
          ) : (
            <span className="text-xs text-destructive">No price</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isCaseOnly ? (
            <CaseQuantityInput
              value={lineItem?.quantity ?? 0}
              onChange={handleQuantityChange}
              caseSize={constraints.caseSize!}
            />
          ) : (
            <>
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
            </>
          )}
        </div>
      </li>
    );
  };

  // Render product group (base product name as header, variants underneath)
  const renderProductGroup = (baseName: string, variants: Product[]) => {
    // Sort variants by grams per unit (smallest to largest)
    const sortedVariants = [...variants].sort((a, b) => {
      const gramsA = a.grams_per_unit ?? a.bag_size_g ?? 0;
      const gramsB = b.grams_per_unit ?? b.bag_size_g ?? 0;
      return gramsA - gramsB;
    });

    if (sortedVariants.length === 1) {
      // Single variant - no grouping needed
      return renderProductRow(sortedVariants[0]);
    }

    // Multiple variants - show as grouped section
    return (
      <div key={baseName} className="mb-3">
        <p className="text-sm font-semibold text-foreground mb-1 pl-1">{baseName}</p>
        <ul className="pl-2 border-l-2 border-muted">
          {sortedVariants.map((variant) => {
            const lineItem = getLineItem(variant.id);
            const hasPrice = prices && variant.id in prices;
            const price = prices?.[variant.id];
            const isCaseOnly = constraints.caseOnly && constraints.caseSize;
            const packagingTypeName = variant.packaging_types?.name ?? null;
            const gramsPerUnit = variant.grams_per_unit;

            const handleQuantityChange = (qty: number) => {
              if (qty <= 0) {
                removeLine(variant.id);
                return;
              }
              const existing = getLineItem(variant.id);
              if (!existing) {
                setLineItems([...lineItems, createLineItem(variant, qty)]);
              } else {
                updateQuantity(variant.id, qty);
              }
            };

            return (
              <li key={variant.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <GramPackagingBadge packagingTypeName={packagingTypeName} gramsPerUnit={gramsPerUnit} />
                  {hasPrice ? (
                    <span className="text-sm text-muted-foreground">${price!.toFixed(2)}</span>
                  ) : (
                    <span className="text-xs text-destructive">No price</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isCaseOnly ? (
                    <CaseQuantityInput
                      value={lineItem?.quantity ?? 0}
                      onChange={handleQuantityChange}
                      caseSize={constraints.caseSize!}
                    />
                  ) : (
                    <>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(variant.id, (lineItem?.quantity ?? 0) - 1)}
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
                        onChange={(e) => handleQuantityInputChange(variant.id, e.target.value)}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => addOrIncrementProduct(variant.id)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  // Render products grouped by base name
  const renderProductsGrouped = (productsList: Product[]) => {
    // Group by base product name
    const grouped: Map<string, Product[]> = new Map();
    for (const p of productsList) {
      if (!grouped.has(p.product_name)) {
        grouped.set(p.product_name, []);
      }
      grouped.get(p.product_name)!.push(p);
    }

    // Sort groups alphabetically
    const sortedGroups = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    return sortedGroups.map(([baseName, variants]) => renderProductGroup(baseName, variants));
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
            {constraints.caseOnly && constraints.caseSize && (
              <Alert className="mb-4">
                <Package className="h-4 w-4" />
                <AlertDescription>
                  <strong>Case ordering:</strong> Products are sold in case lots of {constraints.caseSize} only.
                  Quantities will be adjusted to the nearest case.
                </AlertDescription>
              </Alert>
            )}
            
            {productsLoading || constraintsLoading ? (
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
                    <div>{renderProductsGrouped(perennialProducts)}</div>
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
                    <div>{renderProductsGrouped(seasonalProducts)}</div>
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{li.productName}</span>
                          <GramPackagingBadge 
                            packagingTypeName={li.packagingTypeName} 
                            gramsPerUnit={li.gramsPerUnit} 
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {constraints.caseOnly && constraints.caseSize ? (
                            <CaseQuantityInput
                              value={li.quantity}
                              onChange={(qty) => updateQuantity(li.productId, qty)}
                              caseSize={constraints.caseSize}
                              size="sm"
                            />
                          ) : (
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
                          )}
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
              {authUser?.clientId && (
                <LocationSelect
                  clientId={authUser.clientId}
                  value={selectedLocationId}
                  onChange={setSelectedLocationId}
                  required
                />
              )}
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
