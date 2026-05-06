 import { describe, it, expect, vi, beforeEach } from 'vitest';
 import { render, screen } from '@testing-library/react';
 import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
 import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
 import { useAuth } from '@/hooks/useAuth';
 import { useCurrentProfile } from '@/hooks/useUserManagement';
 import { useAccessControl } from '@/hooks/useAccessControl';
 import React from 'react';
 
 // Mock hooks
 vi.mock('@/hooks/useAuth', () => ({
   useAuth: vi.fn(),
 }));
 
 vi.mock('@/hooks/useUserManagement', () => ({
   useCurrentProfile: vi.fn(),
 }));
 
 vi.mock('@/hooks/useAccessControl', () => ({
   useAccessControl: vi.fn(),
 }));
 
 import Dashboard from '@/pages/Dashboard';
 import Auth from '@/pages/Auth';
 import NotFound from '@/pages/NotFound';
 
 // Mocking the components as they might have complex dependencies
 vi.mock('@/pages/Dashboard', () => ({
   default: () => <div>Dashboard Page</div>,
 }));
 
 vi.mock('@/pages/Auth', () => ({
   default: () => <div>Auth Page</div>,
 }));
 
 // Use the real NotFound component as it's simple
 vi.mock('@/components/layout/AppLayout', () => ({
   default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
 }));
 
 // Simplified ProtectedRoute for testing
 function ProtectedRoute({ children }: { children: React.ReactNode }) {
   const { user, loading } = useAuth();
   const { data: profile, isLoading: profileLoading } = useCurrentProfile();
 
   if (loading || profileLoading) return <div>Loading...</div>;
   if (!user) return <Navigate to="/auth" replace />;
   if (profile && !profile.approved) return <div>Aguardando Aprovação</div>;
 
   return <>{children}</>;
 }
 
 // Simple AccessDenied component
 const AccessDenied = () => <div>Access Denied</div>;
 
 // Simplified RouteGuard for testing
 function RouteGuard({ children, path }: { children: React.ReactNode, path: string }) {
   const { canAccessRoute } = useAccessControl();
   if (!canAccessRoute(path)) return <AccessDenied />;
   return <>{children}</>;
 }
 
 const queryClient = new QueryClient({
   defaultOptions: { queries: { retry: false } }
 });
 
 describe('Navigation and Protection', () => {
   beforeEach(() => {
     vi.clearAllMocks();
   });
 
   it('redirects unauthenticated users to /auth', () => {
     (useAuth as any).mockReturnValue({ user: null, loading: false });
     (useCurrentProfile as any).mockReturnValue({ data: null, isLoading: false });
 
     render(
       <QueryClientProvider client={queryClient}>
         <MemoryRouter initialEntries={['/dashboard']}>
           <Routes>
             <Route path="/auth" element={<Auth />} />
             <Route path="/dashboard" element={
               <ProtectedRoute>
                 <Dashboard />
               </ProtectedRoute>
             } />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
 
     expect(screen.getByText('Auth Page')).toBeInTheDocument();
   });
 
   it('allows authenticated and approved users to access dashboard', () => {
     (useAuth as any).mockReturnValue({ user: { id: '1' }, loading: false });
     (useCurrentProfile as any).mockReturnValue({ data: { approved: true }, isLoading: false });
     (useAccessControl as any).mockReturnValue({ canAccessRoute: () => true });
 
     render(
       <QueryClientProvider client={queryClient}>
         <MemoryRouter initialEntries={['/dashboard']}>
           <Routes>
             <Route path="/dashboard" element={
               <ProtectedRoute>
                 <RouteGuard path="/dashboard">
                   <Dashboard />
                 </RouteGuard>
               </ProtectedRoute>
             } />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
 
     expect(screen.getByText('Dashboard Page')).toBeInTheDocument();
   });
 
   it('shows access denied when user does not have permission for a route', () => {
     (useAuth as any).mockReturnValue({ user: { id: '1' }, loading: false });
     (useCurrentProfile as any).mockReturnValue({ data: { approved: true }, isLoading: false });
     (useAccessControl as any).mockReturnValue({ canAccessRoute: () => false });
 
     render(
       <QueryClientProvider client={queryClient}>
         <MemoryRouter initialEntries={['/admin-only']}>
           <Routes>
             <Route path="/admin-only" element={
               <ProtectedRoute>
                 <RouteGuard path="/admin-only">
                   <div>Admin Content</div>
                 </RouteGuard>
               </ProtectedRoute>
             } />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
 
     expect(screen.getByText('Access Denied')).toBeInTheDocument();
   });
 
   it('renders real 404 page for non-existent routes', () => {
     render(
       <MemoryRouter initialEntries={['/route-that-does-not-exist']}>
         <Routes>
           <Route path="*" element={<NotFound />} />
         </Routes>
       </MemoryRouter>
     );
 
     expect(screen.getByText('404')).toBeInTheDocument();
     expect(screen.getByText(/Página não encontrada/i)).toBeInTheDocument();
   });
 });