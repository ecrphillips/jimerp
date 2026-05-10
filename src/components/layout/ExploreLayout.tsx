import React from 'react';
import hiLogo from '@/assets/home-island-logo.png';

export function ExploreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-hi-cream font-brand flex flex-col">
      <header className="bg-hi-navy py-4 px-6 flex items-center gap-3">
        <img src={hiLogo} alt="Home Island Coffee Partners" className="h-10" />
        <div className="text-hi-sand">
          <p className="font-bold tracking-wide text-sm leading-tight">Home Island</p>
          <p className="text-[10px] uppercase tracking-[0.18em] opacity-70 leading-tight">Coffee Partners</p>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-hi-navy text-hi-sand/50 text-xs py-6 text-center">
        © {new Date().getFullYear()} Home Island Coffee Partners · homeislandcoffee.com
      </footer>
    </div>
  );
}
