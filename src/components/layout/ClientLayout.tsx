import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { AccountSheet } from '@/components/account/AccountSheet';
import {
  Home,
  PlusCircle,
  ClipboardList,
  User,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import hiIcon from '@/assets/home-island-icon.png';

interface ClientLayoutProps {
  children: React.ReactNode;
}

// Client-only navigation items
const navItems = [
  { to: '/portal', label: 'Home', icon: Home, end: true },
  { to: '/portal/new-order', label: 'New Order', icon: PlusCircle },
  { to: '/portal/orders', label: 'Order History', icon: ClipboardList },
  { to: '/portal/account', label: 'Account', icon: User },
];

export function ClientLayout({ children }: ClientLayoutProps) {
  const { authUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = React.useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - same styling as InternalLayout */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:translate-x-0 lg:static",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
            <img src={hiIcon} alt="Home Island" className="h-9 w-9" />
            <div className="flex flex-col leading-tight font-brand">
              <span className="text-base font-bold tracking-wide text-sidebar-foreground">Home Island</span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">Coffee Partners</span>
            </div>
          </div>

          {/* Navigation - client-safe items only */}
          <nav className="flex-1 overflow-y-auto py-4">
            <ul className="space-y-1 px-3">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={'end' in item ? item.end : false}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
                      isActive 
                        ? "bg-sidebar-accent" 
                        : "hover:bg-sidebar-accent/85"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* User section - matches InternalLayout */}
          <div className="border-t border-sidebar-border p-4">
            <button
              onClick={() => setAccountSheetOpen(true)}
              className="w-full mb-3 px-3 py-2 rounded-md text-left transition-colors hover:bg-sidebar-accent/85 group"
            >
              <p className="text-sm font-medium text-sidebar-foreground group-hover:underline">
                {authUser?.profile?.name || authUser?.email}
              </p>
              <p className="text-xs text-sidebar-foreground/60">Client</p>
            </button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent/85 hover:text-sidebar-foreground"
              onClick={handleSignOut}
            >
              <LogOut className="h-5 w-5" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Account Sheet */}
      <AccountSheet open={accountSheetOpen} onOpenChange={setAccountSheetOpen} />

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        {/* Mobile header - matches InternalLayout */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2">
            <img src={hiIcon} alt="Home Island" className="h-7 w-7" />
            <div className="flex flex-col leading-tight font-brand">
              <span className="text-sm font-bold text-hi-navy">Home Island</span>
              <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Coffee Partners</span>
            </div>
          </div>
        </header>

        {/* Page content - uses same page-container styling */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
