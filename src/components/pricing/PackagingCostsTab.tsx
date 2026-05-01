import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
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
import { Plus, Pencil, Trash2, Check, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  PACKAGING_OPTIONS,
  type PackagingVariant,
} from '@/components/PackagingBadge';

interface PackagingCost {
  id: string;
  packaging_variant: PackagingVariant;
  material_cost_per_unit: number;
  labour_cost_per_unit: number;
  notes: string | null;
  updated_at: string;
}

const VARIANT_LABEL: Record<PackagingVariant, string> = Object.fromEntries(
  PACKAGING_OPTIONS.map((o) => [o.value, o.label]),
) as Record<PackagingVariant, string>;

const VARIANT_ORDER: Record<PackagingVariant, number> = Object.fromEntries(
  PACKAGING_OPTIONS.map((o, i) => [o.value, i]),
) as Record<PackagingVariant, number>;

function fmt4(n: number): string {
  return `$${Number(n).toFixed(4)}`;
}

export function PackagingCostsTab() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addVariant, setAddVariant] = useState<PackagingVariant | ''>('');
  const [addMaterial, setAddMaterial] = useState('');
  const [addLabour, setAddLabour] = useState('');
  const [addNotes, setAddNotes] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMaterial, setEditMaterial] = useState('');
  const [editLabour, setEditLabour] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['packaging_costs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaging_costs')
        .select('*');
      if (error) throw error;
      const list = (data ?? []) as unknown as PackagingCost[];
      return list.slice().sort(
        (a, b) =>
          (VARIANT_ORDER[a.packaging_variant] ?? 999) -
          (VARIANT_ORDER[b.packaging_variant] ?? 999),
      );
    },
  });

  const usedVariants = useMemo(
    () => new Set((rows ?? []).map((r) => r.packaging_variant)),
    [rows],
  );

  const availableVariants = useMemo(
    () => PACKAGING_OPTIONS.filter((o) => !usedVariants.has(o.value)),
    [usedVariants],
  );

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!addVariant) throw new Error('Pick a packaging variant');
      const material = Number(addMaterial);
      const labour = Number(addLabour);
      if (!Number.isFinite(material) || material < 0)
        throw new Error('Material cost must be a non-negative number');
      if (!Number.isFinite(labour) || labour < 0)
        throw new Error('Labour cost must be a non-negative number');
      const userResp = await supabase.auth.getUser();
      const userId = userResp.data.user?.id ?? null;
      const { error } = await (supabase.from('packaging_costs') as any).insert({
        packaging_variant: addVariant,
        material_cost_per_unit: material,
        labour_cost_per_unit: labour,
        notes: addNotes.trim() || null,
        updated_by: userId,
      });
      if (error) {
        if ((error as any).code === '23505') {
          throw new Error(
            `${VARIANT_LABEL[addVariant as PackagingVariant]} is already configured`,
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success('Packaging variant added');
      queryClient.invalidateQueries({ queryKey: ['packaging_costs'] });
      setAddOpen(false);
      setAddVariant('');
      setAddMaterial('');
      setAddLabour('');
      setAddNotes('');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to add'),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingId) return;
      const material = Number(editMaterial);
      const labour = Number(editLabour);
      if (!Number.isFinite(material) || material < 0)
        throw new Error('Material cost must be a non-negative number');
      if (!Number.isFinite(labour) || labour < 0)
        throw new Error('Labour cost must be a non-negative number');
      const userResp = await supabase.auth.getUser();
      const userId = userResp.data.user?.id ?? null;
      const { error } = await (supabase.from('packaging_costs') as any)
        .update({
          material_cost_per_unit: material,
          labour_cost_per_unit: labour,
          notes: editNotes.trim() || null,
          updated_by: userId,
        })
        .eq('id', editingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['packaging_costs'] });
      setEditingId(null);
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteId) return;
      const { error } = await supabase
        .from('packaging_costs')
        .delete()
        .eq('id', deleteId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Deleted');
      queryClient.invalidateQueries({ queryKey: ['packaging_costs'] });
      setDeleteId(null);
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to delete'),
  });

  const startEdit = (row: PackagingCost) => {
    setEditingId(row.id);
    setEditMaterial(String(row.material_cost_per_unit));
    setEditLabour(String(row.labour_cost_per_unit));
    setEditNotes(row.notes ?? '');
  };

  // live total in edit mode
  const editTotalLive = useMemo(() => {
    const m = Number(editMaterial);
    const l = Number(editLabour);
    return (Number.isFinite(m) ? m : 0) + (Number.isFinite(l) ? l : 0);
  }, [editMaterial, editLabour]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          onClick={() => setAddOpen(true)}
          disabled={availableVariants.length === 0}
        >
          <Plus className="h-4 w-4 mr-1" /> Add packaging variant
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Loading…
            </p>
          ) : (rows?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No packaging costs configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Packaging variant</TableHead>
                  <TableHead>Material / unit (CAD)</TableHead>
                  <TableHead>Labour / unit (CAD)</TableHead>
                  <TableHead>Total / unit (CAD)</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows!.map((row) => {
                  const isEditing = editingId === row.id;
                  const total = isEditing
                    ? editTotalLive
                    : Number(row.material_cost_per_unit) + Number(row.labour_cost_per_unit);
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        {VARIANT_LABEL[row.packaging_variant] ??
                          row.packaging_variant}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.0001"
                            value={editMaterial}
                            onChange={(e) => setEditMaterial(e.target.value)}
                            className="max-w-[140px]"
                          />
                        ) : (
                          fmt4(row.material_cost_per_unit)
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.0001"
                            value={editLabour}
                            onChange={(e) => setEditLabour(e.target.value)}
                            className="max-w-[140px]"
                          />
                        ) : (
                          fmt4(row.labour_cost_per_unit)
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {fmt4(total)}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                          />
                        ) : (
                          row.notes ?? '—'
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.updated_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => editMutation.mutate()}
                              disabled={editMutation.isPending}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => startEdit(row)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteId(row.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          These are the defaults for each packaging variant. Material covers
          what we supply (bag, labels, etc.); labour covers the cost to pack.
          Either can be overridden per product — set the material override to
          reflect what we contribute (a label only, no bag, etc.) and the
          labour override to reflect non-standard pack effort.
        </p>
      </div>

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add packaging variant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="add-variant">Packaging variant</Label>
              <Select
                value={addVariant}
                onValueChange={(v) => setAddVariant(v as PackagingVariant)}
              >
                <SelectTrigger id="add-variant">
                  <SelectValue placeholder="Select packaging variant" />
                </SelectTrigger>
                <SelectContent>
                  {availableVariants.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="add-material">Material cost / unit (CAD)</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="add-material"
                  type="number"
                  step="0.0001"
                  value={addMaterial}
                  onChange={(e) => setAddMaterial(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Cost of bag, labels, and any other materials we supply.
              </p>
            </div>
            <div>
              <Label htmlFor="add-labour">Labour cost / unit (CAD)</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="add-labour"
                  type="number"
                  step="0.0001"
                  value={addLabour}
                  onChange={(e) => setAddLabour(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Cost of the labour to fill, seal, and label this packaging.
                Reflects pack complexity — small bags cost more labour per
                unit than bulk.
              </p>
            </div>
            <div>
              <Label htmlFor="add-notes">Notes (optional)</Label>
              <Input
                id="add-notes"
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !addVariant}
            >
              {addMutation.isPending ? 'Adding…' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this packaging cost?</AlertDialogTitle>
            <AlertDialogDescription>
              Products that rely on this default will need a per-product
              override or a replacement entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
