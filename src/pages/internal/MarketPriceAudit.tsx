import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Upload, Trash2, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { parseMarketAuditCsv } from '@/lib/marketAuditCsv';
import type { MarketPriceAuditDraftRow } from '@/lib/marketPricingTypes';
import {
  useAuditRuns,
  useImportAudit,
  usePublishAudit,
  useUnpublishAudit,
  useDeleteAudit,
} from '@/hooks/useMarketPriceAudit';

export default function MarketPriceAudit() {
  const { data: runs = [], isLoading } = useAuditRuns();
  const importMut = useImportAudit();
  const publishMut = usePublishAudit();
  const unpublishMut = useUnpublishAudit();
  const deleteMut = useDeleteAudit();

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [parsed, setParsed] = useState<MarketPriceAuditDraftRow[] | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [runDate, setRunDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState<string>('');
  const [headerMissing, setHeaderMissing] = useState<string[]>([]);

  const validCount = useMemo(
    () => (parsed ?? []).filter(r => (r.warnings?.length ?? 0) === 0).length,
    [parsed],
  );

  const onPickFile = async (file: File) => {
    const text = await file.text();
    const res = parseMarketAuditCsv(text);
    setParsed(res.rows);
    setFilename(file.name);
    setHeaderMissing(res.headerMissing);
    if (res.detectedRunDate) setRunDate(res.detectedRunDate);
    if (res.headerMissing.length) {
      toast.error(`CSV missing columns: ${res.headerMissing.join(', ')}`);
    } else {
      toast.success(`Parsed ${res.rows.length} rows`);
    }
  };

  const clearStaging = () => {
    setParsed(null);
    setFilename(null);
    setNotes('');
    setHeaderMissing([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onSaveDraft = async () => {
    if (!parsed || parsed.length === 0) return;
    const usable = parsed.filter(r => r.brand && r.product_name);
    if (usable.length === 0) {
      toast.error('No rows with brand + product_name');
      return;
    }
    try {
      await importMut.mutateAsync({
        run_date: runDate,
        source_filename: filename,
        notes: notes || null,
        rows: usable,
      });
      toast.success(`Draft saved with ${usable.length} rows`);
      clearStaging();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Market Price Audit</h1>
        <p className="text-sm text-muted-foreground">
          Upload the monthly competitor pricing CSV. Exactly one run can be published at a time;
          publishing a new run unpublishes the prior one automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload new run</CardTitle>
          <CardDescription>
            Expected columns: <code>run_date, brand, product_name, product_url, bag_size_g,
            price_cad, price_per_g_cad, status, notes</code>. price_per_g_cad recomputes from
            price_cad ÷ bag_size_g if missing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="csv-file">CSV file</Label>
              <Input
                id="csv-file"
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="run-date">Run date</Label>
              <Input
                id="run-date"
                type="date"
                value={runDate}
                onChange={e => setRunDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 flex-1 min-w-[220px]">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. May 2026 monthly scan"
              />
            </div>
          </div>

          {headerMissing.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Missing required columns: {headerMissing.join(', ')}
            </div>
          )}

          {parsed && parsed.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <strong>{parsed.length}</strong> rows parsed —{' '}
                  <span className="text-green-700">{validCount} clean</span>,{' '}
                  <span className="text-amber-700">{parsed.length - validCount} with warnings</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={clearStaging}>Discard</Button>
                  <Button
                    onClick={onSaveDraft}
                    disabled={importMut.isPending || headerMissing.length > 0}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Save as draft
                  </Button>
                </div>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Brand</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Bag (g)</TableHead>
                      <TableHead className="text-right">Price CAD</TableHead>
                      <TableHead className="text-right">$/g</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Warnings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.brand || <em className="text-muted-foreground">missing</em>}</TableCell>
                        <TableCell>{r.product_name || <em className="text-muted-foreground">missing</em>}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.bag_size_g ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.price_cad?.toFixed(2) ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.price_per_g_cad?.toFixed(4) ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === 'ok' ? 'secondary' : 'outline'}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-amber-700 text-xs">
                          {(r.warnings ?? []).join('; ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing runs</CardTitle>
          <CardDescription>One published run is live at a time.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No runs yet.</div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run date</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.run_date}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.row_count}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.source_filename ? (
                          <span className="inline-flex items-center gap-1">
                            <FileText className="h-3 w-3" />{r.source_filename}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">{r.notes || '—'}</TableCell>
                      <TableCell>
                        {r.is_published ? (
                          <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Published</Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" /> Draft</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          {r.is_published ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => unpublishMut.mutate(r.id)}
                              disabled={unpublishMut.isPending}
                            >
                              Unpublish
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                onClick={() => publishMut.mutate(r.id)}
                                disabled={publishMut.isPending}
                              >
                                Publish
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="ghost"><Trash2 className="h-4 w-4" /></Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete draft run?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently remove the {r.row_count}-row draft for {r.run_date}.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteMut.mutate(r.id)}>Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
