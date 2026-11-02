import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { getMemberColor, MEMBER_COLORS, TIER_RATES, type MemberRow, type BookingRow } from './bookingUtils';
import { useAccountsPricing } from '@/hooks/useAccountPricing';
import { todayInTz } from '@/lib/timezone';
import { formatCurrency } from '@/lib/currency';

interface MemberSummaryPanelProps {
  members: MemberRow[];
  bookings: BookingRow[];
  /** Current billing period month as YYYY-MM */
  currentMonth: string;
}

function getMonthBookings(bookings: BookingRow[], memberId: string, month: string) {
  return bookings.filter(
    b => b.account_id === memberId && b.booking_date.startsWith(month) && !['CANCELLED', 'CANCELLED_FREE', 'CANCELLED_CHARGED', 'CANCELLED_WAIVED', 'NO_SHOW'].includes(b.status)
  );
}

export function MemberSummaryPanel({ members, bookings, currentMonth }: MemberSummaryPanelProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  const canEditColor = role === 'ADMIN' || role === 'OPS';
  const setColor = async (accountId: string, idx: number) => {
    const { error } = await supabase.from('accounts').update({ coroast_color_index: idx }).eq('id', accountId);
    if (error) { toast.error('Could not change colour'); return; }
    qc.invalidateQueries({ queryKey: ['booking-calendar', 'members'] });
  };
  const activeMembers = members.filter(m => m.is_active);
  const today = todayInTz();
  const allMemberIds = members.map(m => m.id);
  const { data: pricingMap } = useAccountsPricing(allMemberIds);

  if (activeMembers.length === 0) return null;

  return (
    <ScrollArea className="w-full mb-4">
      <div className="flex gap-2 pb-2">
        {activeMembers.map(member => {
          const tierDefaults = TIER_RATES[member.tier] ?? TIER_RATES.MEMBER;
          const pricing = pricingMap?.get(member.id);
          const rates = {
            includedHours: pricing?.includedHours.value ?? tierDefaults.includedHours,
            overageRate: pricing?.overageRate.value ?? tierDefaults.overageRate,
          };
          const monthBookings = getMonthBookings(bookings, member.id, currentMonth);
          const hoursUsed = monthBookings
            .filter(b => b.booking_date < today || b.status === 'COMPLETED')
            .reduce((sum, b) => sum + (b.duration_hours ?? 0), 0);
          const hoursScheduled = monthBookings
            .filter(b => b.booking_date >= today && b.status !== 'COMPLETED')
            .reduce((sum, b) => sum + (b.duration_hours ?? 0), 0);
          const totalHours = hoursUsed + hoursScheduled;
          const hoursRemaining = Math.max(0, rates.includedHours - totalHours);
          const overageHours = Math.max(0, totalHours - rates.includedHours);
          const overageCharge = overageHours * rates.overageRate;
          const color = getMemberColor(member.id, members);

          return (
            <div
              role="button"
              tabIndex={0}
              key={member.id}
              onClick={() => navigate(`/accounts/${member.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/accounts/${member.id}`); }}
              className="flex items-start gap-2 rounded-md border p-2 text-xs min-w-[190px] max-w-[220px] shrink-0 text-left transition-colors hover:bg-accent hover:border-accent-foreground/20 cursor-pointer"
            >
              {canEditColor ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <span
                      role="button"
                      aria-label={`Change colour for ${member.business_name}`}
                      title="Change calendar colour"
                      onClick={e => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded-sm mt-0.5 flex-shrink-0 ring-1 ring-border hover:ring-2 hover:ring-ring cursor-pointer"
                      style={{ backgroundColor: color.bg }}
                    />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2" onClick={e => e.stopPropagation()}>
                    <div className="grid grid-cols-4 gap-1.5">
                      {MEMBER_COLORS.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          aria-label={`Colour ${i + 1}`}
                          onClick={() => setColor(member.id, i)}
                          className={`w-6 h-6 rounded ${member.color_index === i ? 'ring-2 ring-offset-1 ring-ring' : ''}`}
                          style={{ backgroundColor: c.bg }}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <div className="w-3 h-3 rounded-sm mt-0.5 flex-shrink-0" style={{ backgroundColor: color.bg }} />
              )}
              <div className="space-y-0.5 min-w-0">
                <div className="font-medium text-sm leading-tight truncate">{member.business_name}</div>
                <Badge variant="outline" className="text-[10px] px-1 py-0">{member.tier}</Badge>
                <div className="text-muted-foreground whitespace-nowrap">
                  {Number(hoursUsed).toFixed(1)}h used · {Number(hoursScheduled).toFixed(1)}h scheduled
                </div>
                {hoursRemaining > 0 ? (
                  <div className="text-muted-foreground">{hoursRemaining.toFixed(1)}h remaining</div>
                ) : (
                  <div className="text-destructive font-medium">
                    +{overageHours.toFixed(1)}h overage ({formatCurrency(overageCharge, { decimals: 0 })})
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
