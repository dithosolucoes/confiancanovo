import React from 'react';
import { MapPin, RefreshCw, ShieldAlert, X } from 'lucide-react';

interface GpsPermissionPromptProps {
  open: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onUseFallback: () => void;
  onClose: () => void;
}

export function GpsPermissionPrompt({
  open,
  errorMessage,
  onRetry,
  onUseFallback,
  onClose,
}: GpsPermissionPromptProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900">
                Permissão de Localização (GPS)
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {errorMessage || 'O navegador bloqueou ou não conseguiu obter a sua posição GPS atual.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2.5 border-y border-slate-100 py-4 text-xs text-slate-600">
          <div className="font-semibold text-slate-800">Como ativar rapidamente:</div>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <strong>Chrome / Android:</strong> toque no ícone de cadeado junto ao endereço →{' '}
              <em>Permissões → Localização → Permitir</em>.
            </li>
            <li>
              <strong>Safari / iPhone:</strong> Definições → Privacidade e Segurança → Serviços de
              Localização → Safari → <em>Durante a utilização</em>.
            </li>
          </ul>
          <p className="text-[11px] text-slate-500">
            Se preferir continuar imediatamente sem GPS preciso, pode usar a estimativa regional da
            sede (Lisboa/Margem Sul).
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onUseFallback}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <MapPin className="h-3.5 w-3.5" />
            Usar Estimativa Regional
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar GPS Novamente
          </button>
        </div>
      </div>
    </div>
  );
}
