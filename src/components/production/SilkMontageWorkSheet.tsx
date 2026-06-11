import React from 'react';
import { PaintBrush as Paintbrush, Hammer, Pen, Paperclip, Sparkle as Sparkles, Cloud, Scissors } from '@phosphor-icons/react';
import { adaptiveLabelFontSize } from '@/lib/adaptiveFontSize';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { ProductImageBlock } from './worksheet/ProductImageBlock';
import { SectorAlerts, type SectorAlert } from './worksheet/SectorAlerts';
import { SignatureFooter } from './worksheet/SignatureFooter';
import { SignedImage } from '@/components/ui/signed-image';
import { generateBatchId } from './worksheet/batchId';
import { formatOpNumber } from './worksheet/stageOrder';
import { formatUnitLabel } from '@/lib/unitLabels';
import {
  filterConsumptionForSector,
  formatConsumptionLine,
  type ConsumptionRow,
} from '@/hooks/useBulkOrderConsumption';

export interface SilkColorGroup {
  /** Cor do CABEDAL (chave de agrupamento). Em todos os setores exceto
   *  Corte Forração, é o que o operador vê no card "Cor". */
  color: string;
  /** Cor da FORRAÇÃO mapeada pra essa cor de cabedal. Usado pelo setor
   *  Corte Forração — o operador corta forração na cor deste campo,
   *  não na cor do cabedal. Null quando ficha não tem o mapping. */
  liningColor?: string | null;
  colorHex?: string;
  combinedGrid: Record<string, number>;
  /** Grade agregada por FACA de Corte Cabedal (P/M/G/...). Populada quando a
   *  ref da ficha tem knife_size_ranges cadastrado. Em Corte Cabedal, a
   *  worksheet usa este grid em vez de combinedGrid. Sizes não-mapeadas viram
   *  chave literal (ex: '41'). Sem cadastro = NULL/vazio = fallback pro
   *  combinedGrid (sizes individuais). */
  knifeGrid?: Record<string, number>;
  /** Grade BASE de 1 ficha fechada (ex: {34:1,...,40:1} soma 12). */
  baseGrid?: Record<string, number>;
  /** Soma da grade base = pares por 1 ficha fechada. */
  baseGradeSum?: number;
  /** Quantas fichas no total (= totalPairs / baseGradeSum). */
  fichas?: number;
  /** TRUE quando agrega OPs com grades base diferentes — omite "Por Ficha". */
  mixedGrades?: boolean;
  totalPairs: number;
  opNumbers: string[];
  /** Números de PV (pedidos de venda) que originaram as OPs do grupo. */
  pvNumbers?: string[];
  /** Referências (sandálias) que cabem nesse grupo solado+cor. Geralmente 1
   *  ref por grupo, mas modelos diferentes podem usar mesmo solado+cor. */
  refs?: Array<{ code: string; name: string }>;
  silk?: { silk_name: string; silk_url: string | null };
  /** URL da imagem da variante exata (se houver). */
  variantImageUrl?: string | null;
  /** Variantes alternativas (pra fallback "Preto" quando a cor não tem foto). */
  alternateVariants?: Array<{ color?: string; image_url?: string | null }>;
  /** Imagem mestre da ficha técnica (último fallback). */
  technicalSheetImageUrl?: string | null;
  /** Material do cabedal (cabedal: couro liso, sintético, etc). */
  upperMaterial?: string;
  /** Consumo de cabedal por par (dm²). */
  upperConsumptionPerPair?: number;
  /** Material do forro. */
  liningMaterial?: string;
  /** Consumo do forro por par (dm²). */
  liningConsumptionPerPair?: number;
  /** Cor da linha de costura. */
  threadColor?: string;
  /** Tipo de ponto de costura. */
  stitchType?: string;
  /** TRUE quando o modelo tem tiras (has_straps). Usado no Corte Forração pra
   *  esconder QUALQUER referência ao cabedal — modelo de tira não tem cabedal,
   *  o cortador só corta a forração na cor da palmilha. */
  hasStraps?: boolean;
  /** Componentes auxiliares (capa, tira, presilha, etc) — pra setor Aviamento/Mesa. */
  components?: Array<{ name: string; material?: string; qty?: string; color?: string }>;
  /** Cor da caixa individual (pra Acabamento). */
  individualBoxColor?: string;
  /** Pares por caixa individual (pra Acabamento). */
  pairsPerIndividualBox?: number;
  /** Lista de alertas específicos pra essa cor/setor (ex: "Modelo fachetado"). */
  alerts?: SectorAlert[];
  /** TRUE quando a palmilha desta cor PRECISA ser forrada (insole_has_lining
   *  E não é palmilha pronta). Usado pra filtrar Corte Forração — cores sem
   *  forração não devem aparecer nessa ficha. */
  requiresLiningCut?: boolean;
  /** TRUE quando o modelo NÃO tem tiras (has_straps=false), ou seja, tem
   *  cabedal completo a cortar. Usado pra filtrar Corte Cabedal — modelos
   *  com tiras não passam por esse setor. */
  requiresUpperCut?: boolean;
  /** Etapas de Aviamento que se aplicam a essa ficha (subset de
   *  ["Frente","Traseira","Costura de tiras"]). Renderizado como
   *  checklist por etapa × numeração no setor Aviamento. */
  aviamentoSteps?: string[];
  /** Lot sizing (PR 2026-05-23): quando o grupo representa o N-ésimo lote
   *  de OPs splitadas, mostra badge "LOTE X / N" no header. */
  lotInfo?: { number: number; total: number };
  /** Consumo previsto por cor (manufacturing traveler). Enriquecido no
   *  PrintWorkSheetsPage via consumptionForOpNumbers. */
  consumption?: ConsumptionRow[];
}

