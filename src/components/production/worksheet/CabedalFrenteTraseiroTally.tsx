import type { CSSProperties, ReactNode } from 'react';
import { CabedalPartBadge } from './CabedalPartBadge';
import { TallyBox } from './TallyBox';
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
}

/**
 * Faixa de uma parte. Frente: cabeçalho sólido preto (como "Cortar placas"
 * da Palmilha). Traseiro: fundo claro + borda tracejada, no espírito da
 * faixa "Forração". Os dois contrastam em P&B sem depender de cor.
 */
function PartBand({ part, children }: BandProps) {
  const isFrente = part === 'frente';
  const wrap: CSSProperties = isFrente
    ? { border: '1.5px solid #000', marginTop: 4 }
    : {
        border: '2px dashed #000',
        marginTop: 6,
        background: '#fff',
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
            fontSize: '8px',
            letterSpacing: '0.08em',
            color: isFrente ? '#d9d6d0' : '#333',
            fontWeight: 700,
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
  const suffix = titleSuffix ? ` · ${titleSuffix}` : '';
  const hint = 'Marque cada parte à parte — o traseiro pode ficar pronto com a frente pendente.';
  return (
    <div data-cabedal-frente-traseiro-tally="">
      <p
        className="keep-with-next font-mono uppercase leading-tight"
        style={{ fontSize: '8px', letterSpacing: '0.06em', fontWeight: 700, margin: '4px 0 0', color: '#000' }}
      >
        {hint}
      </p>
      <PartBand part="frente">
        <TallyBox
          count={count}
          pairsPerCard={pairsPerCard}
          totalUnits={totalUnits}
          size={size}
          title={`Controle de Fichas · Frente${suffix}`}
        />
      </PartBand>
      <PartBand part="traseiro">
        <TallyBox
          count={count}
          pairsPerCard={pairsPerCard}
          totalUnits={totalUnits}
          size={size}
          title={`Controle de Fichas · Traseiro${suffix}`}
        />
      </PartBand>
    </div>
  );
}
