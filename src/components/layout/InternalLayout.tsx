import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useOrderNotifications } from '@/hooks/useOrderNotifications';
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  LogOut,
  Coffee,
  Menu,
  X,
  Clipboard,
  Settings,
  ChevronDown,
  ChevronRight,
  Flame,
  BookOpen,
  Warehouse,
  Wrench,
  Users2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface InternalLayoutProps {
  children: React.ReactNode;
}

// Top-level nav items (reordered: Dashboard > Orders > Production > Inventory > Products > Clients)
const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
];

// Production is now a nested group (Andon boards hidden for MVP)
const productionSubItems = [
  { to: '/production', label: 'Run Sheet', icon: Flame, match: '/production' },
];

// Inventory sub-items
const inventorySubItems = [
  { to: '/inventory', label: 'Levels', icon: Warehouse },
  { to: '/inventory/ledger', label: 'Ledger', icon: BookOpen },
];

// Bottom nav items (removed Green Coffee)
const bottomNavItems = [
  { to: '/products', label: 'Products', icon: Package },
  { to: '/clients', label: 'Clients', icon: Users },
];

export function InternalLayout({ children }: InternalLayoutProps) {
  const { authUser, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  
  // Subscribe to real-time order notifications for OPS/ADMIN users
  useOrderNotifications();
  
  // Production section is open if we're on a production route
  const isProductionRoute = location.pathname.startsWith('/production') || location.pathname === '/boards';
  const [productionOpen, setProductionOpen] = React.useState(isProductionRoute);

  // Inventory section is open if we're on an inventory route
  const isInventoryRoute = location.pathname.startsWith('/inventory');
  const [inventoryOpen, setInventoryOpen] = React.useState(isInventoryRoute);

  // Keep sections open when navigating within them
  React.useEffect(() => {
    if (isProductionRoute) {
      setProductionOpen(true);
    }
  }, [isProductionRoute]);

  React.useEffect(() => {
    if (isInventoryRoute) {
      setInventoryOpen(true);
    }
  }, [isInventoryRoute]);

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
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold">JIM</span>
              <span className="text-xs italic text-sidebar-foreground/60">by Home Island Software</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-4">
            <ul className="space-y-1 px-3">
              {/* Top items: Dashboard, Orders */}
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
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

              {/* Production - Collapsible group */}
              <li>
                <Collapsible open={productionOpen} onOpenChange={setProductionOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
                        isProductionRoute
                          ? "bg-sidebar-accent"
                          : "hover:bg-sidebar-accent/85"
                      )}
                    >
                      <Flame className="h-5 w-5" />
                      Production
                      {productionOpen ? (
                        <ChevronDown className="ml-auto h-4 w-4" />
                      ) : (
                        <ChevronRight className="ml-auto h-4 w-4" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1 space-y-1 pl-4">
                    {productionSubItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/production'}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) => cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
                          isActive
                            ? "bg-sidebar-accent"
                            : "hover:bg-sidebar-accent/85"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </NavLink>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              </li>

              {/* Inventory - Collapsible group */}
              <li>
                <Collapsible open={inventoryOpen} onOpenChange={setInventoryOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
                        isInventoryRoute
                          ? "bg-sidebar-accent"
                          : "hover:bg-sidebar-accent/85"
                      )}
                    >
                      <Warehouse className="h-5 w-5" />
                      Inventory
                      {inventoryOpen ? (
                        <ChevronDown className="ml-auto h-4 w-4" />
                      ) : (
                        <ChevronRight className="ml-auto h-4 w-4" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1 space-y-1 pl-4">
                    {inventorySubItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/inventory'}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) => cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
                          isActive
                            ? "bg-sidebar-accent"
                            : "hover:bg-sidebar-accent/85"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </NavLink>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              </li>

              {/* Bottom items: Products, Clients */}
              {bottomNavItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
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

              {/* Admin section - ADMIN only */}
              {authUser?.role === 'ADMIN' && (
                <>
                  <li>
                    <NavLink
                      to="/admin/users"
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) => cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
                        isActive 
                          ? "bg-sidebar-accent" 
                          : "hover:bg-sidebar-accent/85"
                      )}
                    >
                      <Users2 className="h-5 w-5" />
                      Users & Access
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      to="/admin-tools"
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) => cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
                        isActive 
                          ? "bg-sidebar-accent" 
                          : "hover:bg-sidebar-accent/85"
                      )}
                    >
                      <Wrench className="h-5 w-5" />
                      Admin Tools
                    </NavLink>
                  </li>
                </>
              )}
            </ul>
          </nav>

          {/* User section */}
          <div className="border-t border-sidebar-border p-4">
            <div className="mb-3 px-3">
              <p className="text-sm font-medium text-sidebar-foreground">{authUser?.profile?.name || authUser?.email}</p>
              <p className="text-xs text-sidebar-foreground/60">{authUser?.role}</p>
            </div>
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
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold">JIM</span>
              <span className="text-[10px] italic text-muted-foreground">by Home Island Software</span>
            </div>
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
