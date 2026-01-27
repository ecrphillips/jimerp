import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { History, Calendar, CalendarClock } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';

interface AuditLogEntry {
  id: string;
  order_id: string;
  field_name: 'requested_ship_date' | 'work_deadline';
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  notes: string | null;
  profile?: {
    name: string;
    email: string;
  } | null;
}

interface OrderDateAuditHistoryProps {
  orderId: string;
}

export function OrderDateAuditHistory({ orderId }: OrderDateAuditHistoryProps) {
  const { data: auditLog, isLoading } = useQuery({
    queryKey: ['order-date-audit', orderId],
    queryFn: async () => {
      // Fetch audit log entries
      const { data: logEntries, error: logError } = await supabase
        .from('order_date_audit_log')
        .select('*')
        .eq('order_id', orderId)
        .order('changed_at', { ascending: false });

      if (logError) throw logError;
      
      // Fetch profiles for changed_by users
      const userIds = [...new Set((logEntries ?? []).map(e => e.changed_by).filter(Boolean))];
      let profileMap: Record<string, { name: string; email: string }> = {};
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name, email')
          .in('user_id', userIds);
        
        for (const p of profiles ?? []) {
          profileMap[p.user_id] = { name: p.name, email: p.email };
        }
      }
      
      // Map entries with profile info
      return (logEntries ?? []).map(entry => ({
        ...entry,
        profile: entry.changed_by ? profileMap[entry.changed_by] : null,
      })) as AuditLogEntry[];
    },
    enabled: !!orderId,
  });

  const formatDateValue = (value: string | null) => {
    if (!value) return '—';
    try {
      return format(new Date(value), 'MMM d, yyyy');
    } catch {
      return value;
    }
  };

  const getFieldIcon = (fieldName: string) => {
    return fieldName === 'work_deadline' ? CalendarClock : Calendar;
  };

  const getFieldLabel = (fieldName: string) => {
    return fieldName === 'work_deadline' ? 'Work Deadline' : 'Expected Ship Date';
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading history...</p>;
  }

  if (!auditLog || auditLog.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No date change history.</p>
    );
  }

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <History className="h-4 w-4" />
        <span>View date change history ({auditLog.length} changes)</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-2">
        {auditLog.map((entry) => {
          const Icon = getFieldIcon(entry.field_name);
          return (
            <div
              key={entry.id}
              className="flex items-start gap-3 p-2 bg-muted/30 rounded text-sm"
            >
              <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {getFieldLabel(entry.field_name)}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatDateValue(entry.old_value)}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium">
                    {formatDateValue(entry.new_value)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {entry.profile?.name || 'Unknown'} •{' '}
                  {format(new Date(entry.changed_at), 'MMM d, yyyy h:mm a')}
                </div>
                {entry.notes && (
                  <p className="text-xs text-muted-foreground mt-1 italic">
                    {entry.notes}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
