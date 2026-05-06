import { useRef, useCallback } from 'react';
import { toast } from 'sonner';

export function useBatchToast() {
  const toastIdRef = useRef<string | number | null>(null);

  const start = useCallback((message: string): string | number => {
    const id = toast.loading(message, { duration: Infinity });
    toastIdRef.current = id;
    return id;
  }, []);

  const update = useCallback((id: string | number, current: number, total: number, label = 'Processando') => {
    const pct = Math.round((current / total) * 100);
    toast.loading(`${label}: ${current}/${total} (${pct}%)`, { id, duration: Infinity });
  }, []);

  const finish = useCallback((id: string | number, message: string) => {
    toast.success(message, { id, duration: 4000 });
    toastIdRef.current = null;
  }, []);

  const error = useCallback((id: string | number, message: string) => {
    toast.error(message, { id, duration: 5000 });
    toastIdRef.current = null;
  }, []);

  const dismiss = useCallback((id: string | number) => {
    toast.dismiss(id);
    toastIdRef.current = null;
  }, []);

  return { start, update, finish, error, dismiss };
}
