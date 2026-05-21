import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, Cell,
} from 'recharts';
import type { MarketPriceAuditRow } from '@/lib/marketPricingTypes';

interface Props {
  rows: MarketPriceAuditRow[];
  yourBagSizeG: number | null;
  yourPriceCad: number | null;
  yourLabel?: string;
}

interface Pt {
  x: number;
  y: number;
  brand: string;
  product: string;
  bag: number;
  price: number;
  isYou: boolean;
}

export function BagSizeScatter({ rows, yourBagSizeG, yourPriceCad, yourLabel }: Props) {
  const data: Pt[] = rows
    .filter(r => r.bag_size_g != null && r.price_cad != null)
    .map(r => ({
      x: Number(r.bag_size_g),
      y: Number(r.price_cad),
      brand: r.brand,
      product: r.product_name,
      bag: Number(r.bag_size_g),
      price: Number(r.price_cad),
      isYou: false,
    }));

  if (yourBagSizeG != null && yourPriceCad != null) {
    data.push({
      x: yourBagSizeG,
      y: yourPriceCad,
      brand: 'You',
      product: yourLabel ?? '',
      bag: yourBagSizeG,
      price: yourPriceCad,
      isYou: true,
    });
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
          <XAxis
            type="number"
            dataKey="x"
            domain={['dataMin - 20', 'dataMax + 20']}
            tickFormatter={(v: number) => `${v}g`}
            label={{ value: 'Bag size', position: 'insideBottom', offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            label={{ value: 'Price CAD', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Pt;
              return (
                <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                  <div className="font-medium">{p.brand}</div>
                  {p.product && <div className="text-muted-foreground">{p.product}</div>}
                  <div className="tabular-nums">{p.bag}g · ${p.price.toFixed(2)}</div>
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
