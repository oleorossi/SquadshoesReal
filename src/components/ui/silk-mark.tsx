/**
 * SilkMark — selo de "silk" (marca estampada) definido pelo solado do produto.
 * Componente do design system "Novidade" (handoff Squad Shoes).
 *
 * Regra de negócio: o solado determina qual silk (HOST, NOVA, PRIME, ICON...) é
 * estampado no calçado. Usar `silkBySolado(solado)` para mapear; o silk padrão
 * é 'HOST' quando não há mapeamento conhecido.
 *
 * Cores via design tokens: variant 'dark' = fundo preto + texto amarelo (padrão
 * da etiqueta Caixa Externa), variant 'light' = traço preto sobre transparente.
 *
 * Uso típico:
 *   <SilkMark silk={silkBySolado(produto.solado)} height={22} variant="dark" />
 */
import { cn } from '@/lib/utils';

export type Silk = 'HOST' | 'NOVA' | 'PRIME' | 'ICON' | (string & {});

interface SilkMarkProps {
  silk?: Silk;
  /** Altura em px (default 22). Largura é dinâmica via padding+texto. */
  height?: number;
  /** 'dark' = fundo preto/texto amarelo (etiqueta caixa externa) · 'light' = traço preto sobre transparente. Default 'dark'. */
  variant?: 'dark' | 'light';
  /** Cor do "amarelo etiqueta" quando variant='dark'. Default token --label-yellow (#FFE94A). */
  yellow?: string;
  className?: string;
}

/** Mapeamento canônico solado → silk. Editar quando novos solados forem catalogados. */
const SOLADO_TO_SILK: Record<string, Silk> = {
  'TR-04': 'HOST',
  'TR-PR': 'HOST',
  'TR-09': 'HOST',
  'TR-14': 'HOST',
  'TR-12': 'NOVA',
  'TR-21': 'NOVA',
  'EVA-22': 'NOVA',
  'PU-08': 'PRIME',
  'COURO-A': 'PRIME',
};

export function silkBySolado(solado?: string | null): Silk {
  if (!solado) return 'HOST';
  return SOLADO_TO_SILK[solado.toUpperCase()] ?? 'HOST';
}

/** Logo SVG inline por silk (24×24, currentColor para herdar fg). */
function SilkLogo({ silk, size }: { silk: Silk; size: number }) {
  const fill = 'currentColor';
  switch (silk) {
    case 'HOST':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M 4 12 L 9 4 L 14 12 L 9 20 Z" fill={fill} />
          <circle cx="17" cy="12" r="3" fill={fill} />
        </svg>
      );
    case 'NOVA':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M 12 2 L 14 10 L 22 12 L 14 14 L 12 22 L 10 14 L 2 12 L 10 10 Z" fill={fill} />
        </svg>
      );
    case 'PRIME':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke={fill} strokeWidth="2.5" />
          <circle cx="12" cy="12" r="3.5" fill={fill} />
        </svg>
      );
    default:
      return null;
  }
}

export function SilkMark({
  silk = 'HOST',
  height = 22,
  variant = 'dark',
  yellow,
  className,
}: SilkMarkProps) {
  const isDark = variant === 'dark';
  // Token --label-yellow (definido em src/index.css). Fallback FFE94A do design ref.
  const yellowColor = yellow || 'var(--label-yellow, #FFE94A)';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 box-border leading-none whitespace-nowrap',
        isDark ? 'bg-foreground' : 'bg-transparent text-foreground border border-foreground',
        className,
      )}
      style={{
        height,
        padding: '2px 8px',
        ...(isDark ? { color: yellowColor } : {}),
      }}
    >
      <SilkLogo silk={silk} size={height - 6} />
      <span
        className="font-[Anton] uppercase"
        style={{ fontFamily: 'Anton, sans-serif', fontSize: height * 0.7, letterSpacing: '0.06em' }}
      >
        {silk}
      </span>
    </span>
  );
}
