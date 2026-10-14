import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { useBlendHolds, useReleaseBlendHold } from '@/hooks/useBlendHolds';

/** Lists roasted batches held for a blend, each with a release action. */
export function BlendHoldsPanel({
  blendRoastGroup,
  title = 'Coffee held for blends',
  description,
}: {
  blendRoastGroup?: string;
  title?: string;
  description?: string;
}) {
  const { data: holds } = useBlendHolds();
  const release = useReleaseBlendHold();
  const rows = (holds ?? []).filter((h) => !blendRoastGroup || h.planned_for_blend_roast_group === blendRoastGroup);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.actual_output_kg, 0);

  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{title} · {total.toFixed(1)} kg</p>
          <p className="text-xs text-muted-foreground">
            {description ?? 'Other products can’t pack this coffee until the blend uses it or it is released.'}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={release.isPending}
          onClick={() => release.mutate(rows.map((r) => r.id))}
        >
          Release all
        </Button>
      </div>
      <ul className="divide-y text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
            <span>
              <span className="font-medium">{r.roast_group}</span>
              <span className="text-muted-foreground">
                {' '}· {r.actual_output_kg.toFixed(1)} kg held for {r.planned_for_blend_roast_group}
                {r.roasted_at && ` · roasted ${format(new Date(r.roasted_at), 'MMM d, h:mm a')}`}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={release.isPending}
              onClick={() => release.mutate([r.id])}
            >
              Release to coffee stock
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
