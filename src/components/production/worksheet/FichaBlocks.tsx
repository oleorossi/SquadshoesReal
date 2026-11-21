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
 */
export function FichaBlocks({ blocks, sizes, pairsPerFicha }: Props) {
  if (blocks.length === 0 || sizes.length === 0) return null;
  return (
    <div style={{ borderTop: '1.5px solid #000' }}>
      {blocks.map(block => (
        <div key={block.index} className="keep-together" style={{ borderBottom: '1px solid #000' }}>
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
