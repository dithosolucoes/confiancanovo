import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PortalLayout } from '../../components/PortalLayout';

type ReturnStatus = 'success' | 'cancelled' | 'pending';

const RETURN_VIEWS: Record<
  ReturnStatus,
  { title: string; message: string; className: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    title: 'Pagamento concluído',
    message: 'O seu pagamento foi recebido. Pode acompanhar o estado do pedido na lista de serviços.',
    className: 'text-emerald-700',
    Icon: CheckCircle2,
  },
  cancelled: {
    title: 'Pagamento cancelado',
    message: 'Não foi cobrado nenhum valor. Pode tentar novamente a partir do pedido.',
    className: 'text-rose-700',
    Icon: XCircle,
  },
  pending: {
    title: 'Pagamento pendente',
    message:
      'O pagamento ainda não foi confirmado. Se concluiu o pagamento, aguarde alguns minutos e confira a lista de serviços.',
    className: 'text-amber-700',
    Icon: Clock,
  },
};

function toReturnStatus(raw: string | null): ReturnStatus {
  if (raw === 'success') return 'success';
  if (raw === 'cancelled') return 'cancelled';
  return 'pending';
}

export function PaymentReturnPage() {
  const [searchParams] = useSearchParams();
  const status = toReturnStatus(searchParams.get('stripe_status'));
  const view = RETURN_VIEWS[status];
  const { Icon } = view;

  return (
    <PortalLayout title="Resultado do Pagamento" breadcrumb="Portal do Cliente">
      <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center space-y-4">
        <Icon className={`mx-auto h-10 w-10 ${view.className}`} aria-hidden="true" />
        <h2 className={`text-base font-semibold ${view.className}`}>{view.title}</h2>
        <p className="text-sm text-slate-600">{view.message}</p>
        <div className="pt-2">
          <Link
            to="/cliente/servicos"
            className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Voltar aos meus pedidos
          </Link>
        </div>
      </div>
    </PortalLayout>
  );
}
