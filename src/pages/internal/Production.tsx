import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Production() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Production Plan</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Today's Production</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">No production items scheduled.</p></CardContent>
      </Card>
    </div>
  );
}
