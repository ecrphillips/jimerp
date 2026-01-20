import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Products() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Products</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>All Products</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">No products yet.</p></CardContent>
      </Card>
    </div>
  );
}
