/**
 * StatNumber — número de KPI/métrica em ANTON (display), FONTE ÚNICA da proporção
 * do número em todos os stat cards do sistema (StatCard, KPICard, StatsCard,
 * StatusCard, KPIsRH, …).
 *
 * Por que existe: antes cada card tinha seu número (Anton 38 / 34, mono 24, …) —
 * proporções divergentes página a página. Centralizar garante o MESMO tamanho +
 * comportamento em todo lugar.
 *
 * Robustez: número grande quando cabe; ENCOLHE pra caber (adaptiveNumberFontSize,
 * diretriz do sistema) quando o valor é longo (R$ 1.234.567,89) — sempre completo,
 * NUNCA trunca.
 */
import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { adaptiveNumberFontSize } from '@/lib/adaptiveFontSize';

export type StatTone = 'default' | 'primary' | 'success' | 'warning' | 'destructive';

const TONE: Record<StatTone, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  destructive: 'text-destructive',
};

interface StatNumberProps {
  /** Valor — string/number adapta o tamanho; ReactNode renderiza no tamanho base. */
  value: ReactNode;
  /** Sufixo curto (%, pares, un) em sans menor ao lado do número. */
  unit?: string;
  /** Cor do número. Ignorado se `className` trouxer cor (ex.: cards tonalizados). */
  tone?: StatTone;
  /** Tamanho base em px quando há espaço (default 38). Use menor em layouts densos. */
  base?: number;
  /** Piso do tamanho (default 18). */
  min?: number;
  /** Classes extras no número (ex.: cor herdada `text-current`). */
  className?: string;
}

export function StatNumber({ value, unit, tone = 'default', base = 38, min = 18, className }: StatNumberProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [fontPx, setFontPx] = useState(base);
  const valueStr = typeof value === 'string' || typeof value === 'number' ? String(value) : null;

  useLayoutEffect(() => {
    if (valueStr == null) { setFontPx(base); return; }
    const el = rowRef.current;
    if (!el) return;
    const calc = () => setFontPx(adaptiveNumberFontSize(valueStr, {
      maxWidthPx: Math.max(56, el.clientWidth - (unit ? 32 : 2)), baseFontPx: base, minFontPx: min,
    }));
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [valueStr, unit, base, min]);

  return (
    <div ref={rowRef} className="flex items-baseline gap-1.5 min-w-0">
      <span
        className={cn('font-display leading-[0.9] tracking-tight tabular-nums truncate', className || TONE[tone])}
        style={{ fontSize: fontPx }}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
      {unit && <span className="text-sm text-muted-foreground font-semibold shrink-0 mb-0.5">{unit}</span>}
    </div>
  );
}
