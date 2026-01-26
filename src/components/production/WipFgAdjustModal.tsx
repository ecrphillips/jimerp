import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Minus, Plus } from 'lucide-react';

interface WipFgAdjustModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roastGroup: string;
  currentWipKg: number;
  currentFgKg: number;
}

export function WipFgAdjustModal({
  open,
  onOpenChange,
  roastGroup,
  currentWipKg,
  currentFgKg,
}: WipFgAdjustModalProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [wipKg, setWipKg] = useState(currentWipKg.toString());
  const [fgKg, setFgKg] = useState(currentFgKg.toString());
  
  // Sync when props change
  useEffect(() => {
    if (open) {
      setWipKg(currentWipKg.toString());
      setFgKg(currentFgKg.toString());
    }
  }, [open, currentWipKg, currentFgKg]);
  
  const upsertMutation = useMutation({
    mutationFn: async () => {
      const wipValue = parseFloat(wipKg) || 0;
      const fgValue = parseFloat(fgKg) || 0;
      
      const { error } = await supabase
        .from('roast_group_inventory_levels')
        .upsert({
          roast_group: roastGroup,
          wip_kg: wipValue,
          fg_kg: fgValue,
          updated_by: user?.id,
        }, {
          onConflict: 'roast_group',
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Inventory levels updated for ${roastGroup}`);
      queryClient.invalidateQueries({ queryKey: ['roast-group-inventory-levels'] });
      onOpenChange(false);
    },
    onError: (err) => {
      console.error(err);
      toast.error('Failed to update inventory levels');
    },
  });
  
  const adjustWip = (delta: number) => {
    const current = parseFloat(wipKg) || 0;
    setWipKg(Math.max(0, current + delta).toFixed(1));
  };
  
  const adjustFg = (delta: number) => {
    const current = parseFloat(fgKg) || 0;
    setFgKg(Math.max(0, current + delta).toFixed(1));
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust WIP / FG for {roastGroup}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="wipKg">WIP (unpacked roasted coffee) kg</Label>
            <div className="flex items-center gap-2 mt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustWip(-1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <Input
                id="wipKg"
                type="number"
                step="0.1"
                min="0"
                value={wipKg}
                onChange={(e) => setWipKg(e.target.value)}
                className="text-center"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustWip(1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Roasted coffee not yet packed (from previous production runs).
            </p>
          </div>
          
          <div>
            <Label htmlFor="fgKg">FG (finished goods) kg</Label>
            <div className="flex items-center gap-2 mt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustFg(-1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <Input
                id="fgKg"
                type="number"
                step="0.1"
                min="0"
                value={fgKg}
                onChange={(e) => setFgKg(e.target.value)}
                className="text-center"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustFg(1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Packed inventory available for shipping.
            </p>
          </div>
          
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => upsertMutation.mutate()}
              disabled={upsertMutation.isPending}
            >
              {upsertMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
