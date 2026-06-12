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
    style={{ border: '1.5px solid #000', fontFamily: "'Fira Sans', sans-serif", color: '#000' }}
  >
    <div className="grid grid-cols-3">
      {[
        { label: 'Executado por', width: 'auto' },
        { label: 'Data', width: 'auto' },
        { label: 'Visto do responsável', width: 'auto' },
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
  </div>
);
