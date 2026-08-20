import React from 'react';
import { QrCode } from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';
import { SECTOR_FLOW } from '@/lib/sectors';
import { SizeBandTags, type SizeBand } from './InfantilTag';
import { showsFlowRail, showsQr, type FichaModel } from './fichaModel';

interface Props {
  /** Nome do setor pra título principal. */
  sector: string;
  /** Nome CANÔNICO do setor (SECTOR_FLOW) quando o título exibido difere —
   *  ex.: a ficha de palmilha rotula "Corte de Placa de Fibra" mas o setor do
   *  fluxo é "Corte Palmilha". Sem isto o trilho não acha o passo. */
  flowSector?: string;
  /** Ícone do setor (Phosphor — aceita className + weight). */
  icon: React.ComponentType<{ className?: string; weight?: string }>;
  /** [LEGACY] Cor de fundo do header. Mantido pra compat com chamadores, mas ignorado
   *  no design "Industrial Editorial Minimalist" (header é sempre b/w). */
  bgColor?: string;
  /** [LEGACY] Cor da borda. Mantido pra compat — agora o header usa border-black. */
  borderColor?: string;
  /** Slot pra imagem do produto à esquerda. */
  imageSlot?: React.ReactNode;
  /** Slot principal com identificação (ref/cor/PV/etc). */
  identification: React.ReactNode;
  /** Legenda opcional embaixo do QR (ex.: número do PV). NÃO truncar. */
  qrLabel?: string;
  /** Conteúdo a codificar num QR REAL escaneável (ex.: "PV-00141" ou lista de
   *  PVs). Quando presente, renderiza um QR de verdade (SVG, nítido em qualquer
   *  DPI) no lugar do ícone decorativo. Sem isso, cai no glifo phosphor. */
  qrValue?: string;
  /** Slot extra abaixo do header (alertas). */
  alerts?: React.ReactNode;
  /** Index editorial pré-formatado (ex: "01 / SILK"). Se omitido, é derivado de `sector`. */
  index?: string;
  /** Quando a OP está splitada em lotes (PR lot-sizing 2026-05): mostra
   *  badge editorial proeminente "LOTE X / N" no topo da ficha pra avisar
   *  o operador que está produzindo um pedaço, não a OP inteira. */
  lotInfo?: { number: number; total: number };
  /** Faixa etária da ficha (por numeração: < 33 = infantil). Renderiza selo
   *  "INFANTIL" e/ou "ADULTO" no header. 'misto' mostra os dois. */
  sizeBand?: SizeBand;
  /** Modelo de informação da ficha (ver `fichaModel.ts`). Default 'legacy':
   *  header inalterado. 'lote'/'mao' tiram o trilho dos 11 setores e o índice
   *  editorial; 'mao' tira também o QR. */
  model?: FichaModel;
  /** Faixa de rastreio (OP · PV · cliente · entrega) do modelo 'lote'.
   *  Renderiza logo abaixo do hero. Ignorada quando ausente. */
  trace?: React.ReactNode;
}

/** Trilho do fluxo (11 setores canônicos) — wayfinding no topo da ficha.
 *  Print-safe P&B: passos cumpridos = quadrado PREENCHIDO, atual = quadrado
 *  preenchido com nº (white-on-black) e contorno duplo, pendentes = contorno.
 *  (Sem cor — a fábrica imprime laser P&B; vermelho viraria cinza.) */
const FLOW_RAIL_STEPS = ['C.PLM', 'C.FOR', 'CS.PLM', 'CS.CAB', 'AVIA', 'SILK', 'COLA', 'MONT', 'SOLA', 'ACAB', 'EXP'] as const;

/** Cor-assinatura por setor (MESMA ordem do fluxo 1–10) — escolha do dono
 *  2026-06-30: cada setor tem uma cor pra reconhecer a ficha de longe e não
 *  confundir. Aplicada SÓ na faixa do topo + nome do setor (decisão "barata":
 *  se imprimir em P&B a faixa vira cinza e nada de conteúdo se perde). */
const SECTOR_COLORS = [
  '#2563eb', '#0d9488', '#4f46e5', '#7c3aed', '#d97706',
  '#9333ea', '#0891b2', '#dc2626', '#16a34a', '#db2777', '#475569',
] as const;

