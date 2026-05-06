 import { describe, it, expect, vi, beforeEach } from 'vitest';
 import { render, screen, waitFor } from '@testing-library/react';
 import { MemoryRouter, Routes, Route } from 'react-router-dom';
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
   useCurrentUserRoles: vi.fn(),
 }));
 
 vi.mock('@/hooks/useAccessControl', () => ({
   useAccessControl: vi.fn(),
 }));
 
 // Simplified components for testing
 const Dashboard = () => <div>Dashboard Content</div>;
 const AdminPage = () => <div>Admin Restricted Content</div>;
 const FinancePage = () => <div>Finance Restricted Content</div>;
 const UnauthorizedUI = ({ title }: { title: string }) => <div>Access Denied: <span>{title}</span></div>;
 
 // Mocking the RouteGuard logic from App.tsx
 function TestRouteGuard({ children, path }: { children: React.ReactNode, path: string }) {
   const { canAccessRoute, loading } = useAccessControl();
   
   if (loading) return <div>Loading Permissions...</div>;
   
   // Use the same mapping logic as the real RouteGuard
   const isAtRoot = path === '/' || path === '/dashboard';
   const canAccess = canAccessRoute(path);
   
   if (!canAccess) {
     return <UnauthorizedUI title={isAtRoot ? "Sem acesso ao Painel" : "Acesso Restrito"} />;
   }
   
   return <>{children}</>;
 }
 
 const queryClient = new QueryClient({
   defaultOptions: { queries: { retry: false } }
 });
 
 describe('Security Integration: Profile-based Access Control', () => {
   beforeEach(() => {
     vi.clearAllMocks();
   });
 
   it('denies access to Admin module for a "producao" user', async () => {
     // Mock user with 'producao' role
     (useAuth as any).mockReturnValue({ user: { id: 'user-1' }, loading: false });
     (useAccessControl as any).mockReturnValue({
       loading: false,
       canAccessRoute: (path: string) => !path.startsWith('/settings'), // simulate 'producao' role logic
       roles: ['producao']
     });
 
     render(
       <QueryClientProvider client={queryClient}>
         <MemoryRouter initialEntries={['/settings']}>
           <Routes>
             <Route path="/settings" element={
               <TestRouteGuard path="/settings">
                 <AdminPage />
               </TestRouteGuard>
             } />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
 
   expect(screen.getByText(/Acesso Restrito/i)).toBeInTheDocument();
     expect(screen.queryByText('Admin Restricted Content')).not.toBeInTheDocument();
   });
 
   it('denies access to Finance module for an "almoxarifado" user', async () => {
     // Mock user with 'almoxarifado' role
     (useAuth as any).mockReturnValue({ user: { id: 'user-2' }, loading: false });
     (useAccessControl as any).mockReturnValue({
       loading: false,
       canAccessRoute: (path: string) => !path.startsWith('/finance'),
       roles: ['almoxarifado']
     });
 
     render(
       <QueryClientProvider client={queryClient}>
         <MemoryRouter initialEntries={['/finance']}>
           <Routes>
             <Route path="/finance" element={
               <TestRouteGuard path="/finance">
                 <FinancePage />
               </TestRouteGuard>
             } />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
 
   expect(screen.getByText(/Acesso Restrito/i)).toBeInTheDocument();
   });
 
   it('allows Admin user to access everything (bypass filter simulation)', async () => {
     // Mock user with 'admin' role
     (useAuth as any).mockReturnValue({ user: { id: 'admin-1' }, loading: false });
     (useAccessControl as any).mockReturnValue({
       loading: false,
       canAccessRoute: () => true, // Admin can access all
       roles: ['admin'],
       isAdmin: true
     });
 
     render(
       <QueryClientProvider client={queryClient}>
         <MemoryRouter initialEntries={['/settings']}>
           <Routes>
             <Route path="/settings" element={
               <TestRouteGuard path="/settings">
                 <AdminPage />
               </TestRouteGuard>
             } />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
 
     expect(screen.getByText('Admin Restricted Content')).toBeInTheDocument();
   });
 
   it('prevents access during permissions loading state', () => {
     (useAuth as any).mockReturnValue({ user: { id: 'user-1' }, loading: false });
     (useAccessControl as any).mockReturnValue({
       loading: true,
       canAccessRoute: () => false,
       roles: []
     });
 
     render(
       <QueryClientProvider client={queryClient}>
         <MemoryRouter initialEntries={['/dashboard']}>
           <Routes>
             <Route path="/dashboard" element={
               <TestRouteGuard path="/dashboard">
                 <Dashboard />
               </TestRouteGuard>
             } />
           </Routes>
         </MemoryRouter>
       </QueryClientProvider>
     );
 
     expect(screen.getByText('Loading Permissions...')).toBeInTheDocument();
     expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
   });
 });