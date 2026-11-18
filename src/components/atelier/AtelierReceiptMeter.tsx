/**
 * Saldo conferido do job. O número em Anton é a leitura a um metro;
 * a barra só confirma o mesmo fato e cresce quando a quantidade muda.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

function formatQty(n: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);
}

interface Props {
  received: number;
  pairs: number;
  /** Pares que o operador ainda vai lançar. A faixa clara mostra o depois. */
  preview?: number;
  label: string;
  className?: string;
}

export function AtelierReceiptMeter({ received, pairs, preview = 0, label, className }: Props) {
  const total = Math.max(0, Number(pairs) || 0);
  const done = Math.max(0, Math.min(total, Number(received) || 0));
  const extra = Math.max(0, Number(preview) || 0);
  const after = Math.min(total, done + extra);
  const span = total > 0 ? total : 1;
  const donePct = (done / span) * 100;
  const afterPct = (after / span) * 100;
  const [landed, setLanded] = useState(false);
  const previous = useRef(done);

  useEffect(() => {
    if (previous.current === done) return;
    previous.current = done;
    setLanded(true);
    const timer = window.setTimeout(() => setLanded(false), 900);
    return () => window.clearTimeout(timer);
  }, [done]);

  return (
    <div className={cn('min-w-0', landed && 'kb-landed rounded-sm', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-lg leading-none text-foreground">
          {formatQty(after)}
          <span className="ml-1 font-sans text-[11px] font-normal text-muted-foreground">
            / {formatQty(total)}
          </span>
        </p>
        <span className="truncate text-[10px] text-muted-foreground">{label}</span>
      </div>
      <div
        className="relative mt-1 h-1.5 overflow-hidden bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`${label}: ${formatQty(done)} de ${formatQty(total)} pares`}
      >
        {after > done && (
          <span
            className="atelier-meter-fill absolute inset-y-0 left-0 bg-foreground/25"
            style={{ width: `${afterPct}%` }}
          />
        )}
        <span
          className="atelier-meter-fill absolute inset-y-0 left-0 bg-foreground"
          style={{ width: `${donePct}%` }}
        />
      </div>
    </div>
  );
}
