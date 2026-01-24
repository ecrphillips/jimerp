import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Trash2, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function AdminTools() {
  const navigate = useNavigate();
  
  // Reset state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetUnderstood, setResetUnderstood] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Seed state
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [seedUnderstood, setSeedUnderstood] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  const canConfirmReset = resetConfirmText === 'RESET' && resetUnderstood;

  const handleReset = async () => {
    if (!canConfirmReset) return;
    
    setIsResetting(true);
    try {
      const { error } = await supabase.rpc('dev_test_reset');
      if (error) throw error;
      
      toast.success('Test data reset complete');
      setShowResetModal(false);
      setResetConfirmText('');
      setResetUnderstood(false);
      navigate('/orders');
    } catch (err: any) {
      console.error('Reset failed:', err);
      toast.error(err.message || 'Reset failed');
    } finally {
      setIsResetting(false);
    }
  };

  const handleSeed = async () => {
    if (!seedUnderstood) return;
    
    setIsSeeding(true);
    try {
      const { error } = await supabase.rpc('dev_test_seed_minimal');
      if (error) throw error;
      
      toast.success('Seeded minimal test day');
      setShowSeedModal(false);
      setSeedUnderstood(false);
      navigate('/production?tab=roast');
    } catch (err: any) {
      console.error('Seed failed:', err);
      toast.error(err.message || 'Seed failed');
    } finally {
      setIsSeeding(false);
    }
  };

  const openResetModal = () => {
    setResetConfirmText('');
    setResetUnderstood(false);
    setShowResetModal(true);
  };

  const openSeedModal = () => {
    setSeedUnderstood(false);
    setShowSeedModal(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Tools</h1>
        <p className="text-muted-foreground">
          Administrative utilities for development and testing
        </p>
      </div>

      {/* Dev/Test Reset Card */}
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
              onClick={openResetModal}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Reset Test Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Seed Minimal Test Day Card */}
      <Card className="border-primary/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Seed Minimal Test Day</CardTitle>
          </div>
          <CardDescription>
            Creates sample clients/products/roast mapping and a few orders for today & tomorrow. Andon demand remains board-driven.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">This will create:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Clients: Mah, Nelson, Oldhand (+ ensures MAT/FUN/NSM exist)</li>
                <li>Roast groups with realistic batch sizes</li>
                <li>Products with 300g and 5lb variants</li>
                <li>9 orders (3 per client) for today & tomorrow</li>
                <li>Price list entries for all products</li>
              </ul>
            </div>
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">Andon boards (Matchstick/Funk/No Smoke):</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>No orders created — demand via boards only</li>
              </ul>
            </div>
            <Button 
              variant="default" 
              onClick={openSeedModal}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Seed Test Day
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reset Confirmation Modal */}
      <Dialog open={showResetModal} onOpenChange={setShowResetModal}>
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
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="Type RESET"
                className="font-mono"
              />
            </div>
            
            <div className="flex items-start gap-2">
              <Checkbox
                id="reset-understood"
                checked={resetUnderstood}
                onCheckedChange={(checked) => setResetUnderstood(checked === true)}
              />
              <Label htmlFor="reset-understood" className="text-sm leading-relaxed cursor-pointer">
                I understand this deletes all test orders and production data
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowResetModal(false)}
              disabled={isResetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={!canConfirmReset || isResetting}
            >
              {isResetting ? 'Resetting...' : 'Confirm Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Seed Confirmation Modal (lighter) */}
      <Dialog open={showSeedModal} onOpenChange={setShowSeedModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Seed Test Day
            </DialogTitle>
            <DialogDescription>
              This will create demo clients, products, roast groups, and orders for testing.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-2">
              <Checkbox
                id="seed-understood"
                checked={seedUnderstood}
                onCheckedChange={(checked) => setSeedUnderstood(checked === true)}
              />
              <Label htmlFor="seed-understood" className="text-sm leading-relaxed cursor-pointer">
                I understand this writes demo data
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowSeedModal(false)}
              disabled={isSeeding}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSeed}
              disabled={!seedUnderstood || isSeeding}
            >
              {isSeeding ? 'Seeding...' : 'Confirm Seed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
