import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Leaf, Blend } from 'lucide-react';

interface ProductTypeChoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChooseSingleOrigin: () => void;
  onChooseBlend: () => void;
}

export function ProductTypeChoiceModal({ 
  open, 
  onOpenChange, 
  onChooseSingleOrigin, 
  onChooseBlend 
}: ProductTypeChoiceModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Product</DialogTitle>
          <DialogDescription>
            What type of coffee product are you creating?
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-3 py-4">
          <button
            onClick={onChooseSingleOrigin}
            className="flex items-start gap-4 p-4 border rounded-lg text-left transition-colors hover:bg-accent/50 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Leaf className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base">Single Origin</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Coffee from one origin. You can create new roast groups inline during product creation.
              </p>
            </div>
          </button>
          
          <button
            onClick={onChooseBlend}
            className="flex items-start gap-4 p-4 border rounded-lg text-left transition-colors hover:bg-accent/50 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <div className="flex-shrink-0 h-10 w-10 rounded-full bg-accent flex items-center justify-center">
              <Blend className="h-5 w-5 text-accent-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base">Post-Roast Blend</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Blend of multiple roasted coffees. Component roast groups must exist first — you'll select them from the list.
              </p>
            </div>
          </button>
        </div>
        
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