const FlowRail = ({ current }: { current: number }) => (
  <div className="flex items-stretch gap-[3px] mb-0.5" aria-label={`Setor ${current} de 11 no fluxo`}>
    {FLOW_RAIL_STEPS.map((label, i) => {
      const step = i + 1;
      const done = step < current;
      const isCur = step === current;
      return (
        <div
          key={label}
          className="flex-1 flex flex-col items-center"
          style={{ minWidth: 0 }}
        >
          <div
            style={{
              width: '100%',
              height: isCur ? 9 : 6,
              border: '1px solid #000',
              background: done || isCur ? '#000' : '#fff',
              outline: isCur ? '1px solid #000' : 'none',
              outlineOffset: 1,
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            } as React.CSSProperties}
          />
          <span
            className="uppercase leading-none mt-0.5"
            style={{
              fontFamily: "'Fira Code', monospace",
              fontSize: 6.5,
              letterSpacing: '0.02em',
              fontWeight: isCur ? 700 : 500,
              color: isCur || done ? '#000' : '#9a958c',
            }}
          >
            {label}
          </span>
        </div>
      );
    })}
  </div>
);

/**
 * Header padronizado pra todas as fichas de operador — design Industrial Editorial Minimalist.
 *
 * Layout:
 *   [01 / SETOR]      [FOTO] [IDENTIFICAÇÃO]              [QR]
 *   ──── rule line ────
 *   [ALERTAS opcionais]
 *
 * Tipografia ANTON gigante no setor, hairline 1px black como divisor, sem
 * blocos pretos preenchidos. Branco dominante — economia de tinta + leitura
 * a 50cm na fábrica.
 */
