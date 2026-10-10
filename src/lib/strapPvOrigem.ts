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
 * Origem padrão quando o catálogo não manda "Comprar pronto".
 *
 * Revisão 2 de `specs/tiras-redesenho.md` (R1/R2/R14): a fábrica NUNCA corta
 * tira. O valor gravado `fabrica` (e `source_mode = 'internal'`) passou a
 * SIGNIFICAR **Prestador** — a napa vai ao prestador, que devolve a tira. O
 * enum do banco não foi renomeado; só a semântica e os rótulos.
 */
export const DEFAULT_STRAP_PV_ORIGEM: SelectableStrapPvOrigem = 'fabrica';

/** Origens oferecidas no PV: Prestador (`fabrica`) × Comprar pronto. */
export type SelectableStrapPvOrigem = 'fabrica' | 'sku_acabado';

/** Vocabulário único da UI (R1). Não usar "Fazer"/"Fábrica"/"interna". */
export const STRAP_PV_ORIGEM_LABEL: Record<SelectableStrapPvOrigem, string> = {
  fabrica: 'Prestador',
  sku_acabado: 'Comprar pronto',
};

/** `prestador` legado e `fabrica` são a MESMA origem: Prestador. */
export function normalizeSelectableStrapPvOrigem(
  value: unknown,
): SelectableStrapPvOrigem | null {
  if (value === 'fabrica' || value === 'prestador') return 'fabrica';
  if (value === 'sku_acabado') return 'sku_acabado';
  return null;
}

