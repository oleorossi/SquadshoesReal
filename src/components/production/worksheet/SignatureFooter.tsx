import React from 'react';

interface Props {
  /** Labels das colunas de assinatura. Default: Operador, Conferente, Supervisor. */
  labels?: string[];
  /** Mostra campos Início/Fim em uma linha extra antes das assinaturas. */
  showTime?: boolean;
}

/**
 * Rodapé com linhas de assinatura. Aparece em todas as fichas de operador
 * pra registrar quem produziu, conferiu e supervisionou.
 */
export const SignatureFooter = ({
  labels = ['Operador(a)', 'Conferente', 'Supervisor(a)'],
  showTime = true,
}: Props) => {
  return (
    <div className="mt-auto pt-1.5 border-t border-slate-200">
      {showTime && (
        <div className="flex items-center justify-between mb-1 text-[10px] text-slate-600">
          <span><strong>Operador:</strong> ____________________</span>
          <span><strong>Início:</strong> __:__</span>
          <span><strong>Fim:</strong> __:__</span>
          <span><strong>Data:</strong> __/__/____</span>
        </div>
      )}
      <div className="flex items-end justify-between gap-2">
        {labels.map(label => (
          <div key={label} className="text-center flex-1">
            <div className="border-t border-slate-400 mt-4 pt-0.5">
              <p className="text-[9px] text-slate-500 uppercase font-bold">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
