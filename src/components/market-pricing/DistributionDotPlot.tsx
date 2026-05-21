import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, ReferenceLine, Cell,
} from 'recharts';
import { stableJitter } from '@/lib/marketPricingStats';
import type { MarketPriceAuditRow } from '@/lib/marketPricingTypes';

interface Props {
  rows: MarketPriceAuditRow[];
  yourPpg: number | null;
  yourLabel?: string;
}

interface PlotPoint {
  x: number;
  y: number;
  brand: string;
  product: string;
  ppg: number;
  isYou: boolean;
}

export function DistributionDotPlot({ rows, yourPpg, yourLabel }: Props) {
  const data: PlotPoint[] = rows
    .filter(r => r.price_per_g_cad != null)
    .map(r => ({
      x: stableJitter(`${r.brand}|${r.product_name}`),
      y: Number(r.price_per_g_cad),
      brand: r.brand,
      product: r.product_name,
      ppg: Number(r.price_per_g_cad),
      isYou: false,
    }));

  if (yourPpg != null) {
    data.push({
      x: 0,
      y: yourPpg,
      brand: 'You',
      product: yourLabel ?? '',
      ppg: yourPpg,
      isYou: true,
    });
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 24 }}>
          <XAxis type="number" dataKey="x" hide domain={[-0.7, 0.7]} />
          <YAxis
            type="number"
            dataKey="y"
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            label={{ value: 'CAD per gram', angle: -90, position: 'insideLeft', offset: 10 }}
          />
          {yourPpg != null && (
            <ReferenceLine y={yourPpg} stroke="hsl(var(--primary))" strokeDasharray="4 4" />
          )}
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as PlotPoint;
              return (
                <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                  <div className="font-medium">{p.brand}</div>
                  {p.product && <div className="text-muted-foreground">{p.product}</div>}
                  <div className="tabular-nums">${p.ppg.toFixed(4)} / g</div>
                </div>
              );
            }}
          />
          <Scatter data={data}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.isYou ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.55)'}
                r={d.isYou ? 8 : 5}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
