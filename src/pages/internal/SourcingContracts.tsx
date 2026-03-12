import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SourcingContracts() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contracts</h1>
          <p className="text-sm text-muted-foreground">Purchase commitments — coming soon.</p>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>Contracts</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">The contracts UI will be built here.</p></CardContent>
      </Card>
    </div>
  );
}
