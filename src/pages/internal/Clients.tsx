import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Clients() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Clients</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>All Clients</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">No clients yet.</p></CardContent>
      </Card>
    </div>
  );
}
