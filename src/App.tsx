import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, ROLE_HOME_ROUTES, useAuth } from './context/AuthContext';
import { I18nProvider } from './context/I18nContext';
import { RealtimeProvider } from './context/RealtimeContext';
import type { UserRole } from './types/domain';

const LoginPage = lazy(() => import('./pages/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })));

const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })));
const AdminOrdersPage = lazy(() => import('./pages/admin/AdminOrdersPage').then((m) => ({ default: m.AdminOrdersPage })));
const AdminOrganizationsPage = lazy(() => import('./pages/admin/AdminOrganizationsPage').then((m) => ({ default: m.AdminOrganizationsPage })));
const AdminTechniciansPage = lazy(() => import('./pages/admin/AdminTechniciansPage').then((m) => ({ default: m.AdminTechniciansPage })));
const AdminWeeklyPayoutsPage = lazy(() => import('./pages/admin/AdminWeeklyPayoutsPage').then((m) => ({ default: m.AdminWeeklyPayoutsPage })));
const AdminSuppliersPage = lazy(() => import('./pages/admin/AdminSuppliersPage').then((m) => ({ default: m.AdminSuppliersPage })));
const AdminCashFlowPage = lazy(() => import('./pages/admin/AdminCashFlowPage').then((m) => ({ default: m.AdminCashFlowPage })));
const AdminMileagePage = lazy(() => import('./pages/admin/AdminMileagePage').then((m) => ({ default: m.AdminMileagePage })));
const AdminCatalogPage = lazy(() => import('./pages/admin/AdminCatalogPage').then((m) => ({ default: m.AdminCatalogPage })));
const AdminBusinessParamsPage = lazy(() => import('./pages/admin/AdminBusinessParamsPage').then((m) => ({ default: m.AdminBusinessParamsPage })));
const AdminOrderListsPage = lazy(() => import('./pages/admin/AdminOrderListsPage').then((m) => ({ default: m.AdminOrderListsPage })));
const AdminBackupPage = lazy(() => import('./pages/admin/AdminBackupPage').then((m) => ({ default: m.AdminBackupPage })));
const AdminReconciliationPage = lazy(() => import('./pages/admin/AdminReconciliationPage').then((m) => ({ default: m.AdminReconciliationPage })));
const AdminRatingsPage = lazy(() => import('./pages/admin/AdminRatingsPage').then((m) => ({ default: m.AdminRatingsPage })));
const AdminReportsPage = lazy(() => import('./pages/admin/AdminReportsPage').then((m) => ({ default: m.AdminReportsPage })));
const AdminBroadcastPage = lazy(() => import('./pages/admin/AdminBroadcastPage').then((m) => ({ default: m.AdminBroadcastPage })));
const AdminCustomersPage = lazy(() => import('./pages/admin/AdminCustomersPage').then((m) => ({ default: m.AdminCustomersPage })));
const AdminInvoicingPage = lazy(() => import('./pages/admin/AdminInvoicingPage').then((m) => ({ default: m.AdminInvoicingPage })));
const AdminSubscriptionsPage = lazy(() => import('./pages/admin/AdminSubscriptionsPage').then((m) => ({ default: m.AdminSubscriptionsPage })));
const AdminChatInboxPage = lazy(() => import('./pages/admin/AdminChatInboxPage').then((m) => ({ default: m.AdminChatInboxPage })));

const AgendaCalendarPage = lazy(() => import('./pages/shared/AgendaCalendarPage').then((m) => ({ default: m.AgendaCalendarPage })));
const TechnicianMirrorPage = lazy(() => import('./pages/shared/TechnicianMirrorPage').then((m) => ({ default: m.TechnicianMirrorPage })));

const CompanyDashboardPage = lazy(() => import('./pages/empresa/CompanyDashboardPage').then((m) => ({ default: m.CompanyDashboardPage })));
const CompanyOrdersPage = lazy(() => import('./pages/empresa/CompanyOrdersPage').then((m) => ({ default: m.CompanyOrdersPage })));
const CompanyTechniciansPage = lazy(() => import('./pages/empresa/CompanyTechniciansPage').then((m) => ({ default: m.CompanyTechniciansPage })));
const CompanyPayoutsPage = lazy(() => import('./pages/empresa/CompanyPayoutsPage').then((m) => ({ default: m.CompanyPayoutsPage })));

