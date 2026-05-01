import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

interface AuditRow {
  id: string;
  product_name: string;
  sku: string | null;
  roast_group: string | null;
  updated_at: string;
  account_id: string | null;
  account_name: string | null;
}

/**
 * Returns the second segment of a SKU (origin slot).
 * SKU format: {ACCOUNT}-{ORIGIN/BLD}-{NAME}-{GRAMS}
 */
function getOriginSegment(sku: string | null | undefined): string {
  if (!sku) return '';
  const parts = sku.split('-');
  return parts[1] ?? '';
}

export function PerennialSkuAudit() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const { data: rows, isLoading } = useQuery({
    queryKey: ['perennial-sku-audit'],
    enabled: isAdmin,
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, sku, roast_group, updated_at, account_id, account:accounts(account_name)')
        .eq('is_perennial', true)
        .not('sku', 'is', null)
        .order('product_name');

      if (error) throw error;

      const filtered = (data ?? [])
        .map((p: any) => ({
          id: p.id,
          product_name: p.product_name,
          sku: p.sku,
          roast_group: p.roast_group,
          updated_at: p.updated_at,
          account_id: p.account_id,
          account_name: p.account?.account_name ?? null,
        }))
        .filter((p) => {
          const seg = getOriginSegment(p.sku);
          return seg !== '' && seg !== 'BLD';
        })
        .sort((a, b) => {
          const an = a.account_name ?? '';
          const bn = b.account_name ?? '';
          if (an !== bn) return an.localeCompare(bn);
          return a.product_name.localeCompare(b.product_name);
        });

      return filtered;
    },
  });

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          Perennial SKU Audit
        </CardTitle>
        <CardDescription>
          Perennial products whose SKU has a country code (or other non-BLD value) in the origin
          segment. Perennials should always use <code className="bg-muted px-1 rounded">BLD</code>.
          No bulk fix — open each product to adjust manually.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !rows || rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No non-conforming perennial SKUs found.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {rows.length} product{rows.length === 1 ? '' : 's'} flagged
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Product</th>
                    <th className="text-left px-3 py-2 font-medium">Account</th>
                    <th className="text-left px-3 py-2 font-medium">Current SKU</th>
                    <th className="text-left px-3 py-2 font-medium">Roast group</th>
                    <th className="text-left px-3 py-2 font-medium">Last updated</th>
                    <th className="text-right px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const seg = getOriginSegment(row.sku);
                    return (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">{row.product_name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.account_name ?? '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          <span>{row.sku}</span>
                          <Badge variant="destructive" className="ml-2 text-[10px]">
                            {seg}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.roast_group ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {format(new Date(row.updated_at), 'yyyy-MM-dd')}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/products?edit=${row.id}`)}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Edit product
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
