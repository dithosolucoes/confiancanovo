import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useI18n } from '../context/I18nContext';

export function PWAInstallButton() {
  const { canPromptInstall, isInstalled, isIOS, triggerInstall } = usePWAInstall();
  const { t } = useI18n();
  const [iosModal, setIosModal] = useState(false);

  if (isInstalled) return null;
  if (!canPromptInstall && !isIOS) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canPromptInstall) {
            void triggerInstall();
          } else if (isIOS) {
            setIosModal(true);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
      >
        <Download className="h-3.5 w-3.5 text-emerald-600" />
        <span className="hidden sm:inline">{t('pwa.install')}</span>
      </button>

      {iosModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900">
                Instalar no iPhone / iPad
              </h4>
              <button
                type="button"
                onClick={() => setIosModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              No Safari, toque no botão <Share className="inline h-3.5 w-3.5 text-slate-900" />{' '}
              <strong>Partilhar</strong> e selecione{' '}
              <strong>Adicionar ao Ecrã Principal</strong>.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
