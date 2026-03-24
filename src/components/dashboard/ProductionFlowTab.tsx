import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDashboardMetrics, TimeHorizon } from '@/hooks/useDashboardMetrics';

const SEGMENT_COUNT = 12;

function VuMeter({
  label,
  value,
  max,
  unit,
  isLoading,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  isLoading: boolean;
}) {
  const litCount = Math.min(SEGMENT_COUNT, Math.round((value / max) * SEGMENT_COUNT));

  const getSegmentColor = (index: number, isLit: boolean) => {
    if (!isLit) return 'bg-muted/30';
    if (index >= 10) return 'bg-red-500';
    if (index >= 7) return 'bg-yellow-400';
    return 'bg-green-500';
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="border border-border rounded-sm p-1 bg-background flex flex-col-reverse gap-px">
        {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
          <div
            key={i}
            className={`w-8 h-3 rounded-[1px] transition-colors ${
              isLoading ? 'bg-muted/20 animate-pulse' : getSegmentColor(i, i < litCount)
            }`}
          />
        ))}
      </div>
      <div className="text-center mt-1">
        <p className="text-lg font-bold tabular-nums leading-tight">
          {isLoading ? '—' : value.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground">{unit}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export function ProductionFlowTab() {
  const [horizon, setHorizon] = useState<TimeHorizon>('today');
  const { data: metrics, isLoading } = useDashboardMetrics(horizon);

  const horizonLabel = horizon === 'today' 
    ? 'Today & Tomorrow' 
    : horizon === 'tomorrow' 
      ? 'Day After Tomorrow' 
      : 'All Open Work';

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <p className="text-muted-foreground text-sm">
          Order-constrained work remaining across ROAST → PACK → SHIP
        </p>
        <Tabs value={horizon} onValueChange={(v) => setHorizon(v as TimeHorizon)}>
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="tomorrow">Tomorrow</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Showing: <span className="font-medium">{horizonLabel}</span>
        {metrics && (
          <span className="ml-2">
            ({metrics.ordersInWindow} orders, {metrics.lineItemsInWindow} line items)
          </span>
        )}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 justify-items-center mb-6">
        <VuMeter
          label="Roast Demand"
          value={metrics?.roastDemandKg ?? 0}
          max={100}
          unit="kg"
          isLoading={isLoading}
        />
        <VuMeter
          label="WIP Buffer"
          value={metrics?.wipBufferKg ?? 0}
          max={100}
          unit="kg"
          isLoading={isLoading}
        />
        <VuMeter
          label="FG Ready"
          value={metrics?.fgReadyUnits ?? 0}
          max={500}
          unit="units"
          isLoading={isLoading}
        />
        <VuMeter
          label="Blocked Demand"
          value={metrics?.blockedDemandUnits ?? 0}
          max={500}
          unit="units"
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Roast Demand</strong> decreases when: batches are roasted (single origin), 
              blends are created (post-roast blend), FG is packed, or FG is picked.
            </p>
            <p>
              <strong>WIP Buffer</strong> and <strong>FG Ready</strong> are capped at what's 
              actually needed for orders in this window — surplus inventory is excluded.
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-6">
        Use the Production page to manage work. These metrics reflect remaining work for orders only.
      </p>
    </div>
  );
}
