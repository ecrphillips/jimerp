import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Trash2, Sparkles, RotateCcw, Bomb } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OrderNotificationSettings } from '@/components/admin/OrderNotificationSettings';
import { BuildInfoPanel } from '@/components/admin/BuildInfoPanel';

// Check if we're in development mode
const isDev = import.meta.env.DEV;

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

  // Reset Test Day state (dev only)
  const [showResetTestDayModal, setShowResetTestDayModal] = useState(false);
  const [resetTestDayUnderstood, setResetTestDayUnderstood] = useState(false);
  const [isResettingTestDay, setIsResettingTestDay] = useState(false);

  // Reset Master Data state (dev only - nuclear option)
  const [showResetMasterModal, setShowResetMasterModal] = useState(false);
  const [resetMasterConfirmText, setResetMasterConfirmText] = useState('');
  const [resetMasterUnderstood, setResetMasterUnderstood] = useState(false);
  const [isResettingMaster, setIsResettingMaster] = useState(false);

  const canConfirmReset = resetConfirmText === 'RESET' && resetUnderstood;
  const canConfirmResetMaster = resetMasterConfirmText === 'NUKE' && resetMasterUnderstood;

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

  const handleResetTestDay = async () => {
    if (!resetTestDayUnderstood) return;
    
    setIsResettingTestDay(true);
    try {
      const { data, error } = await supabase.rpc('dev_reset_test_day');
      if (error) throw error;
      
      const counts = data as Record<string, number>;
      const totalCleared = Object.values(counts).reduce((sum, count) => sum + count, 0);
      
      toast.success(
        `Test day reset complete. Cleared ${totalCleared} rows: ` +
        `${counts.orders} orders, ${counts.order_line_items} line items, ` +
        `${counts.roasted_batches} batches, ${counts.packing_runs} packing runs, ` +
        `${counts.inventory_transactions} inventory txns`
      );
      
      setShowResetTestDayModal(false);
      setResetTestDayUnderstood(false);
      navigate('/production?tab=roast');
    } catch (err: any) {
      console.error('Reset test day failed:', err);
      toast.error(err.message || 'Reset test day failed');
    } finally {
      setIsResettingTestDay(false);
    }
  };

  const handleResetMasterData = async () => {
    if (!canConfirmResetMaster) return;
    
    setIsResettingMaster(true);
    try {
      const { data, error } = await supabase.rpc('dev_reset_master_data');
      if (error) throw error;
      
      toast.success('Master data reset complete. All clients, products, and roast groups cleared.');
      
      setShowResetMasterModal(false);
      setResetMasterConfirmText('');
      setResetMasterUnderstood(false);
      navigate('/clients');
    } catch (err: any) {
      console.error('Reset master data failed:', err);
      toast.error(err.message || 'Reset master data failed');
    } finally {
      setIsResettingMaster(false);
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

      {/* Build Info Panel - DEV diagnostics */}
      <BuildInfoPanel />

      {/* Order Submit Notifications */}
      <OrderNotificationSettings />

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

      {/* DEV ONLY: Reset Test Day Card */}
      {isDev && (
        <>
          <Card className="border-orange-500/50 bg-orange-500/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-orange-500" />
                <CardTitle className="text-lg">Reset Test Day (DEV ONLY)</CardTitle>
              </div>
              <CardDescription>
                Complete reset of all transactional data. Returns inventory to zero state. Hidden in production.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-2">This will delete (in FK-safe order):</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>All inventory_transactions (the ledger)</li>
                    <li>All ship_picks, packing_runs, roasted_batches</li>
                    <li>All order_line_items and orders (admin-created)</li>
                    <li>All production checkmarks and plan items</li>
                    <li>All andon picks and external demand</li>
                  </ul>
                </div>
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-2">Preserves:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Clients, products, roast groups</li>
                    <li>Board configuration (source_board_products)</li>
                    <li>Price lists, users, roles</li>
                  </ul>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setResetTestDayUnderstood(false);
                    setShowResetTestDayModal(true);
                  }}
                  className="gap-2 border-orange-500 text-orange-600 hover:bg-orange-500/10"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset Test Day
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* DEV ONLY: Nuclear Reset - Clear ALL Master Data */}
          <Card className="border-red-600/50 bg-red-500/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bomb className="h-5 w-5 text-red-600" />
                <CardTitle className="text-lg">Reset Master Data (DEV ONLY)</CardTitle>
              </div>
              <CardDescription>
                <span className="font-bold text-red-600">NUCLEAR OPTION:</span> Clears ALL clients, products, roast groups, and their dependencies. Use to start fresh with real-world data entry.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-2">This will DELETE:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>All clients and client locations</li>
                    <li>All products and price lists</li>
                    <li>All roast groups and inventory levels</li>
                    <li>All orders, batches, packing runs</li>
                    <li>All board configurations</li>
                    <li>All green coffee lots</li>
                  </ul>
                </div>
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-2">Preserves:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Schema, enums, constraints</li>
                    <li>Auth users and roles</li>
                  </ul>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setResetMasterConfirmText('');
                    setResetMasterUnderstood(false);
                    setShowResetMasterModal(true);
                  }}
                  className="gap-2 border-red-600 text-red-600 hover:bg-red-600/10"
                >
                  <Bomb className="h-4 w-4" />
                  Reset Master Data
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

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

      {/* Reset Test Day Confirmation Modal (dev only) */}
      <Dialog open={showResetTestDayModal} onOpenChange={setShowResetTestDayModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <RotateCcw className="h-5 w-5" />
              Reset Test Day
            </DialogTitle>
            <DialogDescription>
              This will clear all transactional data and reset inventory to zero. Returns row counts when complete.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-2">
              <Checkbox
                id="reset-test-day-understood"
                checked={resetTestDayUnderstood}
                onCheckedChange={(checked) => setResetTestDayUnderstood(checked === true)}
              />
              <Label htmlFor="reset-test-day-understood" className="text-sm leading-relaxed cursor-pointer">
                I understand this clears all orders, batches, and inventory transactions
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowResetTestDayModal(false)}
              disabled={isResettingTestDay}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleResetTestDay}
              disabled={!resetTestDayUnderstood || isResettingTestDay}
              className="border-orange-500 text-orange-600 hover:bg-orange-500/10"
            >
              {isResettingTestDay ? 'Resetting...' : 'Confirm Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Master Data Confirmation Modal (dev only - nuclear) */}
      <Dialog open={showResetMasterModal} onOpenChange={setShowResetMasterModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Bomb className="h-5 w-5" />
              Reset All Master Data
            </DialogTitle>
            <DialogDescription>
              <span className="font-bold">This is the nuclear option.</span> All clients, products, roast groups, and their data will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-nuke-text">
                Type <span className="font-mono font-bold">NUKE</span> to confirm
              </Label>
              <Input
                id="confirm-nuke-text"
                value={resetMasterConfirmText}
                onChange={(e) => setResetMasterConfirmText(e.target.value)}
                placeholder="Type NUKE"
                className="font-mono"
              />
            </div>
            
            <div className="flex items-start gap-2">
              <Checkbox
                id="reset-master-understood"
                checked={resetMasterUnderstood}
                onCheckedChange={(checked) => setResetMasterUnderstood(checked === true)}
              />
              <Label htmlFor="reset-master-understood" className="text-sm leading-relaxed cursor-pointer">
                I understand this deletes ALL clients, products, roast groups, and starts fresh
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowResetMasterModal(false)}
              disabled={isResettingMaster}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetMasterData}
              disabled={!canConfirmResetMaster || isResettingMaster}
            >
              {isResettingMaster ? 'Resetting...' : 'Confirm Nuclear Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
