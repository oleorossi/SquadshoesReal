import { useEffect, useState } from 'react';

/**
 * Hook que reflete navigator.onLine + ouve events `online`/`offline`.
 *
 * Em iOS o `online` event é confiável quando volta WiFi, mas em túnel/elevador
 * com perda momentânea pode demorar. Pra cobrir esse gap, a sync engine
 * (mobileSync.ts) também tenta sync no `visibilitychange` (quando user
 * abre/desbloqueia o app).
 */
export const useOnlineStatus = (): boolean => {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const setOn = () => setOnline(true);
    const setOff = () => setOnline(false);
    window.addEventListener('online', setOn);
    window.addEventListener('offline', setOff);
    return () => {
      window.removeEventListener('online', setOn);
      window.removeEventListener('offline', setOff);
    };
  }, []);

  return online;
};
