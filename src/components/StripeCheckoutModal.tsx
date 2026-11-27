import { useEffect, useState } from 'react';
import {
  CreditCard,
  Lock,
  CheckCircle2,
  X,
  Smartphone,
  Building2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { apiFetch, formatEUR } from '../lib/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  serviceOrderId: string;
  paymentType: 'service_fee' | 'quote_total' | 'full';
  onSuccess: () => void;
}

export function StripeCheckoutModal({
  isOpen,
  onClose,
  serviceOrderId,
  paymentType,
  onSuccess,
}: Props) {
  const [step, setStep] = useState<'method' | 'processing' | 'stripe_external' | 'done'>('method');
  const [selectedMethod, setSelectedMethod] = useState<'Cartão' | 'Multibanco' | 'MB Way'>('MB Way');
  const [sessionInfo, setSessionInfo] = useState<{
    sessionId: string;
    checkoutUrl?: string | null;
    stripeConfigured?: boolean;
    amountToCharge: number;
    vatAmount: number;
    vatRate: number;
    referenceCode: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep('method');
      setSessionInfo(null);
      setError(null);
      setVerifying(false);
    }
  }, [isOpen, serviceOrderId, paymentType]);

  if (!isOpen) return null;

  async function initCheckout() {
    setError(null);
    setStep('processing');
    try {
      const checkout = await apiFetch<{
        sessionId: string;
        checkoutUrl?: string | null;
        stripeConfigured?: boolean;
        amountToCharge: number;
        vatAmount: number;
        vatRate: number;
        referenceCode: string;
      }>('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({ serviceOrderId, paymentType }),
      });
      setSessionInfo(checkout);

      if (checkout.stripeConfigured && checkout.checkoutUrl) {
        setStep('stripe_external');
        return;
      }

      // Preview / Dev environment fallback when STRIPE_SECRET_KEY is not active
      await apiFetch('/api/payments/confirm-preview', {
        method: 'POST',
        body: JSON.stringify({ sessionId: checkout.sessionId }),
      });

      setStep('done');
      onSuccess();
    } catch (err: any) {
      setError(err.message);
      setStep('method');
    }
  }

  async function handleVerifyPending() {
    setError(null);
    setVerifying(true);
    try {
      const res = await apiFetch<{
        checked: number;
        settled: number;
        stillPending: number;
      }>('/api/payments/verify-pending', {
        method: 'POST',
        body: JSON.stringify({ serviceOrderId }),
      });
      if (res.settled > 0) {
        if (!sessionInfo) {
          setSessionInfo({
            sessionId: 'verified',
            amountToCharge: 0,
            vatAmount: 0,
            vatRate: 23,
            referenceCode: 'Ordem Atualizada',
          });
        }
        setStep('done');
        onSuccess();
      } else {
        setError(
          res.checked === 0
            ? 'Nenhuma sessão pendente encontrada para esta ordem.'
            : 'O pagamento ainda aguarda confirmação do webhook Stripe.'
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900">
              Pagamento Seguro · Stripe Portugal
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          {step === 'method' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Selecione o método de pagamento para concluir a liquidação (
                {paymentType === 'service_fee'
                  ? 'Taxa de Deslocação Inicial'
                  : paymentType === 'quote_total'
                  ? 'Orçamento Aprovado'
                  : 'Serviço Completo'}
                ). O total é calculado automaticamente no servidor.
              </p>

              <div className="space-y-2">
                {(
                  [
                    { id: 'MB Way', desc: 'Confirmação instantânea por telemóvel', Icon: Smartphone },
                    { id: 'Multibanco', desc: 'Entidade e Referência automática', Icon: Building2 },
                    { id: 'Cartão', desc: 'Visa, Mastercard ou Apple Pay', Icon: CreditCard },
                  ] as const
                ).map(({ id, desc, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedMethod(id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                      selectedMethod === id
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Icon className="h-5 w-5 text-slate-700 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-slate-900">{id}</div>
                      <div className="text-xs text-slate-500">{desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={verifying}
                  onClick={handleVerifyPending}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} />
                  <span>Verificar Pendentes</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={initCheckout}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Avançar ({selectedMethod})
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
              <p className="text-sm font-medium text-slate-900">
                A preparar sessão Stripe e calcular IVA no servidor...
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Proteção anti-adulteração e verificação de webhook ativa.
              </p>
            </div>
          )}

          {step === 'stripe_external' && sessionInfo && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 tabular-nums space-y-1.5">
                <div className="flex justify-between font-semibold text-slate-900">
                  <span>Ordem {sessionInfo.referenceCode}</span>
                  <span>{formatEUR(sessionInfo.amountToCharge)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>IVA incluído ({sessionInfo.vatRate}%)</span>
                  <span>{formatEUR(sessionInfo.vatAmount)}</span>
                </div>
              </div>

              <a
                href={sessionInfo.checkoutUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                <span>Abrir Página Segura Stripe Checkout</span>
                <ExternalLink className="h-4 w-4" />
              </a>

              <button
                type="button"
                disabled={verifying}
                onClick={handleVerifyPending}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} />
                <span>{verifying ? 'A verificar Stripe...' : 'Já paguei · Confirmar Estado'}</span>
              </button>
            </div>
          )}

          {step === 'done' && sessionInfo && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <div>
                <h4 className="text-base font-semibold text-slate-900">Pagamento Confirmado</h4>
                <p className="mt-1 text-sm text-slate-600">
                  Referência {sessionInfo.referenceCode} · Liquidação registada no Fluxo de Caixa.
                </p>
              </div>
              {sessionInfo.amountToCharge > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left text-xs text-slate-600 tabular-nums">
                  <div className="flex justify-between">
                    <span>Valor Pago ({selectedMethod})</span>
                    <span className="font-semibold text-slate-900">
                      {formatEUR(sessionInfo.amountToCharge)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>IVA incluído ({sessionInfo.vatRate}%)</span>
                    <span>{formatEUR(sessionInfo.vatAmount)}</span>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Concluir
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

