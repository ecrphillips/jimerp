import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { getMemberColor, TIER_RATES, type MemberRow, type BookingRow } from './bookingUtils';

interface MemberSummaryPanelProps {
  members: MemberRow[];
  bookings: BookingRow[];
  /** Current billing period month as YYYY-MM */
  currentMonth: string;
}

function getMonthBookings(bookings: BookingRow[], memberId: string, month: string) {
  return bookings.filter(
    b => b.member_id === memberId && b.booking_date.startsWith(month) && b.status !== 'CANCELLED'
  );
}

export function MemberSummaryPanel({ members, bookings, currentMonth }: MemberSummaryPanelProps) {
  const navigate = useNavigate();
  const activeMembers = members.filter(m => m.is_active);
  if (activeMembers.length === 0) return null;

  const today = new Date().toISOString().split('T')[0];
  const allMemberIds = members.map(m => m.id);

  return (
    <ScrollArea className="w-full mb-4">
      <div className="flex gap-2 pb-2">
        {activeMembers.map(member => {
          const rates = TIER_RATES[member.tier] ?? TIER_RATES.MEMBER;
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
          const color = getMemberColor(member.id, allMemberIds);

          return (
            <button
              key={member.id}
              onClick={() => navigate(`/co-roasting/members/${member.id}`)}
              className="flex items-start gap-2 rounded-md border p-2 text-xs min-w-[190px] max-w-[220px] shrink-0 text-left transition-colors hover:bg-accent hover:border-accent-foreground/20 cursor-pointer"
            >
              <div
                className="w-3 h-3 rounded-sm mt-0.5 flex-shrink-0"
                style={{ backgroundColor: color.bg }}
              />
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
                    +{overageHours.toFixed(1)}h overage (${overageCharge.toFixed(0)})
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
