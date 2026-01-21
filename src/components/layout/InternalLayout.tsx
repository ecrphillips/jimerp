import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  DollarSign,
  Calendar,
  Leaf,
  LogOut,
  Coffee,
  Menu,
  X,
  Clipboard,
  Settings,
  Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface InternalLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/bulk-products', label: 'Bulk Import', icon: Upload },
  { to: '/pricing', label: 'Pricing', icon: DollarSign },
  { to: '/production', label: 'Run Sheet', icon: Calendar },
  { to: '/production/matchstick', label: 'Matchstick', icon: Clipboard },
  { to: '/production/funk', label: 'Funk', icon: Clipboard },
  { to: '/green-coffee', label: 'Green Coffee', icon: Leaf },
  { to: '/boards', label: 'Board Mgmt', icon: Settings },
];

export function InternalLayout({ children }: InternalLayoutProps) {
  const { authUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

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

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:translate-x-0 lg:static",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
            <Coffee className="h-8 w-8 text-sidebar-primary" />
            <span className="text-lg font-semibold">Lite ERP</span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-4">
            <ul className="space-y-1 px-3">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive 
                        ? "bg-sidebar-accent text-sidebar-primary" 
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* User section */}
          <div className="border-t border-sidebar-border p-4">
            <div className="mb-3 px-3">
              <p className="text-sm font-medium">{authUser?.profile?.name || authUser?.email}</p>
              <p className="text-xs text-sidebar-foreground/60">{authUser?.role}</p>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={handleSignOut}
            >
              <LogOut className="h-5 w-5" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2">
            <Coffee className="h-6 w-6 text-primary" />
            <span className="font-semibold">Lite ERP</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