/** Rótulo da origem gravada no PV ("Prestador" | "Comprar pronto"). */
export function strapPvOrigemLabel(value: unknown): string | null {
  const selectable = normalizeSelectableStrapPvOrigem(value);
  return selectable ? STRAP_PV_ORIGEM_LABEL[selectable] : null;
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

/**
 * Padrão do CATÁLOGO (R2) para a medida. `sempre_sku_acabado` → Comprar
 * pronto; `sempre_fabrica` e `escolhe_no_pv` (e vazio) → Prestador. Os três
 * valores do banco continuam válidos — todos viraram só "padrão".
 */
export function catalogDefaultStrapPvOrigem(
  measure: StrapPvOrigemMeasureLike | null | undefined,
): SelectableStrapPvOrigem {
  return normalizeStrapOrigemPadrao(measure?.origem_padrao) === 'sempre_sku_acabado'
    ? 'sku_acabado'
    : DEFAULT_STRAP_PV_ORIGEM;
}

/**
 * Padrão materializável da LINHA: o catálogo manda, mas
 *  - linha de identidade acabada (`finished_product_group`, ex.: Strass da
 *    ficha) só existe comprada pronta — não há napa para mandar ao prestador;
 *  - "Comprar pronto" exige o grupo acabado na ficha (`group_id`), senão o
 *    writer converte para Prestador (mig 28600). O padrão já nasce coerente.
 */
export function defaultStrapPvOrigemForLine(
  line: StrapPvOrigemLineLike | null | undefined,
  measure: StrapPvOrigemMeasureLike | null | undefined,
): SelectableStrapPvOrigem {
  if (isPurchasedReadyStrap(line)) return 'sku_acabado';
  const catalog = catalogDefaultStrapPvOrigem(measure);
  if (catalog === 'sku_acabado' && !strapLineAllowsBuyReadyOrigem(line)) {
    return DEFAULT_STRAP_PV_ORIGEM;
  }
  return catalog;
}

/**
 * Origem efetiva da linha (R2): a escolha EXPLÍCITA do PV vence o catálogo,
 * qualquer que seja o `origem_padrao` da medida; sem escolha, vale o padrão do
 * catálogo. Linha de identidade acabada é sempre Comprar pronto (o writer
 * congela buy_ready por identidade). Sem medida conhecida → null (catálogo
 * ainda não carregou; não inventa).
 */
export function resolveEffectiveStrapPvOrigem(
  line: StrapPvOrigemLineLike | null | undefined,
  measure: StrapPvOrigemMeasureLike | null | undefined,
): EffectiveStrapPvOrigem | null {
  if (isPurchasedReadyStrap(line)) return 'sku_acabado';
  const choice = normalizeSelectableStrapPvOrigem(line?.pv_origem);
  if (choice) return choice;
  if (!measure) return null;
  return defaultStrapPvOrigemForLine(line, measure);
}

/**
 * Valor exibido no seletor do PV: escolha explícita > origem operacional já
 * congelada (`strap_sourcing`, PVs anteriores ao `pv_origem`) > padrão do
 * catálogo. Nunca vazio quando a medida é conhecida — a origem não "falta"
 * mais (R2: o padrão sempre se aplica).
 */
export function strapPvOrigemChooserValue(
  line: StrapPvOrigemLineLike | null | undefined,
  measure: StrapPvOrigemMeasureLike | null | undefined,
  sourcing?: StrapSourcingMap | null,
): SelectableStrapPvOrigem | null {
  if (isPurchasedReadyStrap(line)) return 'sku_acabado';
  const choice = normalizeSelectableStrapPvOrigem(line?.pv_origem);
  if (choice) return choice;
  const lineId = technicalStrapLineId({
    id: line?.id,
    technical_strap_line_id: line?.technical_strap_line_id,
  });
  const mode = lineId ? getStrapSourcingOverride(sourcing, lineId) : null;
  if (mode === 'buy_ready') return 'sku_acabado';
  if (mode === 'internal') return 'fabrica';
  if (!measure) return null;
  return defaultStrapPvOrigemForLine(line, measure);
}

export function isExplicitStrapPvOrigem(
  value: unknown,
): value is StrapPvOrigem {
  return value === 'fabrica' || value === 'prestador' || value === 'sku_acabado';
}

/**
 * Snapshot comprometido (Aprovado / Em Produção) só trava origem JÁ escolhida.
 * Lacuna (sem pv_origem) permanece editável — senão o seletor morto
 * impediria qualquer exceção ao padrão do catálogo (PV-00194 / Meia Cana).
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
 * — G03/artesanal por napa não tem group_id; a origem válida é Prestador.
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
 * Também espelha `strap_sourcing` (Prestador → internal). Sem isso, "Todas
 * comprar pronto" numa cor + "Prestador" só no seletor visível deixava as outras
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
 * impossível de materializar. Converte para Prestador antes do RPC — cobre
 * cores colapsadas que ainda carregavam "Todas comprar pronto" enquanto a aba
 * aberta já mostrava Prestador.
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

/**
 * Preenche `pv_origem` ausente com o padrão do CATÁLOGO (R2) em TODA linha
 * cuja medida é conhecida — não só nas antigas `escolhe_no_pv`. Não
 * sobrescreve escolha explícita: a exceção do PV vence o catálogo.
 */
export function applyDefaultStrapPvOrigemChoices<T extends StrapPvOrigemLineLike>(
  lines: readonly T[] | null | undefined,
  measures: readonly StrapPvOrigemMeasureLike[] | null | undefined,
): { lines: T[]; changed: boolean } {
  const source = lines || [];
  const byId = new Map((measures || []).map((measure) => [measure.id, measure]));
  let changed = false;
  const next = source.map((line) => {
    if (hasExplicitStrapPvOrigem(line)) return line;
    const measure = line.measure_id ? byId.get(line.measure_id) : undefined;
    if (!measure) return line;
    changed = true;
    return { ...line, pv_origem: defaultStrapPvOrigemForLine(line, measure) };
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
 * ⚠ Origem Prestador (`fabrica`/`prestador` legado) usa o preço da medida
 * (`preco_artesanal_per_m`, mão de obra R$/m). Comprar pronto não entra neste gap.
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
          message: `${label}: cadastre a mão de obra do prestador (R$/m) no Hub de Tiras.`,
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

/** Motor canônico: Comprar pronto → buy_ready; Prestador (`fabrica`/`prestador`) → internal. */
export function sourceModeForEffectiveOrigem(
  origem: EffectiveStrapPvOrigem | null | undefined,
): 'internal' | 'buy_ready' | null {
  if (origem === 'sku_acabado') return 'buy_ready';
  if (origem === 'fabrica' || origem === 'prestador') return 'internal';
  return null;
}
