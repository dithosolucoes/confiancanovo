import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Building2,
  Users,
  Wallet,
  Truck,
  Landmark,
  MapPin,
  BookOpen,
  SlidersHorizontal,
  Bell,
  LogOut,
  Menu,
  X,
  PlusCircle,
  FileBarChart,
  CalendarDays,
  UserCircle,
  Briefcase,
  ChevronRight,
  ArrowLeftRight,
  Star,
  ShieldCheck,
  Mail,
  MessageSquare,
  Receipt,
  Repeat,
  UserCheck,
} from 'lucide-react';
import { useAuth, ROLE_HOME_ROUTES, ROLE_LABELS } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useRealtime } from '../context/RealtimeContext';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineIndicator } from './OfflineIndicator';
import { AiAssistant } from './AiAssistant';
import { DatabaseBackup, ListChecks } from 'lucide-react';
import { apiFetch, formatDatePT } from '../lib/api';
import type { AppNotification, LanguageCode, UserRole } from '../types/domain';

interface NavItem {
  labelKey: string;
  to: string;
  icon: typeof LayoutDashboard;
}

const PORTAL_NAV: Record<UserRole, NavItem[]> = {
  super_admin: [
    { labelKey: 'nav.dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
    { labelKey: 'nav.orders', to: '/admin/servicos', icon: ClipboardList },
    { labelKey: 'nav.reports', to: '/admin/relatorios', icon: FileBarChart },
    { labelKey: 'nav.agenda', to: '/admin/agenda', icon: CalendarDays },
    { labelKey: 'nav.organizations', to: '/admin/empresas', icon: Building2 },
    { labelKey: 'nav.customers', to: '/admin/clientes', icon: UserCheck },
    { labelKey: 'nav.technicians', to: '/admin/tecnicos', icon: Users },
    { labelKey: 'nav.invoicing', to: '/admin/faturacao', icon: Receipt },
    { labelKey: 'nav.payouts', to: '/admin/financeiro/repasses', icon: Wallet },
    { labelKey: 'nav.suppliers', to: '/admin/financeiro/fornecedores', icon: Truck },
    { labelKey: 'nav.cashflow', to: '/admin/financeiro/caixa', icon: Landmark },
    { labelKey: 'nav.subscriptions', to: '/admin/subscricoes', icon: Repeat },
    { labelKey: 'nav.reconciliation', to: '/admin/administracao', icon: ShieldCheck },
    { labelKey: 'nav.mileage', to: '/admin/quilometragem', icon: MapPin },
    { labelKey: 'nav.ratings', to: '/admin/avaliacoes', icon: Star },
    { labelKey: 'nav.catalog', to: '/admin/catalogo', icon: BookOpen },
    { labelKey: 'nav.businessParams', to: '/admin/parametros', icon: SlidersHorizontal },
    { labelKey: 'nav.orderLists', to: '/admin/listas', icon: ListChecks },
    { labelKey: 'nav.backup', to: '/admin/copias', icon: DatabaseBackup },
    { labelKey: 'nav.chatInbox', to: '/admin/chat', icon: MessageSquare },
    { labelKey: 'nav.broadcast', to: '/admin/comunicacoes', icon: Mail },
    { labelKey: 'nav.profile', to: '/admin/perfil', icon: UserCircle },
  ],
  company_admin: [
    { labelKey: 'nav.companyDashboard', to: '/empresa/dashboard', icon: LayoutDashboard },
    { labelKey: 'nav.companyOrders', to: '/empresa/servicos', icon: ClipboardList },
    { labelKey: 'nav.agenda', to: '/empresa/agenda', icon: CalendarDays },
    { labelKey: 'nav.companyTechs', to: '/empresa/tecnicos', icon: Users },
    { labelKey: 'nav.payouts', to: '/empresa/repasses', icon: Wallet },
    { labelKey: 'nav.profile', to: '/empresa/perfil', icon: UserCircle },
  ],
  partner_requester: [
    { labelKey: 'nav.partnerNew', to: '/parceiro/novo-pedido', icon: PlusCircle },
    { labelKey: 'nav.partnerOrders', to: '/parceiro/servicos', icon: ClipboardList },
    { labelKey: 'nav.partnerReports', to: '/parceiro/relatorios', icon: FileBarChart },
    { labelKey: 'nav.profile', to: '/parceiro/perfil', icon: UserCircle },
  ],
  technician: [
    { labelKey: 'nav.techAvailable', to: '/tecnico/disponiveis', icon: Briefcase },
    { labelKey: 'nav.techAgenda', to: '/tecnico/agenda', icon: CalendarDays },
    { labelKey: 'nav.techMileage', to: '/tecnico/km', icon: MapPin },
    { labelKey: 'nav.techEarnings', to: '/tecnico/ganhos', icon: Wallet },
    { labelKey: 'nav.profile', to: '/tecnico/perfil', icon: UserCircle },
  ],
  customer: [
    { labelKey: 'nav.customerBook', to: '/cliente/agendar', icon: PlusCircle },
    { labelKey: 'nav.customerOrders', to: '/cliente/servicos', icon: ClipboardList },
    { labelKey: 'nav.profile', to: '/cliente/perfil', icon: UserCircle },
  ],
};

const DEMO_ACCOUNTS = [
  { id: 'user-admin-diego', label: 'Super Admin (Diego)' },
  { id: 'user-company-ricardo', label: 'Centro Técnico (Margem Sul)' },
  { id: 'user-partner-berens', label: 'Parceiro (Berens Estate)' },
  { id: 'user-tech-joao', label: 'Técnico (João Ferreira)' },
  { id: 'user-customer-maria', label: 'Cliente (Maria Conceição)' },
];

const LANGS: LanguageCode[] = ['pt', 'en', 'es'];

export function PortalLayout({
  title,
  breadcrumb,
  primaryAction,
  children,
}: {
  title: string;
  breadcrumb?: string;
  primaryAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, logout, demoLogin } = useAuth();
  const { lang, setLang, t } = useI18n();
  const { addListener } = useRealtime();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    apiFetch<{ notifications: AppNotification[] }>('/api/notifications')
      .then((res) => setNotifications(res.notifications))
      .catch(() => {});
  }, [location.pathname]);

  useEffect(() => {
    return addListener((evt) => {
      if (evt.type === 'notification:new' && evt.notification) {
        setNotifications((prev) => {
          if (prev.some((n) => n.id === evt.notification.id)) return prev;
          return [evt.notification, ...prev];
        });
      }
    });
  }, [addListener]);

  // Técnico: "Meus ganhos" só aparece se a gestão tiver liberado os repasses para ele
  const [techSeesPayouts, setTechSeesPayouts] = useState(true);
  useEffect(() => {
    if (user?.role !== 'technician') return;
    apiFetch<{ techSeesPayouts: boolean }>('/api/settings/visibility')
      .then((r) => setTechSeesPayouts(r.techSeesPayouts))
      .catch(() => setTechSeesPayouts(true));
  }, [user?.role]);

  const navItems = (PORTAL_NAV[user?.role ?? 'customer'] || []).filter(
    (item) => !(user?.role === 'technician' && item.labelKey === 'nav.techEarnings' && !techSeesPayouts)
  );

  if (!user) return null;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function handleReadAll() {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  async function handleSwitchRole(userId: string) {
    setSwitcherOpen(false);
    const nextUser = await demoLogin(userId);
    navigate(ROLE_HOME_ROUTES[nextUser.role]);
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <OfflineIndicator />

      <div className="flex flex-1 min-h-0">
        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Fixed Sidebar (256px) */}
        <aside
          className={`no-print fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-150 lg:static lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
            <Link
              to={ROLE_HOME_ROUTES[user.role]}
              className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap"
            >
              {t('app.name')}
            </Link>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="border-b border-slate-100 px-5 py-3">
            <div className="text-xs font-medium text-slate-900 truncate">{user.full_name}</div>
            <div className="mt-0.5 text-[11px] text-slate-500 truncate">
              {ROLE_LABELS[user.role]}
              {user.organization_name ? ` · ${user.organization_name}` : ''}
            </div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="border-t border-slate-200 p-3 space-y-1">
            {import.meta.env.DEV && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSwitcherOpen(!switcherOpen)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <span className="flex items-center gap-2 truncate">
                  <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="truncate">{t('auth.switchPortal')}</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              </button>

              {switcherOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-full rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg z-50">
                  {DEMO_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => handleSwitchRole(acc.id)}
                      className={`block w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                        user.id === acc.id
                          ? 'bg-slate-900 font-medium text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {acc.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOut className="h-3.5 w-3.5 shrink-0" />
              <span>{t('auth.logout')}</span>
            </button>
          </div>
        </aside>

        {/* Assistente IA (o gestor atende as conversas encaminhadas, por isso não aparece no seu portal) */}
        {user.role !== 'super_admin' && <AiAssistant />}

        {/* Main Content Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Bar Contract: Breadcrumb on Left, Actions on Right */}
          <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
                aria-label="Abrir menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                  <span>{ROLE_LABELS[user.role]}</span>
                  {breadcrumb && (
                    <>
                      <span aria-hidden="true">/</span>
                      <span className="truncate">{breadcrumb}</span>
                    </>
                  )}
                </div>
                <h1 className="font-display text-base sm:text-lg font-semibold text-slate-900 truncate">
                  {title}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {primaryAction}

              <PWAInstallButton />

              {/* Multi-idioma (PT / EN / ES) */}
              <div className="hidden md:inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {LANGS.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold uppercase transition-colors ${
                      lang === code
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {code}
                  </button>
                ))}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen(!notifOpen)}
                  className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  aria-label="Notificações"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-semibold text-white tabular-nums">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg z-50">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <span className="text-xs font-semibold text-slate-900">
                        Notificações & E-mails
                      </span>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleReadAll}
                          className="text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          Marcar lidas
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-500">
                          Sem notificações recentes.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`p-3.5 text-xs ${n.is_read ? 'bg-white' : 'bg-slate-50'}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-900">{n.title}</span>
                              <span className="text-[11px] text-slate-400">
                                {n.channel === 'email' ? 'E-mail' : 'App'}
                              </span>
                            </div>
                            <p className="mt-1 text-slate-600 leading-relaxed">{n.body}</p>
                            <div className="mt-1.5 text-[11px] text-slate-400 tabular-nums">
                              {formatDatePT(n.created_at, true)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name}
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-700">
                  {user.full_name
                    .split(' ')
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join('')
                    .toUpperCase()}
                </div>
              )}
            </div>
          </header>

          {/* Main Viewport */}
          <main className="mx-auto w-full max-w-[1360px] flex-1 p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

