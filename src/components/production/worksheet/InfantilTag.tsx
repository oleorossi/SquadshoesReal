import { Baby } from '@phosphor-icons/react';

/**
 * Selo "INFANTIL" pras fichas de operador impressas. Mesma lógica das listas
 * de PV/OP (referência com shoe_category infantil/kids/criança/bebê), mas com
 * estilo de PRINT: inline styles + cores hardcoded (rosa), print-color-adjust
 * exact pra não desbotar no papel. NÃO usa tokens com alpha (regra do CLAUDE.md
 * pra componentes de impressão).
 */
export const InfantilTag = ({ compact = false }: { compact?: boolean }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: compact ? '2px' : '4px',
      background: '#FCE7F3',
      color: '#9D174D',
      border: '1.5px solid #DB2777',
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
    }}
    aria-label="Pedido infantil"
  >
    <Baby weight="fill" style={{ width: compact ? 11 : 14, height: compact ? 11 : 14 }} />
    Infantil
  </span>
);
