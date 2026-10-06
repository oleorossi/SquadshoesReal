/**
 * Textos editáveis só no lote de geração (não persistem em clients.label_pattern).
 * Branding do lote + overrides de face por SKU (chave = clientOrderLineSkuKey da linha original).
 */
import {
  PONTO_MIX_DEFAULT_PRICE_FORMAT,
  PONTO_MIX_DEFAULT_TEMPLATES,
  clientOrderLineSkuKey,
  type ClientLabelBranding,
  type ClientLabelLineTemplates,
  type ClientLabelPattern,
  type ClientLabelPatternKey,
  type ClientLabelPriceFormat,
  type ClientOrderLine,
} from '@/lib/clientLabelPattern';
import { composePontoMixLabelCopy } from '@/lib/pontoMixLabels';

/** Campos de face editáveis na tabela (nunca codigoBarra). */
export type LotFaceFieldKey =
  | 'descricao'
  | 'referencia'
  | 'cor'
  | 'tamanho'
  | 'valor'
  | 'valorSecundario'
  | 'codProduto'
  | 'tipo'
  | 'categoria'
  | 'grupo'
  | 'semanaFabricacao'
  | 'anoFabricacao'
  | 'line1'
  | 'line2'
  | 'line3';

export type LotBrandingFieldKey = 'motto' | 'exchangeText' | 'materialPrefix';

export interface LotFaceFieldDef {
  key: LotFaceFieldKey;
  label: string;
  /** Sempre obrigatório neste layout. */
  required: boolean;
  /** Obrigatório só se a linha original do CSV tinha valor. */
  requiredIfPresentInCsv?: boolean;
}

export interface LotBrandingFieldDef {
  key: LotBrandingFieldKey;
  label: string;
}

/** Override de face por SKU — Ponto Mix usa line1..3; demais usam campos do pedido. */
export type LotFaceOverride = Partial<Record<LotFaceFieldKey, string>>;

export type LotFaceBySkuKey = Record<string, LotFaceOverride>;

export type LotBranding = Pick<ClientLabelBranding, LotBrandingFieldKey>;

const ORDER_FACE_KEYS: LotFaceFieldKey[] = [
  'descricao',
  'referencia',
  'cor',
  'tamanho',
  'valor',
  'valorSecundario',
  'codProduto',
  'tipo',
  'categoria',
  'grupo',
  'semanaFabricacao',
  'anoFabricacao',
];

export function brandingFieldsForPattern(
  key: ClientLabelPatternKey | null | undefined,
): LotBrandingFieldDef[] {
  switch (key) {
    case 'objetiva':
      return [
        { key: 'motto', label: 'Motto' },
        { key: 'exchangeText', label: 'Texto de troca' },
        { key: 'materialPrefix', label: 'Prefixo material' },
      ];
    case 'nalin_tag':
      return [{ key: 'exchangeText', label: 'Texto de troca' }];
    default:
      return [];
  }
}

export function faceFieldsForPattern(
  key: ClientLabelPatternKey | null | undefined,
): LotFaceFieldDef[] {
  switch (key) {
    case 'objetiva':
      return [
        { key: 'descricao', label: 'Descrição', required: true },
        { key: 'tipo', label: 'Tipo', required: false },
        { key: 'grupo', label: 'Grupo', required: false },
        { key: 'categoria', label: 'Categoria', required: false },
        { key: 'cor', label: 'Cor', required: true },
        { key: 'referencia', label: 'Referência', required: true },
        { key: 'tamanho', label: 'Tam.', required: true },
        { key: 'valor', label: 'Preço', required: false, requiredIfPresentInCsv: true },
        { key: 'semanaFabricacao', label: 'Semana', required: false },
        { key: 'anoFabricacao', label: 'Ano', required: false },
      ];
    case 'objetiva_adesiva':
      return [
        { key: 'descricao', label: 'Descrição', required: true },
        { key: 'referencia', label: 'Referência', required: true },
        { key: 'cor', label: 'Cor', required: true },
        { key: 'tamanho', label: 'Tam.', required: true },
        { key: 'valor', label: 'Preço', required: false, requiredIfPresentInCsv: true },
      ];
    case 'nalin_tag':
      return [
        { key: 'codProduto', label: 'Cód. produto', required: false },
        { key: 'referencia', label: 'Referência', required: true },
        { key: 'descricao', label: 'Descrição', required: true },
        { key: 'cor', label: 'Cor', required: true },
        { key: 'tamanho', label: 'Tam.', required: true },
        { key: 'tipo', label: 'Tipo', required: false },
        { key: 'categoria', label: 'Categoria', required: false },
        { key: 'grupo', label: 'Grupo', required: false },
        { key: 'valor', label: 'Preço', required: false, requiredIfPresentInCsv: true },
        { key: 'valorSecundario', label: 'Preço 2', required: false },
      ];
    case 'baby_nalin':
      return [
        { key: 'tamanho', label: 'Tam.', required: true },
        { key: 'cor', label: 'Cor', required: true },
        { key: 'referencia', label: 'Referência', required: true },
        { key: 'codProduto', label: 'Cód. produto', required: false },
      ];
    case 'ponto_mix':
      return [
        { key: 'line1', label: 'Linha 1', required: false },
        { key: 'line2', label: 'Linha 2', required: false },
        { key: 'line3', label: 'Linha 3', required: false },
        { key: 'tamanho', label: 'Tam.', required: true },
        { key: 'valor', label: 'Preço', required: false, requiredIfPresentInCsv: true },
      ];
    default:
      return [];
  }
}

