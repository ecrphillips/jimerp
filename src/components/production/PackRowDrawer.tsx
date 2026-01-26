import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, FileText } from 'lucide-react';

interface PackingRun {
  id: string;
  product_id: string;
  target_date: string;
  units_packed: number;
  kg_consumed: number;
  notes: string | null;
}

interface PackRowDrawerProps {
  productId: string;
  productName: string;
  sku: string | null;
  roastGroup: string | null;
  packingRun: PackingRun | null;
  unblocksOrders: number;
  wipAvailableKg: number;
  requiredKg: number;
  isReadyToPack: boolean;
}

export function PackRowDrawer({
  productId,
  productName,
  sku,
  roastGroup,
  packingRun,
  unblocksOrders,
  wipAvailableKg,
  requiredKg,
  isReadyToPack,
}: PackRowDrawerProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleOpenShipTab = () => {
    // Navigate to Ship tab - the Ship tab will show orders containing this SKU
    navigate(`/production?tab=ship`);
  };

  return (
    <tr className="bg-accent/30 border-l-2 border-l-primary">
      <td colSpan={6} className="py-3 px-4 pl-6">
        {/* WIP Status Banner */}
        {roastGroup && (
          <div className={`mb-3 p-2 rounded-md text-sm ${isReadyToPack ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
            {isReadyToPack ? (
              <span className="font-medium">
                ✓ WIP available for {roastGroup}: {wipAvailableKg.toFixed(2)} kg • This row needs: {requiredKg.toFixed(2)} kg
              </span>
            ) : requiredKg > 0 ? (
              <span>
                WIP short for {roastGroup}: {wipAvailableKg.toFixed(2)} kg available • This row needs: {requiredKg.toFixed(2)} kg
              </span>
            ) : (
              <span>No remaining demand for this SKU</span>
            )}
          </div>
        )}
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs block mb-1">SKU</span>
            <span className="font-mono">{sku || '—'}</span>
          </div>
          
          <div>
            <span className="text-muted-foreground text-xs block mb-1">Roast Group</span>
            {roastGroup ? (
              <Badge variant="secondary" className="text-xs">{roastGroup}</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          
          <div>
            <span className="text-muted-foreground text-xs block mb-1">KG Consumed</span>
            <span>{packingRun?.kg_consumed?.toFixed(2) ?? '0.00'} kg</span>
          </div>
          
          <div>
            <span className="text-muted-foreground text-xs block mb-1">Notes</span>
            {packingRun?.notes ? (
              <div className="flex items-start gap-1">
                <FileText className="h-3 w-3 mt-0.5 text-muted-foreground" />
                <span className="text-xs">{packingRun.notes}</span>
              </div>
            ) : (
              <span className="text-muted-foreground text-xs">No notes</span>
            )}
          </div>
        </div>
        
        {unblocksOrders > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenShipTab}
              className="text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View {unblocksOrders} order{unblocksOrders !== 1 ? 's' : ''} waiting for this SKU
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
