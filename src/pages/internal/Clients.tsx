import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

export default function Clients() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, billing_email, is_active')
        .order('name', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Clients</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>All Clients</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-destructive">Failed to load: {error instanceof Error ? error.message : String(error)}</p>
          ) : data.length === 0 ? (
            <p className="text-muted-foreground">No clients found.</p>
          ) : (
            <ul className="space-y-3">
              {data.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <span className="font-medium">{c.name}</span>
                    {c.billing_email && (
                      <span className="ml-2 text-sm text-muted-foreground">{c.billing_email}</span>
                    )}
                  </div>
                  <span className={`text-sm ${c.is_active ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
