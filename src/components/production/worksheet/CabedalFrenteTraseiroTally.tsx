import type { CSSProperties, ReactNode } from 'react';
import { CabedalPartBadge } from './CabedalPartBadge';
import { TallyBox } from './TallyBox';
import {
  CABEDAL_TALLY_INSET_PX,
  CABEDAL_TALLY_SIDE_GAP_PX,
  fitCabedalTalliesSideBySide,
  tallyAvailableWidthPx,
} from './tallyLayout';
import type { CabedalPart } from '@/lib/cabedalFrenteTraseiro';
import { cabedalPartLabel } from '@/lib/cabedalFrenteTraseiro';

interface Props {
  /** Quantas fichas o operador marca em cada parte (Frente e Traseiro). */
  count: number;
  pairsPerCard?: number;
  totalUnits?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Sufixo no título (ex.: nome da ref, "corrugados mistos"). */
  titleSuffix?: string;
}

interface BandProps {
  part: CabedalPart;
  children: ReactNode;
  /** Sem margem superior — as duas faixas já se separam pelo gap do flex. */
  flushTop?: boolean;
}

/**
 * Faixa de uma parte. Frente: cabeçalho sólido preto (como "Cortar placas"
 * da Palmilha). Traseiro: fundo claro + borda tracejada, no espírito da
 * faixa "Forração". Os dois contrastam em P&B sem depender de cor.
 */
function PartBand({ part, children, flushTop }: BandProps) {
  const isFrente = part === 'frente';
  const wrap: CSSProperties = isFrente
    ? { border: '1.5px solid #000', marginTop: flushTop ? 0 : 4, flex: flushTop ? 1 : undefined, minWidth: 0 }
    : {
        border: '2px dashed #000',
        marginTop: flushTop ? 0 : 6,
        background: '#fff',
        flex: flushTop ? 1 : undefined,
        minWidth: 0,
      };
  const header: CSSProperties = isFrente
    ? {
        background: '#000',
        color: '#fff',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        padding: '3px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }
    : {
        background: '#f0f0f0',
        color: '#000',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        padding: '3px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '2px dashed #000',
      };
  return (
    <div className="keep-together" data-cabedal-part-band={part} style={wrap}>
      <div className="keep-with-next" style={header}>
        <CabedalPartBadge part={part} size="md" />
        <span
          className="uppercase leading-none"
          style={{
            fontFamily: "'Anton', Impact, sans-serif",
            fontSize: '16px',
            letterSpacing: '-0.02em',
            color: isFrente ? '#fff' : '#000',
          }}
        >
          {cabedalPartLabel(part).toUpperCase()}
        </span>
        <span
          className="font-mono uppercase"
          style={{
            marginLeft: 'auto',
            fontSize: '7px',
            letterSpacing: '0.08em',
            color: isFrente ? '#c8c4bc' : '#555',
            fontWeight: 600,
          }}
        >
          marca independente
        </span>
      </div>
      <div style={{ padding: '2px 6px 4px' }}>{children}</div>
    </div>
  );
}

/**
 * Controle de Fichas do Cabedal: duas grades 1..N independentes, uma para
 * Frente e outra para Traseiro. O operador marca o traseiro pronto mesmo
 * com a frente pendente (e vice-versa).
 */
export function CabedalFrenteTraseiroTally({
  count,
  pairsPerCard = 12,
  totalUnits,
  size = 'sm',
  titleSuffix,
}: Props) {
  if (count <= 0) return null;
  const pair = fitCabedalTalliesSideBySide({ count, size, lastNumber: count });
  const tallyWidthPx = pair.availableWidthPx;
  const sideBySide = pair.sideBySide;
  const suffix = titleSuffix ? ` · ${titleSuffix}` : '';
  const hint = 'Marque cada parte à parte — o traseiro pode ficar pronto com a frente pendente.';
  const bands = (
    <>
      <PartBand part="frente" flushTop={sideBySide}>
        <TallyBox
          count={count}
          pairsPerCard={pairsPerCard}
          totalUnits={totalUnits}
          size={size}
          availableWidthPx={tallyWidthPx}
          title={`Controle de Fichas · Frente${suffix}`}
        />
      </PartBand>
      <PartBand part="traseiro" flushTop={sideBySide}>
        <TallyBox
          count={count}
          pairsPerCard={pairsPerCard}
          totalUnits={totalUnits}
          size={size}
          availableWidthPx={tallyWidthPx}
          title={`Controle de Fichas · Traseiro${suffix}`}
        />
      </PartBand>
    </>
  );
  return (
    <div
      data-cabedal-frente-traseiro-tally=""
      data-cabedal-tally-layout={sideBySide ? 'side-by-side' : 'stack'}
    >
      <p
        className="keep-with-next font-mono uppercase leading-tight"
        style={{ fontSize: '7.5px', letterSpacing: '0.06em', fontWeight: 600, margin: '3px 0 2px', color: '#3a3a3a' }}
      >
        {hint}
      </p>
      {sideBySide ? (
        <div
          className="keep-together flex items-stretch"
          style={{ gap: CABEDAL_TALLY_SIDE_GAP_PX, marginTop: 4 }}
          data-rigid-width={tallyWidthPx * 2 + CABEDAL_TALLY_SIDE_GAP_PX}
        >
          {bands}
        </div>
      ) : (
        bands
      )}
    </div>
  );
}
