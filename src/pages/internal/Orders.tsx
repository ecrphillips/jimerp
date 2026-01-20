import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Orders() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Orders</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>All Orders</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">No orders yet.</p></CardContent>
      </Card>
    </div>
  );
}
