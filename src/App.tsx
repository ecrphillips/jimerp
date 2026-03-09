import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { InternalLayout } from "@/components/layout/InternalLayout";
import { ClientLayout } from "@/components/layout/ClientLayout";

// Pages
import Auth from "@/pages/Auth";
import AuthCallback from "@/pages/AuthCallback";
import SetPassword from "@/pages/SetPassword";
import Dashboard from "@/pages/internal/Dashboard";
import Orders from "@/pages/internal/Orders";
import OrderDetail from "@/pages/internal/OrderDetail";
import CreateOrderForClient from "@/pages/internal/CreateOrderForClient";
import Clients from "@/pages/internal/Clients";
import Products from "@/pages/internal/Products";
import Pricing from "@/pages/internal/Pricing";
import Prospects from "@/pages/internal/Prospects";
import Production from "@/pages/internal/Production";
import GreenCoffee from "@/pages/internal/GreenCoffee";
import CoRoastMembers from "@/pages/internal/CoRoastMembers";
import CoRoastLoringSchedule from "@/pages/internal/CoRoastLoringSchedule";
import BoardsDisabled from "@/pages/internal/BoardsDisabled";
import BulkProducts from "@/pages/internal/BulkProducts";
import Inventory from "@/pages/internal/Inventory";
import InventoryLedger from "@/pages/internal/InventoryLedger";
import AdminTools from "@/pages/internal/AdminTools";
import UsersAccess from "@/pages/internal/UsersAccess";
import Portal from "@/pages/client/Portal";
import NewOrder from "@/pages/client/NewOrder";
import OrderHistory from "@/pages/client/OrderHistory";
import Account from "@/pages/client/Account";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public auth routes */}
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/set-password" element={<SetPassword />} />
            <Route path="/" element={<Navigate to="/auth" replace />} />

            {/* Internal (Admin/Ops) */}
            <Route path="/dashboard" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Dashboard /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/orders" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Orders /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/orders/new" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><CreateOrderForClient /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/orders/:id" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><OrderDetail /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/clients" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Clients /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/products" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Products /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/pricing" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Pricing /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/prospects" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Prospects /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/production" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Production /></InternalLayout>
              </ProtectedRoute>
            } />
            {/* Andon boards disabled for MVP - show disabled message */}
            <Route path="/production/matchstick" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><BoardsDisabled /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/production/funk" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><BoardsDisabled /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/production/nosmoke" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><BoardsDisabled /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/boards" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><BoardsDisabled /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/green-coffee" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><GreenCoffee /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/inventory" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Inventory /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/inventory/ledger" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><InventoryLedger /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/bulk-products" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><BulkProducts /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin-tools" element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <InternalLayout><AdminTools /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/users" element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <InternalLayout><UsersAccess /></InternalLayout>
              </ProtectedRoute>
            } />

            {/* Client Portal */}
            <Route path="/portal" element={
              <ProtectedRoute allowedRoles={['CLIENT']}>
                <ClientLayout><Portal /></ClientLayout>
              </ProtectedRoute>
            } />
            <Route path="/portal/new-order" element={
              <ProtectedRoute allowedRoles={['CLIENT']}>
                <ClientLayout><NewOrder /></ClientLayout>
              </ProtectedRoute>
            } />
            <Route path="/portal/orders" element={
              <ProtectedRoute allowedRoles={['CLIENT']}>
                <ClientLayout><OrderHistory /></ClientLayout>
              </ProtectedRoute>
            } />
            <Route path="/portal/account" element={
              <ProtectedRoute allowedRoles={['CLIENT']}>
                <ClientLayout><Account /></ClientLayout>
              </ProtectedRoute>
            } />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
