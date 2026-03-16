import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import { getDisplayName } from '@/lib/roastGroupUtils';
import { cn } from '@/lib/utils';
import { RoastGroupDetailsSection } from '@/components/roast-groups/RoastGroupDetailsSection';
import { BlendCompositionSection } from '@/components/roast-groups/BlendCompositionSection';
import { GreenLotMappingSection } from '@/components/roast-groups/GreenLotMappingSection';
import { ProductsFamilyTreeSection } from '@/components/roast-groups/ProductsFamilyTreeSection';

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

  const displayName = getDisplayName(rg.display_name, rg.roast_group);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/roast-groups')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Roast Groups
      </Button>

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">{displayName}</h1>
        <Badge variant="outline" className={cn(
          'text-xs',
          rg.is_blend
            ? 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300'
            : 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300'
        )}>
          {rg.is_blend ? 'Blend' : 'Single Origin'}
        </Badge>
        <Badge variant="outline" className={cn(
          'text-xs',
          rg.is_seasonal
            ? 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300'
            : 'border-border text-muted-foreground'
        )}>
          {rg.is_seasonal ? 'Seasonal' : 'Perennial'}
        </Badge>
        {!rg.is_active && (
          <Badge variant="secondary" className="text-xs">Inactive</Badge>
        )}
      </div>

      {/* Section 1: Details */}
      <RoastGroupDetailsSection roastGroupKey={rg.roast_group} initialData={rg} />

      {/* Section 2: Blend Composition (blends only) */}
      {rg.is_blend && (
        <BlendCompositionSection roastGroupKey={rg.roast_group} />
      )}

      {/* Section 3: Green Lot Mapping */}
      <GreenLotMappingSection roastGroupKey={rg.roast_group} />

      {/* Section 4: Products Family Tree */}
      <ProductsFamilyTreeSection roastGroupKey={rg.roast_group} displayName={displayName} />
    </div>
  );
}
