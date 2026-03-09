import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { format, addDays } from 'date-fns';

interface LineItem {
  name: string;
  qty: string;
  rate: string;
  amount: string;
}

interface QuickBooksInstructionsModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  memberName: string;
  memberEmail: string | null;
  tier: string;
  periodEnd: string;
  baseFee: number;
  overageHours: number;
  overageRate: number;
  overageCharge: number;
  paidPallets: number;
  palletRate: number;
  storageCharge: number;
  subtotal: number;
  gst: number;
  grandTotal: number;
}

export default function QuickBooksInstructionsModal({
  open,
  onClose,
  onConfirm,
  isPending,
  memberName,
  memberEmail,
  tier,
  periodEnd,
  baseFee,
  overageHours,
  overageRate,
  overageCharge,
  paidPallets,
  palletRate,
  storageCharge,
  subtotal,
  gst,
  grandTotal,
}: QuickBooksInstructionsModalProps) {
  const tierLabel = tier === 'GROWTH' ? 'Growth' : 'Access';
  const invoiceDate = periodEnd;
  const dueDate = format(addDays(new Date(`${periodEnd}T00:00:00`), 15), 'yyyy-MM-dd');

  const lineItems: LineItem[] = [
    {
      name: `Co-Roasting — Membership (${tierLabel})`,
      qty: '1',
      rate: `$${baseFee.toLocaleString()}`,
      amount: `$${baseFee.toLocaleString()}`,
    },
  ];

  if (overageHours > 0) {
    lineItems.push({
      name: `Co-Roasting — Roast Hours Overage (${tierLabel})`,
      qty: overageHours.toFixed(1),
      rate: `$${overageRate}`,
      amount: `$${overageCharge.toFixed(2)}`,
    });
  }

  if (paidPallets > 0) {
    const storageLabel =
      tier === 'GROWTH'
        ? `Co-Roasting — Pallet Storage (Growth, additional)`
        : `Co-Roasting — Pallet Storage (Access)`;
    lineItems.push({
      name: storageLabel,
      qty: String(paidPallets),
      rate: `$${palletRate}`,
      amount: `$${storageCharge.toFixed(2)}`,
    });
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>QuickBooks Invoice Instructions</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          {/* Step 1 */}
          <div>
            <p className="font-semibold text-foreground mb-1">Step 1 — Find or create the customer</p>
            <p className="text-muted-foreground">
              In QuickBooks, go to Invoices and create a new invoice. In the Customer field, enter
              exactly: <span className="font-medium text-foreground">{memberName}</span>. If this
              customer does not exist in QuickBooks yet, create them now using this exact name before
              proceeding.
            </p>
          </div>

          <Separator />

          {/* Step 2 */}
          <div>
            <p className="font-semibold text-foreground mb-1">Step 2 — Set the invoice date and due date</p>
            <p className="text-muted-foreground">
              Set the invoice date to{' '}
              <span className="font-medium text-foreground">{invoiceDate}</span>. Set the due date to{' '}
              <span className="font-medium text-foreground">{dueDate}</span>.
            </p>
          </div>

          <Separator />

          {/* Step 3 */}
          <div>
            <p className="font-semibold text-foreground mb-1">Step 3 — Add line items</p>
            <div className="rounded-md border overflow-hidden mt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service Item Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right">{item.qty}</TableCell>
                      <TableCell className="text-right">{item.rate}</TableCell>
                      <TableCell className="text-right">{item.amount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <Separator />

          {/* Step 4 */}
          <div>
            <p className="font-semibold text-foreground mb-1">Step 4 — Tax</p>
            <p className="text-muted-foreground">
              Apply GST (5%) to all line items. Note: confirm PST treatment with your accountant
              before your first real invoice — current assumption is GST only applies to these
              service fees in BC.
            </p>
          </div>

          <Separator />

          {/* Step 5 */}
          <div>
            <p className="font-semibold text-foreground mb-1">Step 5 — Verify and send</p>
            <p className="text-muted-foreground">
              Confirm the invoice total matches:{' '}
              <span className="font-medium text-foreground">
                ${subtotal.toFixed(2)}
              </span>{' '}
              + GST{' '}
              <span className="font-medium text-foreground">
                ${gst.toFixed(2)}
              </span>{' '}
              ={' '}
              <span className="font-medium text-foreground">
                ${grandTotal.toFixed(2)}
              </span>
              . Save and send to{' '}
              <span className="font-medium text-foreground">
                {memberEmail || '(no email on file)'}
              </span>
              .
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Go Back
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Saving…' : 'Confirm — Mark as Ready to Invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
