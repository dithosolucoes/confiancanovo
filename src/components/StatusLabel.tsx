import {
  CheckCircle2,
  Clock,
  Navigation,
  Wrench,
  FileSpreadsheet,
  CreditCard,
  XCircle,
  UserCheck,
  AlertCircle,
} from 'lucide-react';
import type { QuoteStatus, ServiceStatus } from '../types/domain';

const SERVICE_STATUS_MAP: Record<
  ServiceStatus,
  { label: string; colorClass: string; Icon: typeof Clock }
> = {
  pending: { label: 'Aguardando Técnico', colorClass: 'text-amber-700', Icon: Clock },
  accepted: { label: 'Aceite', colorClass: 'text-sky-700', Icon: UserCheck },
  on_the_way: { label: 'A Caminho', colorClass: 'text-blue-700', Icon: Navigation },
  in_progress: { label: 'No Local / Em Curso', colorClass: 'text-indigo-700', Icon: Wrench },
  budgeting: { label: 'Em Orçamentação', colorClass: 'text-violet-700', Icon: FileSpreadsheet },
  payment_pending: { label: 'Aguarda Pagamento', colorClass: 'text-amber-700', Icon: CreditCard },
  completed: { label: 'Concluído', colorClass: 'text-emerald-700', Icon: CheckCircle2 },
  cancelled: { label: 'Cancelado', colorClass: 'text-rose-700', Icon: XCircle },
};

export function ServiceStatusLabel({ status }: { status: ServiceStatus }) {
  const cfg = SERVICE_STATUS_MAP[status] ?? SERVICE_STATUS_MAP.pending;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${cfg.colorClass}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{cfg.label}</span>
    </span>
  );
}

export function QuoteStatusLabel({ status }: { status: QuoteStatus }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>Sem Orçamento</span>
      </span>
    );
  }
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span>Orçamento Enviado</span>
      </span>
    );
  }
  if (status === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Orçamento Aprovado</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span>Orçamento Recusado</span>
    </span>
  );
}
