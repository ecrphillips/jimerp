import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface OrderNotification {
  id: string;
  order_id: string;
  client_name: string;
  order_number: string;
  work_deadline: string | null;
  created_at: string;
}

/**
 * Hook that subscribes to real-time order notifications.
 * Shows toast to OPS/ADMIN users when new orders are submitted.
 */
export function useOrderNotifications() {
  const { authUser } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    // Only subscribe for OPS and ADMIN users
    if (!authUser || (authUser.role !== 'OPS' && authUser.role !== 'ADMIN')) {
      return;
    }

    console.log('[useOrderNotifications] Subscribing to order notifications');

    const channel = supabase
      .channel('order-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_notifications',
        },
        (payload) => {
          const notification = payload.new as OrderNotification;
          console.log('[useOrderNotifications] New notification:', notification);
          
          // Show toast with action to view order
          toast.info(
            `New order submitted by ${notification.client_name}`,
            {
              description: `Order ${notification.order_number}`,
              duration: 10000,
              action: {
                label: 'View',
                onClick: () => navigate(`/orders/${notification.order_id}`),
              },
            }
          );
        }
      )
      .subscribe((status) => {
        console.log('[useOrderNotifications] Subscription status:', status);
      });

    return () => {
      console.log('[useOrderNotifications] Unsubscribing');
      supabase.removeChannel(channel);
    };
  }, [authUser, navigate]);
}
