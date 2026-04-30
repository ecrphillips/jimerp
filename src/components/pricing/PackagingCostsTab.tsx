import { useState } from 'react';
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

interface PackagingCost {
  id: string;
  bag_size_g: number;
  cost_per_bag: number;
  notes: string | null;
  updated_at: string;
}

export function PackagingCostsTab() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addBagSize, setAddBagSize] = useState('');
  const [addCost, setAddCost] = useState('');
  const [addNotes, setAddNotes] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBagSize, setEditBagSize] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['packaging_costs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaging_costs')
        .select('*')
        .order('bag_size_g', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PackagingCost[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const userResp = await supabase.auth.getUser();
      const userId = userResp.data.user?.id ?? null;
      const bagSize = parseInt(addBagSize, 10);
      const cost = Number(addCost);
      if (!Number.isFinite(bagSize) || bagSize <= 0) throw new Error('Bag size must be a positive integer');
      if (!Number.isFinite(cost) || cost < 0) throw new Error('Cost must be a non-negative number');
      const { error } = await supabase.from('packaging_costs').insert({
        bag_size_g: bagSize,
        cost_per_bag: cost,
        notes: addNotes.trim() || null,
        updated_by: userId,
      });
      if (error) {
        if ((error as any).code === '23505') {
          throw new Error(`A row for bag size ${bagSize}g already exists`);
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success('Bag size added');
      queryClient.invalidateQueries({ queryKey: ['packaging_costs'] });
      setAddOpen(false);
      setAddBagSize('');
      setAddCost('');
      setAddNotes('');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to add'),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editingId) return;
      const userResp = await supabase.auth.getUser();
      const userId = userResp.data.user?.id ?? null;
      const bagSize = parseInt(editBagSize, 10);
      const cost = Number(editCost);
      if (!Number.isFinite(bagSize) || bagSize <= 0) throw new Error('Bag size must be a positive integer');
      if (!Number.isFinite(cost) || cost < 0) throw new Error('Cost must be a non-negative number');
      const { error } = await supabase
        .from('packaging_costs')
        .update({
          bag_size_g: bagSize,
          cost_per_bag: cost,
          notes: editNotes.trim() || null,
          updated_by: userId,
        })
        .eq('id', editingId);
      if (error) {
        if ((error as any).code === '23505') {
          throw new Error(`A row for bag size ${bagSize}g already exists`);
        }
        throw error;
      }
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
    setEditBagSize(String(row.bag_size_g));
    setEditCost(String(row.cost_per_bag));
    setEditNotes(row.notes ?? '');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add bag size
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : (rows?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No packaging costs configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bag size (g)</TableHead>
                  <TableHead>Cost per bag (CAD)</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows!.map((row) => {
                  const isEditing = editingId === row.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editBagSize}
                            onChange={(e) => setEditBagSize(e.target.value)}
                            className="max-w-[120px]"
                          />
                        ) : (
                          row.bag_size_g
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.0001"
                            value={editCost}
                            onChange={(e) => setEditCost(e.target.value)}
                            className="max-w-[140px]"
                          />
                        ) : (
                          `$${Number(row.cost_per_bag).toFixed(4)}`
                        )}
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
          These costs are used as the default for any product with that bag
          size. To override for a specific product, edit the product directly
          and set its packaging cost override.
        </p>
      </div>

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add bag size</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="add-bag-size">Bag size (grams)</Label>
              <Input
                id="add-bag-size"
                type="number"
                value={addBagSize}
                onChange={(e) => setAddBagSize(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="add-cost">Cost per bag (CAD)</Label>
              <Input
                id="add-cost"
                type="number"
                step="0.0001"
                value={addCost}
                onChange={(e) => setAddCost(e.target.value)}
              />
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
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? 'Adding…' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
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
