import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ViewToggle, useViewMode } from '@/components/sourcing/ViewToggle';
import { GreenCoffeeAlerts } from '@/components/sourcing/GreenCoffeeAlerts';
import { CreateReleaseModal } from '@/components/sourcing/releases/CreateReleaseModal';
import { statusBadgeClass } from '@/components/sourcing/releases/releaseUtils';

interface Vendor { id: string; name: string; }

interface ReleaseRow {
  id: string;
  vendor_id: string | null;
  status: string;
  invoice_number: string | null;
  po_number: string | null;
  eta_date: string | null;
  received_date: string | null;
  arrival_status: string;
  notes: string | null;
  created_at: string;
}

interface ReleaseLineRow {
  id: string;
  release_id: string;
  bags_requested: number;
  bag_size_kg: number;
  lot_id: string | null;
}

type Filter = 'ALL' | 'PENDING' | 'INVOICED';

export default function SourcingReleases() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useViewMode('sourcing_view_releases', 'list');

  const { data: releases = [], isLoading } = useQuery({
    queryKey: ['green-releases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_releases')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ReleaseRow[];
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['green-release-lines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_release_lines')
        .select('id, release_id, bags_requested, bag_size_kg, lot_id');
      if (error) throw error;
      return data as ReleaseLineRow[];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['green-vendors-all-for-releases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_vendors')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data as Vendor[];
    },
  });

  const vendorMap = useMemo(() => {
    const m: Record<string, string> = {};
    vendors.forEach(v => m[v.id] = v.name);
    return m;
  }, [vendors]);

  const linesByRelease = useMemo(() => {
    const m: Record<string, ReleaseLineRow[]> = {};
    lines.forEach(l => {
      if (!m[l.release_id]) m[l.release_id] = [];
      m[l.release_id].push(l);
    });
    return m;
  }, [lines]);

  const filtered = useMemo(() => {
    return releases.filter(r => {
      if (filter !== 'ALL' && r.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        const vname = (r.vendor_id ? vendorMap[r.vendor_id] : '') || '';
        const inv = r.invoice_number || '';
        if (!vname.toLowerCase().includes(q) && !inv.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [releases, filter, search, vendorMap]);

  function summary(r: ReleaseRow) {
    const ls = linesByRelease[r.id] || [];
    const lots = ls.length;
    const totalKg = ls.reduce((s, l) => s + (l.bags_requested || 0) * Number(l.bag_size_kg || 0), 0);
    return { lots, totalKg };
  }

  return (
    <>
      <GreenCoffeeAlerts />
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Releases</h1>
          <div className="flex items-center gap-2">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New Release
            </Button>
          </div>
        </div>

        {/* Filters + search */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-md border border-input overflow-hidden">
            {(['ALL', 'PENDING', 'INVOICED'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === f ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                )}
              >
                {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-48 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor or invoice…" className="pl-8 h-9" />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {releases.length === 0 ? 'No releases yet. Click "New Release" to get started.' : 'No releases match your filters.'}
            </CardContent>
          </Card>
        ) : viewMode === 'list' ? (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Lots</TableHead>
                  <TableHead className="text-right">Total kg</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>ETA / Received</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => {
                  const { lots, totalKg } = summary(r);
                  const dateLabel = r.received_date
                    ? `Received ${format(parseISO(r.received_date), 'MMM d, yyyy')}`
                    : r.eta_date
                      ? `ETA ${format(parseISO(r.eta_date), 'MMM d, yyyy')}`
                      : '—';
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.po_number || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="font-medium">{(r.vendor_id && vendorMap[r.vendor_id]) || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadgeClass(r.status)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{lots}</TableCell>
                      <TableCell className="text-right">{totalKg > 0 ? `${totalKg.toLocaleString()} kg` : '—'}</TableCell>
                      <TableCell className="text-sm font-mono">{r.invoice_number || <span className="text-muted-foreground italic">— Pending</span>}</TableCell>
                      <TableCell className="text-sm">{dateLabel}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(parseISO(r.created_at), 'MMM d, yyyy')}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => navigate(`/sourcing/releases/${r.id}`)}>View</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(r => {
              const { lots, totalKg } = summary(r);
              const dateLabel = r.received_date
                ? `Received ${format(parseISO(r.received_date), 'MMM d, yyyy')}`
                : r.eta_date
                  ? `ETA ${format(parseISO(r.eta_date), 'MMM d, yyyy')}`
                  : null;
              return (
                <Card key={r.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => navigate(`/sourcing/releases/${r.id}`)}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-base leading-tight">{(r.vendor_id && vendorMap[r.vendor_id]) || '—'}</p>
                      <Badge variant="outline" className={statusBadgeClass(r.status)}>{r.status}</Badge>
                    </div>
                    {r.po_number && <p className="text-xs font-mono text-foreground">{r.po_number}</p>}
                    <p className="text-sm">{lots} {lots === 1 ? 'lot' : 'lots'} · {totalKg > 0 ? `${totalKg.toLocaleString()} kg` : '—'}</p>
                    <p className="text-xs text-muted-foreground font-mono">{r.invoice_number || '— Pending'}</p>
                    {dateLabel && <p className="text-xs text-muted-foreground">{dateLabel}</p>}
                    <p className="text-xs text-muted-foreground">Created {format(parseISO(r.created_at), 'MMM d, yyyy')}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <CreateReleaseModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(id) => navigate(`/sourcing/releases/${id}`)}
      />
    </>
  );
}
