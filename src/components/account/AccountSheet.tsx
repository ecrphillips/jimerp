import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { LogOut, Loader2, Check, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';

interface AccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountSheet({ open, onOpenChange }: AccountSheetProps) {
  const { authUser, signOut } = useAuth();
  const queryClient = useQueryClient();
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);

  // Update profile name
  const updateNameMutation = useMutation({
    mutationFn: async (newName: string) => {
      if (!authUser?.id) throw new Error('Not authenticated');
      
      const { error } = await supabase
        .from('profiles')
        .update({ name: newName })
        .eq('user_id', authUser.id);
      
      if (error) throw error;
      return newName;
    },
    onSuccess: () => {
      toast.success('Name updated');
      setIsEditingName(false);
      queryClient.invalidateQueries({ queryKey: ['auth-user'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update name');
    },
  });

  const handleStartEditName = () => {
    setEditedName(authUser?.profile?.name || '');
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    if (!editedName.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    updateNameMutation.mutate(editedName.trim());
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditedName('');
  };

  const handleChangePassword = async () => {
    if (!authUser?.email) {
      toast.error('No email address found');
      return;
    }
    
    setIsSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(authUser.email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      
      if (error) throw error;
      
      toast.success('Password reset email sent', {
        description: `Check ${authUser.email} for the reset link.`,
      });
    } catch (error: any) {
      toast.error(error.message || 'Failed to send reset email');
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleSignOut = async () => {
    onOpenChange(false);
    await signOut();
  };

  const displayRole = authUser?.role === 'CLIENT' ? 'Client' : authUser?.role;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80">
        <SheetHeader>
          <SheetTitle>Account</SheetTitle>
        </SheetHeader>
        
        <div className="mt-6 space-y-6">
          {/* Name field */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Name</Label>
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="h-9"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') handleCancelEditName();
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0"
                  onClick={handleSaveName}
                  disabled={updateNameMutation.isPending}
                >
                  {updateNameMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0"
                  onClick={handleCancelEditName}
                  disabled={updateNameMutation.isPending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{authUser?.profile?.name || '—'}</p>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={handleStartEditName}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Email field (read-only) */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Email</Label>
            <p className="text-sm">{authUser?.email || '—'}</p>
          </div>

          {/* Role field (read-only) */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Role</Label>
            <p className="text-sm">{displayRole || '—'}</p>
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={handleChangePassword}
              disabled={isSendingReset}
            >
              {isSendingReset ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                'Change password'
              )}
            </Button>
            
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
