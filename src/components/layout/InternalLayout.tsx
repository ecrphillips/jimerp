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
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Flame,
  BookOpen,
  Warehouse,
  Wrench,
  Users2,
  UserPlus,
  Calendar,
  Receipt,
  Factory,
  Handshake,
  Settings,
  Building2,
  Binoculars,
  FlaskConical,
  FileSignature,
  Boxes,
  MessageSquarePlus,
  Megaphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FeedbackModal } from '@/components/feedback/FeedbackModal';
import { useFeedbackCount } from '@/hooks/useFeedbackCount';
import { QuickCreateWizard } from '@/components/quick-create/QuickCreateWizard';
import { NewRoastGroupModal } from '@/components/roast-groups/NewRoastGroupModal';

interface InternalLayoutProps {
  children: React.ReactNode;
}


interface NavGroupProps {
  label: string;
  icon: React.ElementType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function NavGroup({ label, icon: Icon, open, onOpenChange, children }: NavGroupProps) {
  return (
    <li>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-sidebar-foreground transition-colors hover:text-sidebar-foreground/80",
            open && "bg-sidebar-accent/30"
          )}>
            <Icon className="h-4 w-4" />
            {label}
            {open ? (
              <ChevronDown className="ml-auto h-3 w-3" />
            ) : (
              <ChevronRight className="ml-auto h-3 w-3" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-0.5">
          <div className="bg-sidebar-accent/20 rounded-md mx-1 px-1 py-1 mb-1 space-y-0.5">
            {children}
          </div>
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
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground border-l-2",
        isActive ? "bg-sidebar-accent border-l-sidebar-primary" : "border-l-transparent hover:bg-sidebar-accent/85"
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
    </NavLink>
  );
}


export function InternalLayout({ children }: InternalLayoutProps) {
  const { authUser, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false);
  const [newRoastGroupOpen, setNewRoastGroupOpen] = React.useState(false);
  const feedbackNewCount = useFeedbackCount();

  useOrderNotifications();

  const closeSidebar = () => setSidebarOpen(false);

  // Nav group open states — persist in sessionStorage
  const STORAGE_KEY = 'jim-nav-groups';
  const getInitialGroupState = () => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored) as Record<string, boolean>;
    } catch {}
    return {} as Record<string, boolean>;
  };
  const initial = React.useMemo(getInitialGroupState, []);
  const [accountsOpen, setAccountsOpen] = React.useState(initial.accounts ?? false);
  const [cmOpen, setCmOpen] = React.useState(initial.manufacturing ?? false);
  const [sourcingOpen, setSourcingOpen] = React.useState(initial.sourcing ?? false);
  const [coroastOpen, setCoroastOpen] = React.useState(initial.coroasting ?? false);
  const [adminOpen, setAdminOpen] = React.useState(initial.admin ?? false);

  // Persist whenever any group changes
  React.useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      accounts: accountsOpen,
      manufacturing: cmOpen,
      sourcing: sourcingOpen,
      coroasting: coroastOpen,
      admin: adminOpen,
    }));
  }, [accountsOpen, cmOpen, sourcingOpen, coroastOpen, adminOpen]);

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
                <NavLink
                  to="/dashboard"
                  onClick={closeSidebar}
                  className={({ isActive }) => cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-sidebar-foreground transition-colors hover:text-sidebar-foreground/80",
                    isActive && "bg-sidebar-accent"
                  )}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </NavLink>
              </li>

              {/* Accounts */}
              <NavGroup label="Accounts" icon={Building2} open={accountsOpen} onOpenChange={setAccountsOpen}>
                <NavItem to="/accounts" icon={Building2} label="Accounts" onClick={closeSidebar} />
                <NavItem to="/prospects" icon={UserPlus} label="Relationships" onClick={closeSidebar} />
              </NavGroup>

              {/* Contract Manufacturing */}
              <NavGroup label="Manufacturing" icon={Factory} open={cmOpen} onOpenChange={setCmOpen}>
                
                <NavItem to="/orders" icon={ShoppingCart} label="Orders" onClick={closeSidebar} />
                <NavItem to="/production" icon={Flame} label="Run Sheet" onClick={closeSidebar} end />
                <NavItem to="/inventory" icon={Warehouse} label="Inventory Levels" onClick={closeSidebar} end />
                <NavItem to="/products" icon={Package} label="Products" onClick={closeSidebar} />
                <NavItem to="/roast-groups" icon={Coffee} label="Roast Groups" onClick={closeSidebar} />
              </NavGroup>

              {/* Sourcing */}
              <NavGroup label="Sourcing" icon={Binoculars} open={sourcingOpen} onOpenChange={setSourcingOpen}>
                <NavItem to="/sourcing/vendors" icon={Users} label="Vendors" onClick={closeSidebar} />
                <NavItem to="/sourcing/samples" icon={FlaskConical} label="Samples" onClick={closeSidebar} />
                <NavItem to="/sourcing/contracts" icon={FileSignature} label="Contracts" onClick={closeSidebar} />
                <NavItem to="/sourcing/lots" icon={Boxes} label="Lots" onClick={closeSidebar} />
              </NavGroup>

              {/* Co-Roasting */}
              <NavGroup label="Co-Roasting" icon={Handshake} open={coroastOpen} onOpenChange={setCoroastOpen}>
                
                <NavItem to="/co-roasting/bookings" icon={Calendar} label="Booking Calendar" onClick={closeSidebar} />
                <NavItem to="/co-roasting/loring-schedule" icon={Calendar} label="Loring Schedule" onClick={closeSidebar} />
                <NavItem to="/co-roasting/billing" icon={Receipt} label="Billing" onClick={closeSidebar} />
              </NavGroup>


              {/* Admin — ADMIN only */}
              {authUser?.role === 'ADMIN' && (
                <NavGroup label="Admin" icon={Settings} open={adminOpen} onOpenChange={setAdminOpen}>
                  <NavItem to="/admin/users" icon={Users2} label="Users & Access" onClick={closeSidebar} />
                  <NavItem to="/admin-tools" icon={Wrench} label="Admin Tools" onClick={closeSidebar} />
                  <NavItem to="/inventory/ledger" icon={BookOpen} label="Ledger" onClick={closeSidebar} />
                  <NavLink
                    to="/admin/feedback"
                    onClick={closeSidebar}
                    className={({ isActive }) => cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground border-l-2",
                      isActive ? "bg-sidebar-accent border-l-sidebar-primary" : "border-l-transparent hover:bg-sidebar-accent/85"
                    )}
                  >
                    <Megaphone className="h-5 w-5" />
                    Feedback
                    {feedbackNewCount > 0 && (
                      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                        {feedbackNewCount}
                      </span>
                    )}
                  </NavLink>
                </NavGroup>
              )}
            </ul>
          </nav>

          <div className="border-t border-sidebar-border p-4">
            <button
              onClick={() => { setQuickCreateOpen(true); closeSidebar(); }}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 mb-3 text-sm font-medium shadow-md transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Quick Create
            </button>
            <button
              onClick={() => { setFeedbackOpen(true); closeSidebar(); }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 mb-2 text-xs font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/85 hover:text-sidebar-foreground"
            >
              <MessageSquarePlus className="h-4 w-4" />
              Give Feedback
            </button>
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
      <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <QuickCreateWizard open={quickCreateOpen} onOpenChange={setQuickCreateOpen} onOpenNewRoastGroup={() => setNewRoastGroupOpen(true)} />
      <NewRoastGroupModal open={newRoastGroupOpen} onOpenChange={setNewRoastGroupOpen} />

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
