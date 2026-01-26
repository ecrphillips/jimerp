import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, Plus } from 'lucide-react';

export default function BoardsDisabled() {
  return (
    <div className="page-container flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold">Boards Disabled for MVP</h2>
          <p className="text-muted-foreground">
            Andon boards are not active. Enter demand for Matchstick, Funk, and No Smoke via admin-created orders instead.
          </p>
          <Button asChild className="gap-2">
            <Link to="/orders/new">
              <Plus className="h-4 w-4" />
              Create Order
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
