import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ClipboardList } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ProductionFlowTab } from '@/components/dashboard/ProductionFlowTab';
import { GreenCoffeeTab } from '@/components/dashboard/GreenCoffeeTab';
import { CoRoastingTab } from '@/components/dashboard/CoRoastingTab';
import { AccountsTab } from '@/components/dashboard/AccountsTab';
import { FinanceTab } from '@/components/dashboard/FinanceTab';

type DashboardTab = 'production' | 'green' | 'coroast' | 'accounts' | 'finance';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('production');
  const { authUser } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="page-container">
      <div className="page-header flex items-center justify-between gap-4">
        <h1 className="page-title">Dashboard</h1>
        <Button
          onClick={() => navigate('/production')}
          className="gap-2 shadow-sm"
          size="lg"
        >
          <ClipboardList className="h-4 w-4" />
          Today's Run Sheet
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DashboardTab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="production">Production Flow</TabsTrigger>
          <TabsTrigger value="green">Green Coffee</TabsTrigger>
          <TabsTrigger value="coroast">Co-Roasting</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          {authUser?.role === 'ADMIN' && (
            <TabsTrigger value="finance">Finance</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="production">
          <ProductionFlowTab />
        </TabsContent>

        <TabsContent value="green">
          <GreenCoffeeTab enabled={activeTab === 'green'} />
        </TabsContent>

        <TabsContent value="coroast">
          <CoRoastingTab enabled={activeTab === 'coroast'} />
        </TabsContent>

        <TabsContent value="accounts">
          <AccountsTab enabled={activeTab === 'accounts'} />
        </TabsContent>

        {authUser?.role === 'ADMIN' && (
          <TabsContent value="finance">
            <FinanceTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
