import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DefaultsTab } from '@/components/pricing/DefaultsTab';
import { PackagingCostsTab } from '@/components/pricing/PackagingCostsTab';
import { CalculatorTab } from '@/components/pricing/CalculatorTab';

export default function PricingAdmin() {
  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Pricing rule profiles, packaging costs, and calculator.
        </p>
      </div>

      <Tabs defaultValue="defaults" className="space-y-4">
        <TabsList>
          <TabsTrigger value="defaults">Profiles</TabsTrigger>
          <TabsTrigger value="packaging">Packaging Costs</TabsTrigger>
          <TabsTrigger value="calculator">Calculator</TabsTrigger>
        </TabsList>

        <TabsContent value="defaults">
          <DefaultsTab />
        </TabsContent>

        <TabsContent value="packaging">
          <PackagingCostsTab />
        </TabsContent>

        <TabsContent value="calculator">
          <CalculatorTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
