import { PalmilhaLayerTallies } from './PalmilhaLayerTally';
import type { FichaBlock } from './fichaBlocks';

interface CommonProps {
  sizes: readonly string[];
  /** Pares de uma ficha (corrugado). O título do quadradinho usa esse número. */
  pairsPerFicha: number;
  /** Camada de forração (napa). Default true na ficha unificada. */
  showForracao?: boolean;
  /** Camada de fibra (placa). Default true na ficha unificada. */
  showFibra?: boolean;
}

interface Props extends CommonProps {
  blocks: readonly FichaBlock[];
}

export function fichaBlockStartNumber(blocks: readonly FichaBlock[], blockOffset: number): number {
  return 1 + blocks.slice(0, blockOffset).reduce((sum, b) => sum + b.fichas, 0);
}

/**
 * Faixa-resumo do Controle de Fichas (totais + camadas). Bloco próprio no
 * empacotamento da A4, para os blocos de 20 poderem subir no espaço livre.
 */
export function FichaBlocksHeader({
  blocks,
  showForracao = true,
  showFibra = true,
}: {
  blocks: readonly FichaBlock[];
  showForracao?: boolean;
  showFibra?: boolean;
}) {
  if (blocks.length === 0) return null;
  const totalFichas = blocks.reduce((sum, block) => sum + block.fichas, 0);
  const totalPairs = blocks.reduce((sum, block) => sum + block.pairs, 0);
  const blocoLabel = blocks.length === 1 ? '1 bloco' : `${blocks.length} blocos`;
  const camadas = [
    showForracao ? 'forração' : null,
    showFibra ? 'fibra' : null,
  ].filter(Boolean).join(' + ');
  return (
    <div
      className="keep-together flex items-baseline justify-between gap-2"
      data-ficha-blocks-header=""
      style={{ padding: '3px 8px' }}
    >
      <span className="section-label" style={{ color: '#000', fontFamily: "'Fira Sans', sans-serif" }}>
        Controle de Fichas
      </span>
      <span style={{ fontFamily: "'Fira Code', monospace", fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {totalFichas} fichas · {blocoLabel} · {totalPairs} pares{camadas ? ` · ${camadas}` : ''}
      </span>
    </div>
  );
}

interface CardProps extends CommonProps {
  block: FichaBlock;
  startNumber: number;
}

/** Um bloco de 20 (ou completar) — unidade keep-together para o paginador. */
export function FichaBlockCard({
  block,
  sizes,
  pairsPerFicha,
  startNumber,
  showForracao = true,
  showFibra = true,
}: CardProps) {
  const suffix = block.completar ? `completar (${block.fichas})` : `bloco ${block.index}`;
  return (
    <div
      className="keep-together"
      data-ficha-block={block.index}
      data-ficha-block-count={block.fichas}
      data-ficha-block-start={startNumber}
      style={{ borderBottom: '1px solid #000' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          padding: '3px 8px',
          background: block.completar ? '#fff' : '#000',
          color: block.completar ? '#C00000' : '#fff',
          WebkitPrintColorAdjust: 'exact',
          printColorAdjust: 'exact',
        }}
      >
        <span style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
          {block.completar ? `Bloco ${block.index} · completar` : `Bloco ${block.index}`}
        </span>
        <span style={{ fontFamily: "'Fira Code', monospace", fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em' }}>
          {block.fichas} fichas · {block.pairs} pares
        </span>
      </div>
      <table className="ficha-viz-grade" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', textAlign: 'center' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #000' }}>
            <th style={{ width: 72, borderRight: '1px solid #000', fontFamily: "'Fira Code', monospace", fontSize: '9px', letterSpacing: '0.06em', padding: '2px 4px' }}>Nº</th>
            {sizes.map(size => (
              <th key={size} style={{ borderRight: '1px solid #000', fontFamily: "'Fira Code', monospace", fontSize: '12px', padding: '2px 1px' }}>{size}</th>
            ))}
            <th style={{ width: 56, fontFamily: "'Fira Code', monospace", fontSize: '9px', letterSpacing: '0.06em' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="ficha-viz-zebra">
            <td style={{ borderRight: '1px solid #000', fontFamily: "'Fira Code', monospace", fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em', padding: '3px 4px' }}>
              × {block.fichas}
            </td>
            {sizes.map(size => (
              <td key={size} style={{ borderRight: '1px solid #000', fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', lineHeight: 1.1, padding: '2px 1px' }}>
                {block.grade[size] || 0}
              </td>
            ))}
            <td style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', lineHeight: 1.1 }}>{block.pairs}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ padding: '2px 6px 3px' }}>
        <PalmilhaLayerTallies
          count={block.fichas}
          startNumber={startNumber}
          pairsPerCard={pairsPerFicha}
          totalUnits={block.pairs}
          showForracao={showForracao}
          showFibra={showFibra}
          titleSuffix={suffix}
        />
      </div>
    </div>
  );
}

/**
 * Seção de blocos de 20 fichas. A linha "Por Ficha" de 12 permanece onde já
 * está; isto só acrescenta a divisão pedida, com a curva já multiplicada.
 *
 * Cada bloco tem o próprio Controle de Fichas, com duas grades independentes
 * (Forração e Fibra) quando as duas camadas cabem na ficha. A numeração é
 * contínua e igual nas duas grades: bloco 1 = 1–20, bloco 2 = 21–40, e o
 * "completar" segue a sequência. Quando esta seção é renderizada, o tally
 * único com o total da OP NÃO deve aparecer — senão o operador vê o total
 * duplicado no papel.
 */
export function FichaBlocks({
  blocks,
  sizes,
  pairsPerFicha,
  showForracao = true,
  showFibra = true,
}: Props) {
  if (blocks.length === 0 || sizes.length === 0) return null;
  return (
    <div data-ficha-blocks="" style={{ borderTop: '1.5px solid #000' }}>
      <FichaBlocksHeader blocks={blocks} showForracao={showForracao} showFibra={showFibra} />
      {blocks.map((block, blockOffset) => (
        <FichaBlockCard
          key={block.index}
          block={block}
          sizes={sizes}
          pairsPerFicha={pairsPerFicha}
          startNumber={fichaBlockStartNumber(blocks, blockOffset)}
          showForracao={showForracao}
          showFibra={showFibra}
        />
      ))}
    </div>
  );
}
