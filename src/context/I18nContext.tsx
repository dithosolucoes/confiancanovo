import React, { createContext, useContext, useState } from 'react';
import type { LanguageCode } from '../types/domain';

const TRANSLATIONS: Record<LanguageCode, Record<string, string>> = {
  pt: {
    'app.name': 'Confiança Repara',
    'nav.dashboard': 'Dashboard Executivo',
    'nav.orders': 'Ordens de Serviço',
    'nav.reports': 'Relatórios & Exportação',
    'nav.agenda': 'Agenda em Grade',
    'nav.organizations': 'Empresas & Parceiros',
    'nav.technicians': 'Técnicos',
    'nav.payouts': 'Repasses Semanais',
    'nav.suppliers': 'Fornecedores & Peças',
    'nav.cashflow': 'Caixa & Contas a Pagar',
    'nav.reconciliation': 'Reconciliação',
    'nav.mileage': 'Quilometragem',
    'nav.ratings': 'Avaliações',
    'nav.catalog': 'Catálogo & Taxas Base',
    'nav.businessParams': 'Parâmetros do Negócio',
    'nav.orderLists': 'Tipos & Referências',
    'nav.backup': 'Cópias de Segurança',
    'nav.broadcast': 'Comunicações & E-mail',
    'nav.customers': 'Clientes B2C',
    'nav.invoicing': 'Faturação & Baixa',
    'nav.subscriptions': 'Subscrições',
    'nav.chatInbox': 'Central de Chat',
    'nav.companyDashboard': 'Dashboard Empresa',
    'nav.companyOrders': 'Ordens da Empresa',
    'nav.companyTechs': 'Equipa de Técnicos',
    'nav.partnerNew': 'Abrir Novo Chamado',
    'nav.partnerOrders': 'Meus Chamados',
    'nav.partnerReports': 'Relatórios & Faturação',
    'nav.profile': 'Meu Perfil',
    'nav.techAvailable': 'Mural Disponíveis',
    'nav.techAgenda': 'Minha Agenda',
    'nav.techMileage': 'Quilometragem (Km)',
    'nav.techEarnings': 'Meus Ganhos',
    'nav.customerBook': 'Solicitar & Subscrições',
    'nav.customerOrders': 'Meus Serviços',
    'auth.logout': 'Terminar Sessão',
    'auth.switchPortal': 'Trocar Portal (Demo)',
    'status.pending': 'Aguardando',
    'status.accepted': 'Aceite',
    'status.on_the_way': 'A caminho',
    'status.in_progress': 'No local',
    'status.budgeting': 'Em orçamentação',
    'status.payment_pending': 'Aguardando pagamento',
    'status.completed': 'Concluído',
    'status.cancelled': 'Cancelado',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.edit': 'Editar',
    'common.search': 'Pesquisar...',
    'common.all': 'Todos',
    'pwa.install': 'Instalar App',
    'pwa.offline': 'Modo offline ativo — algumas ações aguardam ligação.',
  },
  en: {
    'app.name': 'Confiança Repara',
    'nav.dashboard': 'Executive Dashboard',
    'nav.orders': 'Work Orders',
    'nav.reports': 'Reports & Export',
    'nav.agenda': 'Schedule Grid',
    'nav.organizations': 'Companies & Partners',
    'nav.technicians': 'Technicians',
    'nav.payouts': 'Weekly Payouts',
    'nav.suppliers': 'Suppliers & Parts',
    'nav.cashflow': 'Cash Flow & Payables',
    'nav.reconciliation': 'Reconciliation',
    'nav.mileage': 'Mileage Tracking',
    'nav.ratings': 'Ratings',
    'nav.catalog': 'Catalog & Base Rates',
    'nav.businessParams': 'Business Parameters',
    'nav.orderLists': 'Types & References',
    'nav.backup': 'Backups',
    'nav.broadcast': 'Email & Broadcast',
    'nav.customers': 'B2C Customers',
    'nav.invoicing': 'Invoicing & Settlements',
    'nav.subscriptions': 'Subscriptions',
    'nav.chatInbox': 'Chat Inbox',
    'nav.companyDashboard': 'Company Dashboard',
    'nav.companyOrders': 'Company Orders',
    'nav.companyTechs': 'Technician Team',
    'nav.partnerNew': 'New Request',
    'nav.partnerOrders': 'My Requests',
    'nav.partnerReports': 'Monthly Reports',
    'nav.profile': 'My Profile',
    'nav.techAvailable': 'Job Board',
    'nav.techAgenda': 'My Schedule',
    'nav.techMileage': 'Mileage (Km)',
    'nav.techEarnings': 'My Earnings',
    'nav.customerBook': 'Book & Subscriptions',
    'nav.customerOrders': 'My Services',
    'auth.logout': 'Sign Out',
    'auth.switchPortal': 'Switch Portal (Demo)',
    'status.pending': 'Pending',
    'status.accepted': 'Accepted',
    'status.on_the_way': 'On the way',
    'status.in_progress': 'In progress',
    'status.budgeting': 'Budgeting',
    'status.payment_pending': 'Payment pending',
    'status.completed': 'Completed',
    'status.cancelled': 'Cancelled',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.edit': 'Edit',
    'common.search': 'Search...',
    'common.all': 'All',
    'pwa.install': 'Install App',
    'pwa.offline': 'Offline mode active — syncing paused until reconnected.',
  },
  es: {
    'app.name': 'Confiança Repara',
    'nav.dashboard': 'Panel Ejecutivo',
    'nav.orders': 'Órdenes de Servicio',
    'nav.reports': 'Informes y Exportación',
    'nav.agenda': 'Agenda Semanal',
    'nav.organizations': 'Empresas y Socios',
    'nav.technicians': 'Técnicos',
    'nav.payouts': 'Pagos Semanales',
    'nav.suppliers': 'Proveedores y Piezas',
    'nav.cashflow': 'Caja y Cuentas por Pagar',
    'nav.reconciliation': 'Reconciliación',
    'nav.mileage': 'Kilometraje',
    'nav.ratings': 'Valoraciones',
    'nav.catalog': 'Catálogo y Tarifas',
    'nav.businessParams': 'Parámetros del Negocio',
    'nav.orderLists': 'Tipos y Referencias',
    'nav.backup': 'Copias de Seguridad',
    'nav.broadcast': 'Correos y Avisos',
    'nav.customers': 'Clientes B2C',
    'nav.invoicing': 'Facturación y Cobros',
    'nav.subscriptions': 'Suscripciones',
    'nav.chatInbox': 'Centro de Chat',
    'nav.companyDashboard': 'Panel Empresa',
    'nav.companyOrders': 'Órdenes de Empresa',
    'nav.companyTechs': 'Equipo Técnico',
    'nav.partnerNew': 'Nueva Solicitud',
    'nav.partnerOrders': 'Mis Solicitudes',
    'nav.partnerReports': 'Informes Mensuales',
    'nav.profile': 'Mi Perfil',
    'nav.techAvailable': 'Mural Disponibles',
    'nav.techAgenda': 'Mi Agenda',
    'nav.techMileage': 'Kilometraje (Km)',
    'nav.techEarnings': 'Mis Ganancias',
    'nav.customerBook': 'Reservar y Planes',
    'nav.customerOrders': 'Mis Servicios',
    'auth.logout': 'Cerrar Sesión',
    'auth.switchPortal': 'Cambiar Portal (Demo)',
    'status.pending': 'Pendiente',
    'status.accepted': 'Aceptado',
    'status.on_the_way': 'En camino',
    'status.in_progress': 'En curso',
    'status.budgeting': 'Presupuestando',
    'status.payment_pending': 'Pago pendiente',
    'status.completed': 'Completado',
    'status.cancelled': 'Cancelado',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.edit': 'Editar',
    'common.search': 'Buscar...',
    'common.all': 'Todos',
    'pwa.install': 'Instalar App',
    'pwa.offline': 'Modo sin conexión — algunas acciones esperan red.',
  },
};

interface I18nContextValue {
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(() => {
    const saved = localStorage.getItem('confianca_lang');
    return saved === 'en' || saved === 'es' ? saved : 'pt';
  });

  function setLang(next: LanguageCode) {
    setLangState(next);
    localStorage.setItem('confianca_lang', next);
  }

  function t(key: string, fallback?: string): string {
    return TRANSLATIONS[lang][key] || TRANSLATIONS.pt[key] || fallback || key;
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
