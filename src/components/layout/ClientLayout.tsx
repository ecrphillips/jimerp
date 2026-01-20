import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  PlusCircle,
  ClipboardList,
  User,
  LogOut,
  Coffee,
  Menu,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ClientLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { to: '/portal/new-order', label: 'New Order', icon: PlusCircle },
  { to: '/portal/orders', label: 'Order History', icon: ClipboardList },
  { to: '/portal/account', label: 'Account', icon: User },
];

export function ClientLayout({ children }: ClientLayoutProps) {
  const { authUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top navigation */}
      <header className="sticky top-0 z-50 border-b bg-card shadow-sm">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <Coffee className="h-7 w-7 text-primary" />
              <span className="text-lg font-semibold">Client Portal</span>
            </div>

            {/* Desktop navigation */}
            <nav className="hidden items-center gap-1 md:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => cn(
                    "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                    isActive 
                      ? "bg-secondary text-secondary-foreground" 
                      : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>

            {/* User menu */}
            <div className="hidden items-center gap-4 md:flex">
              <div className="text-right">
                <p className="text-sm font-medium">{authUser?.profile?.name || authUser?.email}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </Button>
            </div>

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>

          {/* Mobile navigation */}
          {menuOpen && (
            <nav className="border-t py-4 md:hidden">
              <ul className="space-y-1">
                {navItems.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) => cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isActive 
                          ? "bg-secondary text-secondary-foreground" 
                          : "text-muted-foreground hover:bg-secondary"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
                <li className="border-t pt-3">
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3"
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-5 w-5" />
                    Sign Out
                  </Button>
                </li>
              </ul>
            </nav>
          )}
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
