import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Flame, Package, Truck, AlertCircle, TrendingDown } from 'lucide-react';
import { useDashboardMetrics, TimeHorizon } from '@/hooks/useDashboardMetrics';
import { Skeleton } from '@/components/ui/skeleton';

function MetricCard({ 
  icon: Icon, 
  label, 
  sublabel, 
  value, 
  unit = 'kg',
  isLoading 
}: { 
  icon: React.ElementType;
  label: string;
  sublabel: string;
  value: number;
  unit?: string;
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

function YieldIndicator({ 
  expected, 
  actual, 
  isLoading 
}: { 
  expected: number;
  actual: number | null;
  isLoading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Yield Loss
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-6 w-32" />
        ) : (
          <div className="flex items-baseline gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Expected: </span>
              <span className="font-medium">{expected}%</span>
            </div>
            {actual !== null && (
              <div>
                <span className="text-muted-foreground">Actual: </span>
                <span className="font-medium">{actual}%</span>
              </div>
            )}
            {actual === null && (
              <span className="text-muted-foreground/60 text-xs">
                No completed batches
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { authUser } = useAuth();
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
            Pressure gauge across ROAST → PACK → SHIP
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
      </p>

      {/* Main pipeline stages */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard
          icon={Flame}
          label="Roast Demand"
          sublabel="Green coffee equivalent"
          value={metrics?.greenKgRequired ?? 0}
          isLoading={isLoading}
        />
        <MetricCard
          icon={Package}
          label="WIP Buffer"
          sublabel="Roasted, unpacked"
          value={metrics?.wipKg ?? 0}
          isLoading={isLoading}
        />
        <MetricCard
          icon={Truck}
          label="FG Ready"
          sublabel="Packed, awaiting ship"
          value={metrics?.fgReadyKg ?? 0}
          isLoading={isLoading}
        />
        <MetricCard
          icon={AlertCircle}
          label="Blocked Demand"
          sublabel="Awaiting inventory"
          value={metrics?.blockedDemandKg ?? 0}
          isLoading={isLoading}
        />
      </div>

      {/* Yield indicator */}
      <YieldIndicator
        expected={metrics?.expectedYieldLossPct ?? 16}
        actual={metrics?.actualYieldLossPct ?? null}
        isLoading={isLoading}
      />

      {/* Batch context */}
      <Card className="mt-4">
        <CardContent className="pt-4">
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">
                {metrics?.plannedBatches ?? 0}
              </span>{' '}
              batches planned
            </div>
            <div>
              <span className="font-medium text-foreground">
                {metrics?.completedBatches ?? 0}
              </span>{' '}
              batches completed
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-6">
        This dashboard shows flow pressure in kilograms. Use the Production page to manage work.
      </p>
    </div>
  );
}
