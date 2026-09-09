import { useEffect, useState, type ReactNode } from 'react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';

/**
 * Adia o mount de filhos pesados até o browser ociar (ou um fallback curto).
 * Usado na aba Engenharia da ficha pra deixar identidade/specs interativos
 * antes de BOM/custos/consumos (Fase 3.3).
 */
export function DeferredMount({
  children,
  fallback,
  idleTimeoutMs = 1200,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  idleTimeoutMs?: number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const mark = () => {
      if (!cancelled) setReady(true);
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(mark, { timeout: idleTimeoutMs });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }

    const timer = setTimeout(mark, Math.min(idleTimeoutMs, 200));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [idleTimeoutMs]);

  if (!ready) {
    return (
      fallback ?? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )
    );
  }

  return <>{children}</>;
}