export function seedLotBranding(branding: ClientLabelBranding | null | undefined): LotBranding {
  return {
    motto: branding?.motto ?? '',
    exchangeText: branding?.exchangeText ?? '',
    materialPrefix: branding?.materialPrefix ?? '',
  };
}

export function mergeLotBranding(
  base: ClientLabelBranding,
  lot: LotBranding | null | undefined,
): ClientLabelBranding {
  if (!lot) return base;
  return {
    ...base,
    motto: lot.motto,
    exchangeText: lot.exchangeText,
    materialPrefix: lot.materialPrefix,
  };
}

function readOrderFaceValue(row: ClientOrderLine, key: LotFaceFieldKey): string {
  if (key === 'line1' || key === 'line2' || key === 'line3') return '';
  const raw = row[key];
  return raw == null ? '' : String(raw);
}

export function seedLotFaceFromRow(
  row: ClientOrderLine,
  patternKey: ClientLabelPatternKey,
  options?: {
    templates?: Partial<ClientLabelLineTemplates> | null;
    priceFormat?: Partial<ClientLabelPriceFormat> | null;
  },
): LotFaceOverride {
  const fields = faceFieldsForPattern(patternKey);
  const override: LotFaceOverride = {};

  if (patternKey === 'ponto_mix') {
    const templates: ClientLabelLineTemplates = {
      ...PONTO_MIX_DEFAULT_TEMPLATES,
      ...options?.templates,
    };
    const priceFormat: ClientLabelPriceFormat = {
      ...PONTO_MIX_DEFAULT_PRICE_FORMAT,
      ...options?.priceFormat,
      decimalSeparator: options?.priceFormat?.decimalSeparator === ',' ? ',' : '.',
    };
    const copy = composePontoMixLabelCopy(row, templates, priceFormat);
    override.line1 = copy.line1;
    override.line2 = copy.line2;
    override.line3 = copy.line3;
  }

  for (const field of fields) {
    if (field.key === 'line1' || field.key === 'line2' || field.key === 'line3') continue;
    override[field.key] = readOrderFaceValue(row, field.key);
  }
  return override;
}

export function seedLotFaceFromRows(
  rows: ClientOrderLine[],
  patternKey: ClientLabelPatternKey,
  options?: {
    templates?: Partial<ClientLabelLineTemplates> | null;
    priceFormat?: Partial<ClientLabelPriceFormat> | null;
  },
): LotFaceBySkuKey {
  const next: LotFaceBySkuKey = {};
  for (const row of rows) {
    next[clientOrderLineSkuKey(row)] = seedLotFaceFromRow(row, patternKey, options);
  }
  return next;
}

/** Aplica override de face sobre a linha original (não mexe em codigoBarra). */
export function applyLotFace(
  row: ClientOrderLine,
  override: LotFaceOverride | null | undefined,
  patternKey: ClientLabelPatternKey,
): ClientOrderLine {
  if (!override) return row;
  const fields = faceFieldsForPattern(patternKey);
  const next: ClientOrderLine = { ...row };
  for (const field of fields) {
    if (field.key === 'line1' || field.key === 'line2' || field.key === 'line3') continue;
    if (Object.prototype.hasOwnProperty.call(override, field.key)) {
      const value = override[field.key] ?? '';
      if (field.key === 'referencia' || field.key === 'cor' || field.key === 'tamanho') {
        next[field.key] = value;
      } else if (field.key === 'codProduto') {
        next.codProduto = value;
      } else {
        next[field.key] = value;
      }
    }
  }
  return next;
}

