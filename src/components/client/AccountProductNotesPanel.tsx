import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useClientOrderableProducts } from '@/hooks/useClientOrderableProducts';
import { ProductNotes } from '@/components/client/ProductNotes';
import { useAccountProductNotes } from '@/hooks/useAccountProductNotes';

/**
 * Staff view of the notes a client keeps on their products (client portal →
 * My Products). One thread per coffee; coffees with notes are listed first.
 */
export function AccountProductNotesPanel({ accountId }: { accountId: string }) {
  const { data: products = [], isLoading } = useClientOrderableProducts(accountId);
  const { data: notes = [] } = useAccountProductNotes(accountId);

  const coffees = useMemo(() => {
    const byRg = new Map<string, string>();
    for (const p of products) {
      if (p.roast_group && !byRg.has(p.roast_group)) byRg.set(p.roast_group, p.product_name);
    }
    // Notes can outlive the product that prompted them.
    for (const n of notes) if (!byRg.has(n.roast_group)) byRg.set(n.roast_group, n.roast_group);

    return [...byRg.entries()]
      .map(([roastGroup, name]) => {
        const groupNotes = notes.filter((n) => n.roast_group === roastGroup);
        return { roastGroup, name, notes: groupNotes, latest: groupNotes[0]?.created_at ?? null };
      })
      .sort((a, b) => {
        if (a.latest && b.latest) return b.latest.localeCompare(a.latest);
        if (a.latest) return -1;
        if (b.latest) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [products, notes]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (coffees.length === 0) {
    return <p className="text-sm text-muted-foreground">This account has no coffee products yet.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Notes the client keeps on their products in the client portal. Anything you add here is visible to them.
      </p>
      {coffees.map((c) => (
        <Card key={c.roastGroup}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>{c.name}</span>
              {c.latest && (
                <span className="text-xs font-normal text-muted-foreground">
                  Last note {format(new Date(c.latest), 'MMM d, yyyy')}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProductNotes accountId={accountId} roastGroup={c.roastGroup} notes={c.notes} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
