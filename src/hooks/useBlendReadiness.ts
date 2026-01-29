/**
 * Blend Readiness Hook
 * 
 * Calculates the readiness state for post-roast blends based on:
 * 1. Roasted component inventory (unconsumed component batches)
 * 2. Blend recipe (component percentages)
 * 3. Current demand
 * 
 * Three-stage readiness model:
 * 1. "needs_roasting" - Components not roasted enough
 * 2. "ready_to_blend" - Components roasted enough to cover some/all demand
 * 3. "blended" - After blend event creates WIP
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RoastGroupComponent } from './useRoastGroupComponents';

export type BlendReadinessState = 'needs_roasting' | 'partially_ready' | 'ready_to_blend' | 'blended';

export interface BlendReadiness {
  state: BlendReadinessState;
  /** Kg of blend that can be created from available components */
  blendPossibleKg: number;
  /** Kg of blend demand (net demand) */
  blendNeededKg: number;
  /** Kg staged and ready for blending (min of possible and needed) */
  stagedForBlendKg: number;
  /** Kg that still needs roasting before blending can cover demand */
  roastShortfallKg: number;
  /** WIP already created from blending */
  wipKg: number;
  /** Component inventory breakdown */
  componentInventory: {
    componentRoastGroup: string;
    pct: number;
    roastedKg: number;
    requiredKg: number;
    isBottleneck: boolean;
  }[];
}

/**
 * Fetch roasted component batches for all blends
 * These are batches that are:
 * - ROASTED status
 * - planned_for_blend_roast_group is NOT null
 * - consumed_by_blend_at IS null (not yet consumed)
 */
