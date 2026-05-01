import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Plus, MoreHorizontal, Eye, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@/lib/formatMoney';

type QuoteRow = {
  id: string;
  quote_number: string;
  account_id: string | null;
  prospect_id: string | null;
  status: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  accounts?: { account_name: string } | null;
  prospects?: { business_name: string } | null;
  quote_line_items?: Array<{
    quantity_bags: number;
    calc_final_price_per_bag: number | null;
    final_price_per_bag_override: number | null;
  }>;
};

const STATUS_OPTIONS = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
type StatusOpt = typeof STATUS_OPTIONS[number];

const statusBadge = (s: string) => {
  switch (s) {
    case 'DRAFT': return <Badge variant="secondary">Draft</Badge>;
    case 'SENT': return <Badge>Sent</Badge>;
    case 'ACCEPTED': return <Badge className="bg-emerald-600 hover:bg-emerald-700">Accepted</Badge>;
    case 'REJECTED': return <Badge variant="destructive">Rejected</Badge>;
    case 'EXPIRED': return <Badge variant="outline">Expired</Badge>;
    default: return <Badge variant="secondary">{s}</Badge>;
  }
};

export default function Quotes() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<StatusOpt>>(new Set());
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: quotes, isLoading } = useQuery({
    queryKey: ['quotes-list'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('quotes')
        .select(`
          id, quote_number, account_id, prospect_id, status, title, created_at, updated_at,
          accounts ( account_name ),
          prospects ( business_name ),
          quote_line_items ( quantity_bags, calc_final_price_per_bag, final_price_per_bag_override )
        `)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as QuoteRow[];
    },
  });

  const filtered = useMemo(() => {
    const list = quotes ?? [];
    return list.filter((q) => {
      if (statusFilter.size > 0 && !statusFilter.has(q.status as StatusOpt)) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const recipient =
          q.accounts?.account_name?.toLowerCase() ??
          q.prospects?.business_name?.toLowerCase() ??
          '';
        if (
          !q.quote_number.toLowerCase().includes(needle) &&
          !recipient.includes(needle) &&
          !(q.title ?? '').toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [quotes, search, statusFilter]);

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: src, error } = await (supabase as any)
        .from('quotes')
        .select(`
          account_id, prospect_id, title, internal_notes, customer_notes,
          quote_line_items (
            display_order, green_lot_id, blend_components, product_id, packaging_variant,
            bag_size_g, quantity_bags, tier_id_override, profile_id_override,
            calc_total_cost_per_bag, calc_list_price_per_bag, calc_final_price_per_bag,
            calc_margin_pct, calc_payload, calc_warnings, calc_at,
            final_price_per_bag_override, override_reason, line_notes
          )
        `)
        .eq('id', id)
        .single();
      if (error) throw error;

      const { data: newQuote, error: insErr } = await (supabase as any)
        .from('quotes')
        .insert({
          account_id: src.account_id,
          prospect_id: src.prospect_id,
          status: 'DRAFT',
          title: src.title ? `${src.title} (copy)` : '(copy)',
          internal_notes: src.internal_notes,
          customer_notes: src.customer_notes,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;

      const lines = (src.quote_line_items ?? []).map((l: any) => ({ ...l, quote_id: newQuote.id }));
      if (lines.length > 0) {
        const { error: liErr } = await (supabase as any)
          .from('quote_line_items')
          .insert(lines);
        if (liErr) throw liErr;
      }
      return newQuote.id;
    },
    onSuccess: (newId) => {
      toast.success('Quote duplicated');
      qc.invalidateQueries({ queryKey: ['quotes-list'] });
      navigate(`/accounts/quotes/${newId}`);
    },
    onError: (e: any) => toast.error(`Duplicate failed: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('quotes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Quote deleted');
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ['quotes-list'] });
    },
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });

  const toggleStatus = (s: StatusOpt) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const totalForQuote = (q: QuoteRow): number => {
    return (q.quote_line_items ?? []).reduce((sum, l) => {
      const price = l.final_price_per_bag_override ?? l.calc_final_price_per_bag ?? 0;
      return sum + Number(price) * Number(l.quantity_bags ?? 0);
    }, 0);
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            Multi-line price quotes for accounts and prospects.
          </p>
        </div>
        <Button onClick={() => navigate('/accounts/quotes/new')}>
          <Plus className="h-4 w-4 mr-1" /> New Quote
        </Button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Search by quote #, recipient, or title…"
            className="max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((s) => (
              <Badge
                key={s}
                variant={statusFilter.has(s) ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => toggleStatus(s)}
              >
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </Badge>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quote #</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12">
                  <p className="text-muted-foreground mb-3">No quotes yet.</p>
                  <Button onClick={() => navigate('/accounts/quotes/new')}>
                    <Plus className="h-4 w-4 mr-1" /> New Quote
                  </Button>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((q) => {
                const recipientName =
                  q.accounts?.account_name ?? q.prospects?.business_name ?? '—';
                const isProspect = !!q.prospect_id;
                return (
                  <TableRow
                    key={q.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/accounts/quotes/${q.id}`)}
                  >
                    <TableCell className="font-mono">{q.quote_number}</TableCell>
                    <TableCell>{q.title ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{recipientName}</span>
                        {isProspect && <Badge variant="outline" className="text-xs">Prospect</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(q.status)}</TableCell>
                    <TableCell className="text-right">{q.quote_line_items?.length ?? 0}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMoney(totalForQuote(q))}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(q.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(q.updated_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/accounts/quotes/${q.id}`)}>
                            <Eye className="h-4 w-4 mr-2" /> View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicateMutation.mutate(q.id)}>
                            <Copy className="h-4 w-4 mr-2" /> Duplicate
                          </DropdownMenuItem>
                          {isAdmin && (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteId(q.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete quote?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the quote and all its lines. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
