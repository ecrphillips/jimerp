import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';

export default function SourcingLots() {
  return (
    <div className="page-container">
      <GreenCoffeeAlerts />
      <div className="page-header">
        <div>
          <h1 className="page-title">Lots</h1>
          <p className="text-sm text-muted-foreground">Green coffee inventory lots — coming soon.</p>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>Lots</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">The lots UI will be built here.</p></CardContent>
      </Card>
    </div>
  );
}
