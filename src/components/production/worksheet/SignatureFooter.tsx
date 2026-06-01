import React from 'react';

interface Props {
  /** Labels das colunas de assinatura. Default: Operador, Conferente, Supervisor. */
  labels?: string[];
  /** Mostra campos Início/Fim em uma linha extra antes das assinaturas. */
  showTime?: boolean;
}

/**
 * Rodapé com linhas de assinatura — design Industrial Editorial Minimalist.
 *
 * Layout:
 *   ═══ rule line double (fim da ficha) ═══
 *   [OPERADOR] [INICIO] [FIM] [DATA]    mono small
 *   ─────────  ─────────  ─────────     hairlines pretas
 *   ASSINATURA ASSINATURA ASSINATURA    section-label
 */
export const SignatureFooter = ({
  labels = ['Operador(a)', 'Conferente', 'Supervisor(a)'],
  showTime = true,
}: Props) => {
  return (
    // Fix 20/05/2026: era `mt-auto` mas combinado com flex flex-col dos
    // containers raiz dos workshseets gerava página em branco extra no
    // print. Trocado por margin top fixa.
    //
    // Fix 21/05/2026: keep-with-previous ancora o footer ao último bloco
    // de conteúdo da ficha (última cor/seção). Sem isso, em fichas longas
    // (Silk/Aviamento com 5+ cores) o footer vazava sozinho pra próxima
    // página A4 — órfão. Agora, quando footer não cabe na pg atual, o
    // browser leva o bloco anterior junto pra próxima página.
    <div className="mt-4 pt-2 text-black keep-together keep-with-previous">
      <div
        className="w-full mb-2"
        style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', height: '3px' }}
      />
      {showTime && (
        // Fix mai/2026 (auditoria visual): grid-cols-2 sm:grid-cols-4
        // garante que em telas/papéis estreitos (3+ fichas consolidadas
        // lado a lado, A5 retrato, impressão 2-up) os 4 campos não
        // colapsam em uma só linha bagunçada — quebram pra 2 linhas de
        // 2 colunas (Início+Fim, Data+Turno).
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          {[
            { label: 'Início', value: '__ : __' },
            { label: 'Fim',    value: '__ : __' },
            { label: 'Data',   value: '__ / __ / ____' },
            { label: 'Turno',  value: '☐ M  ☐ T  ☐ N' },
          ].map(item => (
            <div key={item.label}>
              <span
                className="section-label block mb-0.5"
                style={{ color: '#000', fontFamily: "'Fira Sans', sans-serif" }}
              >
                {item.label}
              </span>
              <span className="font-mono text-sm text-black tracking-wider">{item.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        {labels.map(label => (
          <div key={label} className="flex-1 min-w-[120px]">
            <div className="border-t border-black pt-1 mt-4">
              <p
                className="section-label"
                style={{ color: '#000', fontFamily: "'Fira Sans', sans-serif" }}
              >
                Assinatura · {label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
