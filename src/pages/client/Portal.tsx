import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { PlusCircle, Package, Truck, Clock, CheckCircle2 } from 'lucide-react';
import { LocationCodeDisplay } from '@/components/orders/LocationSelect';

interface Order {
  id: string;
  order_number: string;
  status: string;
  requested_ship_date: string | null;
  delivery_method: string;
  created_at: string;
  location_id: string | null;
  shipped_or_ready: boolean;
  invoiced: boolean;
}

export default function Portal() {
  const navigate = useNavigate();
  const { authUser } = useAuth();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['client-portal-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, status, requested_ship_date, delivery_method, created_at, location_id, shipped_or_ready, invoiced')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as Order[];
    },
  });

  // Split orders into open and fulfilled
  const openOrders = orders?.filter(o => 
    !['SHIPPED', 'CANCELLED'].includes(o.status) && !o.shipped_or_ready
  ) ?? [];
  
  const fulfilledOrders = orders?.filter(o => 
    o.status === 'SHIPPED' || o.shipped_or_ready
  ) ?? [];

  const getStatusIcon = (status: string, shipped: boolean) => {
    if (shipped || status === 'SHIPPED') return <Truck className="h-4 w-4 text-green-600" />;
    if (status === 'READY') return <CheckCircle2 className="h-4 w-4 text-blue-600" />;
    if (status === 'IN_PRODUCTION') return <Package className="h-4 w-4 text-amber-600" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  const getStatusLabel = (status: string, shipped: boolean) => {
    if (shipped || status === 'SHIPPED') return 'Shipped';
    if (status === 'READY') return 'Ready for Pickup';
    if (status === 'IN_PRODUCTION') return 'In Production';
    if (status === 'CONFIRMED') return 'Confirmed';
    if (status === 'SUBMITTED') return 'Submitted';
    return status;
  };

  return (
    <div className="page-container">
      <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Welcome back{authUser?.profile?.name ? `, ${authUser.profile.name}` : ''}!</h1>
          <p className="text-muted-foreground">Manage your coffee orders</p>
        </div>
        <Button onClick={() => navigate('/portal/new-order')} size="lg">
          <PlusCircle className="mr-2 h-5 w-5" />
          Create New Order
        </Button>
      </div>

      <div className="grid gap-6">
        {/* Open Orders */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Open Orders
            </CardTitle>
            <CardDescription>
              {openOrders.length === 0 
                ? "No orders currently in progress" 
                : `${openOrders.length} order${openOrders.length > 1 ? 's' : ''} in progress`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : openOrders.length === 0 ? (
              <div className="py-8 text-center">
                <Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                <p className="text-muted-foreground">No open orders</p>
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={() => navigate('/portal/new-order')}
                >
                  Place your first order
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {openOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => navigate('/portal/orders')}
                  >
                    <div className="flex items-center gap-4">
                      {getStatusIcon(order.status, order.shipped_or_ready)}
                      <div>
                        <div className="font-medium">
                          {order.order_number}
                          <LocationCodeDisplay locationId={order.location_id} />
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {order.requested_ship_date 
                            ? `Ship by ${format(new Date(order.requested_ship_date), 'MMM d')}`
                            : `Created ${format(new Date(order.created_at), 'MMM d')}`
                          }
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        order.status === 'IN_PRODUCTION' 
                          ? 'bg-amber-100 text-amber-800' 
                          : order.status === 'CONFIRMED'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-muted text-muted-foreground'
                      }`}>
                        {getStatusLabel(order.status, order.shipped_or_ready)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fulfilled Orders */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Fulfilled Orders
            </CardTitle>
            <CardDescription>
              {fulfilledOrders.length === 0 
                ? "No completed orders yet" 
                : `${fulfilledOrders.length} completed order${fulfilledOrders.length > 1 ? 's' : ''}`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : fulfilledOrders.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">
                Your completed orders will appear here.
              </p>
            ) : (
              <div className="space-y-2">
                {fulfilledOrders.slice(0, 5).map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => navigate('/portal/orders')}
                  >
                    <div className="flex items-center gap-3">
                      <Truck className="h-4 w-4 text-green-600" />
                      <div>
                        <span className="font-medium">{order.order_number}</span>
                        <LocationCodeDisplay locationId={order.location_id} />
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {format(new Date(order.created_at), 'MMM d, yyyy')}
                    </div>
                  </div>
                ))}
                {fulfilledOrders.length > 5 && (
                  <Button 
                    variant="ghost" 
                    className="w-full text-sm"
                    onClick={() => navigate('/portal/orders')}
                  >
                    View all {fulfilledOrders.length} orders →
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
