import {
  normalizeStrapOrigemPadrao,
} from '@/lib/strapBaseNapaPeel';
import {
  getStrapSourcingOverride,
  setStrapSourcing,
  type StrapSourcingMap,
} from '@/lib/strapSourcing';
import {
  isPurchasedReadyStrap,
  type StrapIdentityLike,
} from '@/lib/strapIdentity';
import {
  technicalStrapLineId,
  type StrapPvOrigem,
} from '@/lib/technicalStrapLines';

export type EffectiveStrapPvOrigem = StrapPvOrigem;

/**
 * Padrão do seletor quando Hub = escolhe_no_pv e o operador ainda não escolheu.
 * Decisão 24/09/2026: só Fazer × Comprar pronto — default = fazer (fábrica).
 */
export const DEFAULT_STRAP_PV_ORIGEM: StrapPvOrigem = 'fabrica';

/** Origens oferecidas no PV (prestador legado some da UI). */
export type SelectableStrapPvOrigem = 'fabrica' | 'sku_acabado';

/** Prestador legado conta como "fazer" (internal) — 16-B. */
export function normalizeSelectableStrapPvOrigem(
  value: unknown,
): SelectableStrapPvOrigem | null {
  if (value === 'fabrica' || value === 'prestador') return 'fabrica';
  if (value === 'sku_acabado') return 'sku_acabado';
  return null;
}
export interface StrapPvOrigemLineLike extends StrapIdentityLike {
  id?: string | null;
  label?: string | null;
  measure_id?: string | null;
  pv_origem?: StrapPvOrigem | string | null;
  technical_strap_line_id?: string | null;
  /** Grupo acabado da ficha (legado / escolha fornecedor em reference_base). */
  group_id?: string | null;
}

export interface StrapPvOrigemItemLike {
  color?: string | null;
  strap_colors?: StrapPvOrigemLineLike[] | null;
  /** Origem operacional já congelada — satisfaz escolhe_no_pv sem `pv_origem`. */
  strap_sourcing?: StrapSourcingMap | null;
}

export interface StrapPvOrigemChange {
  lineId: string;
  origem: StrapPvOrigem;
}

export interface StrapPvOrigemMeasureLike {
  id: string;
  origem_padrao?: string | null;
  preco_artesanal_per_m?: number | null;
  preco_prestador_per_m?: number | null;
}

/** Origem efetiva da linha: Hub fixo ganha; em escolhe_no_pv usa o snapshot do PV. */
export function resolveEffectiveStrapPvOrigem(
  line: StrapPvOrigemLineLike | null | undefined,
  measure: StrapPvOrigemMeasureLike | null | undefined,
): EffectiveStrapPvOrigem | null {
  const padrao = normalizeStrapOrigemPadrao(measure?.origem_padrao);
  if (padrao === 'sempre_fabrica') return 'fabrica';
  if (padrao === 'sempre_sku_acabado') return 'sku_acabado';
  const choice = line?.pv_origem;
  if (isExplicitStrapPvOrigem(choice)) {
    // Prestador legado → fazer (fábrica). Wire value permanece fabrica na UI.
    return choice === 'prestador' ? 'fabrica' : choice;
  }
  return null;
}

export interface MissingStrapPvOrigemIssue {
  label: string;
  measureId: string | null;
  code: 'origem_nao_escolhida';
  message: string;
}

function measureRequiresPvOrigemChoice(
  measure: StrapPvOrigemMeasureLike | null | undefined,
): boolean {
  if (measure?.origem_padrao == null || measure.origem_padrao === '') return false;
  return normalizeStrapOrigemPadrao(measure.origem_padrao) === 'escolhe_no_pv';
}

export function isExplicitStrapPvOrigem(
  value: unknown,
): value is StrapPvOrigem {
  return value === 'fabrica' || value === 'prestador' || value === 'sku_acabado';
}

/**
 * Snapshot comprometido (Aprovado / Em Produção) só trava origem JÁ escolhida.
 * Lacuna (escolhe_no_pv sem pv_origem) permanece editável — senão o save
 * exige Fazer/Comprar pronto e o seletor morto impede qualquer opção
 * (PV-00194 / Meia Cana).
 */
export function isStrapPvOrigemChoiceLocked(input: {
  committedSnapshot: boolean;
  productionExcluded?: boolean;
  pvOrigem: unknown;
}): boolean {
  if (input.productionExcluded) return true;
  if (!input.committedSnapshot) return false;
  return isExplicitStrapPvOrigem(input.pvOrigem);
}

function hasExplicitStrapPvOrigem(
  line: StrapPvOrigemLineLike | null | undefined,
): line is StrapPvOrigemLineLike & { pv_origem: StrapPvOrigem } {
  return isExplicitStrapPvOrigem(line?.pv_origem);
}

