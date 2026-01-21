import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format, addDays, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';

type ShipPriority = 'NORMAL' | 'TIME_SENSITIVE';

// Helper: get YYYY-MM-DD in America/Vancouver timezone
function getVancouverDate(daysOffset = 0): string {
  const nowUtc = new Date();
  const vancouverNow = toZonedTime(nowUtc, 'America/Vancouver');
  const target = addDays(vancouverNow, daysOffset);
  return format(target, 'yyyy-MM-dd');
}

interface OrderLineItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity_units: number;
  order: {
    id: string;
    order_number: string;
    requested_ship_date: string | null;
    status: string;
    client: { name: string } | null;
  } | null;
  product: {
    id: string;
    product_name: string;
    sku: string | null;
    bag_size_g: number;
  } | null;
}

interface ExternalDemand {
  id: string;
  source: string;
  target_date: string;
  product_id: string;
  quantity_units: number;
  product: {
    id: string;
    product_name: string;
    sku: string | null;
    bag_size_g: number;
  } | null;
}

interface Checkmark {
  id: string;
  target_date: string;
  product_id: string;
  bag_size_g: number;
  roast_complete: boolean;
  pack_complete: boolean;
  ship_complete: boolean;
  ship_priority: ShipPriority;
}

interface AggregatedRow {
  key: string;
  productId: string;
  productName: string;
  sku: string | null;
  bagSize: number;
  totalUnits: number;
  totalGrams: number;
  orders: { clientName: string; orderNumber: string; units: number }[];
  externalDemand: { source: string; units: number }[];
  checkmark: Checkmark | null;
}

