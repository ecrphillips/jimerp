import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Leaf, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useGreenDeductionSettingQuery, useSetGreenDeduction } from '@/hooks/useGreenDeductionSetting';

/** Admin switch for taking green off stock when batches are marked roasted. */
export function GreenDeductionSettings() {
  const { data, isLoading } = useGreenDeductionSettingQuery();
  const setEnabled = useSetGreenDeduction();
  const [confirmOn, setConfirmOn] = useState(false);
  const enabled = data?.enabled ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Leaf className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Green deduction</CardTitle>
        </div>
        <CardDescription>
          When on, marking a batch roasted takes its inbound green kg off the green lots it was roasted from
          (split across the roast group's lots and baskets, editable on each batch). Undoing a batch puts the green back.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            {isLoading ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>
            ) : (
              <p className="text-sm font-medium">{enabled ? 'On — roasting takes green off stock' : 'Off — roasting does not change green stock'}</p>
            )}
            {data?.updatedAt && (
              <p className="text-xs text-muted-foreground">Last changed {format(parseISO(data.updatedAt), 'MMM d, yyyy h:mm a')}</p>
            )}
          </div>
          <Switch
            checked={enabled}
            disabled={isLoading || setEnabled.isPending}
            onCheckedChange={(on) => (on ? setConfirmOn(true) : setEnabled.mutate(false))}
            aria-label="Green deduction"
          />
        </div>
        {!enabled && (
          <p className="text-xs text-muted-foreground">
            Do a <Link to="/sourcing/lots" className="underline">floor count</Link> first, so lots start from what's really on the floor.
          </p>
        )}
      </CardContent>

      <AlertDialog open={confirmOn} onOpenChange={setConfirmOn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch on green deduction?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">From now on, every batch marked roasted takes its green off the lots' kg on hand.</span>
              <span className="block">Have you done a floor count? If the kg on hand figures are wrong, deductions start from wrong numbers.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setEnabled.mutate(true); setConfirmOn(false); }}>
              Floor count done — switch on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
