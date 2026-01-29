import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RoastGroupComponent {
  id: string;
  parent_roast_group: string;
  component_roast_group: string;
  pct: number;
  display_order: number;
}

export interface ComponentDisplay {
  roastGroup: string;
  displayName: string;
  origin: string | null;
  pct: number;
}

/**
 * Fetches roast group components (blend recipes) from the database.
 * Returns a map of parent_roast_group -> array of components with percentages.
 */
export function useRoastGroupComponents() {
  return useQuery({
    queryKey: ['roast-group-components'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_group_components')
        .select(`
          id,
          parent_roast_group,
          component_roast_group,
          pct,
          display_order
        `)
        .order('parent_roast_group')
        .order('display_order', { ascending: true });
      
      if (error) throw error;
      return (data ?? []) as RoastGroupComponent[];
    },
  });
}

/**
 * Returns component breakdown for a roast group.
 * - For single origins: returns self at 100% with origin info
 * - For blends: returns component roast groups with their percentages
 */
export function getComponentBreakdown(
  roastGroup: string,
  isBlend: boolean,
  origin: string | null,
  displayName: string | null,
  components: RoastGroupComponent[],
  roastGroupsMap: Map<string, { display_name: string | null; origin: string | null }>
): ComponentDisplay[] {
  if (!isBlend) {
    // Single origin: 100% of itself
    return [{
      roastGroup,
      displayName: origin || displayName || roastGroup.replace(/_/g, ' '),
      origin,
      pct: 100,
    }];
  }
  
  // Blend: get components from roast_group_components
  const blendComponents = components.filter(c => c.parent_roast_group === roastGroup);
  
  if (blendComponents.length === 0) {
    // Blend without defined components - show as unknown
    return [{
      roastGroup,
      displayName: 'Components not defined',
      origin: null,
      pct: 100,
    }];
  }
  
  return blendComponents.map(c => {
    const componentInfo = roastGroupsMap.get(c.component_roast_group);
    return {
      roastGroup: c.component_roast_group,
      displayName: componentInfo?.origin || componentInfo?.display_name || c.component_roast_group.replace(/_/g, ' '),
      origin: componentInfo?.origin || null,
      pct: c.pct,
    };
  });
}
