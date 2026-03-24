import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
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
  const { data: metrics, isLoading, refetch } = useDashboardMetrics(horizon);

  const horizonLabel = horizon === 'today' 
    ? 'Today & Tomorrow' 
    : horizon === 'tomorrow' 
      ? 'Day After Tomorrow' 
      : 'This Week (Mon–Fri)';

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <p className="text-muted-foreground text-sm">
          Order-constrained work remaining across ROAST → PACK → SHIP
        </p>
        <div className="flex items-center gap-2">
          <Tabs value={horizon} onValueChange={(v) => setHorizon(v as TimeHorizon)}>
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="tomorrow">Tomorrow</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            className="h-8 w-8"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
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
          label="Orders + queued batches"
          value={metrics?.roastDemandKg ?? 0}
          max={100}
          unit="kg"
          isLoading={isLoading}
        />
        <VuMeter
          label="Roasted coffee on hand"
          value={metrics?.wipBufferKg ?? 0}
          max={100}
          unit="kg"
          isLoading={isLoading}
        />
        <VuMeter
          label="Packed units on hand"
          value={metrics?.fgReadyUnits ?? 0}
          max={200}
          unit="units"
          isLoading={isLoading}
        />
        <VuMeter
          label="Orders vs hours remaining"
          value={metrics?.systemStressScore ?? 0}
          max={100}
          unit="%"
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Roast Demand</strong>: total kg to roast for open orders plus any 
              queued batches not yet connected to orders.
            </p>
            <p>
              <strong>WIP Buffer</strong>: total roasted coffee on hand across all roast groups.
            </p>
            <p>
              <strong>FG Ready</strong>: total packed finished goods on hand.
            </p>
            <p>
              <strong>System Stress</strong>: ratio of open orders to hours remaining in 
              the production window today.
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
