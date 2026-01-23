import React, { useState, useEffect } from 'react';
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
  const tomorrow = getVancouverDate(1);

  const [dateFilter, setDateFilter] = useState<string[]>([today, tomorrow]);
  
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

  const toggleDateFilter = (date: string) => {
    setDateFilter((prev) => {
      if (prev.includes(date)) {
        return prev.filter((d) => d !== date);
      }
      return [...prev, date].sort();
    });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Production</h1>
          <p className="text-sm text-muted-foreground">
            Viewing: {dateFilter.map((d) => format(new Date(d + 'T12:00:00'), 'MMM d')).join(', ')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <Button
              variant={dateFilter.includes(today) ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleDateFilter(today)}
            >
              Today
            </Button>
            <Button
              variant={dateFilter.includes(tomorrow) ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggleDateFilter(tomorrow)}
            >
              Tomorrow
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
          <RoastTab dateFilter={dateFilter} today={today} />
        </TabsContent>

        <TabsContent value="pack" className="mt-4">
          <PackTab dateFilter={dateFilter} today={today} />
        </TabsContent>

        <TabsContent value="ship" className="mt-4">
          <ShipTab dateFilter={dateFilter} today={today} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
