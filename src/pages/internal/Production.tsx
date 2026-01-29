import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Flame, Package, Truck } from 'lucide-react';
import { RoastTab } from '@/components/production/RoastTab';
import { PackTab } from '@/components/production/PackTab';
import { ShipTab } from '@/components/production/ShipTab';
import { PacificTimeTicker } from '@/components/production/PacificTimeTicker';
import { 
  getVancouverDateString,
  getVancouverNow,
} from '@/lib/productionScheduling';
import type { DateFilterConfig } from '@/components/production/types';

type StationView = 'roast' | 'pack' | 'ship';
type DateFilterMode = 'today' | 'tomorrow' | 'all';

export default function Production() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getVancouverDateString(0);
  
  // Date filter: 'today', 'tomorrow', or 'all'
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
        return 'Orders where work must start today';
      case 'tomorrow':
        return 'Orders where work must start tomorrow';
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
        <div className="space-y-1">
          <h1 className="page-title">Production</h1>
          <p className="text-sm text-muted-foreground">
            {filterHelperText}
          </p>
          <PacificTimeTicker className="mt-1" />
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
