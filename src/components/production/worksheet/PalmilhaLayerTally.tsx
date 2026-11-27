import type { CSSProperties, ReactNode } from 'react';
import { TallyBox } from './TallyBox';

export type PalmilhaCutLayer = 'forracao' | 'fibra';

const LAYER_META: Record<PalmilhaCutLayer, { label: string; badge: string; solid: boolean }> = {
  forracao: { label: 'Forração', badge: 'FO', solid: false },
  fibra: { label: 'Fibra', badge: 'FI', solid: true },
};

interface BadgeProps {
  layer: PalmilhaCutLayer;
  size?: 'sm' | 'md';
}

/**
 * Distinção visual Forração vs Fibra que sobrevive à impressão P&B
 * (mesmo espírito Frente/Traseiro do Cabedal):
 *   Fibra    — quadrado sólido preto com "FI" branco
 *   Forração — quadrado vazado (borda 2px) com "FO" preto
 */
export function PalmilhaLayerBadge({ layer, size = 'sm' }: BadgeProps) {
  const meta = LAYER_META[layer];
  const px = size === 'md' ? 22 : 14;
  const fontPx = size === 'md' ? 8 : 6;
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: px,
    height: px,
    flexShrink: 0,
    fontFamily: "'Fira Code', 'Fira Sans', monospace",
    fontSize: fontPx,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1,
    border: meta.solid ? '1.5px solid #000' : '2px solid #000',
    background: meta.solid ? '#000' : '#fff',
    color: meta.solid ? '#fff' : '#000',
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
  };
  return (
    <span
      data-palmilha-layer-badge={layer}
      title={meta.label}
      aria-label={meta.label}
      style={style}
    >
      {meta.badge}
    </span>
  );
}

interface BandProps {
  layer: PalmilhaCutLayer;
  children: ReactNode;
}

/**
 * Faixa de uma camada. Forração (primeiro no fluxo do cortador): fundo claro
 * + borda tracejada, no espírito da faixa "Forração" da ficha. Fibra: cabeçalho
 * sólido preto, como "Cortar placas".
 */
export function PalmilhaLayerBand({ layer, children }: BandProps) {
  const solid = LAYER_META[layer].solid;
  const wrap: CSSProperties = solid
    ? { border: '1.5px solid #000', marginTop: 4 }
    : {
        border: '2px dashed #000',
        marginTop: 6,
        background: '#fff',
      };
  const header: CSSProperties = solid
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
    <div className="keep-together" data-palmilha-layer-band={layer} style={wrap}>
      <div className="keep-with-next" style={header}>
        <PalmilhaLayerBadge layer={layer} size="md" />
        <span
          className="uppercase leading-none"
          style={{
            fontFamily: "'Anton', Impact, sans-serif",
            fontSize: '16px',
            letterSpacing: '-0.02em',
            color: solid ? '#fff' : '#000',
          }}
        >
          {LAYER_META[layer].label.toUpperCase()}
        </span>
        <span
          className="font-mono uppercase"
          style={{
            marginLeft: 'auto',
            fontSize: '8px',
            letterSpacing: '0.08em',
            color: solid ? '#d9d6d0' : '#333',
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

interface TalliesProps {
  count: number;
  startNumber?: number;
  pairsPerCard?: number;
  totalUnits?: number;
  size?: 'sm' | 'md' | 'lg';
  showForracao: boolean;
  showFibra: boolean;
  /** Sufixo no título do tally (ex.: "bloco 1", "completar (15)"). */
  titleSuffix?: string;
}

/**
 * Duas grades independentes (Forração e/ou Fibra) com a mesma numeração
 * contínua. O cortador marca a quantidade de cada camada à parte, mesmo
 * quando os dois itens compartilham o espaço físico da ficha.
 */
export function PalmilhaLayerTallies({
  count,
  startNumber = 1,
  pairsPerCard = 12,
  totalUnits,
  size = 'sm',
  showForracao,
  showFibra,
  titleSuffix,
}: TalliesProps) {
  if (count <= 0 || (!showForracao && !showFibra)) return null;
  const both = showForracao && showFibra;
  const suffix = titleSuffix ? ` · ${titleSuffix}` : '';
  return (
    <div data-palmilha-layer-tallies="">
      {both && (
        <p
          className="keep-with-next font-mono uppercase leading-tight"
          style={{ fontSize: '8px', letterSpacing: '0.06em', fontWeight: 700, margin: '4px 0 0', color: '#000' }}
        >
          Marque a quantidade cortada de cada um à parte — a forração pode ficar pronta com a fibra pendente.
        </p>
      )}
      {showForracao && (
        <PalmilhaLayerBand layer="forracao">
          <TallyBox
            count={count}
            startNumber={startNumber}
            pairsPerCard={pairsPerCard}
            totalUnits={totalUnits}
            size={size}
            title={`Controle · Forração${suffix}`}
          />
        </PalmilhaLayerBand>
      )}
      {showFibra && (
        <PalmilhaLayerBand layer="fibra">
          <TallyBox
            count={count}
            startNumber={startNumber}
            pairsPerCard={pairsPerCard}
            totalUnits={totalUnits}
            size={size}
            title={`Controle · Fibra${suffix}`}
          />
        </PalmilhaLayerBand>
      )}
    </div>
  );
}
