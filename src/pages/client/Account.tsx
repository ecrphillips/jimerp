import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

export default function Account() {
  const { authUser } = useAuth();
  
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Account</h1>
      </div>
      <Card>
        <CardHeader><CardTitle>Your Information</CardTitle></CardHeader>
        <CardContent>
          <p><strong>Name:</strong> {authUser?.profile?.name || 'N/A'}</p>
          <p><strong>Email:</strong> {authUser?.email || 'N/A'}</p>
        </CardContent>
      </Card>
    </div>
  );
}
