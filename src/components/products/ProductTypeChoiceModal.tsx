import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Leaf, Blend, RefreshCw, Snowflake, ArrowLeft, Check } from 'lucide-react';

type LifecycleChoice = 'perennial' | 'seasonal';

interface ProductTypeChoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChooseSingleOrigin: (lifecycle: LifecycleChoice) => void;
  onChooseBlend: (lifecycle: LifecycleChoice) => void;
}

export function ProductTypeChoiceModal({ 
  open, 
  onOpenChange, 
  onChooseSingleOrigin, 
  onChooseBlend 
}: ProductTypeChoiceModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [lifecycleChoice, setLifecycleChoice] = useState<LifecycleChoice | null>(null);

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setStep(1);
      setLifecycleChoice(null);
    }
    onOpenChange(o);
  };

  const handleLifecycleSelect = (choice: LifecycleChoice) => {
    setLifecycleChoice(choice);
    setStep(2);
  };

  const handleBack = () => {
    setStep(1);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Product</DialogTitle>
          {step === 1 && (
            <DialogDescription>
              Is this a perennial product or a one-off seasonal?
            </DialogDescription>
          )}
          {step === 2 && (
            <DialogDescription>
              Is this a post-roast blend?
            </DialogDescription>
          )}
        </DialogHeader>

        {step === 1 && (
          <div className="grid gap-3 py-4">
            <button
              onClick={() => handleLifecycleSelect('perennial')}
              className="flex items-start gap-4 p-4 border rounded-lg text-left transition-colors hover:bg-accent/50 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <RefreshCw className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base">Perennial</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  An ongoing product with revolving green coffee inputs. Always on your menu.
                </p>
              </div>
            </button>

            <button
              onClick={() => handleLifecycleSelect('seasonal')}
              className="flex items-start gap-4 p-4 border rounded-lg text-left transition-colors hover:bg-accent/50 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-accent flex items-center justify-center">
                <Snowflake className="h-5 w-5 text-accent-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base">One-Off / Seasonal</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  A limited run product tied to a specific lot or season.
                </p>
              </div>
            </button>
          </div>
        )}

        {step === 2 && lifecycleChoice && (
          <div className="py-4 space-y-4">
            <Badge variant="secondary" className="gap-1">
              {lifecycleChoice === 'perennial' ? 'Perennial' : 'One-Off / Seasonal'}
              <Check className="h-3 w-3" />
            </Badge>

            <div className="grid gap-3">
              <button
                onClick={() => {
                  handleOpenChange(false);
                  onChooseSingleOrigin(lifecycleChoice);
                }}
                className="flex items-start gap-4 p-4 border rounded-lg text-left transition-colors hover:bg-accent/50 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Leaf className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base">No — standard product</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Single origin, pre-roast blend, or any product with a single roast group.
                  </p>
                </div>
              </button>

              <button
                onClick={() => {
                  handleOpenChange(false);
                  onChooseBlend(lifecycleChoice);
                }}
                className="flex items-start gap-4 p-4 border rounded-lg text-left transition-colors hover:bg-accent/50 hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-accent flex items-center justify-center">
                  <Blend className="h-5 w-5 text-accent-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base">Yes — post-roast blend</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    This product combines multiple separately-roasted coffees.
                  </p>
                </div>
              </button>
            </div>

            <div className="pt-2">
              <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
