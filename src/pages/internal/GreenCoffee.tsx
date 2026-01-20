import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function GreenCoffee() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Green Coffee Lots</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Inventory</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">No green coffee lots yet.</p></CardContent>
      </Card>
    </div>
  );
}
