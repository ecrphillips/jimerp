import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Truck, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface OrderShipmentsCardProps {
  orderId: string;
}

interface ShipmentRow {
  id: string;
  shipment_number: number;
  delivery_method: string;
  location_id: string | null;
  ship_to_name: string | null;
  ship_to_address_line1: string | null;
  ship_to_address_line2: string | null;
  ship_to_city: string | null;
  ship_to_region: string | null;
  ship_to_postal: string | null;
  notes: string | null;
  location?: { name: string; location_code: string } | null;
}

export function OrderShipmentsCard({ orderId }: OrderShipmentsCardProps) {
  const { data: shipments, isLoading } = useQuery({
    queryKey: ['order-shipments', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_shipments')
        .select(`
          id, shipment_number, delivery_method, location_id,
          ship_to_name, ship_to_address_line1, ship_to_address_line2,
          ship_to_city, ship_to_region, ship_to_postal, notes,
          location:client_locations(name, location_code)
        `)
        .eq('order_id', orderId)
        .order('shipment_number');
      if (error) throw error;
      return (data ?? []) as ShipmentRow[];
    },
  });

  if (isLoading) return null;
  if (!shipments || shipments.length === 0) return null;
  // Single shipment with no custom address — covered by main Order Info card.
  const hasCustomDetails = shipments.some(
    s => s.ship_to_address_line1 || s.ship_to_name || s.location_id,
  );
  if (shipments.length <= 1 && !hasCustomDetails) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4" /> Shipments ({shipments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {shipments.map((s) => (
          <div key={s.id} className="border rounded-md p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">#{s.shipment_number}</Badge>
              <Badge variant="outline">{s.delivery_method}</Badge>
              {s.location && (
                <Badge variant="outline" className="gap-1">
                  <MapPin className="h-3 w-3" />
                  <span className="font-mono text-xs">{s.location.location_code}</span>
                  {s.location.name}
                </Badge>
              )}
            </div>
            {s.ship_to_name && <div className="font-medium">{s.ship_to_name}</div>}
            {s.ship_to_address_line1 && <div>{s.ship_to_address_line1}</div>}
            {s.ship_to_address_line2 && <div>{s.ship_to_address_line2}</div>}
            {(s.ship_to_city || s.ship_to_region || s.ship_to_postal) && (
              <div className="text-muted-foreground">
                {[s.ship_to_city, s.ship_to_region, s.ship_to_postal].filter(Boolean).join(', ')}
              </div>
            )}
            {s.notes && <div className="text-xs text-muted-foreground italic">{s.notes}</div>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
