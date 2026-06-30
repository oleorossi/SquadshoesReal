import React from 'react';

/**
 * Rodapé de conclusão padrão das fichas de operador (2026-06-12).
 *
 * Três campos pra preencher à caneta no chão de fábrica:
 *   Executado por · Data · Visto do responsável
 *
 * Componente de PRINT — segue as regras de docs/PRINT_SPEC.md + CLAUDE.md:
 *   - inline styles com cores hardcoded (sem tokens com alpha)
 *   - fontes do index.css ('Fira Sans' body, 'Fira Code' mono)
 *   - sem primitives shadcn
 *   - keep-together + keep-with-previous (nunca quebra no meio nem vira
 *     órfão em página separada do conteúdo).
 */
export const CompletionFooter = () => (
  <div
    className="keep-together keep-with-previous mt-3"
    style={{ display: 'flex', alignItems: 'stretch', fontFamily: "'Fira Sans', sans-serif", color: '#000' }}
  >
    {/* Campos pra preencher à caneta */}
    <div className="grid grid-cols-3" style={{ flex: 1, border: '1.5px solid #000' }}>
      {[
        { label: 'Executado por' },
        { label: 'Data' },
        { label: 'Total conferido' },
      ].map((f, i) => (
        <div
          key={f.label}
          className="px-3 pt-1.5 pb-2"
          style={{ borderLeft: i > 0 ? '1px solid #000' : 'none' }}
        >
          <span
            className="block font-mono uppercase"
            style={{ fontSize: '8px', letterSpacing: '0.18em', color: '#000', fontWeight: 700 }}
          >
            {f.label}
          </span>
          <div style={{ borderBottom: '1.5px solid #000', height: 22, marginTop: 4 }} />
        </div>
      ))}
    </div>
    {/* Selo de conclusão — visto do responsável + carimbo/data */}
    <div
      style={{
        width: 150,
        border: '1.5px solid #000',
        borderLeft: 'none',
        padding: '5px 10px 7px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <span
        className="font-mono uppercase"
        style={{ fontSize: '7.5px', letterSpacing: '0.18em', color: '#000', fontWeight: 700 }}
      >
        Visto do responsável
      </span>
      <span
        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: 18, letterSpacing: '0.02em', lineHeight: 1, marginTop: 3, textTransform: 'uppercase' }}
      >
        Concluído
      </span>
      <div style={{ borderBottom: '1.5px solid #000', height: 15, marginTop: 5 }} />
    </div>
  </div>
);
