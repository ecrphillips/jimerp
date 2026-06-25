import { useState } from 'react';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ownerRpc } from './ownerRpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Pencil, Save, X } from 'lucide-react';

const accountInfoSchema = z.object({
  account_name: z.string().trim().min(1, 'Business name is required').max(200),
  billing_contact_name: z.string().trim().max(200).nullable(),
  billing_email: z
    .string()
    .trim()
    .max(255)
    .email('Enter a valid email address')
    .nullable()
    .or(z.literal('').transform(() => null)),
  billing_phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+()\-.\s]*$/, 'Phone can only contain digits, spaces, and + - . ( )')
    .nullable()
    .or(z.literal('').transform(() => null)),
  billing_address: z.string().trim().max(1000).nullable(),
});

export interface AccountInfoValues {
  account_name: string;
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address: string | null;
}

interface AccountInfoFormProps {
  accountId: string;
  initialValues: AccountInfoValues;
  canEdit: boolean;
}

export function AccountInfoForm({ accountId, initialValues, canEdit }: AccountInfoFormProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<AccountInfoValues>(initialValues);

  const mutation = useMutation({
    mutationFn: async (next: AccountInfoValues) => {
      const { error } = await ownerRpc('owner_update_account', {
        p_account_id: accountId,
        p_account_name: next.account_name,
        p_billing_contact_name: next.billing_contact_name,
        p_billing_email: next.billing_email,
        p_billing_phone: next.billing_phone,
        p_billing_address: next.billing_address,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Account updated');
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['client-account', accountId] });
      queryClient.invalidateQueries({ queryKey: ['my-coroast-account', accountId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update account');
    },
  });

  const handleCancel = () => {
    setValues(initialValues);
    setEditing(false);
  };

  const handleSave = () => {
    const parsed = accountInfoSchema.safeParse({
      account_name: values.account_name,
      billing_contact_name: values.billing_contact_name ?? null,
      billing_email: values.billing_email ?? null,
      billing_phone: values.billing_phone ?? null,
      billing_address: values.billing_address ?? null,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    mutation.mutate({
      account_name: parsed.data.account_name,
      billing_contact_name: parsed.data.billing_contact_name?.trim() || null,
      billing_email: parsed.data.billing_email,
      billing_phone: parsed.data.billing_phone,
      billing_address: parsed.data.billing_address?.trim() || null,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Account Information</CardTitle>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        )}
        {editing && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={mutation.isPending}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1" /> {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="grid gap-4">
            <Field label="Business Name" required>
              <Input
                value={values.account_name}
                onChange={(e) => setValues({ ...values, account_name: e.target.value })}
              />
            </Field>
            <Field label="Billing Contact Name">
              <Input
                value={values.billing_contact_name ?? ''}
                onChange={(e) => setValues({ ...values, billing_contact_name: e.target.value })}
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Billing Email">
                <Input
                  type="email"
                  value={values.billing_email ?? ''}
                  onChange={(e) => setValues({ ...values, billing_email: e.target.value })}
                />
              </Field>
              <Field label="Billing Phone">
                <Input
                  value={values.billing_phone ?? ''}
                  onChange={(e) => setValues({ ...values, billing_phone: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Billing Address">
              <Textarea
                rows={3}
                value={values.billing_address ?? ''}
                onChange={(e) => setValues({ ...values, billing_address: e.target.value })}
              />
            </Field>
          </div>
        ) : (
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Row label="Business Name" value={initialValues.account_name} />
            <Row label="Billing Contact" value={initialValues.billing_contact_name} />
            <Row label="Billing Email" value={initialValues.billing_email} />
            <Row label="Billing Phone" value={initialValues.billing_phone} />
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Billing Address</dt>
              <dd className="whitespace-pre-wrap mt-0.5">{initialValues.billing_address || '—'}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value || '—'}</dd>
    </div>
  );
}
