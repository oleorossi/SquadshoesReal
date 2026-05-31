import * as React from 'react';
import { CheckCircle as CheckCircle2, Warning as AlertTriangle, XCircle, TrendUp as TrendingUp, TrendDown as TrendingDown, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

// ─── Color palettes (semantic — exempt from design-token rule per CLAUDE.md) ───

const STATUS_PALETTE = {
  run:     { bg: 'hsl(158 60% 94%)', text: 'hsl(158 80% 22%)', dot: 'hsl(158 64% 38%)', shadow: 'hsl(158 64% 38% / 0.18)' },
  queued:  { bg: 'hsl(217 91% 95%)', text: 'hsl(217 80% 38%)', dot: 'hsl(217 91% 55%)', shadow: '' },
  paused:  { bg: 'hsl(38 92% 95%)',  text: 'hsl(28 80% 30%)',  dot: 'hsl(38 92% 50%)',  shadow: '' },
  blocked: { bg: 'hsl(0 84% 96%)',   text: 'hsl(0 70% 38%)',   dot: 'hsl(0 78% 58%)',   shadow: '' },
  qc:      { bg: 'hsl(269 50% 96%)', text: 'hsl(269 60% 38%)', dot: 'hsl(269 60% 55%)', shadow: '' },
  done:    { bg: 'hsl(200 14% 93%)', text: 'hsl(200 12% 35%)', dot: 'hsl(200 12% 50%)', shadow: '' },
} as const;

const STAGE_PALETTE = {
  cut:  { bg: 'hsl(217 91% 95%)', text: 'hsl(217 80% 38%)' },
  sew:  { bg: 'hsl(269 50% 96%)', text: 'hsl(269 60% 38%)' },
  assy: { bg: 'hsl(38 92% 95%)',  text: 'hsl(28 80% 30%)' },
  fin:  { bg: 'hsl(192 50% 94%)', text: 'hsl(192 75% 21%)' },
  pack: { bg: 'hsl(8 100% 95%)',  text: 'hsl(8 70% 45%)' },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. StatusPill — production order states
// ─────────────────────────────────────────────────────────────────────────────

export type OrderStatusKey = keyof typeof STATUS_PALETTE;

const STATUS_LABELS: Record<OrderStatusKey, string> = {
  run:     'Em produção',
  queued:  'Na fila',
  paused:  'Pausada',
  blocked: 'Bloqueada',
  qc:      'Qualidade',
  done:    'Concluída',
};

/** Maps the app's canonical order status strings to the design-system key. */
export function canonicalStatusToKey(status?: string | null): OrderStatusKey {
  const s = (status ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  if (s === 'em producao') return 'run';
  if (s === 'reservado')   return 'queued';
  if (s === 'pausada' || s === 'paused') return 'paused';
  if (s === 'bloqueada' || s === 'blocked') return 'blocked';
  if (s === 'qualidade' || s === 'qc') return 'qc';
  return 'done'; // Finalizado, Cancelada, Rascunho → neutral done
}

interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: OrderStatusKey;
}

export function StatusPill({ status, className, ...props }: StatusPillProps) {
  const p = STATUS_PALETTE[status];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold tracking-[0.005em]', className)}
      style={{ background: p.bg, color: p.text }}
      {...props}
    >
      <span
        className="inline-block shrink-0 rounded-full"
        style={{
          width: 6, height: 6,
          background: p.dot,
          boxShadow: p.shadow ? `0 0 0 3px ${p.shadow}` : undefined,
        }}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. StageBadge — manufacturing phase
// ─────────────────────────────────────────────────────────────────────────────

export type StageKey = keyof typeof STAGE_PALETTE;

const STAGE_LABELS: Record<StageKey, string> = {
  cut:  'CORTE',
  sew:  'COSTURA',
  assy: 'MONTAGEM',
  fin:  'ACABAMENTO',
  pack: 'EMBALAGEM',
};

interface StageBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  stage: StageKey;
}

export function StageBadge({ stage, className, ...props }: StageBadgeProps) {
  const p = STAGE_PALETTE[stage];
  return (
    <span
      className={cn('inline-flex items-center rounded-md px-2 py-[3px] text-xs font-bold font-mono tracking-[0.05em]', className)}
      style={{ background: p.bg, color: p.text }}
      {...props}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PriorityBadge
// ─────────────────────────────────────────────────────────────────────────────

export type PriorityKey = 'urgent' | 'high' | 'medium' | 'low';

interface PriorityBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  priority: PriorityKey;
}

export function PriorityBadge({ priority, className, ...props }: PriorityBadgeProps) {
  const styles: Record<PriorityKey, React.CSSProperties> = {
    urgent: {
      background: 'hsl(8 88% 67%)',
      color: '#fff',
      boxShadow: '0 2px 4px hsl(8 88% 50% / 0.3)',
      border: 'none',
    },
    high: {
      background: 'hsl(0 84% 96%)',
      color: 'hsl(0 70% 38%)',
      border: '1px solid hsl(0 84% 88%)',
    },
    medium: {
      background: 'hsl(38 92% 95%)',
      color: 'hsl(28 80% 30%)',
      border: '1px solid hsl(38 92% 85%)',
    },
    low: {
      background: 'hsl(200 14% 93%)',
      color: 'hsl(200 12% 35%)',
      border: '1px solid hsl(200 14% 86%)',
    },
  };

  const labels: Record<PriorityKey, string> = {
    urgent: '★ Urgente',
    high:   'Alta',
    medium: 'Média',
    low:    'Baixa',
  };

  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-[5px] px-2 py-[3px] text-xs font-bold font-mono uppercase tracking-[0.06em]', className)}
      style={styles[priority]}
      {...props}
    >
      {labels[priority]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. StockBadge — inventory level indicator
// ─────────────────────────────────────────────────────────────────────────────

export type StockLevelKey = 'ok' | 'low' | 'out';

interface StockBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  level: StockLevelKey;
  children?: React.ReactNode;
}

export function StockBadge({ level, children, className, ...props }: StockBadgeProps) {
  const palette: Record<StockLevelKey, { bg: string; text: string; icon: React.ReactNode }> = {
    ok:  { bg: 'hsl(158 60% 94%)', text: 'hsl(158 80% 22%)', icon: <CheckCircle2 className="h-[11px] w-[11px]" /> },
    low: { bg: 'hsl(38 92% 95%)',  text: 'hsl(28 80% 30%)',  icon: <AlertTriangle className="h-[11px] w-[11px]" /> },
    out: { bg: 'hsl(0 84% 96%)',   text: 'hsl(0 70% 38%)',   icon: <XCircle className="h-[11px] w-[11px]" /> },
  };

  const defaults: Record<StockLevelKey, string> = {
    ok:  'Disponível',
    low: 'Estoque baixo',
    out: 'Em falta',
  };

  const p = palette[level];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold', className)}
      style={{ background: p.bg, color: p.text }}
      {...props}
    >
      {p.icon}
      {children ?? defaults[level]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DefectTag — removable non-conformity tag
// ─────────────────────────────────────────────────────────────────────────────

interface DefectTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  onRemove?: () => void;
  children: React.ReactNode;
}

export function DefectTag({ onRemove, children, className, ...props }: DefectTagProps) {
  return (
    <span
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-[10px] py-1 text-xs font-medium',
        className,
      )}
      style={{
        borderColor: 'hsl(0 84% 88%)',
        background: 'hsl(0 84% 96%)',
        color: 'hsl(0 70% 38%)',
      }}
      {...props}
    >
      <AlertTriangle className="h-[11px] w-[11px] shrink-0" />
      {children}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 opacity-60 hover:opacity-100 text-[14px] font-bold leading-none"
          aria-label="Remover"
          type="button"
        >
          ×
        </button>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. FilterChip — catalog / list filter
// ─────────────────────────────────────────────────────────────────────────────

interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number;
  children: React.ReactNode;
}

export function FilterChip({ active, count, children, className, ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border px-[11px] py-[5px] text-xs font-semibold transition-all duration-150',
        active
          ? 'text-white shadow-[0_2px_4px_hsl(192_75%_21%/0.18)]'
          : 'border-[hsl(200_14%_88%)] bg-card text-[hsl(200_12%_45%)] hover:border-[hsl(192_75%_21%)] hover:text-[hsl(192_75%_21%)]',
        className,
      )}
      style={active ? { background: 'hsl(192 75% 21%)', borderColor: 'hsl(192 75% 21%)' } : undefined}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span
          className="rounded-[4px] px-[5px] py-px font-mono text-xs"
          style={
            active
              ? { background: 'hsl(192 75% 14%)', color: 'hsl(192 50% 90%)' }
              : { background: 'hsl(200 14% 93%)', color: 'hsl(200 12% 45%)' }
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. AssigneeChip — operator / responsible person
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'hsl(192 75% 30%)',
  'hsl(8 70% 50%)',
  'hsl(269 60% 50%)',
  'hsl(158 64% 38%)',
] as const;

interface AssigneeChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  initials: string;
  colorIndex?: number;
  children: React.ReactNode;
}

export function AssigneeChip({ initials, colorIndex = 0, children, className, ...props }: AssigneeChipProps) {
  const avatarBg = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border py-[3px] pr-[9px] pl-[3px] text-xs font-semibold',
        className,
      )}
      style={{
        background: 'hsl(200 16% 96%)',
        borderColor: 'hsl(200 14% 90%)',
        color: 'hsl(200 30% 18%)',
      }}
      {...props}
    >
      <span
        className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase tracking-[0.04em] text-white"
        style={{ background: avatarBg }}
      >
        {initials}
      </span>
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. VersionTag — lot / reference / version (monospace)
// ─────────────────────────────────────────────────────────────────────────────

export type VersionTagVariant = 'default' | 'peat' | 'coral';

interface VersionTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: VersionTagVariant;
  children: React.ReactNode;
}

export function VersionTag({ variant = 'default', children, className, ...props }: VersionTagProps) {
  const styles: Record<VersionTagVariant, React.CSSProperties> = {
    default: {
      background: 'hsl(200 14% 93%)',
      color: 'hsl(200 30% 18%)',
      borderColor: 'hsl(200 14% 88%)',
    },
    peat: {
      background: 'hsl(192 50% 94%)',
      color: 'hsl(192 75% 21%)',
      borderColor: 'hsl(192 50% 86%)',
    },
    coral: {
      background: 'hsl(8 100% 95%)',
      color: 'hsl(8 70% 45%)',
      borderColor: 'hsl(8 100% 88%)',
    },
  };

  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-[4px] border px-[7px] py-[2px] font-mono text-xs font-bold', className)}
      style={styles[variant]}
      {...props}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. DeltaBadge — KPI trend indicator
// ─────────────────────────────────────────────────────────────────────────────

export type DeltaDirection = 'up' | 'down' | 'flat';

interface DeltaBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  direction: DeltaDirection;
  children: React.ReactNode;
}

export function DeltaBadge({ direction, children, className, ...props }: DeltaBadgeProps) {
  const palette: Record<DeltaDirection, { bg: string; text: string; icon: React.ReactNode }> = {
    up:   { bg: 'hsl(158 60% 94%)', text: 'hsl(158 80% 22%)', icon: <TrendingUp className="h-[11px] w-[11px]" /> },
    down: { bg: 'hsl(0 84% 96%)',   text: 'hsl(0 70% 38%)',   icon: <TrendingDown className="h-[11px] w-[11px]" /> },
    flat: { bg: 'hsl(200 14% 93%)', text: 'hsl(200 12% 40%)', icon: null },
  };
  const p = palette[direction];
  return (
    <span
      className={cn('inline-flex items-center gap-[3px] rounded-[5px] px-[7px] py-[2px] font-mono text-xs font-bold', className)}
      style={{ background: p.bg, color: p.text }}
      {...props}
    >
      {p.icon}
      {children}
    </span>
  );
}

// Arrow variant (up/down with plain arrow icon instead of trend line)
interface ArrowDeltaBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  direction: 'up' | 'down';
  children: React.ReactNode;
}