export const WorksheetHeader = ({
  sector, flowSector, icon: Icon,
  imageSlot, identification, qrLabel, qrValue, alerts, index, lotInfo, sizeBand,
  model = 'legacy', trace,
}: Props) => {
  const editorialIndex = index || `01 / ${sector.toUpperCase()}`;
  // Passo do fluxo (1–11) pro trilho.
  //
  // ⚠ FIX 31/07/2026 — o trilho e a faixa de cor NUNCA renderizaram em produção.
  // Antes o passo saía de `parseInt(editorialIndex, 10)`, mas as CINCO fichas
  // passam `index={`OP ${nº} / ${SETOR}`}` — começa em "OP", logo `parseInt`
  // devolvia NaN, `hasFlow` era sempre false e sumiam a faixa de 7px do topo, o
  // trilho C.PLM→EXP e a cor-assinatura (o nome do setor caía pra #000). O
  // default do componente ("01 / SILK") funcionaria, mas nenhum chamador usa.
  //
  // Agora o passo vem do NOME do setor contra a ordem canônica (SECTOR_FLOW),
  // que é a mesma dos FLOW_RAIL_STEPS. `flowSector` existe para as fichas cujo
  // título não é o nome canônico (a Palmilha rotula "Corte de Placa de Fibra").
  // O parseInt fica só como último fallback, pra não quebrar chamador legado.
  const flowName = flowSector || sector;
  const canonicalIdx = SECTOR_FLOW.indexOf(flowName);
  const flowStep = canonicalIdx >= 0 ? canonicalIdx + 1 : parseInt(editorialIndex, 10);
  const hasFlow = Number.isFinite(flowStep) && flowStep >= 1 && flowStep <= 11;
  // Cor-assinatura do setor (faixa do topo + nome). Fora do fluxo 1–10 → preto.
  const sectorColor = hasFlow ? SECTOR_COLORS[flowStep - 1] : '#000';
  return (
    <div className="mb-1 text-black keep-together keep-with-next">
      {/* Faixa de cor do setor — reconhecimento à distância (escolha do dono
          2026-06-30). B&W: vira cinza, sem perda de conteúdo. */}
      {hasFlow && (
        <div
          style={{
            height: 7,
            background: sectorColor,
            WebkitPrintColorAdjust: 'exact',
            printColorAdjust: 'exact',
          } as React.CSSProperties}
        />
      )}
      {/* Sector title bar — top of the page (per user feedback May/2026) */}
      <div className="flex items-center gap-3 border-y-2 border-black px-2 py-1 mb-1">
        <Icon className="h-7 w-7 text-black shrink-0" weight="bold" />
        <span
          className="uppercase leading-none flex-1 min-w-0 truncate"
          style={{
            fontFamily: "'Anton', Impact, sans-serif",
            fontSize: adaptiveFontSize(sector, { maxWidthPx: 360, baseFontPx: 28, minFontPx: 22, charWidthRatio: 0.45 }),
            letterSpacing: '-0.02em',
            color: sectorColor,
            WebkitPrintColorAdjust: 'exact',
            printColorAdjust: 'exact',
          } as React.CSSProperties}
        >
          {sector}
        </span>
        {sizeBand && <span className="shrink-0"><SizeBandTags band={sizeBand} /></span>}
        {lotInfo && lotInfo.total > 1 ? (
          <span
            className="text-black uppercase leading-none shrink-0 pl-3"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: '26px',
              letterSpacing: '-0.02em',
              borderLeft: '2px solid #000',
            }}
            aria-label={`Lote ${lotInfo.number} de ${lotInfo.total}`}
          >
            <span className="pl-3">LOTE {lotInfo.number}<span className="text-[15px] align-middle">/{lotInfo.total}</span></span>
          </span>
        ) : (
          <span className="section-label hidden sm:inline" style={{ color: '#000' }}>Ficha de Operador</span>
        )}
      </div>

      {/* Editorial index strip — batch ID + data removidos em 2026-06-12
          (pedido do dono: informação desnecessária na ficha). Sai inteiro nos
          modelos 'lote'/'mao' (rodada 1 do redesenho, 20/08/2026): o operador
          não age sobre "OP 08 / MONTAGEM", e o nome do setor já está na barra
          logo acima, em Anton grande. */}
      {showsFlowRail(model) && (
        <div className="flex items-baseline justify-between mb-0.5 gap-3">
          <span className="section-label" style={{ color: '#000', fontFamily: "'Fira Sans', sans-serif" }}>
            {editorialIndex}
          </span>
        </div>
      )}

      {/* Trilho do fluxo (exemplo 1 da melhoria estética 2026-06-30). Também
          sai nos modelos 'lote'/'mao' — a faixa de cor do setor no topo já
          resolve o reconhecimento à distância. */}
      {hasFlow && showsFlowRail(model) && <FlowRail current={flowStep} />}

      {/* Hero row — top hairline rules, no fills */}
      <div className="flex items-stretch gap-3 border-t border-b border-black py-1">

        {/* Image */}
        {imageSlot && (
          <div className="flex items-center justify-center shrink-0">
            {imageSlot}
          </div>
        )}

        {/* Identification */}
        <div className="flex-1 flex flex-col justify-center gap-0.5 min-w-0 border-l border-black pl-4 text-black">
          {identification}
        </div>

        {/* QR — real escaneável (codifica o PV) quando `qrValue` é passado;
            senão cai no glifo decorativo. Legenda embaixo NÃO trunca.
            Sai no modelo 'mao': ali a ficha não responde "de quem é isso". */}
        {showsQr(model) && (
        <div className="flex flex-col items-center justify-center shrink-0 border-l border-black pl-4">
          {qrValue ? (
            <div
              style={{
                border: '1.5px solid #000',
                padding: 2,
                background: '#fff',
                lineHeight: 0,
                WebkitPrintColorAdjust: 'exact',
                printColorAdjust: 'exact',
              } as React.CSSProperties}
            >
              <QRCodeSVG
                value={qrValue}
                size={46}
                level="M"
                marginSize={0}
                fgColor="#000000"
                bgColor="#ffffff"
                title={qrLabel || qrValue}
              />
            </div>
          ) : (
            <QrCode className="h-11 w-11 text-black" weight="thin" />
          )}
          {qrLabel && (
            <span className="text-[8px] font-mono font-bold text-black mt-1 tracking-[0.14em] uppercase text-center leading-tight" style={{ maxWidth: 64 }}>
              {qrLabel}
            </span>
          )}
        </div>
        )}
      </div>

      {/* Rastreio do modelo 'lote' — OP · PV · cliente · entrega numa faixa
          legível, em vez da linha mono de 9px truncada do sub-header. */}
      {trace && <div className="mt-1 keep-together keep-with-next">{trace}</div>}

      {alerts && <div className="mt-1">{alerts}</div>}
    </div>
  );
};
