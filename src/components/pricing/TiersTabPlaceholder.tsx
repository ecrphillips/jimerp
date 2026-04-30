import { Card, CardContent } from '@/components/ui/card';
import { Construction } from 'lucide-react';

export function TiersTabPlaceholder() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Construction className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Tiers coming in the next pricing build (Layer 1B).
        </p>
      </CardContent>
    </Card>
  );
}
