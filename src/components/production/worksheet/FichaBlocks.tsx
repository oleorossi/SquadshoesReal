import { TallyBox } from './TallyBox';
import type { FichaBlock } from './fichaBlocks';

interface Props {
  blocks: readonly FichaBlock[];
  sizes: readonly string[];
  /** Pares de uma ficha (corrugado). O título do quadradinho usa esse número. */
  pairsPerFicha: number;
}

/**
 * Seção de blocos de 20 fichas. A linha "Por Ficha" de 12 permanece onde já
 * está; isto só acrescenta a divisão pedida, com a curva já multiplicada.
 *
 * Cada bloco tem o próprio Controle de Fichas (quadradinhos = fichas daquele
 * bloco). Quando esta seção é renderizada, o tally único com o total da OP
 * NÃO deve aparecer — senão o operador vê o total duplicado no papel.
 */
export function FichaBlocks({ blocks, sizes, pairsPerFicha }: Props) {
  if (blocks.length === 0 || sizes.length === 0) return null;
  const totalFichas = blocks.reduce((sum, block) => sum + block.fichas, 0);
  const totalPairs = blocks.reduce((sum, block) => sum + block.pairs, 0);
  const blocoLabel = blocks.length === 1 ? '1 bloco' : `${blocks.length} blocos`;
  return (
    <div data-ficha-blocks="" style={{ borderTop: '1.5px solid #000' }}>
      <div
        className="keep-together flex items-baseline justify-between gap-2"
        style={{ padding: '4px 8px' }}
      >
        <span className="section-label" style={{ color: '#000', fontFamily: "'Fira Sans', sans-serif" }}>
          Controle de Fichas
        </span>
        <span style={{ fontFamily: "'Fira Code', monospace", fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {totalFichas} fichas · {blocoLabel} · {totalPairs} pares
        </span>
      </div>
      {blocks.map(block => (
        <div key={block.index} className="keep-together" data-ficha-block={block.index} data-ficha-block-count={block.fichas} style={{ borderBottom: '1px solid #000' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              padding: '4px 8px',
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
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', textAlign: 'center' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #000' }}>
                <th style={{ width: 72, borderRight: '1px solid #000', fontFamily: "'Fira Code', monospace", fontSize: '9px', letterSpacing: '0.06em', padding: '3px 4px' }}>Nº</th>
                {sizes.map(size => (
                  <th key={size} style={{ borderRight: '1px solid #000', fontFamily: "'Fira Code', monospace", fontSize: '12px', padding: '3px 1px' }}>{size}</th>
                ))}
                <th style={{ width: 56, fontFamily: "'Fira Code', monospace", fontSize: '9px', letterSpacing: '0.06em' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ borderRight: '1px solid #000', fontFamily: "'Fira Code', monospace", fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em', padding: '4px' }}>
                  × {block.fichas}
                </td>
                {sizes.map(size => (
                  <td key={size} style={{ borderRight: '1px solid #000', fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', lineHeight: 1.1, padding: '3px 1px' }}>
                    {block.grade[size] || 0}
                  </td>
                ))}
                <td style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', lineHeight: 1.1 }}>{block.pairs}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ padding: '2px 6px 4px' }}>
            <TallyBox
              count={block.fichas}
              pairsPerCard={pairsPerFicha}
              totalUnits={block.pairs}
              size="sm"
              title={block.completar ? `Controle · completar (${block.fichas})` : `Controle · bloco ${block.index}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
