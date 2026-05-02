import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { ExternalLink, Edit, Archive } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const sb: any = supabase;

type LockedPriceRow = {
  id: string;
  account_id: string;
  product_id: string;
  bag_size_g: number;
  green_source_type: 'GREEN_LOT' | 'ROAST_GROUP' | 'THEORETICAL_BLEND';
  green_source_id: string | null;
  theoretical_blend_ratios: any;
  locked_price: number;
  source_quote_id: string;
  effective_from: string;
  expires_at: string | null;
  is_archived: boolean;
  archived_reason: string | null;
  notes: string | null;
  accounts: { account_name: string } | null;
  products: { product_name: string } | null;
  source_quote: { quote_number: string } | null;
};

type Props = {
  /** When set, restricts the view to a single account and hides the account filter. */
  accountIdFilter?: string;
  /** Hide the surrounding Card wrapper. */
  bare?: boolean;
};

export function LockedPricesTab({ accountIdFilter, bare = false }: Props) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();

  const [accountSearch, setAccountSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['locked-prices', accountIdFilter ?? null, showArchived],
    queryFn: async () => {
      let q = sb
        .from('locked_prices')
        .select(`
          id, account_id, product_id, bag_size_g, green_source_type, green_source_id,
          theoretical_blend_ratios, locked_price, source_quote_id, effective_from,
          expires_at, is_archived, archived_reason, notes,
          accounts ( account_name ),
          products ( product_name ),
          source_quote:quotes!locked_prices_source_quote_id_fkey ( quote_number )
        `)
        .order('account_id')
        .order('product_id');
      if (accountIdFilter) q = q.eq('account_id', accountIdFilter);
      if (!showArchived) q = q.eq('is_archived', false);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LockedPriceRow[];
    },
  });

  // Resolve green source labels: gather ids by type, then fetch.
  const lotIds = useMemo(
    () => Array.from(new Set((rows ?? []).filter(r => r.green_source_type === 'GREEN_LOT' && r.green_source_id).map(r => r.green_source_id!))),
    [rows],
  );
  const groupIds = useMemo(
    () => Array.from(new Set((rows ?? []).filter(r => r.green_source_type === 'ROAST_GROUP' && r.green_source_id).map(r => r.green_source_id!))),
    [rows],
  );

  const { data: lotMap } = useQuery({
    queryKey: ['locked-prices-lots', lotIds],
    queryFn: async () => {
      if (lotIds.length === 0) return {};
      const { data, error } = await sb.from('green_lots').select('id, lot_identifier, name').in('id', lotIds);
      if (error) throw error;
      const m: Record<string, string> = {};
      (data ?? []).forEach((l: any) => { m[l.id] = l.lot_identifier ?? l.name ?? l.id.slice(0, 8); });
      return m;
    },
    enabled: lotIds.length > 0,
  });

  const { data: groupMap } = useQuery({
    queryKey: ['locked-prices-groups', groupIds],
    queryFn: async () => {
      if (groupIds.length === 0) return {};
      const { data, error } = await sb.from('roast_groups').select('roast_group, display_name');
      if (error) throw error;
      const m: Record<string, string> = {};
      (data ?? []).forEach((g: any) => { m[g.roast_group] = g.display_name ?? g.roast_group; });
      return m;
    },
    enabled: groupIds.length > 0,
  });

  const greenSourceLabel = (r: LockedPriceRow): string => {
    if (r.green_source_type === 'GREEN_LOT') {
      return lotMap?.[r.green_source_id ?? ''] ?? `Lot ${(r.green_source_id ?? '').slice(0, 8)}`;
    }
    if (r.green_source_type === 'ROAST_GROUP') {
      return groupMap?.[r.green_source_id ?? ''] ?? `Group ${r.green_source_id}`;
    }
    if (r.green_source_type === 'THEORETICAL_BLEND') {
      const n = Array.isArray(r.theoretical_blend_ratios) ? r.theoretical_blend_ratios.length : 0;
      return `Theoretical blend (${n} lots)`;
    }
    return '—';
  };

  const filtered = useMemo(() => {
    let out = rows ?? [];
    if (accountSearch.trim()) {
      const q = accountSearch.toLowerCase();
      out = out.filter(r => r.accounts?.account_name?.toLowerCase().includes(q));
    }
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      out = out.filter(r => r.products?.product_name?.toLowerCase().includes(q));
    }
    return out;
  }, [rows, accountSearch, productSearch]);

  const [editRow, setEditRow] = useState<LockedPriceRow | null>(null);
  const [archiveRow, setArchiveRow] = useState<LockedPriceRow | null>(null);

  const archiveLock = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb
        .from('locked_prices')
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_reason: 'Manually archived',
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Locked price archived');
      qc.invalidateQueries({ queryKey: ['locked-prices'] });
      setArchiveRow(null);
    },
    onError: (e: any) => toast.error(`Archive failed: ${e.message}`),
  });

  const body = (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        {!accountIdFilter && (
          <div className="w-56">
            <Label className="text-xs">Account</Label>
            <Input
              placeholder="Search account…"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
            />
          </div>
        )}
        <div className="w-56">
          <Label className="text-xs">Product</Label>
          <Input
            placeholder="Search product…"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} id="show-archived" />
          <Label htmlFor="show-archived" className="text-sm">Show archived</Label>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {!accountIdFilter && <TableHead>Account</TableHead>}
            <TableHead>Product</TableHead>
            <TableHead>Bag size</TableHead>
            <TableHead>Green source</TableHead>
            <TableHead className="text-right">Locked price</TableHead>
            <TableHead>Effective from</TableHead>
            <TableHead>Expires at</TableHead>
            <TableHead>Source quote</TableHead>
            <TableHead className="w-24">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={accountIdFilter ? 8 : 9} className="text-center py-6 text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={accountIdFilter ? 8 : 9} className="text-center py-6 text-muted-foreground">
                No locked prices.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((r) => {
              const muted = r.is_archived;
              return (
                <TableRow key={r.id} className={muted ? 'opacity-60' : ''}>
                  {!accountIdFilter && <TableCell>{r.accounts?.account_name ?? '—'}</TableCell>}
                  <TableCell>{r.products?.product_name ?? '—'}</TableCell>
                  <TableCell>{r.bag_size_g}g</TableCell>
                  <TableCell className="text-sm">{greenSourceLabel(r)}</TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={muted ? 'line-through' : ''}>
                      ${Number(r.locked_price).toFixed(2)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{r.effective_from}</TableCell>
                  <TableCell className="text-sm">{r.expires_at ?? '—'}</TableCell>
                  <TableCell>
                    {r.source_quote ? (
                      <Link
                        to={`/accounts/quotes/${r.source_quote_id}`}
                        className="font-mono text-xs underline-offset-2 hover:underline inline-flex items-center gap-1"
                      >
                        {r.source_quote.quote_number}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {isAdmin && !r.is_archived && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditRow(r)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => setArchiveRow(r)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {editRow && (
        <EditLockedPriceModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['locked-prices'] });
            setEditRow(null);
          }}
        />
      )}

      {archiveRow && (
        <AlertDialog open onOpenChange={(o) => !o && setArchiveRow(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this locked price?</AlertDialogTitle>
              <AlertDialogDescription>
                Future orders will revert to calculated prices.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={() => archiveLock.mutate(archiveRow.id)}
                disabled={archiveLock.isPending}
              >
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );

  if (bare) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Locked Prices</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function EditLockedPriceModal({
  row,
  onClose,
  onSaved,
}: {
  row: LockedPriceRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [price, setPrice] = useState(String(row.locked_price));
  const [expires, setExpires] = useState(row.expires_at ?? '');
  const [notes, setNotes] = useState(row.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const numPrice = Number(price);
    if (!Number.isFinite(numPrice) || numPrice < 0) {
      toast.error('Enter a valid price');
      return;
    }
    setSaving(true);
    const { error } = await sb
      .from('locked_prices')
      .update({
        locked_price: numPrice,
        expires_at: expires || null,
        notes: notes.trim() || null,
      })
      .eq('id', row.id);
    setSaving(false);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success('Locked price updated');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit locked price</DialogTitle>
          <DialogDescription>
            {row.accounts?.account_name} · {row.products?.product_name} · {row.bag_size_g}g
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Locked price</Label>
            <Input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div>
            <Label>Expires at</Label>
            <Input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">Leave blank for no expiry.</p>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