function useRoastedComponentBatches() {
  return useQuery({
    queryKey: ['roasted-component-batches-for-blending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roasted_batches')
        .select('id, roast_group, actual_output_kg, planned_for_blend_roast_group')
        .eq('status', 'ROASTED')
        .not('planned_for_blend_roast_group', 'is', null)
        .is('consumed_by_blend_at', null);
      
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Calculate blend readiness for a specific blend roast group
 */
export function useBlendReadiness(
  blendRoastGroup: string,
  isBlend: boolean,
  components: RoastGroupComponent[],
  netDemandKg: number,
  wipKg: number
): BlendReadiness | null {
  const { data: componentBatches } = useRoastedComponentBatches();
  
  return useMemo(() => {
    if (!isBlend) return null;
    
    // Get components for this blend
    const blendComponents = components.filter(c => c.parent_roast_group === blendRoastGroup);
    if (blendComponents.length === 0) return null;
    
    // Sum roasted component inventory by component roast group
    const componentInventoryMap: Record<string, number> = {};
    for (const batch of componentBatches ?? []) {
      if (batch.planned_for_blend_roast_group === blendRoastGroup) {
        componentInventoryMap[batch.roast_group] = 
          (componentInventoryMap[batch.roast_group] ?? 0) + Number(batch.actual_output_kg);
      }
    }
    
    // Calculate how much blend can be produced from available components
    // For each component: eligible_kg / (pct/100) = max blend possible from that component
    // The bottleneck is the minimum across all components
    const componentDetails = blendComponents.map(c => {
      const roastedKg = componentInventoryMap[c.component_roast_group] ?? 0;
      const ratio = c.pct / 100;
      const blendPossibleFromComponent = ratio > 0 ? roastedKg / ratio : 0;
      // Required kg for this component to meet full blend demand
      const requiredKg = netDemandKg * ratio;
      
      return {
        componentRoastGroup: c.component_roast_group,
        pct: c.pct,
        roastedKg,
        requiredKg,
        blendPossibleFromComponent,
        isBottleneck: false, // Will be set below
      };
    });
    
    // Find the bottleneck - minimum blend possible across all components
    const blendPossibleKg = componentDetails.length > 0
      ? Math.min(...componentDetails.map(c => c.blendPossibleFromComponent))
      : 0;
    
    // Mark the bottleneck component(s)
    const componentInventory = componentDetails.map(c => ({
      componentRoastGroup: c.componentRoastGroup,
      pct: c.pct,
      roastedKg: c.roastedKg,
      requiredKg: c.requiredKg,
      isBottleneck: Math.abs(c.blendPossibleFromComponent - blendPossibleKg) < 0.01,
    }));
    
    // Calculate staged and shortfall
    const stagedForBlendKg = Math.min(blendPossibleKg, Math.max(0, netDemandKg - wipKg));
    const roastShortfallKg = Math.max(0, netDemandKg - wipKg - blendPossibleKg);
    
    // Determine state
    // "blended" = WIP exists and covers demand (from blend ADJUSTMENT)
    // "ready_to_blend" = components roasted, enough to blend, but blend not yet executed
    // "partially_ready" = some components available but not enough for full demand
    // "needs_roasting" = components not roasted enough
    let state: BlendReadinessState;
    if (wipKg >= netDemandKg && netDemandKg > 0) {
      // WIP already covers demand - fully blended
      state = 'blended';
    } else if (wipKg > 0 && wipKg < netDemandKg && blendPossibleKg === 0) {
      // Some WIP but not enough and no more components to blend
      state = 'blended'; // Partially blended, need more roasting
    } else if (blendPossibleKg >= (netDemandKg - wipKg) && blendPossibleKg > 0) {
      // Components can cover remaining demand
      state = 'ready_to_blend';
    } else if (blendPossibleKg > 0) {
      // Some components available but not enough
      state = 'partially_ready';
    } else {
      state = 'needs_roasting';
    }
    
    return {
      state,
      blendPossibleKg,
      blendNeededKg: netDemandKg,
      stagedForBlendKg,
      roastShortfallKg,
      wipKg,
      componentInventory,
    };
  }, [isBlend, blendRoastGroup, components, componentBatches, netDemandKg, wipKg]);
}

/**
 * Get status label and style for blend readiness
 */
export function getBlendReadinessDisplay(readiness: BlendReadiness | null, coverageDelta: number) {
  if (!readiness) {
    // Not a blend - use standard coverage display
    return null;
  }
  
  const { state, stagedForBlendKg, roastShortfallKg, wipKg, blendNeededKg, blendPossibleKg } = readiness;
  
  switch (state) {
    case 'blended':
      // WIP exists - show coverage status based on WIP vs demand
      if (wipKg >= blendNeededKg) {
        const surplus = wipKg - blendNeededKg;
        return {
          label: surplus > 0.1 ? `Covered +${surplus.toFixed(1)} kg` : 'Covered',
          variant: 'covered' as const,
          className: 'bg-primary/10 text-primary border-primary/20',
        };
      }
      // WIP exists but doesn't cover full demand
      const shortfall = blendNeededKg - wipKg - blendPossibleKg;
      if (shortfall > 0) {
        return {
          label: `Short ${shortfall.toFixed(1)} kg`,
          sublabel: wipKg > 0 ? `${wipKg.toFixed(1)} kg WIP` : undefined,
          variant: 'short' as const,
          className: 'bg-amber-100 text-amber-800 border-amber-300',
        };
      }
      // WIP + staged components can cover
      return {
        label: 'Ready to blend more',
        sublabel: `${wipKg.toFixed(1)} kg WIP, ${blendPossibleKg.toFixed(1)} kg staged`,
        variant: 'ready' as const,
        className: 'bg-green-100 text-green-800 border-green-300',
      };
      
    case 'ready_to_blend':
      return {
        label: 'Ready to blend',
        sublabel: `${stagedForBlendKg.toFixed(1)} kg staged`,
        variant: 'ready' as const,
        className: 'bg-green-100 text-green-800 border-green-300',
      };
      
    case 'partially_ready':
      return {
        label: `Needs roasting: ${roastShortfallKg.toFixed(1)} kg`,
        sublabel: `${stagedForBlendKg.toFixed(1)} kg staged`,
        variant: 'partial' as const,
        className: 'bg-blue-100 text-blue-800 border-blue-300',
      };
      
    case 'needs_roasting':
    default:
      return {
        label: `Short ${blendNeededKg.toFixed(1)} kg`,
        sublabel: 'Components need roasting',
        variant: 'short' as const,
        className: 'bg-amber-100 text-amber-800 border-amber-300',
      };
  }
}
