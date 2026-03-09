import { Badge } from '@/components/ui/badge';
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
  const activeMembers = members.filter(m => m.is_active);
  if (activeMembers.length === 0) return null;

  const allMemberIds = members.map(m => m.id);

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {activeMembers.map(member => {
        const rates = TIER_RATES[member.tier] ?? TIER_RATES.ACCESS;
        const monthBookings = getMonthBookings(bookings, member.id, currentMonth);
        const hoursUsed = monthBookings.reduce((sum, b) => sum + (b.duration_hours ?? 0), 0);
        const hoursRemaining = Math.max(0, rates.includedHours - hoursUsed);
        const overageHours = Math.max(0, hoursUsed - rates.includedHours);
        const overageCharge = overageHours * rates.overageRate;
        const color = getMemberColor(member.id, allMemberIds);

        return (
          <div
            key={member.id}
            className="flex items-start gap-2 rounded-md border p-2 text-xs min-w-[180px]"
          >
            <div
              className="w-3 h-3 rounded-sm mt-0.5 flex-shrink-0"
              style={{ backgroundColor: color.bg }}
            />
            <div className="space-y-0.5">
              <div className="font-medium text-sm leading-tight">{member.business_name}</div>
              <Badge variant="outline" className="text-[10px] px-1 py-0">{member.tier}</Badge>
              <div className="text-muted-foreground">
                {Number(hoursUsed).toFixed(1)}h used / {rates.includedHours}h included
              </div>
              {hoursRemaining > 0 ? (
                <div className="text-muted-foreground">{hoursRemaining.toFixed(1)}h remaining</div>
              ) : (
                <div className="text-destructive font-medium">
                  +{overageHours.toFixed(1)}h overage (${overageCharge.toFixed(0)})
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
