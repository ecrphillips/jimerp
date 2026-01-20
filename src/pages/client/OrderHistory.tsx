import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function OrderHistory() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Order History</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Your Orders</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">No orders yet.</p></CardContent>
      </Card>
    </div>
  );
}
