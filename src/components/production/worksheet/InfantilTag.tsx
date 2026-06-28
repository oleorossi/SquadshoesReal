import type { CSSProperties } from 'react';
import { Baby } from '@phosphor-icons/react';

/**
 * Selos de FAIXA ETÁRIA pras fichas de operador impressas: "INFANTIL" (rosa)
 * e "ADULTO" (cinza). Estilo de PRINT: inline styles + cores hardcoded,
 * print-color-adjust exact pra não desbotar no papel. NÃO usa tokens com
 * alpha (regra do CLAUDE.md pra componentes de impressão).
 *
 * A faixa é determinada pela NUMERAÇÃO da grade (< 33 = infantil), não por
 * shoe_category textual — o texto trazia o ESTILO (Rasteirinha, Sandália…) e
 * quase nunca "Infantil", então as fichas infantis não eram designadas.
 */
const tagStyle = (bg: string, color: string, border: string, compact: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: compact ? '2px' : '4px',
  background: bg,
  color,
  border: `1.5px solid ${border}`,
  borderRadius: '4px',
  padding: compact ? '0 4px' : '2px 7px',
  fontFamily: "'Fira Sans', sans-serif",
  fontSize: compact ? '9px' : '12px',
  fontWeight: 700,
  lineHeight: 1.4,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  WebkitPrintColorAdjust: 'exact',
  printColorAdjust: 'exact',
});

export const InfantilTag = ({ compact = false }: { compact?: boolean }) => (
  <span style={tagStyle('#FCE7F3', '#9D174D', '#DB2777', compact)} aria-label="Pedido infantil">
    <Baby weight="fill" style={{ width: compact ? 11 : 14, height: compact ? 11 : 14 }} />
    Infantil
  </span>
);

export const AdultoTag = ({ compact = false }: { compact?: boolean }) => (
  // Monocromático (branco/preto) pra ficar na paleta da ficha — o azul-ardósia
  // antigo destoava do preto/vermelho/branco. Infantil mantém o rosa por ser o
  // sinal que realmente precisa saltar.
  <span style={tagStyle('#FFFFFF', '#000000', '#000000', compact)} aria-label="Pedido adulto">
    Adulto
  </span>
);

export type SizeBand = 'infantil' | 'adulto' | 'misto';

/** Renderiza o(s) selo(s) de faixa etária. 'misto' mostra os dois lado a lado. */
export const SizeBandTags = ({ band, compact = false }: { band?: SizeBand; compact?: boolean }) => {
  if (!band) return null;
  if (band === 'misto') {
    return (
      <span style={{ display: 'inline-flex', gap: '4px' }}>
        <InfantilTag compact={compact} />
        <AdultoTag compact={compact} />
      </span>
    );
  }
  return band === 'infantil' ? <InfantilTag compact={compact} /> : <AdultoTag compact={compact} />;
};
