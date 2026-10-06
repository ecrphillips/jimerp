import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Flame, Package, Truck, CalendarClock, ClipboardList, FileText } from 'lucide-react';
import { PlanTab } from '@/components/production/PlanTab';
import { RoastTab } from '@/components/production/RoastTab';
import { PackTab } from '@/components/production/PackTab';
import { ShipTab } from '@/components/production/ShipTab';
import { InvoicingTab } from '@/components/production/InvoicingTab';
import { PacificTimeTicker } from '@/components/production/PacificTimeTicker';
import { 
  getVancouverDateString,
  getVancouverNow,
} from '@/lib/productionScheduling';
import type { DateFilterConfig } from '@/components/production/types';
import { DateFilterRail } from '@/components/production/DateFilterRail';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';
import { useProductionRealtime } from '@/hooks/useProductionRealtime';

type StationView = 'plan' | 'roast' | 'pack' | 'ship' | 'invoicing';
type DateFilterMode = 'today' | 'tomorrow' | 'all';

export default function Production() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getVancouverDateString(0);

  // Keep all production tabs live (realtime + 30s polling fallback) — no manual refresh.
  useProductionRealtime();
  
  // Date filter: 'today', 'tomorrow', or 'all'
  // Date filter: 'today', 'tomorrow', or 'all'. Today is the standard view — the
  // floor works the run sheet that is due now, and can step out to the others.
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('today');
  
  // Filter configuration is now simpler - actual filtering happens client-side
  // based on computed work_start_at
  const dateFilterConfig = useMemo((): DateFilterConfig => {
    return {
      mode: dateFilterMode,
    } as DateFilterConfig;
  }, [dateFilterMode]);

  // Helper text for filter buttons
  const filterHelperText = useMemo(() => {
    switch (dateFilterMode) {
      case 'today':
        return 'Orders where work must start today, plus all overdue orders';
      case 'tomorrow':
        return 'Orders where work must start tomorrow (excludes overdue)';
      case 'all':
        return 'All open orders';
      default:
        return '';
    }
  }, [dateFilterMode]);
  
  // Read initial tab from URL param, default to 'roast'
  const tabFromUrl = searchParams.get('tab') as StationView | null;
  const [stationView, setStationView] = useState<StationView>(
    tabFromUrl && ['plan', 'roast', 'pack', 'ship', 'invoicing'].includes(tabFromUrl) ? tabFromUrl : 'plan'
  );

  // Update URL when tab changes
  const handleTabChange = (tab: StationView) => {
    setStationView(tab);
    setSearchParams({ tab });
  };

  return (
    <div className="page-container">
      <GreenCoffeeAlerts />
      <div className="page-header">
        <div className="space-y-1">
          <h1 className="page-title">Production</h1>
          <p className="text-sm text-muted-foreground">
            {filterHelperText}
          </p>
          <PacificTimeTicker className="mt-1" />
        </div>
        <div className="flex items-center gap-4">

      {dateFilterMode === 'tomorrow' && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-md border border-amber-400/60 bg-amber-100/80 dark:bg-amber-500/10 px-4 py-3 text-amber-900 dark:text-amber-200 shadow-sm"
        >
          <CalendarClock className="h-5 w-5 shrink-0" />
          <div className="text-sm font-medium">
            Viewing <span className="font-bold uppercase tracking-wide">Tomorrow's</span> run sheet — today's orders are hidden.
          </div>
        </div>
      )}
        </div>
      </div>

      {/* Station Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
        {/* The run-sheet date filter is a left rail so the applied filter is obvious;
            Invoicing is date-independent, so it has no rail. */}
        {stationView !== 'invoicing' && (
          <DateFilterRail mode={dateFilterMode} onChange={setDateFilterMode} />
        )}
        <Tabs value={stationView} onValueChange={(v) => handleTabChange(v as StationView)} className="mb-4 min-w-0 flex-1">
        <TabsList className="grid w-full grid-cols-5 max-w-3xl">
          <TabsTrigger value="plan" className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Plan
          </TabsTrigger>
          <TabsTrigger value="roast" className="flex items-center gap-2">
            <Flame className="h-4 w-4" />
            Roast
          </TabsTrigger>
          <TabsTrigger value="pack" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Pack
          </TabsTrigger>
          <TabsTrigger value="ship" className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Ship
          </TabsTrigger>
          <TabsTrigger value="invoicing" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Invoicing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="mt-4">
          <PlanTab dateFilterConfig={dateFilterConfig} today={today} />
        </TabsContent>

        <TabsContent value="roast" className="mt-4">
          <RoastTab dateFilterConfig={dateFilterConfig} today={today} />
        </TabsContent>

        <TabsContent value="pack" className="mt-4">
          <PackTab dateFilterConfig={dateFilterConfig} today={today} />
        </TabsContent>

        <TabsContent value="ship" className="mt-4">
          <ShipTab dateFilterConfig={dateFilterConfig} today={today} />
        </TabsContent>

        <TabsContent value="invoicing" className="mt-4">
          <InvoicingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