export interface SoleSilkGroup {
  soleName: string;
  colorGroups: SilkColorGroup[];
  totalPairs: number;
  /** Razão social do(s) cliente(s) dos PVs desta ficha. */
  clientNames?: string[];
}

export type GroupedSector =
  | 'Silk'
  | 'Montagem'
  | 'Corte Forração'
  | 'Corte Cabedal'
  | 'Costura'
  | 'Aviamento'
  | 'Acabamento';

interface Props {
  group: SoleSilkGroup;
  sector: GroupedSector;
  date?: string;
  /** Pares por ficha. Default 12. */
  pairsPerCard?: number;
  /** Faixa etária (por numeração) — selo INFANTIL/ADULTO no header. */
  sizeBand?: 'infantil' | 'adulto' | 'misto';
}

const SECTOR_THEME: Record<GroupedSector, {
  border: string;
  bg: string;
  bgLight: string;
  border1: string;
  textColor: string;
  icon: typeof Paintbrush;
  accentColor: 'pink' | 'blue' | 'cyan' | 'violet' | 'amber' | 'emerald' | 'orange';
  showFrenteTraseiro: boolean;
  showSilkImage: boolean;
  /** Renderiza foto do produto (sandália). Desligar em setores que cortam só
   *  componente isolado (Corte Forração — só forro, não vê o calçado). */
  showProductImage: boolean;
  /** Renderiza alertas de fachetado/conjugado/etc (só Aviamento). */
  showAlerts: boolean;
  /** Mostra info de cabedal/forro/material (Aviamento, Corte Forração). */
  showMaterials: 'upper' | 'lining' | 'both' | 'none';
  /** Mostra info de costura (Costura). */
  showStitching: boolean;
  /** Mostra checklist de acabamento (Acabamento). */
  showFinishingChecklist: boolean;
  /** Mostra info de embalagem individual (Acabamento). */
  showIndividualBox: boolean;
  /** Mostra checklist específico de Corte de Cabedal (peças do cabedal,
   *  conferência de cor do couro, etiquetagem por lote). Só em Corte Cabedal. */
  showCabedalCutChecklist?: boolean;
}> = {
  'Silk':           { border: 'border-pink-700',    bg: 'bg-pink-600',    bgLight: 'bg-pink-50',    border1: 'border-pink-500',   textColor: 'text-pink-900',    icon: Paintbrush, accentColor: 'pink',    showFrenteTraseiro: false, showSilkImage: true,  showProductImage: false, showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Montagem':       { border: 'border-blue-700',    bg: 'bg-blue-600',    bgLight: 'bg-blue-50',    border1: 'border-blue-500',   textColor: 'text-blue-900',    icon: Hammer,     accentColor: 'blue',    showFrenteTraseiro: false, showSilkImage: false, showProductImage: true,  showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  // Corte Forração: SEM silk/marca (pedido user 09/06/2026 — o cortador da
  // forração só corta o forro na cor da palmilha, não precisa conferir
  // logomarca). showProductImage=false: corta só o forro, não vê o calçado.
  // showAlerts=true (audit E2 10/06/2026): o alerta "Solado fachetado —
  // duplicar corte de forração do salto" é EXECUTADO por este setor — antes
  // só Aviamento via o aviso.
  'Corte Forração': { border: 'border-cyan-700',    bg: 'bg-cyan-600',    bgLight: 'bg-cyan-50',    border1: 'border-cyan-500',   textColor: 'text-cyan-900',    icon: Cloud,      accentColor: 'cyan',    showFrenteTraseiro: false, showSilkImage: false, showProductImage: false, showAlerts: true,  showMaterials: 'lining',showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  // Corte Cabedal — só em modelos has_straps=false. Mostra material do cabedal,
  // sem silk, sem foto do calçado (cortador só vê o cabedal por cor). Amber pra
  // distinguir visualmente dos outros 2 cortes.
  'Corte Cabedal':  { border: 'border-orange-700',  bg: 'bg-orange-600',  bgLight: 'bg-orange-50',  border1: 'border-orange-500', textColor: 'text-orange-900', icon: Scissors,   accentColor: 'orange',  showFrenteTraseiro: false, showSilkImage: false, showProductImage: true,  showAlerts: true,  showMaterials: 'upper', showStitching: false, showFinishingChecklist: false, showIndividualBox: false, showCabedalCutChecklist: false },
  'Costura':        { border: 'border-violet-700',  bg: 'bg-violet-600',  bgLight: 'bg-violet-50',  border1: 'border-violet-500', textColor: 'text-violet-900',  icon: Pen,        accentColor: 'violet',  showFrenteTraseiro: false, showSilkImage: false, showProductImage: true,  showAlerts: false, showMaterials: 'none',  showStitching: true,  showFinishingChecklist: false, showIndividualBox: false },
  'Aviamento':      { border: 'border-amber-700',   bg: 'bg-amber-600',   bgLight: 'bg-amber-50',   border1: 'border-amber-500',  textColor: 'text-amber-900',   icon: Paperclip,  accentColor: 'amber',   showFrenteTraseiro: true,  showSilkImage: false, showProductImage: true,  showAlerts: true,  showMaterials: 'both',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Acabamento':     { border: 'border-emerald-700', bg: 'bg-emerald-600', bgLight: 'bg-emerald-50', border1: 'border-emerald-500',textColor: 'text-emerald-900', icon: Sparkles,   accentColor: 'emerald', showFrenteTraseiro: false, showSilkImage: true,  showProductImage: true,  showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: true,  showIndividualBox: true  },
};

/**
 * Checklist de kit handoff/receipt — adotado como prática enxuta (Toyota/
 * Lectra). Cada setor formaliza recebimento do upstream + entrega pro
 * downstream em sacolas etiquetadas, eliminando erro de separação.
 *
 * Convenção: a ficha mostra o que o operador deve confirmar AO RECEBER e
 * AO ENTREGAR. Sem isso, kits viravam responsabilidade tácita e variavam
 * por operador.
 */
const KIT_FLOWS: Record<GroupedSector, { receive: string[]; deliver: string[]; nextSector: string } | null> = {
  'Corte Forração': {
    receive: ['Palmilhas recebidas do Corte Palmilha', 'Cor de forração conferida com ficha técnica'],
    deliver: ['Forrações agrupadas por cor', 'Sacolas etiquetadas (cor + qtd)', 'Encaminhado ao próximo setor'],
    nextSector: 'Aviamento / Costura',
  },
  'Corte Cabedal': {
    receive: ['Couro/material separado por cor'],
    deliver: ['Cabedais cortados por cor + numeração', 'Sacolas etiquetadas (cor + qtd)', 'Encaminhado à Costura'],
    nextSector: 'Costura',
  },
  'Costura': {
    receive: ['Cabedal recebido do Corte', 'Forrações recebidas do Corte Forração', 'Linha na cor conferida'],
    deliver: ['Peças costuradas conferidas', 'Encaminhado ao Aviamento'],
    nextSector: 'Aviamento',
  },
  'Aviamento': {
    receive: ['Palmilha + forração + cabedal recebidos', 'Aviamentos (fivelas/ilhoses) separados por cor', 'Componentes batem com a ficha técnica'],
    deliver: ['Conjuntos completos por par', 'Sacolas etiquetadas (cor + numeração)', 'Encaminhado à Montagem'],
    nextSector: 'Montagem',
  },
  'Silk':       null,
  'Montagem':   null,
  'Acabamento': null,
};

const KitHandoffChecklist = ({ sector }: { sector: GroupedSector }) => {
  const flow = KIT_FLOWS[sector];
  if (!flow) return null;
  return (
    <div className="mt-3 mb-2 px-2 py-2 keep-together" style={{ border: '1.5px solid #000' }}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="section-label" style={{ color: '#000' }}>
          Kit · Recebimento / Entrega ({flow.nextSector})
        </span>
        <span className="font-mono text-[9px] text-black/60 tracking-widest uppercase">
          Kit handoff
        </span>
      </div>
      <div className="border-t border-black pt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div>
          <span className="section-label block mb-1" style={{ color: '#000' }}>Ao Receber</span>
          {flow.receive.map(item => (
            <div key={item} className="flex items-start gap-2 text-[11px] text-black mb-0.5">
              <span className="w-3.5 h-3.5 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
              <span className="leading-tight">{item}</span>
            </div>
          ))}
        </div>
        <div>
          <span className="section-label block mb-1" style={{ color: '#000' }}>Ao Entregar</span>
          {flow.deliver.map(item => (
            <div key={item} className="flex items-start gap-2 text-[11px] text-black mb-0.5">
              <span className="w-3.5 h-3.5 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
              <span className="leading-tight">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Ficha de operador genérica pra setores que agrupam por SOLADO + COR.
 *
 * Cada cor ganha sua própria caixa com:
 *   - Foto do produto (variante exata > variante Preto > master > placeholder)
 *   - Grade de pares por numeração
 *   - Info setor-específica (cabedal/forro/costura/embalagem)
 *   - Tally box pra operadora marcar fichas concluídas
 *   - Checklist quando aplicável (Aviamento: frente/traseira; Acabamento: 4-step)
 *   - Alertas (modelo fachetado, conjugado, etc)
 */
export const SilkMontageWorkSheet = ({ group, sector, date, pairsPerCard = 12, sizeBand }: Props) => {
  const theme = SECTOR_THEME[sector];
  const Icon = theme.icon;
  // Silks únicos deste solado (deduplica por silk_url). Pra setores que
  // exibem silk (Silk + Acabamento), mostra cada silk uma vez — se o cliente
  // tiver silk própria, ela aparece aqui no lugar da silk padrão do solado
  // (resolução já feita no PrintWorkSheetsPage.getOrderSilk com cascata
  // cliente → grupo econômico → silk default do solado).
  const uniqueSilks = theme.showSilkImage
    ? Array.from(
        new Map(
          group.colorGroups
            .map(g => g.silk)
            .filter((s): s is { silk_name: string; silk_url: string | null } => !!s)
            .map(s => [s.silk_url || s.silk_name, s] as const),
        ).values(),
      )
    : [];

  // Batch ID determinístico — mesma set de OPs no mesmo dia → mesmo ID.
  // Operadora anota pra bater apontamentos depois (genealogia).
  const allOpNumbers = group.colorGroups.flatMap(cg => cg.opNumbers || []);
  const batchId = generateBatchId(sector, allOpNumbers, date);

  return (
    <div
      className="w-[210mm] p-[6mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Fira Sans', sans-serif", color: '#000' }}
    >
      <WorksheetHeader
        sector={sector}
        icon={Icon}
        sizeBand={sizeBand}
        imageSlot={
          // Em Silk, mostra a imagem da MARCA no header (1ª silk única).
          // O bloco "02 / Silks" abaixo continua mostrando todas as silks dessa
          // ficha em detalhe — o header é a referência visual rápida.
          sector === 'Silk' && uniqueSilks[0]?.silk_url ? (
            <div
              className="w-20 h-20 bg-white overflow-hidden shrink-0 flex items-center justify-center"
              style={{ border: '1.5px solid #000' }}
            >
              <SignedImage
                src={uniqueSilks[0].silk_url}
                alt={uniqueSilks[0].silk_name}
                className="w-full h-full object-contain"
              />
            </div>
          ) : undefined
        }
        identification={(() => {
          // Coleta PVs únicos de todas as cores deste solado pra destacar no header.
          const pvs = Array.from(new Set(
            group.colorGroups.flatMap(cg => cg.pvNumbers || []).filter(Boolean)
          )).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          // Fichas agregadas (Corte Forração / Corte Cabedal) cobrem múltiplos
          // PVs por design. Mostrar lista COMPLETA (não "+N outros") pra que
          // o cortador veja exatamente quais pedidos estão sendo cortados
          // — evita bug onde "OFF WHITE de outro PV" entrou sem perceber.
          const isAggregated = sector === 'Corte Forração' || sector === 'Corte Cabedal';
          const pvDisplay = pvs.length === 0 ? null
            : pvs.length === 1 || isAggregated ? pvs.join(' · ')
            : `${pvs[0]} +${pvs.length - 1}`;
          return (
            <div className="flex items-start gap-4 min-w-0">
              {/* PV destacado — pedido user 19/05/2026 */}
              {pvDisplay && (
                <div className={isAggregated ? 'min-w-0 flex-1' : 'shrink-0'}>
                  <span className="section-label block" style={{ color: '#000' }}>
                    {pvs.length > 1 ? `Pedidos (${pvs.length})` : 'Pedido'}
                  </span>
                  <p
                    className={`text-black leading-tight mt-0.5 ${isAggregated && pvs.length > 1 ? 'break-words' : ''}`}
                    style={{
                      fontFamily: "'Anton', Impact, sans-serif",
                      fontSize: isAggregated && pvs.length > 1 ? '20px' : '32px',
                      letterSpacing: '-0.025em',
                    }}
                  >
                    {pvDisplay}
                  </p>
                </div>
              )}
              <div className={`min-w-0 flex-1 ${pvDisplay ? 'border-l border-black pl-4' : ''}`}>
                <span className="section-label block" style={{ color: '#000' }}>Solado</span>
                <p
                  className="text-black uppercase leading-none mt-0.5"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.025em' }}
                >
                  {group.soleName}
                </p>
                {group.clientNames && group.clientNames.length > 0 && (
                  <p className="font-mono text-[11px] text-black tracking-wider uppercase mt-1 leading-tight">
                    <span className="text-black/60">Cliente · </span>
                    <span className="font-bold">{group.clientNames.join(' · ')}</span>
                  </p>
                )}
                <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                  <span className="font-mono text-[11px] text-black tracking-widest uppercase">
                    {group.colorGroups.length} cor{group.colorGroups.length !== 1 ? 'es' : ''}
                  </span>
                  <span className="font-mono text-[11px] text-black tracking-widest uppercase">
                    Total · <span className="font-bold">{group.totalPairs}</span> pares
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
        qrLabel={sector.toUpperCase().slice(0, 8)}
        date={date}
        batchId={batchId}
        index={`OP ${formatOpNumber(sector)} / ${sector.toUpperCase()}`}
      />

      {/* Silks em destaque — uma por solado, multiple se cliente/grupo tem silk própria */}
      {theme.showSilkImage && uniqueSilks.length > 0 && (
        <div className="mb-2 keep-together">
          <div className="flex items-baseline justify-between mb-1">
            <span className="section-label" style={{ color: '#000' }}>
              02 / Silk{uniqueSilks.length > 1 ? 's' : ''} · Solado {group.soleName}
            </span>
            <span className="font-mono text-[10px] text-black tracking-widest uppercase">
              {uniqueSilks.length} arte{uniqueSilks.length > 1 ? 's' : ''} · verificar antes
            </span>
          </div>
          <div className="border-t border-black pt-2 grid grid-cols-2 gap-2">
            {uniqueSilks.map((silk, idx) => (
              <div key={`${silk.silk_url}-${idx}`} className="flex items-center gap-2 bg-white p-1.5" style={{ border: '1px solid #000' }}>
                {silk.silk_url ? (
                  <div className="w-16 h-16 bg-white overflow-hidden shrink-0 flex items-center justify-center" style={{ border: '1.5px solid #000' }}>
                    <SignedImage
                      src={silk.silk_url}
                      alt={silk.silk_name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-16 h-16 bg-white shrink-0 flex items-center justify-center" style={{ border: '1.5px solid #000' }}>
                    <span className="text-[8px] text-black text-center px-1 font-mono uppercase tracking-widest">Sem marca cadastrada</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className="text-black uppercase leading-none truncate"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.02em' }}
                    title={silk.silk_name}
                  >
                    {silk.silk_name}
                  </p>
                  {!silk.silk_url && (
                    <p className="text-[9px] font-mono text-black mt-0.5 tracking-widest uppercase">Cadastrar em /silks</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-color blocks.
          Fix 21/05/2026: o último colorBlock + SignatureFooter ficam num
          wrapper externo .keep-together pra forçar o browser a paginá-los
          JUNTOS (hard constraint, ao contrário do break-before: avoid que
          é soft e Chrome ignora). Sem isso, em fichas de Silk/Aviamento/
          Corte com 5+ cores o footer vazava sozinho pra pg seguinte. */}
      <div className="flex-1 space-y-2">
        {group.colorGroups.map((cg, idx) => {
          // Corte Cabedal: se a ref tem knife_size_ranges cadastrado (knifeGrid
          // populado com labels P/M/G), exibe colunas por faca em vez de
          // numeração individual. Outros setores sempre usam combinedGrid.
          // Sizes não-mapeadas viram chave literal (ex: "41") no knifeGrid e
          // aparecem como colunas individuais ao lado das facas.
          const usingKnife = sector === 'Corte Cabedal'
            && cg.knifeGrid
            && Object.keys(cg.knifeGrid).length > 0;
          const sourceGrid: Record<string, number> = usingKnife ? cg.knifeGrid! : cg.combinedGrid;
          // Ordem visual canônica das facas: PP < P < M < G < GG < GGG, depois
          // outros labels (alfabético) e por último numerações individuais.
          const KNIFE_ORDER = ['PP', 'P', 'M', 'G', 'GG', 'GGG'];
          const activeSizes = Object.keys(sourceGrid)
            .filter(s => (sourceGrid[s] ?? 0) > 0)
            .sort((a, b) => {
              const ia = KNIFE_ORDER.indexOf(a.toUpperCase());
              const ib = KNIFE_ORDER.indexOf(b.toUpperCase());
              if (ia >= 0 && ib >= 0) return ia - ib;
              if (ia >= 0) return -1;
              if (ib >= 0) return 1;
              const na = parseFloat(a), nb = parseFloat(b);
              const aIsNum = !isNaN(na), bIsNum = !isNaN(nb);
              if (aIsNum && bIsNum) return na - nb;
              if (aIsNum) return 1;   // labels alpha antes de numéricas
              if (bIsNum) return -1;
              return a.localeCompare(b);
            });
          const cards = Math.max(1, Math.ceil(cg.totalPairs / pairsPerCard));
          const isLast = idx === group.colorGroups.length - 1;

          const colorBlock = (
            // flow-card (v6): o card pode fragmentar ENTRE seções internas
            // (header/foto/grade/consumo/tally — cada uma keep-together
            // próprio). Borda fecha em cada fragmento via box-decoration-
            // break: clone. Antes era keep-together anulado pelo unlock
            // :has(table) — quebrava em qualquer ponto interno.
            <div className="flow-card bg-white" style={{ border: '1.5px solid #000' }}>
              {/* Color header — editorial, no fill. Atômico + colado na
                  seção seguinte (nunca órfão no fim da página). */}
              <div className="keep-together keep-with-next px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {cg.colorHex && (
                    <div className="w-5 h-5 shrink-0" style={{ backgroundColor: cg.colorHex, border: '1px solid #000' }} />
                  )}
                  <div className="min-w-0">
                    {/* "Cor" = cor base do calçado (= cor do produto). No Corte
                        Forração é a cor em que a forração é cortada. Regra do
                        user (09/06/2026): a cor da forração É a cor base do
                        calçado — NÃO um mapeamento separado (antes usava
                        liningColor e saía "NÃO CADASTRADA" em branco). */}
                    <span className="section-label block" style={{ color: '#000' }}>
                      {sector === 'Corte Forração' ? 'Cor da Forração' : 'Cor'}
                    </span>
                    <span
                      className="uppercase leading-none block"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.025em', color: '#C00000' }}
                    >
                      {cg.color}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {cg.refs && cg.refs.length > 0 && (
                    <div className="text-right">
                      <span className="section-label block" style={{ color: '#000' }}>Ref.</span>
                      <div className="flex items-center gap-1 mt-0.5 justify-end flex-wrap">
                        {cg.refs.map((r) => (
                          <span
                            key={r.code || r.name}
                            className="inline-block bg-black text-white font-bold px-2 py-0.5 rounded-sm whitespace-nowrap uppercase"
                            style={{ fontSize: '10px', letterSpacing: '0.04em' }}
                          >
                            {r.name || r.code || '—'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {cg.pvNumbers && cg.pvNumbers.length > 0 && (
                    <div className="text-right">
                      <span className="section-label block" style={{ color: '#000' }}>Pedido</span>
                      <span className="font-mono text-[12px] font-bold text-black tracking-wider">
                        {cg.pvNumbers.length === 1 ? cg.pvNumbers[0] : `${cg.pvNumbers[0]} +${cg.pvNumbers.length - 1}`}
                      </span>
                    </div>
                  )}
                  {cg.opNumbers.length > 0 && (
                    <div className="text-right">
                      <span className="section-label block" style={{ color: '#000' }}>Ordem</span>
                      <span className="font-mono text-[12px] font-bold text-black tracking-wider">
                        {cg.opNumbers.length === 1 ? cg.opNumbers[0] : `${cg.opNumbers[0]} +${cg.opNumbers.length - 1}`}
                      </span>
                    </div>
                  )}
                  {cg.lotInfo && cg.lotInfo.total > 1 && (
                    <div className="text-right border-r border-black pr-3">
                      <span className="section-label block" style={{ color: '#000' }}>Lote</span>
                      <span
                        className="text-black leading-none block"
                        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.025em' }}
                      >
                        {cg.lotInfo.number}<span className="text-sm font-mono tracking-widest">/{cg.lotInfo.total}</span>
                      </span>
                    </div>
                  )}
                  <div className="text-right">
                    <span className="section-label block" style={{ color: '#000' }}>Pares</span>
                    <span
                      className="text-black leading-none block"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.02em' }}
                    >
                      {cg.totalPairs}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-2 bg-white">
                {/* Linha superior: foto (quando aplicável ao setor) + info setor-específica.
                    `keep-together`: foto e grid de materiais devem ficar JUNTOS na mesma
                    página (auditoria mai/2026 — sem isso, em cusp de página a foto ficava
                    isolada de Cabedal/Forro, operador lia info sem ver o produto). */}
                <div className="flex gap-2 mb-2 keep-together">
                  {theme.showProductImage && (
                    <ProductImageBlock
                      variantImageUrl={cg.variantImageUrl}
                      alternateVariants={cg.alternateVariants}
                      technicalSheetImageUrl={cg.technicalSheetImageUrl}
                      orderColor={cg.color}
                      size={140}
                      alt={`${group.soleName} ${cg.color}`}
                    />
                  )}
                  <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    {theme.showMaterials !== 'none' && (
                      <>
                        {(theme.showMaterials === 'upper' || theme.showMaterials === 'both') && (
                          <div>
                            <span className="section-label block" style={{ color: '#000' }}>Cabedal</span>
                            <p className="font-bold text-black uppercase mt-0.5 leading-tight">{cg.upperMaterial || '—'}</p>
                            {cg.upperConsumptionPerPair && (
                              <p className="font-mono text-[10px] text-black tracking-wider">{cg.upperConsumptionPerPair.toFixed(2)} dm²/par</p>
                            )}
                          </div>
                        )}
                        {(theme.showMaterials === 'lining' || theme.showMaterials === 'both') && (
                          <div>
                            <span className="section-label block" style={{ color: '#000' }}>Forração</span>
                            <p className="font-bold text-black uppercase mt-0.5 leading-tight">{cg.liningMaterial || '—'}</p>
                            {cg.liningConsumptionPerPair && (
                              <p className="font-mono text-[10px] text-black tracking-wider">{cg.liningConsumptionPerPair.toFixed(2)} dm²/par</p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {theme.showStitching && (
                      <>
                        <div>
                          <span className="section-label block" style={{ color: '#000' }}>Linha</span>
                          <p className="font-bold text-black uppercase mt-0.5">{cg.threadColor || '—'}</p>
                        </div>
                        <div>
                          <span className="section-label block" style={{ color: '#000' }}>Ponto</span>
                          <p className="font-bold text-black uppercase mt-0.5">{cg.stitchType || '—'}</p>
                        </div>
                      </>
                    )}
                    {theme.showIndividualBox && (
                      <>
                        <div>
                          <span className="section-label block" style={{ color: '#000' }}>Caixa Individual</span>
                          <p className="font-bold text-black uppercase mt-0.5">{cg.individualBoxColor || '—'}</p>
                        </div>
                        <div>
                          <span className="section-label block" style={{ color: '#000' }}>Pares / Caixa</span>
                          <p className="font-mono font-bold text-black mt-0.5">{cg.pairsPerIndividualBox || 12}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Componentes auxiliares (Aviamento). Quando TODOS os items
                    têm label começando com 'TIRA', renderiza como tabela de
                    "Sequência de Tiras". */}
                {(theme.showMaterials === 'both' || sector === 'Montagem') && cg.components && cg.components.length > 0 && (() => {
                  const isAllStraps = cg.components.every(c => /^TIRA(\s|$)/i.test(c.name || ''));
                  // Lista curta (≤8) fica atômica; lista longa flui linha a
                  // linha (tr é atômico, thead repete) pra não pular página
                  // inteira deixando branco.
                  return (
                    <div className={`mb-2 ${cg.components.length <= 8 ? 'keep-together' : ''}`}>
                      <div className="flex items-baseline justify-between mb-1 keep-with-next">
                        <span className="section-label" style={{ color: '#000' }}>
                          {isAllStraps ? `Sequência de Tiras · ${cg.components.length}` : 'Componentes'}
                        </span>
                        {isAllStraps && (
                          <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                            Ordem da ficha técnica
                          </span>
                        )}
                      </div>
                      {isAllStraps ? (
                        <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse', border: '1px solid #000' }}>
                          <thead>
                            <tr style={{ borderBottom: '1.5px solid #000' }}>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000', width: 36 }}>#</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Tira</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Cor</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Material</th>
                              <th className="section-label px-2 py-1 text-center" style={{ color: '#000', width: 32 }}>OK</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cg.components.map((c, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #000' }}>
                                <td className="px-2 py-1 font-mono font-bold text-black">{i + 1}</td>
                                <td className="px-2 py-1 font-bold text-black uppercase">{c.name}</td>
                                <td className="px-2 py-1 text-black uppercase" style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.01em' }}>
                                  {c.color || '—'}
                                </td>
                                <td className="px-2 py-1 text-black">{c.material || '—'}</td>
                                <td className="px-2 py-1 text-center">
                                  <span className="inline-block w-4 h-4" style={{ border: '1.5px solid #000' }} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <ul className="text-[11px] space-y-0.5 bg-white p-2 border-t border-black">
                          {cg.components.map((c, i) => (
                            <li key={i} className="text-black">
                              <span className="font-bold uppercase">{c.name}:</span>{' '}
                              {c.material || '—'}
                              {c.color && ` · ${c.color}`}
                              {c.qty && ` · ${c.qty}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}

                {/* Alertas (só renderiza no setor relevante — ex: Aviamento) */}
                {theme.showAlerts && cg.alerts && cg.alerts.length > 0 && <SectorAlerts alerts={cg.alerts} />}

                {/* Checklist específico de Corte de Cabedal */}
                {theme.showCabedalCutChecklist && (
                  <div className="mb-2 keep-together">
                    <span className="section-label block mb-1" style={{ color: '#000' }}>
                      Checklist · Corte do Cabedal · {cg.color}
                    </span>
                    <div className="border-t border-black pt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {[
                        `Conferir cor do material · esperado ${cg.color}`,
                        cg.upperMaterial ? `Material · ${cg.upperMaterial}` : 'Conferir tipo de material da ficha',
                        'Molde do cabedal separado por numeração',
                        'Cortar peças · lateral, peito (língua), traseira',
                        'Cortar reforços / contraforte se aplicável',
                        'Separar peças por par · verificar simetria L/R',
                        cg.upperConsumptionPerPair
                          ? `Consumo esperado · ${cg.upperConsumptionPerPair.toFixed(2)} dm²/par`
                          : 'Identificar lote · cor + numeração + OP',
                      ].map((item, i) => (
                        <label key={i} className="flex items-start gap-1.5 text-[11px] leading-tight py-0.5 text-black">
                          <span className="w-3.5 h-3.5 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                          <span>{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Grade de números — editorial hairline. Atômica: label +
                    tabela inteira na mesma página (linhas "Por Ficha"/"Total"
                    nunca se separam). */}
                <div className="mb-2 keep-together">
                  <span className="section-label block mb-1" style={{ color: '#000' }}>Grade · Pares por Numeração</span>
                  <table className="w-full text-center bg-white" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', border: '1.5px solid #000' }}>
                    <thead>
                      <tr style={{ borderBottom: '1.5px solid #000' }}>
                        {/* Coluna do rótulo: largura precisa caber "Total × N
                            fichas" (≈96px). Sob table-layout:fixed quem manda é
                            o width do TH — antes era 54 e cortava o texto. */}
                        <th className="section-label py-1.5" style={{ color: '#000', width: 96, borderRight: '1px solid #000' }}>Nº</th>
                        {activeSizes.map((s, i) => (
                          <th
                            key={s}
                            className="py-1.5 text-black font-bold"
                            style={{
                              fontSize: '13px',
                              fontFamily: "'Fira Code', monospace",
                              borderRight: '1px solid #000',
                            }}
                          >
                            {s}
                          </th>
                        ))}
                        <th className="section-label py-1.5" style={{ color: '#000', width: 50 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Linha "Por Ficha" só aparece quando TODAS as OPs do
                          grupo têm a mesma grade base. Quando há grades
                          mistas, omitimos pra evitar perCard × N ≠ Total
                          confundir o operador. */}
                      {cg.baseGrid && cg.baseGradeSum && !cg.mixedGrades && !usingKnife && (
                        <tr style={{ borderBottom: '1.5px solid #000' }}>
                          <td className="py-1 text-[9px] font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 76, whiteSpace: 'nowrap', padding: '4px 6px', letterSpacing: '0.04em' }}>
                            Por Ficha<br />({cg.baseGradeSum}p)
                          </td>
                          {activeSizes.map(s => (
                            <td key={s} className="py-1 font-mono font-bold text-black" style={{ fontSize: '14px', borderRight: '1px solid #000' }}>
                              {cg.baseGrid?.[s] || '—'}
                            </td>
                          ))}
                          <td className="py-1 font-mono font-bold text-black" style={{ fontSize: '14px' }}>
                            {cg.baseGradeSum}
                          </td>
                        </tr>
                      )}
                      <tr style={{ borderBottom: theme.showFrenteTraseiro ? '1px solid #000' : 'none' }}>
                        <td className="py-1.5 font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 96, whiteSpace: 'nowrap', padding: '6px 6px', letterSpacing: '0.04em', fontSize: adaptiveLabelFontSize(cg.fichas, cg.mixedGrades) }}>
                          {cg.mixedGrades
                            ? <>Total<br />({cg.fichas || 0} fichas*)</>
                            : cg.fichas && cg.fichas > 1
                              ? <>Total<br />× {cg.fichas} fichas</>
                              : <>Total<br />(1 ficha)</>}
                        </td>
                        {activeSizes.map(s => (
                          <td
                            key={s}
                            className="py-1.5 text-black"
                            style={{
                              fontFamily: "'Anton', Impact, sans-serif",
                              fontSize: '22px',
                              letterSpacing: '-0.02em',
                              lineHeight: '1',
                              borderRight: '1px solid #000',
                            }}
                          >
                            {sourceGrid[s] || 0}
                          </td>
                        ))}
                        <td
                          className="py-1.5 text-black"
                          style={{
                            fontFamily: "'Anton', Impact, sans-serif",
                            fontSize: '22px',
                            letterSpacing: '-0.02em',
                            lineHeight: '1',
                          }}
                        >
                          {cg.totalPairs}
                        </td>
                      </tr>

                      {/* Etapas de Aviamento — checklist por etapa × numeração.
                          A lista vem da ficha técnica (cg.aviamentoSteps).
                          Fallback pro comportamento antigo (Frente+Traseira)
                          quando a ficha não tem aviamento_steps cadastrado. */}
                      {theme.showFrenteTraseiro && (() => {
                        const steps = (cg.aviamentoSteps && cg.aviamentoSteps.length > 0)
                          ? cg.aviamentoSteps
                          : ['Frente', 'Traseira'];
                        return steps.map((step, sIdx) => (
                          <tr key={`avi-${step}`} style={{ borderBottom: sIdx < steps.length - 1 ? '1px solid #000' : 'none' }}>
                            <td className="py-1.5 text-[10px] font-mono font-bold text-black uppercase tracking-wider" style={{ borderRight: '1px solid #000' }}>{step}</td>
                            {activeSizes.map(s => (
                              <td key={s} className="py-1.5" style={{ borderRight: '1px solid #000' }}>
                                <span className="inline-block w-5 h-5" style={{ border: '1.5px solid #000' }} />
                              </td>
                            ))}
                            <td className="py-1.5">
                              <span className="inline-block w-5 h-5" style={{ border: '1.5px solid #000' }} />
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Checklist Acabamento */}
                {theme.showFinishingChecklist && (
                  <div className="mb-2">
                    <span className="section-label block mb-1" style={{ color: '#000' }}>Checklist por Ficha</span>
                    <div className="border-t border-black pt-1.5 grid grid-cols-4 gap-2">
                      {['Limpou cola', 'Conferiu numeração', 'Conferiu par', 'Embalou'].map(item => (
                        <label key={item} className="flex items-center gap-1.5 text-[11px] text-black">
                          <span className="inline-block w-4 h-4 shrink-0" style={{ border: '1.5px solid #000' }} />
                          <span className="leading-tight">{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Consumo Previsto — padrão de manufacturing traveler
                    (Craftybase/ERPNext/Tulip). Filtra por setor pra
                    operadora ver só o que ela consome. */}
                {cg.consumption && cg.consumption.length > 0 && (() => {
                  const filtered = filterConsumptionForSector(cg.consumption, sector);
                  if (filtered.length === 0) return null;
                  return (
                    <div className="mt-2 px-2 py-1.5 keep-together" style={{ border: '1px solid #000' }}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="section-label" style={{ color: '#000' }}>
                          Consumo Previsto
                        </span>
                        <span className="font-mono text-[9px] text-black/60 tracking-widest uppercase">
                          {filtered.length} item{filtered.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="border-t border-black pt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {filtered.map(row => (
                          <div key={row.product_id} className="text-[10px] text-black leading-tight flex items-baseline justify-between gap-2">
                            <span className="truncate font-medium">{row.product_name}</span>
                            <span className="font-mono shrink-0 text-black/80">
                              {row.required >= 10 ? row.required.toFixed(1) : row.required.toFixed(2)}
                              {' '}
                              <span className="text-[8px] text-black/60 uppercase tracking-widest">
                                {formatUnitLabel(row.unit, row.component === 'Solado' ? 'par' : 'un')}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Tally Box */}
                <TallyBox count={cards} pairsPerCard={pairsPerCard} />
              </div>
            </div>
          );

          // Último colorBlock + checklist + SignatureFooter: cada bloco do
          // trailing é atômico POR SI (checklist e footer têm keep-together
          // próprio) e ancorado ao anterior via keep-with-previous — assim
          // enchem a página um a um em vez de pular juntos como um blocão
          // (que deixava meia página em branco quando não cabia inteiro).
          if (isLast) {
            return (
              <div key={idx}>
                {colorBlock}
                <div className="keep-with-previous">
                  <KitHandoffChecklist sector={sector} />
                  <SignatureFooter />
                </div>
              </div>
            );
          }
          return <React.Fragment key={idx}>{colorBlock}</React.Fragment>;
        })}
        {/* Ficha sem cores: ainda precisa de footer. */}
        {group.colorGroups.length === 0 && (
          <>
            <KitHandoffChecklist sector={sector} />
            <SignatureFooter />
          </>
        )}
      </div>
    </div>
  );
};
