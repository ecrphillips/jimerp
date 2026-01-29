import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Flame, Package, Truck, Clock } from 'lucide-react';
import { useDashboardMetrics, TimeHorizon } from '@/hooks/useDashboardMetrics';
import { Skeleton } from '@/components/ui/skeleton';

function MetricCard({ 
  icon: Icon, 
  label, 
  sublabel, 
  value, 
  unit,
  isLoading 
}: { 
  icon: React.ElementType;
  label: string;
  sublabel: string;
  value: number;
  unit: string;
  isLoading?: boolean;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {label}
          </CardTitle>
          <p className="text-xs text-muted-foreground/70 mt-0.5">{sublabel}</p>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent className="flex-1 flex items-end">
        {isLoading ? (
          <Skeleton className="h-10 w-24" />
        ) : (
          <p className="text-4xl font-bold tabular-nums">
            {value.toLocaleString()}
            <span className="text-lg font-normal text-muted-foreground ml-1">{unit}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [horizon, setHorizon] = useState<TimeHorizon>('today');
  const { data: metrics, isLoading } = useDashboardMetrics(horizon);

  const horizonLabel = horizon === 'today' 
    ? 'Today & Tomorrow' 
    : horizon === 'tomorrow' 
      ? 'Day After Tomorrow' 
      : 'All Open Work';

  return (
    <div className="page-container">
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">Production Flow</h1>
          <p className="text-muted-foreground text-sm">
            Order-constrained work remaining across ROAST → PACK → SHIP
          </p>
        </div>
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

      {/* Main pipeline stages - order constrained */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard
          icon={Flame}
          label="Roast Demand"
          sublabel="Remaining roasting work"
          value={metrics?.roastDemandKg ?? 0}
          unit="kg"
          isLoading={isLoading}
        />
        <MetricCard
          icon={Package}
          label="WIP Buffer"
          sublabel="Roasted, waiting to pack"
          value={metrics?.wipBufferKg ?? 0}
          unit="kg"
          isLoading={isLoading}
        />
        <MetricCard
          icon={Truck}
          label="FG Ready"
          sublabel="Packed, ready to pick"
          value={metrics?.fgReadyUnits ?? 0}
          unit="units"
          isLoading={isLoading}
        />
        <MetricCard
          icon={Clock}
          label="Blocked Demand"
          sublabel="Orders awaiting fulfilment"
          value={metrics?.blockedDemandUnits ?? 0}
          unit="units"
          isLoading={isLoading}
        />
      </div>

      {/* Explanation card */}
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