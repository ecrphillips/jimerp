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
import Dashboard from "@/pages/internal/Dashboard";
import Orders from "@/pages/internal/Orders";
import OrderDetail from "@/pages/internal/OrderDetail";
import CreateOrderForClient from "@/pages/internal/CreateOrderForClient";
import Clients from "@/pages/internal/Clients";
import Products from "@/pages/internal/Products";
import Pricing from "@/pages/internal/Pricing";
import Production from "@/pages/internal/Production";
import GreenCoffee from "@/pages/internal/GreenCoffee";
import MatchstickBoard from "@/pages/internal/MatchstickBoard";
import FunkBoard from "@/pages/internal/FunkBoard";
import NoSmokeBoard from "@/pages/internal/NoSmokeBoard";
import BoardManagement from "@/pages/internal/BoardManagement";
import BulkProducts from "@/pages/internal/BulkProducts";
import Inventory from "@/pages/internal/Inventory";
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
            {/* Public */}
            <Route path="/auth" element={<Auth />} />
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
            <Route path="/production" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Production /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/production/matchstick" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><MatchstickBoard /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/production/funk" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><FunkBoard /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/production/nosmoke" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><NoSmokeBoard /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/green-coffee" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><GreenCoffee /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/boards" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><BoardManagement /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/inventory" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><Inventory /></InternalLayout>
              </ProtectedRoute>
            } />
            <Route path="/bulk-products" element={
              <ProtectedRoute allowedRoles={['ADMIN', 'OPS']}>
                <InternalLayout><BulkProducts /></InternalLayout>
              </ProtectedRoute>
            } />

            {/* Client Portal */}
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
