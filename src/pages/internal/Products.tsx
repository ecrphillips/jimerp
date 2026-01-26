import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Package, Warehouse, Flame } from 'lucide-react';
import { ProductsListTab } from '@/components/products/ProductsListTab';
import { FGInventoryTab } from '@/components/products/FGInventoryTab';
import { RoastGroupsTab } from '@/components/products/RoastGroupsTab';

type TabView = 'products' | 'fg-inventory' | 'roast-groups';

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Read initial tab from URL param, default to 'products'
  const tabFromUrl = searchParams.get('tab') as TabView | null;
  const [activeTab, setActiveTab] = useState<TabView>(
    tabFromUrl && ['products', 'fg-inventory', 'roast-groups'].includes(tabFromUrl) 
      ? tabFromUrl 
      : 'products'
  );

  const handleTabChange = (tab: TabView) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Products</h1>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as TabView)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="products" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Products
          </TabsTrigger>
          <TabsTrigger value="fg-inventory" className="flex items-center gap-2">
            <Warehouse className="h-4 w-4" />
            FG Inventory
          </TabsTrigger>
          <TabsTrigger value="roast-groups" className="flex items-center gap-2">
            <Flame className="h-4 w-4" />
            Roast Groups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <ProductsListTab />
        </TabsContent>

        <TabsContent value="fg-inventory">
          <FGInventoryTab />
        </TabsContent>

        <TabsContent value="roast-groups">
          <RoastGroupsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
