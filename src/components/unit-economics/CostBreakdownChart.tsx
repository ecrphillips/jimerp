import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell, LabelList } from 'recharts';
import type { CostBreakdown, UnitEconomicsInputs } from '@/lib/unitEconomics';
import { unitLabel } from '@/lib/unitEconomics';
import { formatMoney } from '@/lib/formatMoney';

interface Props {
  inputs: UnitEconomicsInputs;
  perUnit: CostBreakdown;
}

const COLOURS = {
  green:     'hsl(145 50% 40%)',
  packaging: 'hsl(38 80% 50%)',
  roasting:  'hsl(20 70% 50%)',
  labour:    'hsl(280 50% 50%)',
  overhead:  'hsl(210 30% 50%)',
};

export function CostBreakdownChart({ inputs, perUnit }: Props) {
  // Build a single horizontally-stacked bar
  const segments: Array<{ key: keyof CostBreakdown; label: string; value: number; colour: string }> = [
    { key: 'green',     label: 'Green coffee',  value: perUnit.green,     colour: COLOURS.green },
    { key: 'packaging', label: 'Packaging',     value: perUnit.packaging, colour: COLOURS.packaging },
    { key: 'roasting',  label: 'Home Island roasting', value: perUnit.roasting, colour: COLOURS.roasting },
  ];
  if (inputs.includeLabour) {
    segments.push({ key: 'labour', label: 'Labour', value: perUnit.labour, colour: COLOURS.labour });
  }
  if ((inputs.overheadMonthly ?? 0) > 0 && (inputs.monthlyKg ?? 0) > 0) {
    segments.push({ key: 'overhead', label: 'Overhead', value: perUnit.overhead, colour: COLOURS.overhead });
  }

  const row: Record<string, number | string> = { name: `Per ${unitLabel(inputs.displayUnit)}` };
  segments.forEach(s => { row[s.key] = s.value; });

  const wholesale = inputs.wholesalePrice ?? 0;
  const retail = inputs.retailPrice ?? 0;
  const cost = perUnit.total;
  const xMax = Math.max(cost, wholesale, retail) * 1.15 || 1;

  const wsMargin = wholesale - cost;
  const retailMargin = retail - cost;

  return (
    <div className="space-y-4">
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={[row]}
            layout="vertical"
            margin={{ top: 30, right: 40, bottom: 10, left: 10 }}
          >
            <XAxis
              type="number"
              domain={[0, xMax]}
              tickFormatter={(v) => `$${v.toFixed(2)}`}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} width={70} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => {
                const seg = segments.find(s => s.key === name);
                return [formatMoney(value).replace('CAD ', ''), seg?.label ?? name];
              }}
            />
            {segments.map(s => (
              <Bar key={s.key} dataKey={s.key} stackId="cost" fill={s.colour} isAnimationActive={false}>
                <Cell fill={s.colour} />
              </Bar>
            ))}
            {wholesale > 0 && (
              <ReferenceLine
                x={wholesale}
                stroke={wsMargin >= 0 ? 'hsl(145 60% 35%)' : 'hsl(0 70% 50%)'}
                strokeDasharray="4 4"
                strokeWidth={2}
                label={{
                  value: `Wholesale $${wholesale.toFixed(2)}`,
                  position: 'top',
                  fill: wsMargin >= 0 ? 'hsl(145 60% 35%)' : 'hsl(0 70% 50%)',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            )}
            {retail > 0 && (
              <ReferenceLine
                x={retail}
                stroke={retailMargin >= 0 ? 'hsl(145 60% 25%)' : 'hsl(0 70% 40%)'}
                strokeWidth={2}
                label={{
                  value: `Retail $${retail.toFixed(2)}`,
                  position: 'top',
                  offset: 18,
                  fill: retailMargin >= 0 ? 'hsl(145 60% 25%)' : 'hsl(0 70% 40%)',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: s.colour }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">${s.value.toFixed(2)}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1.5 font-semibold">
          <span className="text-muted-foreground">Total cost:</span>
          <span className="tabular-nums">${cost.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