/** Diff de pv_origem por UUID da linha técnica — usado pra copiar a escolha às outras cores. */
export function collectStrapPvOrigemChanges(
  previous: readonly StrapPvOrigemLineLike[] | null | undefined,
  next: readonly StrapPvOrigemLineLike[] | null | undefined,
): StrapPvOrigemChange[] {
  const previousById = new Map<string, unknown>();
  for (const line of previous || []) {
    const lineId = technicalStrapLineId({
      id: line.id,
      technical_strap_line_id: line.technical_strap_line_id,
    });
    if (lineId) previousById.set(lineId, line.pv_origem);
  }
  const changes: StrapPvOrigemChange[] = [];
  const seen = new Set<string>();
  for (const line of next || []) {
    const lineId = technicalStrapLineId({
      id: line.id,
      technical_strap_line_id: line.technical_strap_line_id,
    });
    if (!lineId || !isExplicitStrapPvOrigem(line.pv_origem) || seen.has(lineId)) continue;
    if (previousById.get(lineId) === line.pv_origem) continue;
    seen.add(lineId);
    changes.push({ lineId, origem: line.pv_origem });
  }
  return changes;
}

/** UUID do grupo acabado na linha da ficha (pin finished ou group_id legado). */
export function strapLineFinishedGroupId(
  line: Pick<StrapPvOrigemLineLike, 'group_id' | 'identity_group_id'> | null | undefined,
): string | null {
  const identity = (line?.identity_group_id || '').trim();
  if (identity) return identity;
  const group = (line?.group_id || '').trim();
  return group || null;
}

/**
 * "Comprar pronto" só é materializável quando a ficha aponta um grupo acabado.
 * Sem isso o writer estoura `Tira pronta exige o grupo acabado (group_id) na ficha`
 * — G03/artesanal por napa não tem group_id; a origem válida é Fazer.
 */
export function strapLineAllowsBuyReadyOrigem(
  line: StrapPvOrigemLineLike | null | undefined,
): boolean {
  return !!strapLineFinishedGroupId(line);
}

/**
 * A origem da posição (TIRA 2, TRASEIRA…) é do pedido, não da cor.
 * Sem isso, escolher em OFF WHITE deixa NEW WHISKY/ROSADO vazios e o save
 * devolve o mesmo toast (PV-00194).
 *
 * Também espelha `strap_sourcing` (fábrica → internal). Sem isso, "Todas
 * comprar pronto" numa cor + "Fazer" só no seletor visível deixava as outras
 * cores com pv_origem=sku e o prepare barrava o PV inteiro.
 */
export function applyStrapPvOrigemChangesToItems<T extends StrapPvOrigemItemLike>(
  items: readonly T[],
  sourceIndex: number,
  changes: readonly StrapPvOrigemChange[],
  isExcluded?: (item: T, index: number) => boolean,
): T[] {
  if (changes.length === 0) return [...items];
  const byLine = new Map(changes.map((change) => [change.lineId, change.origem]));
  return items.map((item, index) => {
    if (index === sourceIndex) return item;
    if (isExcluded?.(item, index)) return item;
    const straps = Array.isArray(item.strap_colors) ? item.strap_colors : [];
    if (straps.length === 0) return item;
    let changed = false;
    let nextSourcing: StrapSourcingMap = { ...(item.strap_sourcing || {}) };
    const nextStraps = straps.map((line) => {
      const lineId = technicalStrapLineId({
        id: line.id,
        technical_strap_line_id: line.technical_strap_line_id,
      });
      if (!lineId) return line;
      const origem = byLine.get(lineId);
      if (!origem || line.pv_origem === origem) return line;
      changed = true;
      if (origem === 'fabrica' || origem === 'prestador') {
        nextSourcing = setStrapSourcing(nextSourcing, lineId, 'internal');
      } else if (origem === 'sku_acabado') {
        const mode = getStrapSourcingOverride(nextSourcing, lineId);
        if (mode !== 'buy_ready') {
          nextSourcing = setStrapSourcing(nextSourcing, lineId, null);
        }
      }
      return { ...line, pv_origem: origem };
    });
    return changed
      ? { ...item, strap_colors: nextStraps, strap_sourcing: nextSourcing }
      : item;
  });
}

/**
 * No submit: `sku_acabado` em linha artesanal sem grupo acabado na ficha é
 * impossível de materializar. Converte para Fazer antes do RPC — cobre cores
 * colapsadas que ainda carregavam "Todas comprar pronto" enquanto a aba aberta
 * já mostrava Fazer.
 */
