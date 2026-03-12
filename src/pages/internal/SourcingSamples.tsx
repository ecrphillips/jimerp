import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SourcingSamples() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Samples</h1>
          <p className="text-sm text-muted-foreground">Coffee sample evaluation — coming soon.</p>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>Samples</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">The samples UI will be built here.</p></CardContent>
      </Card>
    </div>
  );
}
