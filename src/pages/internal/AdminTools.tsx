import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function AdminTools() {
  const navigate = useNavigate();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const canConfirm = confirmText === 'RESET' && understood;

  const handleReset = async () => {
    if (!canConfirm) return;
    
    setIsResetting(true);
    try {
      const { error } = await supabase.rpc('dev_test_reset');
      if (error) throw error;
      
      toast.success('Test data reset complete');
      setShowConfirmModal(false);
      setConfirmText('');
      setUnderstood(false);
      navigate('/orders');
    } catch (err: any) {
      console.error('Reset failed:', err);
      toast.error(err.message || 'Reset failed');
    } finally {
      setIsResetting(false);
    }
  };

  const openModal = () => {
    setConfirmText('');
    setUnderstood(false);
    setShowConfirmModal(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Tools</h1>
        <p className="text-muted-foreground">
          Administrative utilities for development and testing
        </p>
      </div>

      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg">Dev / Test Reset</CardTitle>
          </div>
          <CardDescription>
            Clears all orders and production state while preserving products, clients, and configuration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">This will delete:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>All orders and line items</li>
                <li>All roasted batches and packing runs</li>
                <li>All production checkmarks and plan items</li>
                <li>All andon picks and external demand</li>
                <li>All WIP and FG inventory records</li>
              </ul>
            </div>
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">This will NOT delete:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Clients, products, roast groups</li>
                <li>Board configuration</li>
                <li>Price lists</li>
                <li>Users and roles</li>
              </ul>
            </div>
            <Button 
              variant="destructive" 
              onClick={openModal}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Reset Test Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Modal */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirm Reset
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. All operational data will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-text">
                Type <span className="font-mono font-bold">RESET</span> to confirm
              </Label>
              <Input
                id="confirm-text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type RESET"
                className="font-mono"
              />
            </div>
            
            <div className="flex items-start gap-2">
              <Checkbox
                id="understood"
                checked={understood}
                onCheckedChange={(checked) => setUnderstood(checked === true)}
              />
              <Label htmlFor="understood" className="text-sm leading-relaxed cursor-pointer">
                I understand this deletes all test orders and production data
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowConfirmModal(false)}
              disabled={isResetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={!canConfirm || isResetting}
            >
              {isResetting ? 'Resetting...' : 'Confirm Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
