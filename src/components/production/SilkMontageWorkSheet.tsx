import React from 'react';
import { PaintBrush as Paintbrush, Hammer, Pen, Paperclip, Sparkle as Sparkles, Cloud, Scissors, Warning as AlertTriangle } from '@phosphor-icons/react';
import { adaptiveLabelFontSize } from '@/lib/adaptiveFontSize';
import { gradeTableFont } from './worksheet/adaptiveFont';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { HeaderIdentification } from './worksheet/HeaderIdentification';
import { GroupSubHeader } from './worksheet/GroupSubHeader';
import { ProductImageBlock } from './worksheet/ProductImageBlock';
import { CompletionFooter } from './worksheet/CompletionFooter';
import { PaginatedSheet, type SheetBlock } from './worksheet/PaginatedSheet';
import { SectorAlerts, type SectorAlert } from './worksheet/SectorAlerts';
import { SignedImage } from '@/components/ui/signed-image';
import { formatOpNumber } from './worksheet/stageOrder';

export interface SilkColorGroup {
  /** Cor do CABEDAL (chave de agrupamento). Em todos os setores exceto
   *  Corte Forração, é o que o operador vê no card "Cor". */
  color: string;
  colorHex?: string;
  combinedGrid: Record<string, number>;
  /** Grade agregada por FACA de Corte Cabedal (P/M/G/...). Populada quando a
   *  ref da ficha tem knife_size_ranges cadastrado. Em Corte Cabedal, a
   *  worksheet usa este grid em vez de combinedGrid. Sizes não-mapeadas viram
   *  chave literal (ex: '41'). Sem cadastro = NULL/vazio = fallback pro
   *  combinedGrid (sizes individuais). */
  knifeGrid?: Record<string, number>;
  /** Grade agregada por FAIXA P/M/G do AVIAMENTO (segmento próprio, independente
   *  das facas). Populada quando a ref tem aviamento_size_ranges (ou herda o
   *  padrão global). Em Aviamento, a worksheet usa este grid em vez de
   *  combinedGrid. Sizes não-mapeadas viram chave literal. Sem cadastro/padrão =
   *  fallback pro combinedGrid (numerações individuais). */
  aviamentoGrid?: Record<string, number>;
  /** Curva-base de 1 CORRUGADO físico (soma = baseGradeSum). Vazia/ausente
   *  quando a resolução é inexata. */
  baseGrid?: Record<string, number>;
  /** Pares por corrugado físico: 12/15/18 (resolveFicha, 7º passe). */
  baseGradeSum?: number;
  /** Quantas fichas (corrugados) no total — somado entre OPs. */
  fichas?: number;
  /** TRUE quando agrega OPs com grades base diferentes — omite "Por Ficha". */
  mixedGrades?: boolean;
  /** Corrugados DIFERENTES entre OPs do grupo — título do tally avisa. */
  corrugadosMistos?: boolean;
  /** Alguma OP com última ficha parcial — grade exibe "≈ N fichas". */
  fichasAproximadas?: boolean;
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
  /** TRUE quando o modelo tem tiras (has_straps). Usado no Corte Forração pra
   *  esconder QUALQUER referência ao cabedal — modelo de tira não tem cabedal,
   *  o cortador só corta a forração na cor da palmilha. */
  hasStraps?: boolean;
  /** Componentes auxiliares (capa, tira, presilha, etc) — pra setor Aviamento/Mesa. */
  components?: Array<{ name: string; material?: string; qty?: string; color?: string; cm?: number }>;
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
  /** TRUE quando o cabedal passa por COSTURA: tem cabedal a cortar
   *  (requiresUpperCut) E a ficha técnica NÃO é corte a fio
   *  (upper_corte_a_fio=false). Filtra a ficha 'Costura Cabedal'. */
  requiresUpperSewing?: boolean;
  /** Etapas de Aviamento que se aplicam a essa ficha (subset de
   *  ["Frente","Traseira","Costura de tiras"]). Renderizado como
   *  checklist por etapa × numeração no setor Aviamento. */
  aviamentoSteps?: string[];
  /** Lot sizing (PR 2026-05-23): quando o grupo representa o N-ésimo lote
   *  de OPs splitadas, mostra badge "LOTE X / N" no header. */
  lotInfo?: { number: number; total: number };
}

export interface SoleSilkGroup {
  /** Título do grupo: nome do SOLADO (agrupamento padrão) ou nome da
   *  REFERÊNCIA quando `groupKind === 'reference'` (Aviamento, 2026-06-12). */
  soleName: string;
  colorGroups: SilkColorGroup[];
  totalPairs: number;
  /** Razão social do(s) cliente(s) dos PVs desta ficha. */
  clientNames?: string[];
  /** Como o grupo foi formado (2026-06-12):
   *  - 'sole' (default): por solado — header rotula "Solado".
   *  - 'reference': por referência (Aviamento monta o cabedal; solado é
   *    irrelevante) — header rotula "Referência" e os cards escondem a
   *    badge de ref (redundante, a ficha inteira É de uma ref). */
  groupKind?: 'sole' | 'reference';
  /** Faixa etária do GRUPO (por numeração) — selo no sub-header do grupo
   *  dentro do maço contínuo do setor (2026-06-12). */
  sizeBand?: 'infantil' | 'adulto' | 'misto';
}

