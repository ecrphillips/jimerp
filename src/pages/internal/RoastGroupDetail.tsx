import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { getDisplayName } from '@/lib/roastGroupUtils';

export default function RoastGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: rg, isLoading } = useQuery({
    queryKey: ['roast-group-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('*')
        .eq('roast_group', id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!rg) return <div className="p-6 text-sm text-muted-foreground">Roast group not found.</div>;

  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/roast-groups')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>
      <h1 className="text-2xl font-bold">{getDisplayName(rg.display_name, rg.roast_group)}</h1>
      <p className="text-sm text-muted-foreground">Detail page — coming soon.</p>
    </div>
  );
}