const PartnerNewOrderPage = lazy(() => import('./pages/parceiro/PartnerNewOrderPage').then((m) => ({ default: m.PartnerNewOrderPage })));
const PartnerOrdersPage = lazy(() => import('./pages/parceiro/PartnerOrdersPage').then((m) => ({ default: m.PartnerOrdersPage })));
const PartnerReportsPage = lazy(() => import('./pages/parceiro/PartnerReportsPage').then((m) => ({ default: m.PartnerReportsPage })));

const TechAvailablePage = lazy(() => import('./pages/tecnico/TechAvailablePage').then((m) => ({ default: m.TechAvailablePage })));
const TechAgendaPage = lazy(() => import('./pages/tecnico/TechAgendaPage').then((m) => ({ default: m.TechAgendaPage })));
const TechMileagePage = lazy(() => import('./pages/tecnico/TechMileagePage').then((m) => ({ default: m.TechMileagePage })));
const TechEarningsPage = lazy(() => import('./pages/tecnico/TechEarningsPage').then((m) => ({ default: m.TechEarningsPage })));
const TechProfilePage = lazy(() => import('./pages/tecnico/TechProfilePage').then((m) => ({ default: m.TechProfilePage })));

const CustomerBookPage = lazy(() => import('./pages/cliente/CustomerBookPage').then((m) => ({ default: m.CustomerBookPage })));
const CustomerOrdersPage = lazy(() => import('./pages/cliente/CustomerOrdersPage').then((m) => ({ default: m.CustomerOrdersPage })));
const CustomerProfilePage = lazy(() => import('./pages/cliente/CustomerProfilePage').then((m) => ({ default: m.CustomerProfilePage })));

const OrderDetailView = lazy(() => import('./features/orders/OrderDetailView').then((m) => ({ default: m.OrderDetailView })));

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        A carregar Confiança Repara...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME_ROUTES[user.role]} replace />;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={ROLE_HOME_ROUTES[user.role]} replace />;
  return <>{children}</>;
}

