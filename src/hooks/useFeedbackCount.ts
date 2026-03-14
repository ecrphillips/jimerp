import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useFeedbackCount() {
  const { authUser } = useAuth();
  const isAdmin = authUser?.role === 'ADMIN';

  const { data: count = 0 } = useQuery({
    queryKey: ['feedback-new-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('feedback_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'NEW');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: isAdmin,
    staleTime: 60000,
  });
  return isAdmin ? count : 0;
}
