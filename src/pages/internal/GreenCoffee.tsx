import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function GreenCoffee() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Green Coffee</h1>
          <p className="text-sm text-muted-foreground">
            Sourcing module coming soon. Schema has been migrated to the new vendor → sample → contract → lot structure.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Sourcing</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground">The new sourcing UI will be built here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
