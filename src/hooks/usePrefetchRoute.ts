import { useCallback, useRef } from 'react';
import { getNavigationResource } from '@/data/navigation';

const prefetched = new Set<string>();

export function usePrefetchRoute() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefetch = useCallback((path: string) => {
    if (prefetched.has(path)) return;

    timerRef.current = setTimeout(() => {
      // O catálogo conhece a relação destino → chunk. Se uma futura rota não
      // tiver loader, hover continua sendo inofensivo em vez de lançar erro.
      const preload = getNavigationResource(path)?.preload;
      if (!preload) return;

      prefetched.add(path);
      preload().catch(() => prefetched.delete(path));
    }, 80);
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { prefetch, cancel };
}
