import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useOrderNotifications } from '@/hooks/useOrderNotifications';
import { AccountSheet } from '@/components/account/AccountSheet';
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  LogOut,
  Coffee,
  Menu,
  X,
  Settings,
  ChevronDown,
  ChevronRight,
  Flame,
  BookOpen,
  Warehouse,
  Wrench,
  Users2,
  UserPlus,
  Handshake,
  Calendar,
  Receipt,
  Factory,
  Link
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface InternalLayoutProps {
  children: React.ReactNode;
}


interface NavGroupProps {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function NavGroup({ label, open, onOpenChange, children }: NavGroupProps) {
  return (
    <li>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground/80">
            {label}
            {open ? (
              <ChevronDown className="ml-auto h-3 w-3" />
            ) : (
              <ChevronRight className="ml-auto h-3 w-3" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-0.5 space-y-0.5">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  end?: boolean;
}

function NavItem({ to, icon: Icon, label, onClick, end }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
        isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/85"
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
    </NavLink>
  );
}

interface NestedNavGroupProps {
  icon: React.ElementType;
  label: string;
  isRoute: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: { to: string; label: string; icon: React.ElementType; end?: boolean }[];
  onItemClick?: () => void;
}

function NestedNavGroup({ icon: Icon, label, isRoute, open, onOpenChange, items, onItemClick }: NestedNavGroupProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
            isRoute ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/85"
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
          {open ? (
            <ChevronDown className="ml-auto h-4 w-4" />
          ) : (
            <ChevronRight className="ml-auto h-4 w-4" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1 pl-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onItemClick}
            className={({ isActive }) => cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground",
              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/85"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function InternalLayout({ children }: InternalLayoutProps) {
  const { authUser, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = React.useState(false);

  useOrderNotifications();

  const closeSidebar = () => setSidebarOpen(false);

  // Group open states
  const [cmOpen, setCmOpen] = React.useState(true);
  const [coroastOpen, setCoroastOpen] = React.useState(true);
  const [relOpen, setRelOpen] = React.useState(true);
  const [adminOpen, setAdminOpen] = React.useState(true);

  // Nested dropdown states
  const isProductionRoute = location.pathname.startsWith('/production');
  const isInventoryRoute = location.pathname.startsWith('/inventory');
  const [productionOpen, setProductionOpen] = React.useState(isProductionRoute);
  const [inventoryOpen, setInventoryOpen] = React.useState(isInventoryRoute);

  React.useEffect(() => { if (isProductionRoute) setProductionOpen(true); }, [isProductionRoute]);
  React.useEffect(() => { if (isInventoryRoute) setInventoryOpen(true); }, [isInventoryRoute]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="flex min-h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
        />
      )}

      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:translate-x-0 lg:static",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
            <Coffee className="h-8 w-8 text-sidebar-primary" />
            <div className="flex flex-col leading-tight">
              <span className="text-lg font-bold">JIM</span>
              <span className="text-xs italic text-sidebar-foreground/60">by Home Island Software</span>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-4">
            <ul className="space-y-1 px-3">
              {/* Dashboard */}
              <li>
                <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" onClick={closeSidebar} />
              </li>

              {/* Contract Manufacturing */}
              <NavGroup label="Contract Manufacturing" open={cmOpen} onOpenChange={setCmOpen}>
                <NavItem to="/clients" icon={Users} label="Clients" onClick={closeSidebar} />
                <NavItem to="/orders" icon={ShoppingCart} label="Orders" onClick={closeSidebar} />
                <NestedNavGroup
                  icon={Flame}
                  label="Production"
                  isRoute={isProductionRoute}
                  open={productionOpen}
                  onOpenChange={setProductionOpen}
                  items={productionSubItems.map(i => ({ ...i, end: i.to === '/production' }))}
                  onItemClick={closeSidebar}
                />
                <NestedNavGroup
                  icon={Warehouse}
                  label="Inventory"
                  isRoute={isInventoryRoute}
                  open={inventoryOpen}
                  onOpenChange={setInventoryOpen}
                  items={inventorySubItems.map(i => ({ ...i, end: i.to === '/inventory' }))}
                  onItemClick={closeSidebar}
                />
                <NavItem to="/products" icon={Package} label="Products" onClick={closeSidebar} />
              </NavGroup>

              {/* Co-Roasting */}
              <NavGroup label="Co-Roasting" open={coroastOpen} onOpenChange={setCoroastOpen}>
                <NavItem to="/co-roasting/members" icon={Users} label="Members" onClick={closeSidebar} />
                <NavItem to="/co-roasting/bookings" icon={Calendar} label="Booking Calendar" onClick={closeSidebar} />
                <NavItem to="/co-roasting/loring-schedule" icon={Calendar} label="Loring Schedule" onClick={closeSidebar} />
                <NavItem to="/co-roasting/billing" icon={Receipt} label="Billing" onClick={closeSidebar} />
              </NavGroup>

              {/* Relationships */}
              <NavGroup label="Relationships" open={relOpen} onOpenChange={setRelOpen}>
                <NavItem to="/prospects" icon={UserPlus} label="Prospects" onClick={closeSidebar} />
              </NavGroup>

              {/* Admin — ADMIN only */}
              {authUser?.role === 'ADMIN' && (
                <NavGroup label="Admin" open={adminOpen} onOpenChange={setAdminOpen}>
                  <NavItem to="/admin/users" icon={Users2} label="Users & Access" onClick={closeSidebar} />
                  <NavItem to="/admin-tools" icon={Wrench} label="Admin Tools" onClick={closeSidebar} />
                </NavGroup>
              )}
            </ul>
          </nav>

          <div className="border-t border-sidebar-border p-4">
            <button
              onClick={() => setAccountSheetOpen(true)}
              className="w-full mb-3 px-3 py-2 rounded-md text-left transition-colors hover:bg-sidebar-accent/85 group"
            >
              <p className="text-sm font-medium text-sidebar-foreground group-hover:underline">
                {authUser?.profile?.name || authUser?.email}
              </p>
              <p className="text-xs text-sidebar-foreground/60">{authUser?.role}</p>
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

      <AccountSheet open={accountSheetOpen} onOpenChange={setAccountSheetOpen} />

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-4 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
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

        <main className="flex-1 overflow-y-auto pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
