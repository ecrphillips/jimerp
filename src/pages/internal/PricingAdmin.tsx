import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PricingSheetTab } from '@/components/pricing/PricingSheetTab';
import { AssumptionsTab } from '@/components/pricing/AssumptionsTab';
import { PackagingCostsTab } from '@/components/pricing/PackagingCostsTab';

export default function PricingAdmin() {
  return (
    <div className="pricing-sheet container mx-auto p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Build a price from its cost floor up. Every rate is visible and editable.
        </p>
      </div>

      <Tabs defaultValue="sheet" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sheet">Sheet</TabsTrigger>
          <TabsTrigger value="assumptions">Assumptions</TabsTrigger>
          <TabsTrigger value="packaging">Packaging Costs</TabsTrigger>
        </TabsList>

        <TabsContent value="sheet">
          <PricingSheetTab />
        </TabsContent>

        <TabsContent value="assumptions">
          <AssumptionsTab />
        </TabsContent>

        <TabsContent value="packaging">
          <PackagingCostsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
