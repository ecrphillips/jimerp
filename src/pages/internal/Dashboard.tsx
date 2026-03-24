import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
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
