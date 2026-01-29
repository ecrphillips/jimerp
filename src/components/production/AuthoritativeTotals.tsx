/**
 * Authoritative Totals Components
 * 
 * Small, embedded sections for each production tab showing computed inventory
 * from source-of-truth tables (not cached levels).
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Database, AlertTriangle, CheckCircle } from 'lucide-react';
import {
  useAuthoritativeWip,
  useAuthoritativeFg,
  useAuthoritativeRoastDemand,
  type RoastDemand,
  type AuthoritativeWip,
  type AuthoritativeFg,
} from '@/hooks/useAuthoritativeInventory';

// ============================================================================
// ROAST TAB - Authoritative Totals
// ============================================================================

interface RoastAuthoritativeTotalsProps {
  roastGroup: string;
}

export function RoastAuthoritativeTotals({ roastGroup }: RoastAuthoritativeTotalsProps) {
  const { data: roastDemand, isLoading } = useAuthoritativeRoastDemand();
  const { data: wip } = useAuthoritativeWip();
  
  if (isLoading) return null;
  
  const demand = roastDemand?.[roastGroup];
  const wipData = wip?.[roastGroup];
  
  if (!demand && !wipData) return null;
  
  const netDemand = demand?.net_roast_demand_kg ?? 0;
  const grossDemand = demand?.gross_demand_kg ?? 0;
  const wipAvailable = wipData?.wip_available_kg ?? 0;
  const fgUnallocated = demand?.fg_unallocated_kg ?? 0;
  
  return (
    <div className="text-xs bg-muted/30 rounded-md p-2 mt-2 border border-border/50">
      <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
        <Database className="h-3 w-3" />
        <span className="font-medium">Authoritative</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-foreground">
        <div>
          <div className="text-muted-foreground text-[10px]">Gross demand</div>
          <div className="font-mono">{grossDemand.toFixed(1)} kg</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[10px]">WIP on hand</div>
          <div className="font-mono">{wipAvailable.toFixed(1)} kg</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[10px]">FG (unalloc)</div>
          <div className="font-mono">{fgUnallocated.toFixed(1)} kg</div>
        </div>
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-border/50">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-[10px]">Net roast demand</span>
          <Badge 
            variant={netDemand > 0 ? 'destructive' : 'default'} 
            className="text-[10px] h-4 px-1.5"
          >
            {netDemand.toFixed(1)} kg
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PACK TAB - Authoritative Totals
// ============================================================================

interface PackAuthoritativeTotalsProps {
  productId: string;
  roastGroup: string | null;
  demandedUnits: number;
  packedUnits: number;
}

export function PackAuthoritativeTotals({ 
  productId, 
  roastGroup, 
  demandedUnits,
  packedUnits,
}: PackAuthoritativeTotalsProps) {
  const { data: wip, isLoading: wipLoading } = useAuthoritativeWip();
  const { data: fg, isLoading: fgLoading } = useAuthoritativeFg();
  
  if (wipLoading || fgLoading) return null;
  
  const wipData = roastGroup ? wip?.[roastGroup] : null;
  const fgData = fg?.[productId];
  
  const wipAvailableKg = wipData?.wip_available_kg ?? 0;
  const remainingUnits = Math.max(0, demandedUnits - packedUnits);
  const bagSizeG = fgData?.bag_size_g ?? 0;
  const requiredKg = (remainingUnits * bagSizeG) / 1000;
  
  // WIP status
  let wipStatus: 'full' | 'partial' | 'none' = 'none';
  if (remainingUnits > 0) {
    if (wipAvailableKg >= requiredKg) {
      wipStatus = 'full';
    } else if (wipAvailableKg > 0) {
      wipStatus = 'partial';
    }
  }
  
  return (
    <div className="text-xs bg-muted/30 rounded-md p-2 border border-border/50">
      <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
        <Database className="h-3 w-3" />
        <span className="font-medium">Authoritative</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-foreground">
        <div>
          <div className="text-muted-foreground text-[10px]">WIP avail</div>
          <div className="font-mono">{wipAvailableKg.toFixed(2)} kg</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[10px]">Required</div>
          <div className="font-mono">{requiredKg.toFixed(2)} kg</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[10px]">Status</div>
          {wipStatus === 'full' ? (
            <Badge variant="default" className="bg-success text-success-foreground text-[10px] h-4 px-1.5">
              <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
              Ready
            </Badge>
          ) : wipStatus === 'partial' ? (
            <Badge variant="secondary" className="bg-warning/20 text-warning-foreground text-[10px] h-4 px-1.5">
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
              Partial
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              —
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SHIP TAB - Line Item Authoritative Totals
// ============================================================================

interface ShipLineAuthoritativeTotalsProps {
  productId: string;
  requiredUnits: number;
  pickedUnits: number;
}

export function ShipLineAuthoritativeTotals({ 
  productId, 
  requiredUnits,
  pickedUnits,
}: ShipLineAuthoritativeTotalsProps) {
  const { data: fg, isLoading } = useAuthoritativeFg();
  
  if (isLoading) return null;
  
  const fgData = fg?.[productId];
  const fgAvailable = fgData?.fg_available_units ?? 0;
  const remainingToPick = Math.max(0, requiredUnits - pickedUnits);
  
  return (
    <div className="text-xs text-muted-foreground">
      <span className="font-mono">
        Req: {requiredUnits} | FG: {fgAvailable} | Picked: {pickedUnits} | Remain: {remainingToPick}
      </span>
    </div>
  );
}

// ============================================================================
// SUMMARY PANEL - For tab headers
// ============================================================================

interface AuthoritativeSummaryPanelProps {
  tab: 'roast' | 'pack' | 'ship';
}

export function AuthoritativeSummaryPanel({ tab }: AuthoritativeSummaryPanelProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const { data: wip, isLoading: wipLoading } = useAuthoritativeWip();
  const { data: fg, isLoading: fgLoading } = useAuthoritativeFg();
  const { data: roastDemand, isLoading: demandLoading } = useAuthoritativeRoastDemand();
  
  const isLoading = wipLoading || fgLoading || demandLoading;
  
  // Summary stats
  const totalWipKg = Object.values(wip ?? {}).reduce((sum, w) => sum + w.wip_available_kg, 0);
  const totalFgUnits = Object.values(fg ?? {}).reduce((sum, f) => sum + f.fg_available_units, 0);
  const totalNetDemandKg = Object.values(roastDemand ?? {}).reduce((sum, d) => sum + d.net_roast_demand_kg, 0);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1">
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Database className="h-3 w-3" />
          <span>Authoritative Totals</span>
          {isLoading && <span className="text-[10px]">(loading...)</span>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 p-3 bg-muted/30 rounded-md border border-border/50 text-xs">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-muted-foreground mb-1">Total WIP</div>
              <div className="font-mono text-lg">{totalWipKg.toFixed(1)} kg</div>
              <div className="text-muted-foreground text-[10px]">
                {Object.keys(wip ?? {}).length} roast groups
              </div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Total FG (unallocated)</div>
              <div className="font-mono text-lg">{totalFgUnits} units</div>
              <div className="text-muted-foreground text-[10px]">
                {Object.keys(fg ?? {}).length} products
              </div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Net Roast Demand</div>
              <div className="font-mono text-lg">{totalNetDemandKg.toFixed(1)} kg</div>
              <div className="text-muted-foreground text-[10px]">
                After WIP + FG offset
              </div>
            </div>
          </div>
          
          {tab === 'roast' && Object.keys(roastDemand ?? {}).length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="text-muted-foreground mb-2">By Roast Group</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {Object.entries(roastDemand ?? {}).sort((a, b) => b[1].net_roast_demand_kg - a[1].net_roast_demand_kg).map(([rg, data]) => (
                  <div key={rg} className="flex justify-between items-center font-mono">
                    <span className="truncate max-w-[150px]">{rg}</span>
                    <div className="flex gap-3">
                      <span className="text-muted-foreground">WIP: {data.wip_available_kg.toFixed(1)}</span>
                      <span className="text-muted-foreground">FG: {data.fg_unallocated_kg.toFixed(1)}</span>
                      <Badge 
                        variant={data.net_roast_demand_kg > 0 ? 'destructive' : 'secondary'}
                        className="text-[10px] h-4 min-w-[60px] justify-center"
                      >
                        Net: {data.net_roast_demand_kg.toFixed(1)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
