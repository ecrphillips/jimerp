import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const plannedMetrics = [
  'Monthly Revenue',
  'Cost of Goods Sold',
  'Gross Margin %',
  'Roaster Utilisation %',
  'Revenue per Roaster Hour',
];

export function FinanceTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Financial Dashboard</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Revenue reporting, contribution margin, and activity-based costing will be built here in a future phase.
        </p>
        <div className="space-y-2">
          {plannedMetrics.map(metric => (
            <div key={metric} className="flex items-center justify-between py-2 border-b last:border-0">
              <span className="text-sm text-muted-foreground/50">{metric}</span>
              <span className="text-sm text-muted-foreground/30">—</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