export function coerceImpossibleBuyReadyStrapOrigem<T extends StrapPvOrigemItemLike>(
  items: readonly T[],
): { items: T[]; coerced: Array<{ color: string; label: string }> } {
  const coerced: Array<{ color: string; label: string }> = [];
  const next = items.map((item) => {
    const straps = Array.isArray(item.strap_colors) ? [...item.strap_colors] : [];
    if (straps.length === 0) return item;
    let changed = false;
    let nextSourcing: StrapSourcingMap = { ...(item.strap_sourcing || {}) };
    const nextStraps = straps.map((line) => {
      if (line.pv_origem !== 'sku_acabado') return line;
      // Identidade finished_product_group continua no caminho buy_ready do writer.
      if (isPurchasedReadyStrap(line)) return line;
      if (strapLineAllowsBuyReadyOrigem(line)) return line;
      changed = true;
      coerced.push({
        color: (item.color || 'sem cor').trim() || 'sem cor',
        label: (line.label || 'Tira').trim() || 'Tira',
      });
      const lineId = technicalStrapLineId({
        id: line.id,
        technical_strap_line_id: line.technical_strap_line_id,
      });
      if (lineId) {
        nextSourcing = setStrapSourcing(nextSourcing, lineId, 'internal');
      }
      return { ...line, pv_origem: 'fabrica' as const };
    });
    return changed
      ? { ...item, strap_colors: nextStraps, strap_sourcing: nextSourcing }
      : item;
  });
  return { items: next, coerced };
}

/** Primeiro gap de origem, nomeando as cores que ainda estão vazias. */
export function firstMissingStrapPvOrigemMessage(
  items: readonly StrapPvOrigemItemLike[] | null | undefined,
  measures: readonly StrapPvOrigemMeasureLike[] | null | undefined,
): string | null {
  const colorsByLabel = new Map<string, string[]>();
  let firstLabel: string | null = null;
  let firstMessage: string | null = null;
  for (const item of items || []) {
    const straps = Array.isArray(item.strap_colors) ? item.strap_colors : [];
    if (straps.length === 0) continue;
    const missing = listMissingStrapPvOrigemChoices(straps, measures, item.strap_sourcing);
    const color = (item.color || 'sem cor').trim() || 'sem cor';
    for (const issue of missing) {
      if (!firstLabel) {
        firstLabel = issue.label;
        firstMessage = issue.message;
      }
      const colors = colorsByLabel.get(issue.label) || [];
      if (!colors.includes(color)) colors.push(color);
      colorsByLabel.set(issue.label, colors);
    }
  }
  if (!firstLabel || !firstMessage) return null;
  const colors = colorsByLabel.get(firstLabel) || [];
  if (colors.length === 0) return firstMessage;
  return `${firstLabel}: escolha Fazer ou Comprar pronto em ${colors.join(', ')} antes de salvar.`;
}

/**
 * `strap_sourcing` com modo canônico já congela a origem operacional (PVs
 * anteriores ao campo `pv_origem`). Sem isso, pedido Aprovado com sourcing
 * preenchido trava no âmbar "Escolha a origem…" (PV-00168).
 */
export function strapSourcingSatisfiesPvOrigemChoice(
  line: StrapPvOrigemLineLike | null | undefined,
  sourcing: StrapSourcingMap | null | undefined,
): boolean {
  const lineId = technicalStrapLineId({
    id: line?.id,
    technical_strap_line_id: line?.technical_strap_line_id,
  });
  if (!lineId) return false;
  const mode = getStrapSourcingOverride(sourcing, lineId);
  return mode === 'internal' || mode === 'buy_ready';
}

/** Posições escolhe_no_pv sem pv_origem — bloqueiam save no desktop (spec).
 *  Se a medida ainda não traz `origem_padrao` (migration não aplicada / catálogo
 *  antigo), não bloqueia — senão o PV inteiro trava sem o Hub estar pronto.
 *  Sourcing operacional já gravado também satisfaz (legado pré-pv_origem). */
export function listMissingStrapPvOrigemChoices(
  lines: readonly StrapPvOrigemLineLike[] | null | undefined,
  measures: readonly StrapPvOrigemMeasureLike[] | null | undefined,
  sourcing?: StrapSourcingMap | null,
): MissingStrapPvOrigemIssue[] {
  const byId = new Map((measures || []).map((measure) => [measure.id, measure]));
  const issues: MissingStrapPvOrigemIssue[] = [];
  for (const [index, line] of (lines || []).entries()) {
    const measure = line.measure_id ? byId.get(line.measure_id) : undefined;
    if (!measureRequiresPvOrigemChoice(measure)) continue;
    if (hasExplicitStrapPvOrigem(line)) continue;
    if (strapSourcingSatisfiesPvOrigemChoice(line, sourcing)) continue;
    const label = (line.label || `Tira ${index + 1}`).trim() || `Tira ${index + 1}`;
    issues.push({
      label,
      measureId: line.measure_id || null,
      code: 'origem_nao_escolhida',
      message: `${label}: escolha Fazer ou Comprar pronto antes de salvar.`,
    });
  }
  return issues;
}

