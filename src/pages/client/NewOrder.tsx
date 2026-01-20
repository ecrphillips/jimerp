import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function NewOrder() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">New Order</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Create Order</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-muted-foreground">Select products to add to your order.</p>
          <Button disabled>Submit Order</Button>
        </CardContent>
      </Card>
    </div>
  );
}
