import React from 'react';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';

/**
 * Identificação padrão do hero do WorksheetHeader (2026-06-12, pedido do dono):
 *
 *   PEDIDO(S)             | <children — resumo do setor>
 *   PV-00141 · PV-00150   |
 *   RAZÃO SOCIAL EM VERMELHO
 *
 * - O número do pedido sai em Anton ADAPTATIVO (vários PVs juntos encolhem),
 *   com tamanho-padrão um pouco menor que o antigo (32px → base 24px).
 * - Logo ABAIXO do(s) PV(s): razão social do(s) cliente(s) em DESTAQUE
 *   VERMELHO (#C00000 — o vermelho canônico de print do projeto), uppercase,
 *   Anton (peso forte). Substitui o campo "Cliente" pequeno que ficava em
 *   outro canto do header (não duplicar).
 * - Vários clientes: separados por " · ", também adaptativo.
 *
 * Print component (docs/PRINT_SPEC.md): inline styles, cores hardcoded,
 * fontes 'Fira Sans'/'Fira Code'/'Anton'. Sem primitives shadcn.
 */
interface Props {
  /** Números de PV (já únicos/ordenados pelo caller). */
  pvNumbers: string[];
  /** Razão social do(s) cliente(s) — exibida em vermelho abaixo do PV. */
  clientNames?: string[];
  /** Coluna(s) à direita (resumo do setor: pares, grupos, metas). */
  children?: React.ReactNode;
}

export const HeaderIdentification = ({ pvNumbers, clientNames, children }: Props) => {
  const pvDisplay = pvNumbers.join(' · ');
  const clientDisplay = (clientNames || []).filter(Boolean).join(' · ');
  // Anton condensed (~0.45 char ratio); coluna do hero tem ~330px úteis.
  const pvFont = adaptiveFontSize(pvDisplay, {
    maxWidthPx: 330, baseFontPx: 24, minFontPx: 12, charWidthRatio: 0.5,
  });
  const clientFont = adaptiveFontSize(clientDisplay, {
    maxWidthPx: 330, baseFontPx: 15, minFontPx: 8.5, charWidthRatio: 0.48,
  });
  const hasPvCol = pvNumbers.length > 0 || clientDisplay.length > 0;
  return (
    <div className="flex items-start gap-4 min-w-0">
      {hasPvCol && (
        <div className="min-w-0 flex-1">
          {pvNumbers.length > 0 && (
            <>
              <span className="section-label block" style={{ color: '#000' }}>
                {pvNumbers.length > 1 ? `Pedidos (${pvNumbers.length})` : 'Pedido'}
              </span>
              <p
                className="text-black leading-tight mt-0.5 break-words"
                style={{
                  fontFamily: "'Anton', Impact, sans-serif",
                  fontSize: `${pvFont}px`,
                  letterSpacing: '-0.025em',
                }}
              >
                {pvDisplay}
              </p>
            </>
          )}
          {clientDisplay && (
            <p
              className="uppercase leading-tight mt-0.5 break-words"
              style={{
                fontFamily: "'Anton', Impact, sans-serif",
                fontSize: `${clientFont}px`,
                letterSpacing: '-0.01em',
                color: '#C00000',
                WebkitPrintColorAdjust: 'exact',
                printColorAdjust: 'exact',
              } as React.CSSProperties}
            >
              {clientDisplay}
            </p>
          )}
        </div>
      )}
      {children && (
        <div className={`min-w-0 flex-1 ${hasPvCol ? 'border-l border-black pl-4' : ''}`}>
          {children}
        </div>
      )}
    </div>
  );
};
