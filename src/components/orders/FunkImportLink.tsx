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
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <Cloud className="h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-amber-900">FUNK Shopify orders</div>
        <div className="text-xs text-amber-700">Manual CSV import (Shopify auto-pull coming soon)</div>
      </div>
      <Button
        onClick={() => navigate('/admin/funk-import')}
        className="ml-auto bg-amber-600 hover:bg-amber-700"
      >
        <Upload className="mr-2 h-4 w-4" />
        Import FUNK orders
      </Button>
    </div>
  );
}