export function ArrowDeltaBadge({ direction, children, className, ...props }: ArrowDeltaBadgeProps) {
  const palette = {
    up:   { bg: 'hsl(158 60% 94%)', text: 'hsl(158 80% 22%)', icon: <ArrowUp className="h-[11px] w-[11px]" /> },
    down: { bg: 'hsl(0 84% 96%)',   text: 'hsl(0 70% 38%)',   icon: <ArrowDown className="h-[11px] w-[11px]" /> },
  };
  const p = palette[direction];
  return (
    <span
      className={cn('inline-flex items-center gap-[3px] rounded-[5px] px-[7px] py-[2px] font-mono text-xs font-bold', className)}
      style={{ background: p.bg, color: p.text }}
      {...props}
    >
      {p.icon}
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. CountBadge — notification / pending count
// ─────────────────────────────────────────────────────────────────────────────

export type CountBadgeVariant = 'coral' | 'peat' | 'muted';

interface CountBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: CountBadgeVariant;
  children: React.ReactNode;
}

export function CountBadge({ variant = 'muted', children, className, ...props }: CountBadgeProps) {
  const styles: Record<CountBadgeVariant, React.CSSProperties> = {
    coral: { background: 'hsl(8 88% 67%)',  color: '#fff' },
    peat:  { background: 'hsl(192 75% 21%)', color: '#fff' },
    muted: { background: 'hsl(200 14% 93%)', color: 'hsl(200 30% 18%)' },
  };
  return (
    <span
      className={cn('inline-block min-w-[20px] rounded-[4px] px-1.5 py-px text-center font-mono text-xs font-bold', className)}
      style={styles[variant]}
      {...props}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. MaterialTag — material category with color swatch
// ─────────────────────────────────────────────────────────────────────────────

interface MaterialTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  swatchColor: string;
  children: React.ReactNode;
}

export function MaterialTag({ swatchColor, children, className, ...props }: MaterialTagProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-[6px] border border-border bg-card px-[10px] py-1 text-xs font-semibold text-foreground', className)}
      {...props}
    >
      <span
        className="inline-block h-[10px] w-[10px] shrink-0 rounded-[3px]"
        style={{
          background: swatchColor,
          border: '1px solid rgb(0 0 0 / 0.08)',
        }}
      />
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. LiveIndicator — real-time production line indicator
// ─────────────────────────────────────────────────────────────────────────────

interface LiveIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  current: number;
  total: number;
}

export function LiveIndicator({ label, current, total, className, ...props }: LiveIndicatorProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-2 rounded-[8px] px-[14px] py-2 text-sm font-semibold text-white', className)}
      style={{ background: 'hsl(215 35% 8%)' }}
      {...props}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full animate-pulse"
        style={{
          background: 'hsl(8 88% 67%)',
          boxShadow: '0 0 0 3px hsl(8 88% 67% / 0.3)',
        }}
      />
      {label} — Produzindo ·{' '}
      <span className="font-mono font-bold" style={{ color: 'hsl(8 100% 88%)' }}>
        {current}/{total}
      </span>{' '}
      pares
    </div>
  );
}
