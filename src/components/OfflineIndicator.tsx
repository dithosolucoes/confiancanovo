import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

export function OfflineIndicator() {
  const { t } = useI18n();
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="bg-amber-600 px-4 py-1.5 text-center text-xs font-medium text-white flex items-center justify-center gap-2">
      <WifiOff className="h-3.5 w-3.5" />
      <span>{t('pwa.offline')}</span>
    </div>
  );
}
