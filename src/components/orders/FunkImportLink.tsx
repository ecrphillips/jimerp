import { useNavigate } from 'react-router-dom';
import { Upload, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

/**
 * FUNK CSV import entry point. Visible to ADMIN and OPS only.
 * Matches the No Smoke Shopify pull card visually — eventually FUNK will move
 * to a direct Shopify pull and replace this with the same one-click flow.
 */
export function FunkImportLink() {
  const { isInternal } = useAuth();
  const navigate = useNavigate();

  if (!isInternal) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <Cloud className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">FUNK Shopify orders</div>
        <div className="text-xs text-muted-foreground">Manual CSV import (Shopify auto-pull coming soon)</div>
      </div>
      <Button
        onClick={() => navigate('/admin/funk-import')}
        variant="secondary"
        className="ml-auto"
      >
        <Upload className="mr-2 h-4 w-4" />
        Import FUNK orders
      </Button>
    </div>
  );
}