export function pontoMixLineOverrideFromFace(
  override: LotFaceOverride | null | undefined,
): Partial<ClientLabelLineTemplates> | undefined {
  if (!override) return undefined;
  if (
    override.line1 == null
    && override.line2 == null
    && override.line3 == null
  ) {
    return undefined;
  }
  return {
    line1: override.line1 ?? '',
    line2: override.line2 ?? '',
    line3: override.line3 ?? '',
  };
}

export function isLotFaceDirty(
  original: ClientOrderLine,
  override: LotFaceOverride | null | undefined,
  patternKey: ClientLabelPatternKey,
  options?: {
    templates?: Partial<ClientLabelLineTemplates> | null;
    priceFormat?: Partial<ClientLabelPriceFormat> | null;
  },
): boolean {
  if (!override) return false;
  const seeded = seedLotFaceFromRow(original, patternKey, options);
  const fields = faceFieldsForPattern(patternKey);
  return fields.some(field => (override[field.key] ?? '') !== (seeded[field.key] ?? ''));
}

export function isLotBrandingDirty(
  saved: ClientLabelBranding | null | undefined,
  lot: LotBranding | null | undefined,
  patternKey: ClientLabelPatternKey | null | undefined,
): boolean {
  if (!lot) return false;
  const seeded = seedLotBranding(saved);
  return brandingFieldsForPattern(patternKey).some(
    field => (lot[field.key] ?? '') !== (seeded[field.key] ?? ''),
  );
}

export interface LotFaceValidationIssue {
  skuKey: string;
  field: LotFaceFieldKey | 'lines';
  message: string;
}

/**
 * Valida face do lote para as linhas selecionadas.
 * Branding vazio é permitido (omite na arte).
 */
export function validateLotFace(
  rows: Array<{ row: ClientOrderLine; skuKey: string }>,
  lotFaceBySkuKey: LotFaceBySkuKey,
  patternKey: ClientLabelPatternKey,
): LotFaceValidationIssue[] {
  const fields = faceFieldsForPattern(patternKey);
  const issues: LotFaceValidationIssue[] = [];

  for (const { row, skuKey } of rows) {
    const override = lotFaceBySkuKey[skuKey] ?? seedLotFaceFromRow(row, patternKey);
    const applied = applyLotFace(row, override, patternKey);

    if (patternKey === 'ponto_mix') {
      const hasLine = [override.line1, override.line2, override.line3].some(
        part => (part ?? '').trim().length > 0,
      );
      if (!hasLine) {
        issues.push({
          skuKey,
          field: 'lines',
          message: 'Informe ao menos uma linha de texto na etiqueta.',
        });
      }
    }

    for (const field of fields) {
      if (field.key === 'line1' || field.key === 'line2' || field.key === 'line3') continue;
      const value = (override[field.key] ?? readOrderFaceValue(applied, field.key)).trim();
      if (field.required && !value) {
        issues.push({
          skuKey,
          field: field.key,
          message: `${field.label} é obrigatório.`,
        });
        continue;
      }
      if (field.requiredIfPresentInCsv) {
        const original = readOrderFaceValue(row, field.key).trim();
        if (original && !value) {
          issues.push({
            skuKey,
            field: field.key,
            message: `${field.label} não pode ficar vazio (veio preenchido no pedido).`,
          });
        }
      }
    }
  }

  return issues;
}

export function reseedsLotTexts(
  rows: ClientOrderLine[],
  pattern: ClientLabelPattern | null | undefined,
): { lotBranding: LotBranding; lotFaceBySkuKey: LotFaceBySkuKey } {
  if (!pattern) {
    return { lotBranding: seedLotBranding(null), lotFaceBySkuKey: {} };
  }
  return {
    lotBranding: seedLotBranding(pattern.branding),
    lotFaceBySkuKey: seedLotFaceFromRows(rows, pattern.key, {
      templates: pattern.templates,
      priceFormat: pattern.priceFormat,
    }),
  };
}

/** Lista só as chaves de face que existem em ClientOrderLine (útil em testes). */
export function orderFaceFieldKeys(): LotFaceFieldKey[] {
  return [...ORDER_FACE_KEYS];
}
