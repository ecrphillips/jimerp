import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useFeedbackCount() {
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
    staleTime: 60000,
  });
  return count;
}
