import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { AppRole, Profile } from '@/types/database';

interface AuthUser {
  id: string;
  email: string;
  role: AppRole;
  clientId: string | null;
  profile: Profile | null;
  isActive: boolean;
  // New account_users fields (populated for CLIENT users)
  accountId: string | null;
  isOwner: boolean;
  canPlaceOrders: boolean;
  canBookRoaster: boolean;
  canManageLocations: boolean;
  canInviteUsers: boolean;
  locationAccess: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  authUser: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isOps: boolean;
  isClient: boolean;
  isInternal: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserData = async (userId: string, email: string) => {
    try {
      // Fetch user role
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role, client_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (roleError) {
        console.error('Error fetching user role:', roleError);
        return null;
      }

      // Fetch profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
      }

      if (!roleData) {
        // No role assigned yet - this is a new user
        return null;
      }

      // Default account_users fields
      let accountId: string | null = null;
      let isOwner = false;
      let canPlaceOrders = false;
      let canBookRoaster = false;
      let canManageLocations = false;
      let canInviteUsers = false;
      let locationAccess = 'ALL';

      // For CLIENT users, look up account_users record
      if (roleData.role === 'CLIENT') {
        const { data: accountUser, error: auError } = await supabase
          .from('account_users')
          .select('account_id, is_owner, can_place_orders, can_book_roaster, can_manage_locations, can_invite_users, location_access')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();

        if (auError) {
          console.error('Error fetching account_users:', auError);
        }

        if (accountUser) {
          accountId = accountUser.account_id;
          isOwner = accountUser.is_owner;
          canPlaceOrders = accountUser.can_place_orders;
          canBookRoaster = accountUser.can_book_roaster;
          canManageLocations = accountUser.can_manage_locations;
          canInviteUsers = accountUser.can_invite_users;
          locationAccess = accountUser.location_access;
        }
      }

      return {
        id: userId,
        email,
        role: roleData.role as AppRole,
        clientId: roleData.client_id,
        profile: profileData as Profile | null,
        isActive: profileData?.is_active ?? true,
        accountId,
        isOwner,
        canPlaceOrders,
        canBookRoaster,
        canManageLocations,
        canInviteUsers,
        locationAccess,
      };
    } catch (error) {
      console.error('Error in fetchUserData:', error);
      return null;
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        // Defer data fetching with setTimeout to prevent deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchUserData(session.user.id, session.user.email || '').then(setAuthUser);
          }, 0);
        } else {
          setAuthUser(null);
        }
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id, session.user.email || '').then((data) => {
          setAuthUser(data);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAuthUser(null);
  };

  const isAdmin = authUser?.role === 'ADMIN';
  const isOps = authUser?.role === 'OPS';
  const isClient = authUser?.role === 'CLIENT';
  const isInternal = isAdmin || isOps;

  return (
    <AuthContext.Provider value={{
      user,
      session,
      authUser,
      loading,
      signIn,
      signOut,
      isAdmin,
      isOps,
      isClient,
      isInternal,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
