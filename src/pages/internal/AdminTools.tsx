import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Trash2, Sparkles, RotateCcw, Bomb, Wand2 } from 'lucide-react';
import { GenericLaneConversion } from '@/components/admin/GenericLaneConversion';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { OrderNotificationSettings } from '@/components/admin/OrderNotificationSettings';
import { BuildInfoPanel } from '@/components/admin/BuildInfoPanel';
import { PackagingTypesManager } from '@/components/admin/PackagingTypesManager';
import { buildSku, getOriginCode, generateFgNameCode, formatGramsSuffix } from '@/lib/skuGenerator';

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

  // SKU Backfill state
  const [showBackfillModal, setShowBackfillModal] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);

  // Co-Roasting clear state
  const queryClient = useQueryClient();
  const [showClearCoroastModal, setShowClearCoroastModal] = useState(false);
  const [clearCoroastConfirmText, setClearCoroastConfirmText] = useState('');
  const [isClearingCoroast, setIsClearingCoroast] = useState(false);

  // Orphaned account_users cleanup state
  const [orphanEmail, setOrphanEmail] = useState('');
  const [isRemovingOrphan, setIsRemovingOrphan] = useState(false);

  const handleRemoveOrphanedAccountUsers = async () => {
    const email = orphanEmail.trim().toLowerCase();
    if (!email) {
      toast.error('Enter an email address');
      return;
    }
    setIsRemovingOrphan(true);
    try {
      // 1. Try profiles lookup
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .ilike('email', email)
        .maybeSingle();

      let userIds: string[] = [];
      if (profile?.user_id) {
        userIds = [profile.user_id];
      } else {
        // 2. Find account_users whose user_id has no profile row at all
        const { data: allAus } = await supabase
          .from('account_users')
          .select('user_id');
        const candidateIds = Array.from(new Set((allAus ?? []).map(r => r.user_id)));
        if (candidateIds.length > 0) {
          const { data: existingProfiles } = await supabase
            .from('profiles')
            .select('user_id')
            .in('user_id', candidateIds);
          const knownIds = new Set((existingProfiles ?? []).map(p => p.user_id));
          userIds = candidateIds.filter(id => !knownIds.has(id));
        }
        if (userIds.length === 0) {
          toast.error('No matching profile or orphaned account_users found for that email');
          return;
        }
      }

      // 3. Delete account_users rows for these user_ids
      const { data: deleted, error: delError } = await supabase
        .from('account_users')
        .delete()
        .in('user_id', userIds)
        .select('id');
      if (delError) throw delError;

      const count = deleted?.length ?? 0;
      if (count === 0) {
        toast.error('No account_users rows found to remove');
      } else {
        toast.success(`Removed ${count} account_user row${count === 1 ? '' : 's'}`);
        setOrphanEmail('');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove orphaned account users');
    } finally {
      setIsRemovingOrphan(false);
    }
  };

  // Query products missing SKUs
  const { data: productsNeedingSku = [] } = useQuery({
    queryKey: ['products-needing-sku'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name, account_id, bag_size_g, roast_group')
        .is('sku', null)
        .not('account_id', 'is', null);
      if (error) throw error;
      return data ?? [];
    },
  });

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

  const handleBackfillSkus = async () => {
    setIsBackfilling(true);
    try {
      // Fetch all accounts with account_code
      const { data: accounts } = await supabase.from('accounts').select('id, account_code');
      const accountMap = new Map((accounts ?? []).map(a => [a.id, a.account_code]));

      // Fetch existing SKUs for collision detection
      const { data: existingSkuRows } = await supabase.from('products').select('sku');
      const existingSkus = new Set((existingSkuRows ?? []).map(r => r.sku?.toUpperCase()).filter(Boolean));
      const existingFgCodes = new Set<string>();

      let generated = 0;
      let skipped = 0;

      for (const product of productsNeedingSku) {
        const accountCode = accountMap.get(product.account_id);
        if (!accountCode) {
          skipped++;
          continue;
        }

        // Get roast group origin
        let originCode = 'BLD';
        if (product.roast_group) {
          const { data: rg } = await supabase.from('roast_groups').select('origin, is_blend').eq('roast_group', product.roast_group).maybeSingle();
          if (rg && !rg.is_blend && rg.origin) {
            originCode = getOriginCode(rg.origin);
          }
        }

        const { code: fgCode } = generateFgNameCode(product.product_name || '', existingFgCodes);
        existingFgCodes.add(fgCode);
        const gramsSuffix = formatGramsSuffix(product.bag_size_g || 0);
        const sku = buildSku({ clientCode: accountCode, originCode, fgNameCode: fgCode, gramsSuffix });

        if (existingSkus.has(sku.toUpperCase())) {
          skipped++;
          continue;
        }

        const { error } = await supabase.from('products').update({ sku } as any).eq('id', product.id);
        if (error) {
          skipped++;
        } else {
          existingSkus.add(sku.toUpperCase());
          generated++;
        }
      }

      toast.success(`${generated} SKUs generated, ${skipped} skipped (missing account code or collision)`);
      setShowBackfillModal(false);
    } catch (err: any) {
      toast.error(err.message || 'Backfill failed');
    } finally {
      setIsBackfilling(false);
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

  const handleClearCoroastData = async () => {
    if (clearCoroastConfirmText !== 'CONFIRM') return;
    setIsClearingCoroast(true);
    try {
      const tables = [
        'coroast_invoices',
        'coroast_waiver_log',
        'coroast_storage_allocations',
        'coroast_hour_ledger',
        'coroast_bookings',
        'coroast_billing_periods',
        'coroast_member_notes',
        'coroast_members',
      ] as const;
      for (const table of tables) {
        const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
      }
      toast.success('Co-roasting data cleared');
      queryClient.invalidateQueries({ queryKey: ['coroast-billing-periods'] });
      queryClient.invalidateQueries({ queryKey: ['coroast-billing-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['coroast-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['bookings-week'] });
      queryClient.invalidateQueries({ queryKey: ['coroast-members-summary'] });
      queryClient.invalidateQueries({ queryKey: ['coroast-member-notes'] });
      queryClient.invalidateQueries({ queryKey: ['coroast-members'] });
      setShowClearCoroastModal(false);
      setClearCoroastConfirmText('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to clear co-roasting data');
    } finally {
      setIsClearingCoroast(false);
    }
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

      {/* Packaging Types Manager */}
      <PackagingTypesManager />

      {/* Order Submit Notifications */}
      <OrderNotificationSettings />

      {/* Data Maintenance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Data Maintenance</CardTitle>
          </div>
          <CardDescription>
            Tools for maintaining data integrity and backfilling missing values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-1">Backfill SKUs</p>
              <p>Generate SKUs for account-linked products that are missing them. Products linked to legacy clients are not affected.</p>
              <p className="mt-1 font-medium">{productsNeedingSku.length} product{productsNeedingSku.length !== 1 ? 's' : ''} missing SKUs.</p>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowBackfillModal(true)}
              disabled={productsNeedingSku.length === 0}
              className="gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Backfill SKUs
            </Button>
          </div>

          {/* Clear Co-Roasting Test Data */}
          <div className="border-t pt-4 space-y-4">
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-1">Clear Co-Roasting Test Data</p>
              <p>Delete all bookings, billing periods, hour ledger entries, invoices, storage allocations, and waiver logs. Member accounts and certifications are not affected.</p>
            </div>
            <Button
              variant="destructive"
              onClick={() => { setClearCoroastConfirmText(''); setShowClearCoroastModal(true); }}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Clear All Co-Roasting Data
            </Button>
          </div>

          {/* Remove Orphaned Account Users */}
          <div className="border-t pt-4 space-y-4">
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-1">Remove Orphaned Account Users</p>
              <p>Look up an email and delete its <code>account_users</code> link rows. If no profile exists, scans for <code>account_users</code> rows whose user has no profile record.</p>
              <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                ⚠️ Use this to clean up stuck invite records before re-inviting a user.
              </p>
            </div>
            <div className="flex gap-2 max-w-md">
              <Input
                type="email"
                placeholder="user@example.com"
                value={orphanEmail}
                onChange={(e) => setOrphanEmail(e.target.value)}
                disabled={isRemovingOrphan}
              />
              <Button
                variant="destructive"
                onClick={handleRemoveOrphanedAccountUsers}
                disabled={isRemovingOrphan || !orphanEmail.trim()}
                className="gap-2 shrink-0"
              >
                <Trash2 className="h-4 w-4" />
                {isRemovingOrphan ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generic Lane Conversion */}
      <GenericLaneConversion />

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

      {/* Backfill SKUs Confirmation Modal */}
      <Dialog open={showBackfillModal} onOpenChange={setShowBackfillModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              Backfill SKUs
            </DialogTitle>
            <DialogDescription>
              This will generate SKUs for {productsNeedingSku.length} product{productsNeedingSku.length !== 1 ? 's' : ''} linked to accounts. Products linked to legacy clients are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBackfillModal(false)} disabled={isBackfilling}>
              Cancel
            </Button>
            <Button onClick={handleBackfillSkus} disabled={isBackfilling}>
              {isBackfilling ? 'Backfilling…' : 'Confirm Backfill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Co-Roasting Data Confirmation */}
      <Dialog open={showClearCoroastModal} onOpenChange={setShowClearCoroastModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Clear All Co-Roasting Data?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete all bookings, billing periods, hour ledger entries, invoices, storage allocations, and waiver logs. Member accounts and certifications are not affected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="coroast-confirm">Type CONFIRM to proceed</Label>
            <Input
              id="coroast-confirm"
              value={clearCoroastConfirmText}
              onChange={e => setClearCoroastConfirmText(e.target.value)}
              placeholder="CONFIRM"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearCoroastModal(false)} disabled={isClearingCoroast}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearCoroastData}
              disabled={clearCoroastConfirmText !== 'CONFIRM' || isClearingCoroast}
            >
              {isClearingCoroast ? 'Clearing…' : 'Clear Co-Roasting Data'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
