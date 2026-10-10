import React from 'react';
import { summarizeInsolePerforation, type InsolePerforationRef } from '@/lib/insolePerforation';

interface Props {
  refs?: InsolePerforationRef[] | null;
}

/**
 * Destaque "PALMILHA FURADA" nas fichas de operador de Silk e Palmilha
 * (spec da ficha técnica `insole_perforated`, 2026-10-10).
 *
 * Print: inline styles + cores hardcoded (regras de print do CLAUDE.md). O
 * vermelho vem pareado com Anton grande e faixa preta invertida, pra o
 * destaque sobreviver no laser P&B da fábrica.
 */
export const PalmilhaFuradaBanner = ({ refs }: Props) => {
  const { show, onlyRefs } = summarizeInsolePerforation(refs);
  if (!show) return null;
  return (
    <div
      className="keep-together keep-with-next flex items-stretch bg-white mt-0.5 mb-0.5"
      style={{ border: '2.5px solid #000', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
      data-testid="palmilha-furada-banner"
    >
      <div
        className="flex items-center justify-center px-2 shrink-0"
        style={{ background: '#000', color: '#fff', fontFamily: "'Fira Code', monospace", fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}
      >
        Atenção
      </div>
      <div className="flex items-baseline flex-wrap gap-x-2 px-2 py-0.5 min-w-0">
        <span
          className="uppercase leading-none"
          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.01em', color: '#C00000' }}
        >
          ● Palmilha furada
        </span>
        {onlyRefs && (
          <span
            className="uppercase"
            style={{ fontFamily: "'Fira Sans', sans-serif", fontSize: '11px', fontWeight: 700, color: '#000' }}
          >
            só {onlyRefs.join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
};
