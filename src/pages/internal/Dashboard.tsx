import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Flame, Package, Truck, FileCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function Dashboard() {
  const { authUser } = useAuth();

  // Fetch aggregated pressure metrics from orders
  const { data: pressureMetrics } = useQuery({
    queryKey: ['dashboard-pressure'],
    queryFn: async () => {
      // Orders needing roast (SUBMITTED, CONFIRMED - not yet roasted)
      const { count: roastQueue } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['SUBMITTED', 'CONFIRMED'])
        .eq('roasted', false);

      // Orders needing pack (roasted but not packed)
      const { count: packQueue } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['SUBMITTED', 'CONFIRMED', 'IN_PRODUCTION'])
        .eq('roasted', true)
        .eq('packed', false);

      // Orders ready to ship (packed, not shipped)
      const { count: shipQueue } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['CONFIRMED', 'IN_PRODUCTION', 'READY'])
        .eq('packed', true)
        .eq('shipped_or_ready', false);

      // Orders staged but not invoiced
      const { count: invoiceQueue } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['READY', 'SHIPPED'])
        .eq('invoiced', false);

      return {
        roastQueue: roastQueue ?? 0,
        packQueue: packQueue ?? 0,
        shipQueue: shipQueue ?? 0,
        invoiceQueue: invoiceQueue ?? 0,
      };
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const stats = [
    { label: 'Awaiting Roast', value: String(pressureMetrics?.roastQueue ?? 0), icon: Flame, color: 'text-orange-500' },
    { label: 'Awaiting Pack', value: String(pressureMetrics?.packQueue ?? 0), icon: Package, color: 'text-blue-500' },
    { label: 'Ready to Ship', value: String(pressureMetrics?.shipQueue ?? 0), icon: Truck, color: 'text-green-500' },
    { label: 'Awaiting Invoice', value: String(pressureMetrics?.invoiceQueue ?? 0), icon: FileCheck, color: 'text-purple-500' },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {authUser?.profile?.name || 'User'}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Production Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            This dashboard shows aggregated pressure by station. Use the Production page to manage work priorities.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            All prioritization is driven by <strong>work_deadline</strong>, not customer-entered ship dates.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
