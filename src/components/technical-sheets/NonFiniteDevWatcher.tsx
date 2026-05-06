import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface NonFiniteEventDetail {
  label: string;
  valueType: string;
  value: string;
  timestamp: number;
}

/**
 * Dev-only watcher that listens for `ficha-tecnica:non-finite` events
 * dispatched by `parseSafeNumber` / `safeToFixed` / `formatCurrency`.
 *
 * Renders an inline banner at the top of the page and emits a sonner toast
 * with the field label so we can pinpoint which input is sending bad data.
 * Returns `null` (no-op) in production builds.
 */
export function NonFiniteDevWatcher() {
  const [events, setEvents] = useState<NonFiniteEventDetail[]>([]);
  const isDev = (import.meta as any).env?.DEV === true;

  useEffect(() => {
    if (!isDev) return;
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<NonFiniteEventDetail>).detail;
      if (!detail) return;
      setEvents((prev) => {
        // Dedupe by label so the banner stays compact
        if (prev.some((e) => e.label === detail.label)) return prev;
        return [...prev, detail];
      });
      toast.warning(`Valor não-finito em "${detail.label}"`, {
        description: `Tipo: ${detail.valueType} • Valor: ${detail.value}`,
        duration: 6000,
      });
    };
    window.addEventListener('ficha-tecnica:non-finite', handler as EventListener);
    return () => window.removeEventListener('ficha-tecnica:non-finite', handler as EventListener);
  }, [isDev]);

  if (!isDev || events.length === 0) return null;

  return (
    <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-700 dark:text-amber-400">
            [DEV] Valores não-finitos detectados ({events.length})
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-amber-800 dark:text-amber-300">
            {events.map((e) => (
              <li key={e.label} className="truncate">
                <span className="font-semibold">{e.label}</span>
                {' → '}
                <span className="opacity-80">{e.valueType}: {e.value}</span>
              </li>
            ))}
          </ul>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 text-amber-700 hover:bg-amber-500/20"
          onClick={() => setEvents([])}
          aria-label="Dispensar avisos"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}