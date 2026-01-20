import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Pricing() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Pricing</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Price Lists</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">No pricing data yet.</p></CardContent>
      </Card>
    </div>
  );
}
