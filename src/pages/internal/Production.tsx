import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { format, addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { Flame, Package, Truck } from 'lucide-react';
import { RoastTab } from '@/components/production/RoastTab';
import { PackTab } from '@/components/production/PackTab';
import { ShipTab } from '@/components/production/ShipTab';

type StationView = 'roast' | 'pack' | 'ship';

// Helper: get YYYY-MM-DD in America/Vancouver timezone
function getVancouverDate(daysOffset = 0): string {
  const nowUtc = new Date();
  const vancouverNow = toZonedTime(nowUtc, 'America/Vancouver');
  const target = addDays(vancouverNow, daysOffset);
  return format(target, 'yyyy-MM-dd');
}

export default function Production() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getVancouverDate(0);
  const todayPlusOne = getVancouverDate(1);
  const todayPlusTwo = getVancouverDate(2);

  // Date filter: 'today', 'tomorrow', or 'all'
  type DateFilterMode = 'today' | 'tomorrow' | 'all';
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('today');
  
  // NEW BUCKET LOGIC:
  // - TODAY: requested_ship_date <= today + 1 (shipping tomorrow or sooner)
  // - TOMORROW: requested_ship_date == today + 2 OR manually_deprioritized = true (day after, or deferred)
  // - ALL: show all open orders (no date filter)
  // 
  // The actual filtering is done in child components with these parameters
  const dateFilterConfig = useMemo(() => {
    if (dateFilterMode === 'today') {
      // TODAY bucket: ship date <= tomorrow
      return {
        mode: 'today' as const,
        maxDate: todayPlusOne, // <= this date
      };
    }
    if (dateFilterMode === 'tomorrow') {
      // TOMORROW bucket: ship date == day after tomorrow OR manually_deprioritized
      return {
        mode: 'tomorrow' as const,
        exactDate: todayPlusTwo,
      };
    }
    // ALL mode - no date filter
    return {
      mode: 'all' as const,
    };
  }, [dateFilterMode, todayPlusOne, todayPlusTwo]);

  // Helper text for filter buttons
  const filterHelperText = useMemo(() => {
    switch (dateFilterMode) {
      case 'today':
        return 'Shipping tomorrow or sooner';
      case 'tomorrow':
        return 'Shipping day after, or deferred';
      case 'all':
        return 'All open orders';
      default:
        return '';
    }
  }, [dateFilterMode]);
  
  // Read initial tab from URL param, default to 'roast'
  const tabFromUrl = searchParams.get('tab') as StationView | null;
  const [stationView, setStationView] = useState<StationView>(
    tabFromUrl && ['roast', 'pack', 'ship'].includes(tabFromUrl) ? tabFromUrl : 'roast'
  );

  // Update URL when tab changes
  const handleTabChange = (tab: StationView) => {
    setStationView(tab);
    setSearchParams({ tab });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Production</h1>
          <p className="text-sm text-muted-foreground">
            {filterHelperText}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <Button
              variant={dateFilterMode === 'today' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateFilterMode('today')}
            >
              Today
            </Button>
            <Button
              variant={dateFilterMode === 'tomorrow' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateFilterMode('tomorrow')}
            >
              Tomorrow
            </Button>
            <Button
              variant={dateFilterMode === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateFilterMode('all')}
            >
              All
            </Button>
          </div>
        </div>
      </div>

      {/* Station Tabs */}
      <Tabs value={stationView} onValueChange={(v) => handleTabChange(v as StationView)} className="mb-4">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
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
        </TabsList>

        <TabsContent value="roast" className="mt-4">
          <RoastTab dateFilterConfig={dateFilterConfig} today={today} />
        </TabsContent>

        <TabsContent value="pack" className="mt-4">
          <PackTab dateFilterConfig={dateFilterConfig} today={today} />
        </TabsContent>

        <TabsContent value="ship" className="mt-4">
          <ShipTab dateFilterConfig={dateFilterConfig} today={today} />
        </TabsContent>
      </Tabs>
    </div>
  );
}