/** Facas de Corte de uma referência (Corte Cabedal, 2026-06-12). `ranges`
 *  espelha technical_sheets.knife_size_ranges — `code` (código físico da
 *  faca) é opcional (retrocompat com cadastros antigos sem o campo). */
export interface KnifeRefSpec {
  refCode: string;
  refName: string;
  ranges: Array<{ label: string; sizes: string[]; code?: string }>;
}

export type GroupedSector =
  | 'Silk'
  | 'Montagem'
  | 'Corte Forração'
  | 'Corte Cabedal'
  | 'Costura Palmilha'
  | 'Costura Cabedal'
  | 'Aviamento'
  | 'Acabamento';

interface Props {
  /** Grupos do SETOR INTEIRO (1 por solado/referência) — fluxo contínuo no
   *  mesmo maço de páginas (2026-06-12). Cada grupo abre com um sub-header
   *  compacto (GroupSubHeader); o WorksheetHeader agregado aparece 1× só. */
  groups: SoleSilkGroup[];
  sector: GroupedSector;
  /** Pares por ficha. Default 12. */
  pairsPerCard?: number;
  /** Faixa etária AGREGADA do setor — selo INFANTIL/ADULTO no header. */
  sizeBand?: 'infantil' | 'adulto' | 'misto';
  /** Rótulo da faixa de cabeçalho de página (PaginatedSheet). */
  sectorLabel?: string;
  /** Facas de Corte por referência (SÓ Corte Cabedal, 2026-06-12): bloco
   *  "Facas de Corte" logo após o header — qtd de facas do modelo + tabela
   *  por faca (código em destaque + numerações cobertas + referência quando
   *  o maço tem várias). */
  knives?: KnifeRefSpec[];
  /** Range de numerações de cada faca (label P/M/G → ["34","35","36","37"]) —
   *  exibido sob o rótulo no cabeçalho da grade de Corte Cabedal. (User 2026-06-17.) */
  facaRanges?: Record<string, string[]>;
}

// Simplificação 2026-06-12: KPIs, blocos de materiais (cabedal/forro),
// checklists genéricos de setor e "Consumo Previsto" foram REMOVIDOS das
// fichas de operador (pedido do user). O tema agora só controla layout.
const SECTOR_THEME: Record<GroupedSector, {
  icon: typeof Paintbrush;
  /** Layout compacto empilhado: cor → grade por ficha → total por numeração.
   *  Sem foto, sem materiais, sem checklist (Corte Forração / Costura Palmilha). */
  compact: boolean;
  /** Campos fillable Frente/Traseira por numeração (Aviamento). */
  showFrenteTraseiro: boolean;
  showSilkImage: boolean;
  /** Renderiza foto do produto (sandália). Desligar em setores que cortam só
   *  componente isolado (Corte Forração — só forro, não vê o calçado). */
  showProductImage: boolean;
  /** Renderiza alertas operacionais (fachetado etc). */
  showAlerts: boolean;
  /** Linha "PEÇAS A COSTURAR: N (2 peças/par)" — só Costura Cabedal. */
  showPiecesToSew: boolean;
}> = {
  // Silk (2026-06-12, pedido do dono): layout COMPACTO igual Corte Forração
  // (agrupamento solado+cor) mostrando APENAS a logomarca a estampar (cliente
  // quando o silk de cliente está habilitado, senão a do solado — cascata já
  // resolvida no PrintWorkSheetsPage.getOrderSilk). Sem foto de produto, sem
  // tabela de múltiplos silks: 1 logomarca por ficha (ou por cor, quando as
  // cores resolvem silks diferentes).
  'Silk':             { icon: Paintbrush, compact: true,  showFrenteTraseiro: false, showSilkImage: true,  showProductImage: false, showAlerts: false, showPiecesToSew: false },
  'Montagem':         { icon: Hammer,     compact: false, showFrenteTraseiro: false, showSilkImage: false, showProductImage: true,  showAlerts: false, showPiecesToSew: false },
  // Corte Forração: layout COMPACTO (pedido user 2026-06-12) — por cor, só
  // nome da cor + grade por ficha + total por numeração + alerta fachetado
  // (audit E2 10/06/2026: o alerta é EXECUTADO por este setor).
  'Corte Forração':   { icon: Cloud,      compact: true,  showFrenteTraseiro: false, showSilkImage: false, showProductImage: false, showAlerts: true,  showPiecesToSew: false },
  // Corte Cabedal — só em modelos has_straps=false. Sem silk; foto do produto
  // pra identificação do cabedal por cor.
  'Corte Cabedal':    { icon: Scissors,   compact: false, showFrenteTraseiro: false, showSilkImage: false, showProductImage: true,  showAlerts: true,  showPiecesToSew: false },
  // Costura Palmilha (2026-06-12, ex-'Costura'): mesmíssimo layout compacto
  // do Corte Forração. Roteiro: OPs com 'Costura' em production_sectors.
  'Costura Palmilha': { icon: Pen,        compact: true,  showFrenteTraseiro: false, showSilkImage: false, showProductImage: false, showAlerts: true,  showPiecesToSew: false },
  // Costura Cabedal (2026-06-12): só pra OPs com 'Corte Cabedal' no roteiro e
  // upper_corte_a_fio=false. Foto + cor + grade + "PEÇAS A COSTURAR".
  'Costura Cabedal':  { icon: Pen,        compact: false, showFrenteTraseiro: false, showSilkImage: false, showProductImage: true,  showAlerts: false, showPiecesToSew: true  },
  'Acabamento':       { icon: Sparkles,   compact: false, showFrenteTraseiro: false, showSilkImage: true,  showProductImage: true,  showAlerts: false, showPiecesToSew: false },
  'Aviamento':        { icon: Paperclip,  compact: false, showFrenteTraseiro: true,  showSilkImage: false, showProductImage: true,  showAlerts: true,  showPiecesToSew: false },
};

