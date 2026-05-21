import { useMemo, useState } from 'react';
import { ArrowUpDown, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { MarketPriceAuditRow } from '@/lib/marketPricingTypes';

type SortKey = 'brand' | 'bag_size_g' | 'price_cad' | 'price_per_g_cad';

interface Props {
  rows: MarketPriceAuditRow[];
  you: {
    brand: string;
    product: string;
    bagSizeG: number;
    priceCad: number;
    pricePerG: number;
  } | null;
}

export function RankedTable({ rows, you }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('price_per_g_cad');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggle = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  };

  const Th = ({ k, children, align }: { k: SortKey; children: React.ReactNode; align?: 'right' }) => (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <Button variant="ghost" size="sm" className="-mx-2 h-7" onClick={() => toggle(k)}>
        {children}
        <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
      </Button>
    </TableHead>
  );

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <Th k="brand">Brand</Th>
            <TableHead>Product</TableHead>
            <Th k="bag_size_g" align="right">Bag</Th>
            <Th k="price_cad" align="right">Price</Th>
            <Th k="price_per_g_cad" align="right">$/g</Th>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {you && (
            <TableRow className="bg-primary/5">
              <TableCell className="font-medium">
                {you.brand} <Badge className="ml-2">You</Badge>
              </TableCell>
              <TableCell>{you.product}</TableCell>
              <TableCell className="text-right tabular-nums">{you.bagSizeG}g</TableCell>
              <TableCell className="text-right tabular-nums">${you.priceCad.toFixed(2)}</TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                ${you.pricePerG.toFixed(4)}
              </TableCell>
              <TableCell />
            </TableRow>
          )}
          {sorted.map(r => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.brand}</TableCell>
              <TableCell>{r.product_name}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.bag_size_g != null ? `${r.bag_size_g}g` : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.price_cad != null ? `$${Number(r.price_cad).toFixed(2)}` : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.price_per_g_cad != null ? `$${Number(r.price_per_g_cad).toFixed(4)}` : '—'}
              </TableCell>
              <TableCell className="text-right">
                {r.product_url && (
                  <a
                    href={r.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary inline-flex"
                    aria-label={`Open ${r.brand} product page`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
