import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Clock, CheckCircle, Package } from 'lucide-react';

export default function Dashboard() {
  const { authUser } = useAuth();

  const stats = [
    { label: 'Submitted Orders', value: '0', icon: Clock, color: 'text-warning' },
    { label: 'In Production', value: '0', icon: Package, color: 'text-info' },
    { label: 'Ready to Ship', value: '0', icon: CheckCircle, color: 'text-success' },
    { label: 'Total Orders', value: '0', icon: ShoppingCart, color: 'text-primary' },
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
          <CardTitle>Recent Submitted Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No pending orders. Create demo data to get started.</p>
        </CardContent>
      </Card>
    </div>
  );
}