/**
 * Preenche `pv_origem` ausente com o padrão (prestador / comprar pronto) só nas
 * posições `escolhe_no_pv`. Não sobrescreve escolha explícita do operador.
 */
export function applyDefaultStrapPvOrigemChoices<T extends StrapPvOrigemLineLike>(
  lines: readonly T[] | null | undefined,
  measures: readonly StrapPvOrigemMeasureLike[] | null | undefined,
): { lines: T[]; changed: boolean } {
  const source = lines || [];
  const byId = new Map((measures || []).map((measure) => [measure.id, measure]));
  let changed = false;
  const next = source.map((line) => {
    const measure = line.measure_id ? byId.get(line.measure_id) : undefined;
    if (!measureRequiresPvOrigemChoice(measure)) return line;
    if (hasExplicitStrapPvOrigem(line)) return line;
    changed = true;
    return { ...line, pv_origem: DEFAULT_STRAP_PV_ORIGEM };
  });
  return { lines: changed ? next : [...source], changed };
}

export interface StrapHubIncompleteIssue {
  label: string;
  measureId: string | null;
  code: 'preco_prestador_ausente' | 'preco_artesanal_ausente';
  message: string;
}

/** Medida com um ou mais preços faltando — uma linha no diálogo do PV. */
export interface StrapHubIncompleteMeasureGap {
  measureId: string;
  labels: string[];
  needsArtesanal: boolean;
  needsPrestador: boolean;
}

/**
 * Gaps de Hub para a origem efetiva. Frete/prestador padrão entram na fatia
 * da OS automática (RPC) — aqui só preços da medida.
 *
 * ⚠ Origem "fazer" (fábrica; prestador legado incluso) NÃO exige MO do
 * prestador — só preço artesanal. Comprar pronto não entra neste gap.
 */
export function listStrapHubIncompleteForOrigem(
  lines: readonly StrapPvOrigemLineLike[] | null | undefined,
  measures: readonly StrapPvOrigemMeasureLike[] | null | undefined,
): StrapHubIncompleteIssue[] {
  const byId = new Map((measures || []).map((measure) => [measure.id, measure]));
  const issues: StrapHubIncompleteIssue[] = [];
  for (const [index, line] of (lines || []).entries()) {
    const measure = line.measure_id ? byId.get(line.measure_id) : undefined;
    const effective = resolveEffectiveStrapPvOrigem(line, measure);
    const label = (line.label || `Tira ${index + 1}`).trim() || `Tira ${index + 1}`;
    const measureId = line.measure_id || null;
    if (effective === 'fabrica') {
      const price = Number(measure?.preco_artesanal_per_m);
      if (!(price > 0)) {
        issues.push({
          label,
          measureId,
          code: 'preco_artesanal_ausente',
          message: `${label}: cadastre o preço artesanal (R$/m) no Hub de Tiras.`,
        });
      }
    }
    // sku_acabado / null: sem gap de preço de medida neste helper.
  }
  return issues;
}

/** Agrupa issues por medida (UUID) para o diálogo de completar no PV. */
export function groupStrapHubIncompleteByMeasure(
  issues: readonly StrapHubIncompleteIssue[],
): StrapHubIncompleteMeasureGap[] {
  const byMeasure = new Map<string, StrapHubIncompleteMeasureGap>();
  for (const issue of issues) {
    if (!issue.measureId) continue;
    const current = byMeasure.get(issue.measureId) || {
      measureId: issue.measureId,
      labels: [],
      needsArtesanal: false,
      needsPrestador: false,
    };
    if (!current.labels.includes(issue.label)) current.labels.push(issue.label);
    if (issue.code === 'preco_artesanal_ausente') current.needsArtesanal = true;
    if (issue.code === 'preco_prestador_ausente') current.needsPrestador = true;
    byMeasure.set(issue.measureId, current);
  }
  return Array.from(byMeasure.values());
}

/** Frete/m = amount / per_meters; Y deve ser > 0. */
export function strapFreightPerMeter(
  amount: number | null | undefined,
  perMeters: number | null | undefined,
): number | null {
  if (amount == null || perMeters == null) return null;
  const a = Number(amount);
  const y = Number(perMeters);
  if (!Number.isFinite(a) || a < 0 || !Number.isFinite(y) || !(y > 0)) return null;
  return a / y;
}

/** Motor canônico: sku → buy_ready; fábrica/prestador → internal (OS no prestador). */
export function sourceModeForEffectiveOrigem(
  origem: EffectiveStrapPvOrigem | null | undefined,
): 'internal' | 'buy_ready' | null {
  if (origem === 'sku_acabado') return 'buy_ready';
  if (origem === 'fabrica' || origem === 'prestador') return 'internal';
  return null;
}