// Ordem visual canônica das facas: PP < P < M < G < GG < GGG, depois
// outros labels (alfabético) e por último numerações individuais.
const KNIFE_ORDER = ['PP', 'P', 'M', 'G', 'GG', 'GGG'];
const sortSizes = (sizes: string[]): string[] =>
  [...sizes].sort((a, b) => {
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

/**
 * Ficha de operador genérica pra setores agrupados (solado+cor ou, no
 * Aviamento, referência+cor — `group.groupKind`).
 *
 * FLUXO CONTÍNUO POR SETOR (2026-06-12, pedido do dono): o componente recebe
 * TODOS os grupos do setor e emite UM PaginatedSheet só — header agregado do
 * setor (1×) + sub-header compacto por grupo + cards + CompletionFooter por
 * grupo. Grupo que não cabe no resto da página vai inteiro pra próxima, sem
 * repetir header gigante (a identificação das páginas 2+ é a faixa fina do
 * próprio PaginatedSheet).
 *
 * Layout completo (Corte Cabedal/Costura Cabedal/Aviamento/Acabamento):
 * card por cor com foto (quando aplicável), grade, alertas e tally.
 *
 * Layout compacto (Corte Forração/Costura Palmilha/Silk — pedido user
 * 2026-06-12): por cor, apenas nome da cor + grade por ficha + total por
 * numeração + alerta fachetado em 1 linha + tally. Silk adiciona o bloco
 * da LOGOMARCA a estampar (única por grupo, ou por cor quando divergem).
 */
export const SilkMontageWorkSheet = ({ groups, sector, pairsPerCard = 12, sizeBand, sectorLabel, knives, facaRanges }: Props) => {
  const theme = SECTOR_THEME[sector];
  const Icon = theme.icon;

  // ── Agregados do setor (header consolidado, padrão PalmilhaWorkSheet) ──
  const grandTotal = groups.reduce((s, g) => s + g.totalPairs, 0);
  const totalColors = groups.reduce((s, g) => s + g.colorGroups.length, 0);
  const allPvs = Array.from(new Set(
    groups.flatMap(g => g.colorGroups.flatMap(cg => cg.pvNumbers || [])).filter(Boolean),
  )).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const allClients = Array.from(new Set(
    groups.flatMap(g => g.clientNames || []).filter(Boolean),
  )).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const groupNoun = groups[0]?.groupKind === 'reference' ? 'referência' : 'solado';

  /** Tabela de grade compartilhada (Por Ficha + Total + etapas Aviamento). */
  const renderGradeTable = (cg: SilkColorGroup) => {
    // Corte Cabedal: se a ref tem knife_size_ranges cadastrado (knifeGrid
    // populado com labels P/M/G), exibe colunas por faca em vez de
    // numeração individual. Aviamento: idem com aviamentoGrid (segmento
    // próprio). Outros setores sempre usam combinedGrid.
    const usingKnife = sector === 'Corte Cabedal'
      && cg.knifeGrid
      && Object.keys(cg.knifeGrid).length > 0;
    const usingAviamentoPmg = sector === 'Aviamento'
      && cg.aviamentoGrid
      && Object.keys(cg.aviamentoGrid).length > 0;
    const usingBuckets = usingKnife || usingAviamentoPmg;
    const sourceGrid: Record<string, number> = usingKnife
      ? cg.knifeGrid!
      : usingAviamentoPmg
        ? cg.aviamentoGrid!
        : cg.combinedGrid;
    const activeSizes = sortSizes(Object.keys(sourceGrid).filter(s => (sourceGrid[s] ?? 0) > 0));
    // F-M3 (2026-06-17): na grade por faixa (faca/P-M-G), a soma das colunas
    // exibidas tem que fechar com o total de pares do grupo — senão alguma
    // numeração não foi mapeada e o operador produziria a menos/a mais. Aviso
    // visual discreto (não esconde dados, só alerta).
    const displayedSum = activeSizes.reduce((s, k) => s + (Number(sourceGrid[k]) || 0), 0);
    const knifeGridMismatch = usingBuckets && displayedSum !== (cg.totalPairs || 0);
    // Fontes adaptativas pela qtd de colunas (2026-06-12): grade mista
    // (16+ numerações) cortava as células com fonte fixa. No layout COMPACTO
    // a grade desce 1 bucket (dense, 7º passe) pra caberem 2 cores por página.
    const ft = gradeTableFont(activeSizes, theme.compact);
    // Range de numerações de cada faca (P → "34-37") sob o rótulo no cabeçalho
    // quando agrupando por faca (Corte Cabedal). Contíguo vira "34-37"; senão
    // lista "34·36". Vazio quando não há range pra a faca.
    const facaRangeLabel = (label: string): string => {
      const sizes = facaRanges?.[label];
      if (!sizes || sizes.length === 0) return '';
      const nums = sizes.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      if (nums.length === 0) return '';
      if (nums.length === 1) return String(nums[0]);
      const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
      return contiguous ? `${nums[0]}-${nums[nums.length - 1]}` : nums.join('·');
    };
    return (
      <>
      <table className="w-full text-center bg-white" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', border: '1.5px solid #000' }}>
        <thead>
          <tr style={{ borderBottom: '1.5px solid #000' }}>
            {/* Coluna do rótulo: largura precisa caber "Total × N
                fichas" (≈96px). Sob table-layout:fixed quem manda é
                o width do TH — antes era 54 e cortava o texto. */}
            <th className="section-label py-1" style={{ color: '#000', width: 96, borderRight: '1px solid #000' }}>Nº</th>
            {activeSizes.map(s => (
              <th
                key={s}
                className="text-black font-bold"
                style={{
                  fontSize: `${ft.headerPx}px`,
                  fontFamily: "'Fira Code', monospace",
                  borderRight: '1px solid #000',
                  padding: `${ft.padY}px 1px`,
                  lineHeight: 1.2,
                }}
              >
                {s}
                {usingKnife && facaRangeLabel(s) && (
                  <div style={{ fontSize: `${Math.max(6, ft.headerPx - 4)}px`, fontWeight: 400, fontFamily: "'Fira Code', monospace", lineHeight: 1, marginTop: 1, color: '#000' }}>
                    {facaRangeLabel(s)}
                  </div>
                )}
              </th>
            ))}
            <th className="section-label py-1" style={{ color: '#000', width: 50 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {/* Linha "Por Ficha" só aparece quando TODAS as OPs do
              grupo têm a mesma grade base. Quando há grades
              mistas, omitimos pra evitar perCard × N ≠ Total
              confundir o operador. */}
          {cg.baseGrid && cg.baseGradeSum && !cg.mixedGrades && !usingBuckets && (
            <tr style={{ borderBottom: '1.5px solid #000' }}>
              <td className="py-1 text-[9px] font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 76, whiteSpace: 'nowrap', padding: '4px 6px', letterSpacing: '0.04em' }}>
                Por Ficha<br />({cg.baseGradeSum}p)
              </td>
              {activeSizes.map(s => (
                <td key={s} className="font-mono font-bold text-black" style={{ fontSize: `${ft.cellPx}px`, borderRight: '1px solid #000', padding: `${ft.padY}px 1px`, lineHeight: 1.2 }}>
                  {cg.baseGrid?.[s] || '—'}
                </td>
              ))}
              <td className="font-mono font-bold text-black" style={{ fontSize: `${ft.cellPx}px`, padding: `${ft.padY}px 1px`, lineHeight: 1.2 }}>
                {cg.baseGradeSum}
              </td>
            </tr>
          )}
          <tr style={{ borderBottom: theme.showFrenteTraseiro ? '1px solid #000' : 'none' }}>
            <td className="py-1 font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 96, whiteSpace: 'nowrap', padding: '5px 6px', letterSpacing: '0.04em', fontSize: adaptiveLabelFontSize(cg.fichas, cg.mixedGrades) }}>
              {cg.fichasAproximadas
                ? <>Total<br />≈ {cg.fichas || 0} fichas</>
                : cg.mixedGrades
                  ? <>Total<br />({cg.fichas || 0} fichas*)</>
                  : cg.fichas && cg.fichas > 1
                    ? <>Total<br />× {cg.fichas} fichas</>
                    : <>Total<br />(1 ficha)</>}
            </td>
            {activeSizes.map(s => (
              <td
                key={s}
                className="text-black"
                style={{
                  fontFamily: "'Anton', Impact, sans-serif",
                  fontSize: `${ft.displayPx}px`,
                  letterSpacing: '-0.02em',
                  lineHeight: '1.1',
                  borderRight: '1px solid #000',
                  padding: `${ft.padY}px 1px`,
                }}
              >
                {sourceGrid[s] || 0}
              </td>
            ))}
            <td
              className="text-black"
              style={{
                fontFamily: "'Anton', Impact, sans-serif",
                fontSize: `${ft.displayPx}px`,
                letterSpacing: '-0.02em',
                lineHeight: '1.1',
                padding: `${ft.padY}px 1px`,
              }}
            >
              {cg.totalPairs}
            </td>
          </tr>

          {/* Etapas de Aviamento — campos fillable por etapa × numeração.
              A lista vem da ficha técnica (cg.aviamentoSteps).
              Fallback pro comportamento antigo (Frente+Traseira)
              quando a ficha não tem aviamento_steps cadastrado. */}
          {theme.showFrenteTraseiro && (() => {
            const steps = (cg.aviamentoSteps && cg.aviamentoSteps.length > 0)
              ? cg.aviamentoSteps
              : ['Frente', 'Traseira'];
            return steps.map((step, sIdx) => (
              <tr key={`avi-${step}`} style={{ borderBottom: sIdx < steps.length - 1 ? '1px solid #000' : 'none' }}>
                <td className="py-1 text-[10px] font-mono font-bold text-black uppercase tracking-wider" style={{ borderRight: '1px solid #000' }}>{step}</td>
                {activeSizes.map(s => (
                  <td key={s} className="py-1" style={{ borderRight: '1px solid #000' }}>
                    <span className="inline-block w-5 h-5" style={{ border: '1.5px solid #000' }} />
                  </td>
                ))}
                <td className="py-1">
                  <span className="inline-block w-5 h-5" style={{ border: '1.5px solid #000' }} />
                </td>
              </tr>
            ));
          })()}
        </tbody>
      </table>
      {/* F-M3: grade por faixa (faca/P-M-G) não fecha com o total do grupo. */}
      {knifeGridMismatch && (
        <p
          className="leading-tight mt-0.5"
          style={{ fontSize: '9px', fontWeight: 700, color: '#C00000' }}
        >
          ⚠ grade por {usingAviamentoPmg ? 'faixa P/M/G' : 'faca'} não fecha com o total ({displayedSum} ≠ {cg.totalPairs} pares) — conferir mapeamento de numerações
        </p>
      )}
      </>
    );
  };

  /** Alerta operacional em 1 linha compacta (layout compacto). */
  const renderCompactAlerts = (cg: SilkColorGroup) => {
    if (!theme.showAlerts || !cg.alerts || cg.alerts.length === 0) return null;
    return (
      <div className="keep-together flex items-center gap-2 px-2 py-1 mt-1 bg-white" style={{ border: '1.5px solid #000' }}>
        <AlertTriangle className="h-3.5 w-3.5 text-black shrink-0" weight="bold" />
        <span className="text-[10px] text-black leading-tight" style={{ fontWeight: 700 }}>
          {cg.alerts.map(a => a.text).join(' · ')}
        </span>
      </div>
    );
  };

  // ── Blocos atômicos pro PaginatedSheet (2026-06-12) ──
  // Header agregado do SETOR (1×) → [sub-header + cards + rodapé] por grupo.
  const headerBlock = (
      <WorksheetHeader
        sector={sector}
        icon={Icon}
        sizeBand={sizeBand}
        identification={
          // PVs do setor inteiro, lista COMPLETA com fonte adaptativa (não
          // "+N outros") — o operador vê exatamente quais pedidos estão no
          // maço. Razão social em vermelho logo abaixo (2026-06-12).
          <HeaderIdentification pvNumbers={allPvs} clientNames={allClients}>
            <span className="section-label block" style={{ color: '#000' }}>Resumo</span>
            <p
              className="text-black uppercase leading-none mt-0.5"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.025em' }}
            >
              {grandTotal} <span className="text-xs font-mono tracking-widest">pares</span>
            </p>
            <div className="flex items-baseline gap-3 mt-1 flex-wrap">
              <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                {groups.length} {groupNoun}{groups.length !== 1 ? 's' : ''}
              </span>
              <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                {totalColors} cor{totalColors !== 1 ? 'es' : ''}
              </span>
            </div>
          </HeaderIdentification>
        }
        qrLabel={sector.toUpperCase().slice(0, 8)}
        index={`OP ${formatOpNumber(sector)} / ${sector.toUpperCase()}`}
      />
  );

  // ── Facas de Corte (SÓ Corte Cabedal, pedido do dono 2026-06-12) ──
  // Bloco logo após o header do maço: quantidade de facas + tabela por faca
  // com CÓDIGO em destaque (Anton) e numerações cobertas. Quando o maço tem
  // várias referências, a coluna "Referência" identifica de qual modelo é
  // cada conjunto de facas. Retrocompat: faca sem `code` mostra "—".
  const sortRanges = <T extends { label: string }>(ranges: T[]): T[] =>
    [...ranges].sort((a, b) => {
      const ia = KNIFE_ORDER.indexOf(a.label.toUpperCase());
      const ib = KNIFE_ORDER.indexOf(b.label.toUpperCase());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.label.localeCompare(b.label);
    });
  const knivesBlock = sector === 'Corte Cabedal' && knives && knives.length > 0 ? (() => {
    const multiRef = knives.length > 1;
    const totalKnives = knives.reduce((s, k) => s + k.ranges.length, 0);
    return (
      <div className="keep-together mb-2 bg-white" style={{ border: '1.5px solid #000' }}>
        <div className="px-3 py-1.5 flex items-baseline justify-between gap-3" style={{ borderBottom: '1.5px solid #000' }}>
          <span className="section-label" style={{ color: '#000' }}>02 / Facas de Corte</span>
          <span
            className="text-black uppercase leading-none"
            style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.02em' }}
          >
            {totalKnives} <span className="text-[10px] font-mono tracking-widest">faca{totalKnives !== 1 ? 's' : ''}{multiRef ? ` · ${knives.length} referências` : ''}</span>
          </span>
        </div>
        <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid #000' }}>
              {multiRef && (
                <th className="section-label px-3 py-1" style={{ color: '#000' }}>Referência</th>
              )}
              <th className="section-label px-3 py-1" style={{ color: '#000', width: 64 }}>Faca</th>
              <th className="section-label px-3 py-1" style={{ color: '#000', width: 140 }}>Código</th>
              <th className="section-label px-3 py-1" style={{ color: '#000' }}>Numerações</th>
            </tr>
          </thead>
          <tbody>
            {knives.flatMap((k) => {
              const ordered = sortRanges(k.ranges);
              return ordered.map((r, ri) => (
                <tr
                  key={`${k.refCode || k.refName}-${r.label}-${ri}`}
                  style={{ borderBottom: '1px solid #000' }}
                >
                  {multiRef && (
                    <td className="px-3 py-1 align-middle">
                      {ri === 0 ? (
                        <span
                          className="inline-block bg-black text-white font-bold px-2 py-0.5 rounded-sm whitespace-nowrap uppercase"
                          style={{ fontSize: '10px', letterSpacing: '0.04em' }}
                        >
                          {k.refName || k.refCode || '—'}
                        </span>
                      ) : (
                        <span className="font-mono text-[9px] text-black uppercase tracking-widest">″</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-1 font-mono text-[11px] font-bold text-black uppercase tracking-wider align-middle">
                    {r.label}
                  </td>
                  <td className="px-3 py-1 align-middle">
                    <span
                      className="text-black uppercase leading-none"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', letterSpacing: '-0.01em' }}
                    >
                      {r.code || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-1 font-mono text-[11px] font-bold text-black align-middle">
                    {(r.sizes || []).join(' · ') || '—'}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    );
  })() : null;

  // ── Builder dos blocos de UM grupo (solado/referência) ──
  // Sub-header compacto (faixa fina — NÃO o header gigante) + logomarca +
  // 1 card por cor + rodapé de conclusão do grupo.
  const buildGroupBlocks = (group: SoleSilkGroup, gi: number): SheetBlock[] => {
    // Silks únicos deste grupo (deduplica por silk_url). Se o cliente tiver
    // silk própria, ela aparece no lugar da silk padrão do solado (cascata
    // cliente → grupo econômico → solado já resolvida no getOrderSilk).
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

    const groupOps = Array.from(new Set(group.colorGroups.flatMap(cg => cg.opNumbers || []).filter(Boolean)));
    const subHeaderBlock = (
      <GroupSubHeader
        eyebrow={`${group.groupKind === 'reference' ? 'Referência' : 'Solado'} ${gi + 1}/${groups.length}`}
        title={group.soleName}
        pairs={group.totalPairs}
        ops={groupOps}
        sizeBand={group.sizeBand}
      />
    );

  // ── Logomarca a estampar (Silk compacto, 2026-06-12) ──
  // UMA logomarca por grupo (cascata cliente → grupo econômico → solado
  // → Squad já resolvida): bloco único em destaque. Quando cores do
  // mesmo solado resolvem silks DIFERENTES, a logomarca desce pro nível
  // da cor (bloco por seção, renderizado no loop abaixo).
  const silkSingleBlock = theme.compact && theme.showSilkImage && uniqueSilks.length === 1 ? (
        <div className="keep-together mb-2 flex items-center gap-3 bg-white p-2" style={{ border: '2px solid #000' }}>
          {uniqueSilks[0].silk_url ? (
            <div className="bg-white overflow-hidden shrink-0 flex items-center justify-center" style={{ width: 110, height: 110, border: '1.5px solid #000' }}>
              <SignedImage
                src={uniqueSilks[0].silk_url}
                alt={uniqueSilks[0].silk_name}
                loading="eager"
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="bg-white shrink-0 flex items-center justify-center" style={{ width: 110, height: 110, border: '1.5px solid #000' }}>
              <span className="text-[8px] text-black text-center px-1 font-mono uppercase tracking-widest">Sem marca cadastrada</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <span className="section-label block" style={{ color: '#000' }}>02 / Logomarca a Estampar</span>
            <p
              className="text-black uppercase leading-none mt-1"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '30px', letterSpacing: '-0.02em' }}
            >
              {uniqueSilks[0].silk_name}
            </p>
            {!uniqueSilks[0].silk_url && (
              <p className="text-[9px] font-mono text-black mt-1 tracking-widest uppercase">Cadastrar em /silks</p>
            )}
          </div>
        </div>
  ) : null;

  // Silks em destaque (layout COMPLETO — Acabamento): uma por solado,
  // multiple se cliente/grupo tem silk própria
  const silksGridBlock = !theme.compact && theme.showSilkImage && uniqueSilks.length > 0 ? (
        <div className="mb-1.5 keep-together">
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
                      loading="eager"
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
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '17px', letterSpacing: '-0.02em' }}
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
  ) : null;

  // Per-color blocks — 1 bloco atômico por cor no paginador.
  const colorBlocks = group.colorGroups.map((cg, idx) => {
          // 7º passe (2026-06-12): a tally é de CORRUGADOS (12/15/18 pares)
          // SEMPRE — 1 caixinha = 1 corrugado físico, mesmo com grades mistas
          // (fichas agora soma certo entre OPs). Corrugados divergentes entre
          // OPs: o título avisa "corrugados mistos" em vez de mostrar um
          // pares/ficha enganoso. Fallback (sem resolução): pairsPerCard (12).
          const cgBgs = cg.baseGradeSum ?? 0;
          const cgNf = cg.fichas ?? 0;
          const tallyPerCard = cgBgs > 0 ? cgBgs : pairsPerCard;
          const cards = cgNf > 0 ? cgNf : Math.max(1, Math.ceil(cg.totalPairs / tallyPerCard));
          const tallyTitle = cg.corrugadosMistos ? 'Controle de Fichas · corrugados mistos' : undefined;

          // ── Layout COMPACTO (Corte Forração / Costura Palmilha) ──
          // Pedido user 2026-06-12: por cor, apenas nome da cor (Anton),
          // grade por ficha + total por numeração, alerta fachetado em 1
          // linha e tally. Sem foto, sem materiais, sem checklist.
          // Densidade do compacto (7º passe, pedido do dono: "reduzir um pouco
          // a fonte dos itens em cima" pra 2 cores caberem na mesma A4):
          // cor 26→20px, total 22→17px, margens mb-1→mb-0.5 / pt-1.5→pt-1,
          // grade 1 bucket menor (dense) e tally size="sm".
          if (theme.compact) {
            return (
              <div key={idx} className="pt-1" style={{ borderTop: '2px solid #000' }}>
                <div className="keep-together keep-with-next flex items-end justify-between gap-3 mb-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {cg.colorHex && (
                      <div className="w-4 h-4 shrink-0" style={{ backgroundColor: cg.colorHex, border: '1px solid #000' }} />
                    )}
                    <span
                      className="uppercase leading-none block truncate"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.025em', color: '#C00000' }}
                    >
                      {cg.color}
                    </span>
                  </div>
                  <div className="flex items-end gap-3 shrink-0">
                    {cg.lotInfo && cg.lotInfo.total > 1 && (
                      <span className="font-mono text-[10px] font-bold text-black tracking-widest uppercase">
                        Lote {cg.lotInfo.number}/{cg.lotInfo.total}
                      </span>
                    )}
                    <span
                      className="text-black leading-none"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '17px', letterSpacing: '-0.02em' }}
                    >
                      {cg.totalPairs} <span className="text-[10px] font-mono tracking-widest">pares</span>
                    </span>
                  </div>
                </div>
                {/* Logomarca POR COR — só quando as cores da ficha resolvem
                    silks DIFERENTES (senão o bloco único acima cobre tudo). */}
                {theme.showSilkImage && uniqueSilks.length > 1 && cg.silk && (
                  <div className="keep-together keep-with-next flex items-center gap-2 bg-white p-1.5 mb-1" style={{ border: '1.5px solid #000' }}>
                    {cg.silk.silk_url ? (
                      <div className="bg-white overflow-hidden shrink-0 flex items-center justify-center" style={{ width: 64, height: 64, border: '1px solid #000' }}>
                        <SignedImage
                          src={cg.silk.silk_url}
                          alt={cg.silk.silk_name}
                          loading="eager"
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="bg-white shrink-0 flex items-center justify-center" style={{ width: 64, height: 64, border: '1px solid #000' }}>
                        <span className="text-[8px] text-black text-center px-1 font-mono uppercase tracking-widest">Sem marca</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="section-label block" style={{ color: '#000' }}>Logomarca a Estampar</span>
                      <p
                        className="text-black uppercase leading-none mt-0.5 truncate"
                        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', letterSpacing: '-0.02em' }}
                        title={cg.silk.silk_name}
                      >
                        {cg.silk.silk_name}
                      </p>
                    </div>
                  </div>
                )}
                <div className="keep-together">
                  {renderGradeTable(cg)}
                </div>
                {renderCompactAlerts(cg)}
                <TallyBox count={cards} pairsPerCard={tallyPerCard} totalUnits={cg.totalPairs} title={tallyTitle} size="sm" />
              </div>
            );
          }

          // ── Layout COMPLETO (Corte Cabedal / Costura Cabedal / Aviamento /
          //    Acabamento) ──
          const colorBlock = (
            // flow-card (v6): o card pode fragmentar ENTRE seções internas
            // (header/foto/grade/tally — cada uma keep-together próprio).
            // Borda fecha em cada fragmento via box-decoration-break: clone.
            <div className="flow-card bg-white" style={{ border: '1.5px solid #000' }}>
              {/* Color header — editorial, no fill. Atômico + colado na
                  seção seguinte (nunca órfão no fim da página). */}
              <div className="keep-together keep-with-next px-3 py-1.5 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {cg.colorHex && (
                    <div className="w-5 h-5 shrink-0" style={{ backgroundColor: cg.colorHex, border: '1px solid #000' }} />
                  )}
                  <div className="min-w-0">
                    <span className="section-label block" style={{ color: '#000' }}>Cor</span>
                    <span
                      className="uppercase leading-none block"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.025em', color: '#C00000' }}
                    >
                      {cg.color}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {/* Badge de ref escondida quando a FICHA INTEIRA é de uma
                      referência (groupKind 'reference' — Aviamento): o header
                      já identifica o modelo, repetir por card é ruído. */}
                  {group.groupKind !== 'reference' && cg.refs && cg.refs.length > 0 && (
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
                      <span className="font-mono text-[11px] font-bold text-black tracking-wider">
                        {cg.pvNumbers.length === 1 ? cg.pvNumbers[0] : `${cg.pvNumbers[0]} +${cg.pvNumbers.length - 1}`}
                      </span>
                    </div>
                  )}
                  {cg.opNumbers.length > 0 && (
                    <div className="text-right">
                      <span className="section-label block" style={{ color: '#000' }}>Ordem</span>
                      <span className="font-mono text-[11px] font-bold text-black tracking-wider">
                        {cg.opNumbers.length === 1 ? cg.opNumbers[0] : `${cg.opNumbers[0]} +${cg.opNumbers.length - 1}`}
                      </span>
                    </div>
                  )}
                  {cg.lotInfo && cg.lotInfo.total > 1 && (
                    <div className="text-right border-r border-black pr-3">
                      <span className="section-label block" style={{ color: '#000' }}>Lote</span>
                      <span
                        className="text-black leading-none block"
                        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.025em' }}
                      >
                        {cg.lotInfo.number}<span className="text-xs font-mono tracking-widest">/{cg.lotInfo.total}</span>
                      </span>
                    </div>
                  )}
                  <div className="text-right">
                    <span className="section-label block" style={{ color: '#000' }}>Pares</span>
                    <span
                      className="text-black leading-none block"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.02em' }}
                    >
                      {cg.totalPairs}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-2 bg-white">
                {/* Foto do produto (máx. 1 por card — pedido user 2026-06-12).
                    Costura Cabedal usa 48×48 (identificação rápida); demais
                    setores mantêm 140 pra leitura a distância. */}
                {theme.showProductImage && (
                  <div className="flex gap-2 mb-1.5 keep-together">
                    <ProductImageBlock
                      variantImageUrl={cg.variantImageUrl}
                      alternateVariants={cg.alternateVariants}
                      technicalSheetImageUrl={cg.technicalSheetImageUrl}
                      orderColor={cg.color}
                      size={sector === 'Costura Cabedal' ? 48 : 140}
                      alt={`${group.soleName} ${cg.color}`}
                    />
                    {theme.showPiecesToSew && (
                      <div className="flex-1 flex flex-col justify-center pl-2" style={{ borderLeft: '1px solid #000' }}>
                        <span className="section-label block" style={{ color: '#000' }}>Peças a Costurar</span>
                        <span
                          className="text-black leading-none mt-0.5 block"
                          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.02em' }}
                        >
                          {cg.totalPairs * 2}
                          <span className="text-[11px] font-mono tracking-widest uppercase"> peças (2 peças/par)</span>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Sequência de Tiras / componentes auxiliares (Aviamento /
                    Montagem) — insumo de execução, com ordem das tiras da
                    ficha técnica (EXCEÇÃO mantida na simplificação 2026-06-12). */}
                {(sector === 'Aviamento' || sector === 'Montagem') && cg.components && cg.components.length > 0 && (() => {
                  const isAllStraps = cg.components.every(c => /^TIRA(\s|$)/i.test(c.name || ''));
                  // Lista curta (≤8) fica atômica; lista longa flui linha a
                  // linha (tr é atômico, thead repete) pra não pular página
                  // inteira deixando branco.
                  return (
                    <div className={`mb-1.5 ${cg.components.length <= 8 ? 'keep-together' : ''}`}>
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
                        <>
                        <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', border: '1px solid #000' }}>
                          <thead>
                            <tr style={{ borderBottom: '1.5px solid #000' }}>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000', width: 36 }}>#</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Tira</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Cor</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Material</th>
                              <th className="section-label px-2 py-1 text-right" style={{ color: '#000', width: 72 }}>Medida</th>
                              <th className="section-label px-2 py-1 text-center" style={{ color: '#000', width: 32 }}>OK</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cg.components.map((c, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #000' }}>
                                <td className="px-2 py-1 font-mono font-bold text-black">{i + 1}</td>
                                <td className="px-2 py-1 font-bold text-black uppercase">{c.name}</td>
                                <td className="px-2 py-1 text-black uppercase" style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '13px', letterSpacing: '-0.01em' }}>
                                  {c.color || '—'}
                                </td>
                                <td className="px-2 py-1 text-black">{c.material || '—'}</td>
                                <td className="px-2 py-1 text-right font-mono font-bold" style={{ whiteSpace: 'nowrap', color: '#C00000' }}>
                                  {c.cm != null ? `${c.cm} cm` : '—'}
                                </td>
                                <td className="px-2 py-1 text-center">
                                  <span className="inline-block w-4 h-4" style={{ border: '1.5px solid #000' }} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="text-black mt-0.5" style={{ fontSize: '9px', color: '#000' }}>
                          Medida em cm — <strong>"do par"</strong> (o valor é por par).
                        </div>
                        </>
                      ) : (
                        <ul className="text-[10px] space-y-0.5 bg-white p-2 border-t border-black">
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

                {/* Alertas operacionais (fachetado etc) — mantidos na
                    simplificação 2026-06-12. */}
                {theme.showAlerts && cg.alerts && cg.alerts.length > 0 && <SectorAlerts alerts={cg.alerts} />}

                {/* Grade de números — editorial hairline. Atômica: label +
                    tabela inteira na mesma página (linhas "Por Ficha"/"Total"
                    nunca se separam). */}
                <div className="mb-1.5 keep-together">
                  <span className="section-label block mb-1" style={{ color: '#000' }}>Grade · Pares por Numeração</span>
                  {renderGradeTable(cg)}
                </div>

                {/* Tally Box */}
                <TallyBox count={cards} pairsPerCard={tallyPerCard} totalUnits={cg.totalPairs} title={tallyTitle} />
              </div>
            </div>
          );

          return <React.Fragment key={idx}>{colorBlock}</React.Fragment>;
  });

    return [
      // Sub-header do grupo — keepWithNext: nunca fecha página sozinho
      // (título "Solado N/M" órfão no pé da folha, conteúdo na seguinte).
      { node: subHeaderBlock, keepWithNext: true },
      ...(silkSingleBlock ? [silkSingleBlock] : []),
      ...(silksGridBlock ? [silksGridBlock] : []),
      ...colorBlocks,
      // Rodapé de conclusão do GRUPO — keepWithPrev: nunca abre página
      // sozinho, puxa o último card do grupo junto.
      { node: <CompletionFooter />, keepWithPrev: true },
    ];
  };

  // ── Maço contínuo do setor: header agregado + grupos em sequência ──
  const blocks: SheetBlock[] = [
    headerBlock,
    ...(knivesBlock ? [knivesBlock] : []),
    ...groups.flatMap((group, gi) => buildGroupBlocks(group, gi)),
  ];

  return <PaginatedSheet sectorLabel={sectorLabel || sector} blocks={blocks} />;
};
