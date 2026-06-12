import React from 'react';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';
import { SizeBandTags, type SizeBand } from './InfantilTag';

/**
 * Sub-header compacto de GRUPO dentro do maço contínuo de um setor
 * (2026-06-12, pedido do dono — fluxo contínuo por setor).
 *
 * Substitui o antigo WorksheetHeader gigante que abria UMA FICHA NOVA por
 * grupo (solado/referência/OP) dentro do MESMO setor — desperdiçava papel
 * (página 70% em branco + header completo repetido). Agora o setor inteiro
 * é um único PaginatedSheet; cada grupo abre com esta faixa fina:
 *
 *   SOLADO 02/05                     [INFANTIL] LOTE 1/2 · OPs · 480 PARES
 *   NOME DO SOLADO (Anton menor, adaptativo)
 *   ─ hairline ─
 *
 * Print component (docs/PRINT_SPEC.md): inline styles, cores hardcoded,
 * fontes 'Fira Sans'/'Fira Code'/'Anton'. Sem primitives shadcn.
 */
interface Props {
  /** Eyebrow mono à esquerda (ex.: "SOLADO 02/05", "REFERÊNCIA 1/3", "OP 4/9"). */
  eyebrow: string;
  /** Identidade do grupo — solado / referência / "REF · COR". */
  title: string;
  /** Total de pares do grupo (Anton à direita). */
  pairs?: number;
  /** Badge "LOTE X/N" quando o grupo é parte de split de lote. */
  lotInfo?: { number: number; total: number };
  /** Números de OP do grupo (≤3 lista; >3 vira contagem). */
  ops?: string[];
  /** Linha extra mono (ex.: "PV-00141 · CLIENTE X · entrega 12/07"). */
  note?: string;
  /** Selo INFANTIL/ADULTO da faixa do grupo. */
  sizeBand?: SizeBand;
}

export const GroupSubHeader = ({ eyebrow, title, pairs, lotInfo, ops, note, sizeBand }: Props) => {
  const titleFont = adaptiveFontSize(title, {
    maxWidthPx: 430, baseFontPx: 20, minFontPx: 12, charWidthRatio: 0.48,
  });
  const opsDisplay = ops && ops.length > 0
    ? (ops.length <= 3 ? ops.join(' · ') : `${ops.length} OPs`)
    : null;
  return (
    <div
      className="keep-together keep-with-next"
      style={{ borderTop: '3px solid #000', borderBottom: '1px solid #000', padding: '2px 0 3px', color: '#000' }}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span
            className="block font-mono uppercase"
            style={{ fontSize: '8px', letterSpacing: '0.18em', fontWeight: 700, color: '#000' }}
          >
            {eyebrow}
          </span>
          <span
            className="block uppercase leading-none truncate mt-0.5 text-black"
            style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: `${titleFont}px`, letterSpacing: '-0.02em' }}
            title={title}
          >
            {title}
          </span>
        </div>
        <div className="flex items-end gap-3 shrink-0">
          {sizeBand && <SizeBandTags band={sizeBand} compact />}
          {lotInfo && lotInfo.total > 1 && (
            <span className="font-mono text-[10px] font-bold text-black tracking-widest uppercase">
              Lote {lotInfo.number}/{lotInfo.total}
            </span>
          )}
          {opsDisplay && (
            <span className="font-mono text-[9px] text-black tracking-wider uppercase">
              {opsDisplay}
            </span>
          )}
          {typeof pairs === 'number' && (
            <span
              className="text-black leading-none"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '19px', letterSpacing: '-0.02em' }}
            >
              {pairs} <span className="text-[9px] font-mono tracking-widest">pares</span>
            </span>
          )}
        </div>
      </div>
      {note && (
        <p className="font-mono text-[9px] text-black tracking-wider uppercase leading-tight mt-0.5 truncate" title={note}>
          {note}
        </p>
      )}
    </div>
  );
};