function RoleGuard({
  allowedRole,
  children,
}: {
  allowedRole: UserRole;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        A verificar permissões...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== allowedRole) {
    return <Navigate to={ROLE_HOME_ROUTES[user.role]} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <RealtimeProvider>
          <BrowserRouter>
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">A carregar...</div>}>
            <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/cadastro"
            element={
              <PublicOnlyRoute>
                <RegisterPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/esqueci-senha"
            element={
              <PublicOnlyRoute>
                <ForgotPasswordPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/redefinir-senha"
            element={
              <PublicOnlyRoute>
                <ResetPasswordPage />
              </PublicOnlyRoute>
            }
          />
          <Route path="/trocar-senha" element={<ChangePasswordPage />} />

          {/* 1. PORTAL SUPER ADMIN */}
          <Route
            path="/admin/dashboard"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminDashboardPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/servicos"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminOrdersPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/servicos/:id"
            element={
              <RoleGuard allowedRole="super_admin">
                <OrderDetailView backRoute="/admin/servicos" />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/empresas"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminOrganizationsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/tecnicos"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminTechniciansPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/tecnicos/:id/espelho"
            element={
              <RoleGuard allowedRole="super_admin">
                <TechnicianMirrorPage backRoute="/admin/tecnicos" />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/financeiro/repasses"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminWeeklyPayoutsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/financeiro/fornecedores"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminSuppliersPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/financeiro/caixa"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminCashFlowPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/quilometragem"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminMileagePage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/catalogo"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminCatalogPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/parametros"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminBusinessParamsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/copias"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminBackupPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/listas"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminOrderListsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/agenda"
            element={
              <RoleGuard allowedRole="super_admin">
                <AgendaCalendarPage orderBaseRoute="/admin/servicos" />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/avaliacoes"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminRatingsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/administracao"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminReconciliationPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/relatorios"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminReportsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/comunicacoes"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminBroadcastPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/clientes"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminCustomersPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/faturacao"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminInvoicingPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/subscricoes"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminSubscriptionsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/chat"
            element={
              <RoleGuard allowedRole="super_admin">
                <AdminChatInboxPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/perfil"
            element={
              <RoleGuard allowedRole="super_admin">
                <TechProfilePage />
              </RoleGuard>
            }
          />

          {/* 2. PORTAL EMPRESA / CENTRO TÉCNICO */}
          <Route
            path="/empresa/dashboard"
            element={
              <RoleGuard allowedRole="company_admin">
                <CompanyDashboardPage />
              </RoleGuard>
            }
          />
          <Route
            path="/empresa/servicos"
            element={
              <RoleGuard allowedRole="company_admin">
                <CompanyOrdersPage />
              </RoleGuard>
            }
          />
          <Route
            path="/empresa/servicos/:id"
            element={
              <RoleGuard allowedRole="company_admin">
                <OrderDetailView backRoute="/empresa/servicos" />
              </RoleGuard>
            }
          />
          <Route
            path="/empresa/tecnicos"
            element={
              <RoleGuard allowedRole="company_admin">
                <CompanyTechniciansPage />
              </RoleGuard>
            }
          />
          <Route
            path="/empresa/tecnicos/:id/espelho"
            element={
              <RoleGuard allowedRole="company_admin">
                <TechnicianMirrorPage backRoute="/empresa/tecnicos" />
              </RoleGuard>
            }
          />
          <Route
            path="/empresa/repasses"
            element={
              <RoleGuard allowedRole="company_admin">
                <CompanyPayoutsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/empresa/agenda"
            element={
              <RoleGuard allowedRole="company_admin">
                <AgendaCalendarPage orderBaseRoute="/empresa/servicos" />
              </RoleGuard>
            }
          />
          <Route
            path="/empresa/perfil"
            element={
              <RoleGuard allowedRole="company_admin">
                <TechProfilePage />
              </RoleGuard>
            }
          />

          {/* 3. PORTAL PARCEIRO CONTRATANTE */}
          <Route
            path="/parceiro/novo-pedido"
            element={
              <RoleGuard allowedRole="partner_requester">
                <PartnerNewOrderPage />
              </RoleGuard>
            }
          />
          <Route
            path="/parceiro/servicos"
            element={
              <RoleGuard allowedRole="partner_requester">
                <PartnerOrdersPage />
              </RoleGuard>
            }
          />
          <Route
            path="/parceiro/servicos/:id"
            element={
              <RoleGuard allowedRole="partner_requester">
                <OrderDetailView backRoute="/parceiro/servicos" />
              </RoleGuard>
            }
          />
          <Route
            path="/parceiro/relatorios"
            element={
              <RoleGuard allowedRole="partner_requester">
                <PartnerReportsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/parceiro/perfil"
            element={
              <RoleGuard allowedRole="partner_requester">
                <TechProfilePage />
              </RoleGuard>
            }
          />

          {/* 4. PORTAL DO TÉCNICO */}
          <Route
            path="/tecnico/disponiveis"
            element={
              <RoleGuard allowedRole="technician">
                <TechAvailablePage />
              </RoleGuard>
            }
          />
          <Route
            path="/tecnico/agenda"
            element={
              <RoleGuard allowedRole="technician">
                <TechAgendaPage />
              </RoleGuard>
            }
          />
          <Route
            path="/tecnico/agenda/:id"
            element={
              <RoleGuard allowedRole="technician">
                <OrderDetailView backRoute="/tecnico/agenda" />
              </RoleGuard>
            }
          />
          <Route
            path="/tecnico/km"
            element={
              <RoleGuard allowedRole="technician">
                <TechMileagePage />
              </RoleGuard>
            }
          />
          <Route
            path="/tecnico/ganhos"
            element={
              <RoleGuard allowedRole="technician">
                <TechEarningsPage />
              </RoleGuard>
            }
          />
          <Route
            path="/tecnico/perfil"
            element={
              <RoleGuard allowedRole="technician">
                <TechProfilePage />
              </RoleGuard>
            }
          />

          {/* 5. PORTAL DO CLIENTE FINAL */}
          <Route
            path="/cliente/agendar"
            element={
              <RoleGuard allowedRole="customer">
                <CustomerBookPage />
              </RoleGuard>
            }
          />
          <Route
            path="/cliente/servicos"
            element={
              <RoleGuard allowedRole="customer">
                <CustomerOrdersPage />
              </RoleGuard>
            }
          />
          <Route
            path="/cliente/servicos/:id"
            element={
              <RoleGuard allowedRole="customer">
                <OrderDetailView backRoute="/cliente/servicos" />
              </RoleGuard>
            }
          />
          <Route
            path="/cliente/perfil"
            element={
              <RoleGuard allowedRole="customer">
                <CustomerProfilePage />
              </RoleGuard>
            }
          />

          <Route path="*" element={<RootRedirect />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </RealtimeProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