export default function Production() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Use America/Vancouver timezone for today/tomorrow
  const today = getVancouverDate(0);
  const tomorrow = getVancouverDate(1);

  const [dateFilter, setDateFilter] = useState<string[]>([today, tomorrow]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showShippableOnly, setShowShippableOnly] = useState(false);

  // Fetch order line items for orders with relevant statuses and ship dates
  const { data: orderLineItems, isLoading: ordersLoading } = useQuery({
    queryKey: ['production-orders', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select(`
          id,
          order_id,
          product_id,
          quantity_units,
          order:orders!inner(
            id,
            order_number,
            requested_ship_date,
            status,
            client:clients(name)
          ),
          product:products(id, product_name, sku, bag_size_g)
        `)
        .in('order.status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .in('order.requested_ship_date', dateFilter);

      if (error) throw error;
      return (data ?? []) as OrderLineItem[];
    },
  });

  // Fetch external demand for selected dates
  const { data: externalDemand } = useQuery({
    queryKey: ['external-demand', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_demand')
        .select('id, source, target_date, product_id, quantity_units, product:products(id, product_name, sku, bag_size_g)')
        .in('target_date', dateFilter)
        .gt('quantity_units', 0);

      if (error) throw error;
      return (data ?? []) as ExternalDemand[];
    },
  });

  // Fetch existing checkmarks
  const { data: checkmarks } = useQuery({
    queryKey: ['production-checkmarks', dateFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checkmarks')
        .select('*')
        .in('target_date', dateFilter);

      if (error) throw error;
      return (data ?? []) as Checkmark[];
    },
  });

  // Aggregate data by product × bag size
  const aggregatedRows = useMemo(() => {
    const rowMap: Record<string, AggregatedRow> = {};

    // Process order line items
    for (const li of orderLineItems ?? []) {
      if (!li.product) continue;
      const key = `${li.product_id}-${li.product.bag_size_g}`;
      
      if (!rowMap[key]) {
        rowMap[key] = {
          key,
          productId: li.product_id,
          productName: li.product.product_name,
          sku: li.product.sku,
          bagSize: li.product.bag_size_g,
          totalUnits: 0,
          totalGrams: 0,
          orders: [],
          externalDemand: [],
          checkmark: null,
        };
      }

      rowMap[key].totalUnits += li.quantity_units;
      rowMap[key].totalGrams += li.quantity_units * li.product.bag_size_g;
      rowMap[key].orders.push({
        clientName: li.order?.client?.name ?? 'Unknown',
        orderNumber: li.order?.order_number ?? 'Unknown',
        units: li.quantity_units,
      });
    }

    // Process external demand
    for (const ed of externalDemand ?? []) {
      if (!ed.product) continue;
      const key = `${ed.product_id}-${ed.product.bag_size_g}`;

      if (!rowMap[key]) {
        rowMap[key] = {
          key,
          productId: ed.product_id,
          productName: ed.product.product_name,
          sku: ed.product.sku,
          bagSize: ed.product.bag_size_g,
          totalUnits: 0,
          totalGrams: 0,
          orders: [],
          externalDemand: [],
          checkmark: null,
        };
      }

      rowMap[key].totalUnits += ed.quantity_units;
      rowMap[key].totalGrams += ed.quantity_units * ed.product.bag_size_g;
      rowMap[key].externalDemand.push({
        source: ed.source,
        units: ed.quantity_units,
      });
    }

    // Attach checkmarks
    for (const cm of checkmarks ?? []) {
      const key = `${cm.product_id}-${cm.bag_size_g}`;
      if (rowMap[key]) {
        rowMap[key].checkmark = cm;
      }
    }

    // Sort: TIME_SENSITIVE first, then alphabetically by product name
    return Object.values(rowMap).sort((a, b) => {
      const aPriority = a.checkmark?.ship_priority ?? 'NORMAL';
      const bPriority = b.checkmark?.ship_priority ?? 'NORMAL';
      
      // TIME_SENSITIVE sorts before NORMAL
      if (aPriority === 'TIME_SENSITIVE' && bPriority !== 'TIME_SENSITIVE') return -1;
      if (bPriority === 'TIME_SENSITIVE' && aPriority !== 'TIME_SENSITIVE') return 1;
      
      return a.productName.localeCompare(b.productName);
    });
  }, [orderLineItems, externalDemand, checkmarks]);

  // Filter for "Shippable Now": pack_complete = true AND ship_complete = false
  const displayedRows = useMemo(() => {
    if (!showShippableOnly) return aggregatedRows;
    
    return aggregatedRows.filter((row) => {
      const packComplete = row.checkmark?.pack_complete ?? false;
      const shipComplete = row.checkmark?.ship_complete ?? false;
      return packComplete && !shipComplete;
    });
  }, [aggregatedRows, showShippableOnly]);

  const checkmarkMutation = useMutation({
    mutationFn: async ({ productId, bagSize, field, value }: { productId: string; bagSize: number; field: 'roast_complete' | 'pack_complete' | 'ship_complete'; value: boolean }) => {
      const targetDate = today;
      
      const { error } = await supabase
        .from('production_checkmarks')
        .upsert({
          target_date: targetDate,
          product_id: productId,
          bag_size_g: bagSize,
          [field]: value,
          updated_by: user?.id,
        }, {
          onConflict: 'target_date,product_id,bag_size_g',
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-checkmarks'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update checkmark');
    },
  });

  const priorityMutation = useMutation({
    mutationFn: async ({ productId, bagSize, priority, existingCheckmark }: { productId: string; bagSize: number; priority: ShipPriority; existingCheckmark: Checkmark | null }) => {
      const targetDate = today;
      
      const { error } = await supabase
        .from('production_checkmarks')
        .upsert({
          target_date: targetDate,
          product_id: productId,
          bag_size_g: bagSize,
          ship_priority: priority,
          roast_complete: existingCheckmark?.roast_complete ?? false,
          pack_complete: existingCheckmark?.pack_complete ?? false,
          ship_complete: existingCheckmark?.ship_complete ?? false,
          updated_by: user?.id,
        }, {
          onConflict: 'target_date,product_id,bag_size_g',
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-checkmarks'] });
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update priority');
    },
  });

  const toggleExpand = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleDateFilter = (date: string) => {
    setDateFilter((prev) => {
      if (prev.includes(date)) {
        return prev.filter((d) => d !== date);
      }
      return [...prev, date].sort();
    });
  };

  const togglePriority = (row: AggregatedRow) => {
    const currentPriority = row.checkmark?.ship_priority ?? 'NORMAL';
    const newPriority: ShipPriority = currentPriority === 'NORMAL' ? 'TIME_SENSITIVE' : 'NORMAL';
    priorityMutation.mutate({ productId: row.productId, bagSize: row.bagSize, priority: newPriority, existingCheckmark: row.checkmark });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Production Run Sheet</h1>
          <p className="text-sm text-muted-foreground">
            Viewing: {dateFilter.map((d) => format(parseISO(d), 'MMM d')).join(', ')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="shippable-filter"
              checked={showShippableOnly}
              onCheckedChange={setShowShippableOnly}
            />
            <Label htmlFor="shippable-filter" className="text-sm font-medium cursor-pointer">
              Shippable Now
            </Label>
          </div>
          <div className="flex gap-2">
            <Button
              variant={dateFilter.includes(today) ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleDateFilter(today)}
            >
              Today
            </Button>
            <Button
              variant={dateFilter.includes(tomorrow) ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleDateFilter(tomorrow)}
            >
              Tomorrow
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {showShippableOnly ? 'Shippable Now' : 'Aggregated Production'}
            <span className="ml-4 text-xs font-normal text-muted-foreground">
              ({displayedRows.length} rows)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ordersLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : displayedRows.length === 0 ? (
            <p className="text-muted-foreground">
              {showShippableOnly 
                ? 'No items ready to ship. Items appear here when Pack ✓ is checked but Ship ✓ is not.'
                : 'No production items for selected dates.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 w-8"></th>
                  <th className="pb-2">Product</th>
                  <th className="pb-2">SKU</th>
                  <th className="pb-2">Bag Size</th>
                  <th className="pb-2 text-right">Units</th>
                  <th className="pb-2 text-right">Total KG</th>
                  <th className="pb-2 text-center">Priority</th>
                  <th className="pb-2 text-center">Roast ✓</th>
                  <th className="pb-2 text-center">Pack ✓</th>
                  <th className="pb-2 text-center">Ship ✓</th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((row) => {
                  const isTimeSensitive = (row.checkmark?.ship_priority ?? 'NORMAL') === 'TIME_SENSITIVE';
                  
                  return (
                    <React.Fragment key={row.key}>
                      <tr className={`border-b last:border-0 hover:bg-muted/50 ${isTimeSensitive ? 'bg-destructive/5' : ''}`}>
                        <td className="py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => toggleExpand(row.key)}
                          >
                            {expandedRows.has(row.key) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </td>
                        <td className="py-2 font-medium">
                          {row.productName}
                          {isTimeSensitive && (
                            <Badge variant="destructive" className="ml-2 text-xs">
                              <Clock className="h-3 w-3 mr-1" />
                              Urgent
                            </Badge>
                          )}
                        </td>
                        <td className="py-2">{row.sku || '—'}</td>
                        <td className="py-2">{row.bagSize}g</td>
                        <td className="py-2 text-right font-medium">{row.totalUnits}</td>
                        <td className="py-2 text-right">{(row.totalGrams / 1000).toFixed(2)}</td>
                        <td className="py-2 text-center">
                          <Button
                            variant={isTimeSensitive ? 'destructive' : 'outline'}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => togglePriority(row)}
                          >
                            {isTimeSensitive ? 'Urgent' : 'Normal'}
                          </Button>
                        </td>
                        <td className="py-2 text-center">
                          <Checkbox
                            checked={row.checkmark?.roast_complete ?? false}
                            onCheckedChange={(checked) =>
                              checkmarkMutation.mutate({
                                productId: row.productId,
                                bagSize: row.bagSize,
                                field: 'roast_complete',
                                value: !!checked,
                              })
                            }
                          />
                        </td>
                        <td className="py-2 text-center">
                          <Checkbox
                            checked={row.checkmark?.pack_complete ?? false}
                            onCheckedChange={(checked) =>
                              checkmarkMutation.mutate({
                                productId: row.productId,
                                bagSize: row.bagSize,
                                field: 'pack_complete',
                                value: !!checked,
                              })
                            }
                          />
                        </td>
                        <td className="py-2 text-center">
                          <Checkbox
                            checked={row.checkmark?.ship_complete ?? false}
                            onCheckedChange={(checked) =>
                              checkmarkMutation.mutate({
                                productId: row.productId,
                                bagSize: row.bagSize,
                                field: 'ship_complete',
                                value: !!checked,
                              })
                            }
                          />
                        </td>
                      </tr>
                      {expandedRows.has(row.key) && (
                        <tr>
                          <td colSpan={10} className="bg-muted/30 px-8 py-2">
                            <div className="space-y-1 text-xs">
                              {row.orders.map((o, i) => (
                                <div key={i} className="flex justify-between">
                                  <span>{o.clientName} — {o.orderNumber}</span>
                                  <span>{o.units} units</span>
                                </div>
                              ))}
                              {row.externalDemand.map((ed, i) => (
                                <div key={`ext-${i}`} className="flex justify-between text-info">
                                  <span>{ed.source} (External)</span>
                                  <span>{ed.units} units</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
