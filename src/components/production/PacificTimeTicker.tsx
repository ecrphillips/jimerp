/**
 * Pacific Time Ticker Component
 * 
 * Displays current Pacific time (Vancouver) and production window info
 * Non-distracting, auto-updating display for production context
 */

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';
import { 
  getVancouverNow, 
  PRODUCTION_WINDOW_START, 
  PRODUCTION_WINDOW_END 
} from '@/lib/productionScheduling';
import { cn } from '@/lib/utils';

interface PacificTimeTickerProps {
  className?: string;
}

export function PacificTimeTicker({ className }: PacificTimeTickerProps) {
  const [now, setNow] = useState(getVancouverNow);
  
  // Update every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(getVancouverNow());
    }, 60000); // 1 minute
    
    return () => clearInterval(interval);
  }, []);
  
  // Determine if we're within the production window
  const currentHour = now.getHours();
  const isInProductionWindow = 
    currentHour >= PRODUCTION_WINDOW_START && currentHour < PRODUCTION_WINDOW_END;
  
  // Format: "Thu Jan 29 · 13:41"
  const dateStr = format(now, 'EEE MMM d');
  const timeStr = format(now, 'HH:mm');
  
  // Production window string
  const windowStr = `${String(PRODUCTION_WINDOW_START).padStart(2, '0')}:00–${String(PRODUCTION_WINDOW_END).padStart(2, '0')}:00`;
  
  return (
    <div 
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        className
      )}
    >
      <Clock className="h-3 w-3" />
      <span>
        <span className="font-medium">Pacific Time:</span>
        {' '}
        {dateStr}
        {' · '}
        <span className={cn(
          "font-mono",
          isInProductionWindow && "text-foreground font-medium"
        )}>
          {timeStr}
        </span>
      </span>
      <span className="text-muted-foreground/60">
        — Window: {windowStr}
      </span>
      {isInProductionWindow && (
        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          Active
        </span>
      )}
    </div>
  );
}
