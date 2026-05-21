import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { bucketSummaries, bucketOf, type Bucket } from '@/lib/marketPricingStats';

interface Props {
  values: ReadonlyArray<number | null | undefined>;
  yourPpg: number | null;
}

const LABEL: Record<Bucket, string> = {
  VALUE: 'Value',
  MID: 'Mid-market',
  PREMIUM: 'Premium',
};

const SUBTITLE: Record<Bucket, string> = {
  VALUE: 'Bottom quartile',
  MID: 'Middle half',
  PREMIUM: 'Top quartile',
};

export function TierBuckets({ values, yourPpg }: Props) {
  const summaries = bucketSummaries(values);
  if (summaries.length === 0) return null;
  const yourBucket = bucketOf(yourPpg, values);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {summaries.map(s => {
        const active = s.bucket === yourBucket;
        return (
          <Card
            key={s.bucket}
            className={cn(
              'transition-colors',
              active ? 'border-primary ring-2 ring-primary/30' : 'border-muted',
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-baseline justify-between">
                <div className="font-medium">{LABEL[s.bucket]}</div>
                <div className="text-xs text-muted-foreground">{SUBTITLE[s.bucket]}</div>
              </div>
              <div className="mt-2 text-sm tabular-nums">
                ${s.minPpg.toFixed(4)} – ${s.maxPpg.toFixed(4)} / g
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {s.count} brand{s.count === 1 ? '' : 's'}
                {active && <span className="ml-2 text-primary font-medium">• You</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
