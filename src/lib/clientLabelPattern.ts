/**
 * Contrato do padrão de etiqueta persistido em `clients.label_pattern`.
 *
 * v1 (legado): um único `{ version, key, geometry, branding }`.
 * v2: coleção — o mesmo cliente pode ter Nalin e Objetiva ao mesmo tempo.
 *
 * Defaults do registry só semeiam o formulário; o que vale na emissão é o
 * jsonb gravado no cliente.
 */

/**
 * `objetiva` = hangtag (Tag) — arte calibrada pela foto física.
 * `objetiva_adesiva` = adesiva — mesmo CSV Objetiva; layout aguarda foto de calibração.
 */
export const CLIENT_LABEL_PATTERN_KEYS = [
  'baby_nalin',
  'objetiva',
  'objetiva_adesiva',
  'ponto_mix',
] as const;
export type ClientLabelPatternKey = (typeof CLIENT_LABEL_PATTERN_KEYS)[number];

/** Tag e adesiva compartilham o CSV do ERP Objetiva (SKU + TAMANHOS). */
export function isObjetivaFamilyKey(
  key: string | null | undefined,
): key is 'objetiva' | 'objetiva_adesiva' {
  return key === 'objetiva' || key === 'objetiva_adesiva';
}

export interface ClientLabelGeometry {
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  columnGapMm: number;
  leftMarginMm: number;
  rightMarginMm: number;
  topMarginMm: number;
  bottomMarginMm: number;
}

export interface ClientLabelBranding {
  logoUrl: string | null;
  motto: string;
  exchangeText: string;
  materialPrefix: string;
}

/** Templates das 3 linhas do esqueleto preço-varejo (Ponto Mix). */
export interface ClientLabelLineTemplates {
  line1: string;
  line2: string;
  line3: string;
}

export interface ClientLabelPriceFormat {
  prefix: string;
  /** Separador decimal impresso — arte Ponto Mix usa ponto. */
  decimalSeparator: '.' | ',';
}

/**
 * Mapeamento do arquivo de pedido → campos canônicos.
 * Separado do layout da etiqueta (mesmo `key` casa os dois na emissão).
 */
export interface ClientLabelFileMapping {
  version: 1;
  /** Nome do cabeçalho no CSV/XLSX para cada campo canônico (vazio = tentar aliases). */
  columns: Partial<{
    descricao: string;
    referencia: string;
    cor: string;
    tamanho: string;
    codigoBarra: string;
    preco: string;
    quantidade: string;
    codProduto: string;
  }>;
}

export interface ClientLabelPattern {
  version: 1;
  key: ClientLabelPatternKey;
  geometry: ClientLabelGeometry;
  branding: ClientLabelBranding;
  /** Só relevante em `ponto_mix`; outros tipos ignoram. */
  templates?: ClientLabelLineTemplates;
  priceFormat?: ClientLabelPriceFormat;
}

/** Coleção persistida: um padrão por tipo + mapeamento de arquivo por tipo. */
export interface ClientLabelPatternCollection {
  version: 2;
  activeKey: ClientLabelPatternKey | null;
  patterns: Partial<Record<ClientLabelPatternKey, ClientLabelPattern>>;
  fileMappings?: Partial<Record<ClientLabelPatternKey, ClientLabelFileMapping>>;
}

/** Linha unificada exibida/selecionada no workspace (Nalin ou Objetiva). */
export interface ClientOrderLine {
  tamanho: string;
  cor: string;
  referencia: string;
  codProduto: string;
  codigoBarra: string;
  quantidade: number;
  descricao?: string;
  valor?: string;
  tipo?: string;
  categoria?: string;
  grupo?: string;
  semanaFabricacao?: string;
  anoFabricacao?: string;
  pedido?: string;
  sourceFile?: string;
}

export const BABY_NALIN_DEFAULT_GEOMETRY: ClientLabelGeometry = {
  labelWidthMm: 50,
  labelHeightMm: 30,
  columns: 2,
  columnGapMm: 6,
  leftMarginMm: 0,
  rightMarginMm: 0,
  topMarginMm: 0,
  bottomMarginMm: 0,
};

export const BABY_NALIN_DEFAULT_BRANDING: ClientLabelBranding = {
  logoUrl: null,
  motto: '',
  exchangeText: '',
  materialPrefix: '',
};

/** Hangtag Objetiva (Tag) — margens justas como na faca física (foto de calibração). */
export const OBJETIVA_DEFAULT_GEOMETRY: ClientLabelGeometry = {
  labelWidthMm: 42,
  labelHeightMm: 65,
  columns: 1,
  columnGapMm: 0,
  leftMarginMm: 1.0,
  rightMarginMm: 1.0,
  topMarginMm: 1.0,
  bottomMarginMm: 1.0,
};

export const OBJETIVA_DEFAULT_BRANDING: ClientLabelBranding = {
  logoUrl: null,
  motto: 'DEUS É FIEL',
  exchangeText: 'TROCA MANTER ESTA ETIQUETA',
  materialPrefix: 'PU/SO',
};

/**
 * Placeholder da adesiva Objetiva — geometria provisória até a foto de calibração.
 * Não gerar PDF com este default: o workspace bloqueia até existir arte.
 */
export const OBJETIVA_ADESIVA_DEFAULT_GEOMETRY: ClientLabelGeometry = {
  labelWidthMm: 50,
  labelHeightMm: 30,
  columns: 1,
  columnGapMm: 0,
  leftMarginMm: 1.0,
  rightMarginMm: 1.0,
  topMarginMm: 1.0,
  bottomMarginMm: 1.0,
};

export const OBJETIVA_ADESIVA_DEFAULT_BRANDING: ClientLabelBranding = {
  logoUrl: null,
  motto: '',
  exchangeText: '',
  materialPrefix: 'PU/SO',
};

/** Etiqueta preço varejo Ponto Mix — rolo 40×60 mm, 1 coluna, L42PRO. */
export const PONTO_MIX_DEFAULT_GEOMETRY: ClientLabelGeometry = {
  labelWidthMm: 40,
  labelHeightMm: 60,
  columns: 1,
  columnGapMm: 0,
  leftMarginMm: 1.2,
  rightMarginMm: 1.2,
  topMarginMm: 0,
  bottomMarginMm: 0,
};

export const PONTO_MIX_DEFAULT_BRANDING: ClientLabelBranding = {
  logoUrl: null,
  motto: '',
  exchangeText: '',
  materialPrefix: '',
};

export const PONTO_MIX_DEFAULT_TEMPLATES: ClientLabelLineTemplates = {
  line1: '{descricao}',
  line2: '{referencia}',
  line3: '{cor} {tamanho} {tamanho}',
};

export const PONTO_MIX_DEFAULT_PRICE_FORMAT: ClientLabelPriceFormat = {
  prefix: 'R$ ',
  decimalSeparator: '.',
};

/** Defaults provisórios até o CSV real do Ponto Mix (Q15); aliases cobrem o resto. */
export const PONTO_MIX_DEFAULT_FILE_MAPPING: ClientLabelFileMapping = {
  version: 1,
  columns: {
    descricao: '',
    referencia: '',
    cor: '',
    tamanho: '',
    codigoBarra: '',
    preco: '',
    quantidade: '',
    codProduto: '',
  },
};

export function defaultPatternForKey(key: ClientLabelPatternKey): ClientLabelPattern {
  if (key === 'objetiva') {
    return {
      version: 1,
      key: 'objetiva',
      geometry: { ...OBJETIVA_DEFAULT_GEOMETRY },
      branding: { ...OBJETIVA_DEFAULT_BRANDING },
    };
  }
  if (key === 'objetiva_adesiva') {
    return {
      version: 1,
      key: 'objetiva_adesiva',
      geometry: { ...OBJETIVA_ADESIVA_DEFAULT_GEOMETRY },
      branding: { ...OBJETIVA_ADESIVA_DEFAULT_BRANDING },
    };
  }
  if (key === 'ponto_mix') {
    return {
      version: 1,
      key: 'ponto_mix',
      geometry: { ...PONTO_MIX_DEFAULT_GEOMETRY },
      branding: { ...PONTO_MIX_DEFAULT_BRANDING },
      templates: { ...PONTO_MIX_DEFAULT_TEMPLATES },
      priceFormat: { ...PONTO_MIX_DEFAULT_PRICE_FORMAT },
    };
  }
  return {
    version: 1,
    key: 'baby_nalin',
    geometry: { ...BABY_NALIN_DEFAULT_GEOMETRY },
    branding: { ...BABY_NALIN_DEFAULT_BRANDING },
  };
}

export function patternLabel(key: ClientLabelPatternKey): string {
  if (key === 'objetiva') return 'Objetiva · Tag';
  if (key === 'objetiva_adesiva') return 'Objetiva · Adesiva';
  if (key === 'ponto_mix') return 'Ponto Mix';
  return 'Nalin';
}

export function defaultFileMappingForKey(key: ClientLabelPatternKey): ClientLabelFileMapping {
  if (key === 'ponto_mix') return { ...PONTO_MIX_DEFAULT_FILE_MAPPING, columns: { ...PONTO_MIX_DEFAULT_FILE_MAPPING.columns } };
  return { version: 1, columns: {} };
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Normaliza jsonb do banco (ou rascunho da UI) para o contrato v1. */
export function normalizeClientLabelPattern(
  raw: unknown,
  fallbackKey: ClientLabelPatternKey = 'baby_nalin',
): ClientLabelPattern {
  const rawKey =
    raw && typeof raw === 'object' ? (raw as { key?: string }).key : undefined;
  const resolvedKey: ClientLabelPatternKey =
    rawKey === 'objetiva' ||
    rawKey === 'objetiva_adesiva' ||
    rawKey === 'baby_nalin' ||
    rawKey === 'ponto_mix'
      ? rawKey
      : fallbackKey;
  const base = defaultPatternForKey(resolvedKey);

  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const geometryRaw = (obj.geometry && typeof obj.geometry === 'object'
    ? obj.geometry
    : {}) as Record<string, unknown>;
  const brandingRaw = (obj.branding && typeof obj.branding === 'object'
    ? obj.branding
    : {}) as Record<string, unknown>;
  const templatesRaw = (obj.templates && typeof obj.templates === 'object'
    ? obj.templates
    : {}) as Record<string, unknown>;
  const priceRaw = (obj.priceFormat && typeof obj.priceFormat === 'object'
    ? obj.priceFormat
    : {}) as Record<string, unknown>;

  const pattern: ClientLabelPattern = {
    version: 1,
    key: base.key,
    geometry: {
      labelWidthMm: asFiniteNumber(geometryRaw.labelWidthMm, base.geometry.labelWidthMm),
      labelHeightMm: asFiniteNumber(geometryRaw.labelHeightMm, base.geometry.labelHeightMm),
      columns: Math.max(1, Math.trunc(asFiniteNumber(geometryRaw.columns, base.geometry.columns))),
      columnGapMm: Math.max(0, asFiniteNumber(geometryRaw.columnGapMm, base.geometry.columnGapMm)),
      leftMarginMm: Math.max(0, asFiniteNumber(geometryRaw.leftMarginMm, base.geometry.leftMarginMm)),
      rightMarginMm: Math.max(0, asFiniteNumber(geometryRaw.rightMarginMm, base.geometry.rightMarginMm)),
      topMarginMm: Math.max(0, asFiniteNumber(geometryRaw.topMarginMm, base.geometry.topMarginMm)),
      bottomMarginMm: Math.max(0, asFiniteNumber(geometryRaw.bottomMarginMm, base.geometry.bottomMarginMm)),
    },
    branding: {
      logoUrl: typeof brandingRaw.logoUrl === 'string' && brandingRaw.logoUrl.trim()
        ? brandingRaw.logoUrl.trim()
        : null,
      motto: asString(brandingRaw.motto, base.branding.motto),
      exchangeText: asString(brandingRaw.exchangeText, base.branding.exchangeText),
      materialPrefix: asString(brandingRaw.materialPrefix, base.branding.materialPrefix),
    },
  };

  if (base.key === 'ponto_mix') {
    const tpl = base.templates ?? PONTO_MIX_DEFAULT_TEMPLATES;
    const pf = base.priceFormat ?? PONTO_MIX_DEFAULT_PRICE_FORMAT;
    pattern.templates = {
      line1: asString(templatesRaw.line1, tpl.line1),
      line2: asString(templatesRaw.line2, tpl.line2),
      line3: asString(templatesRaw.line3, tpl.line3),
    };
    const sep = priceRaw.decimalSeparator === ',' ? ',' : pf.decimalSeparator;
    pattern.priceFormat = {
      prefix: asString(priceRaw.prefix, pf.prefix),
      decimalSeparator: sep === ',' ? ',' : '.',
    };
  }

  return pattern;
}

export function isClientLabelPatternKey(value: unknown): value is ClientLabelPatternKey {
  return (
    value === 'baby_nalin' ||
    value === 'objetiva' ||
    value === 'objetiva_adesiva' ||
    value === 'ponto_mix'
  );
}

export function normalizeClientLabelFileMapping(
  raw: unknown,
  key: ClientLabelPatternKey = 'ponto_mix',
): ClientLabelFileMapping {
  const base = defaultFileMappingForKey(key);
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const colsRaw = (obj.columns && typeof obj.columns === 'object' ? obj.columns : {}) as Record<
    string,
    unknown
  >;
  const columns: ClientLabelFileMapping['columns'] = { ...base.columns };
  for (const field of Object.keys(base.columns).length > 0
    ? (Object.keys(base.columns) as Array<keyof ClientLabelFileMapping['columns']>)
    : ([
        'descricao',
        'referencia',
        'cor',
        'tamanho',
        'codigoBarra',
        'preco',
        'quantidade',
        'codProduto',
      ] as const)) {
    if (typeof colsRaw[field] === 'string') {
      columns[field] = colsRaw[field] as string;
    }
  }
  return { version: 1, columns };
}

export function clientOrderLineSkuKey(row: ClientOrderLine): string {
  return [row.referencia, row.cor, row.tamanho, row.codigoBarra]
    .map(part => part.trim().replace(/\s+/g, ' ').toUpperCase())
    .join(' · ');
}

/** Couche Nalin ↔ geometry do padrão (mesmos campos de vão/margem). */
export function geometryFromCoucheProfile(profile: {
  columnGapMm: number;
  leftMarginMm: number;
  rightMarginMm: number;
  topMarginMm: number;
  bottomMarginMm: number;
}): ClientLabelGeometry {
  return {
    ...BABY_NALIN_DEFAULT_GEOMETRY,
    columnGapMm: profile.columnGapMm,
    leftMarginMm: profile.leftMarginMm,
    rightMarginMm: profile.rightMarginMm,
    topMarginMm: profile.topMarginMm,
    bottomMarginMm: profile.bottomMarginMm,
  };
}

export function coucheProfileFromGeometry(geometry: ClientLabelGeometry): {
  columnGapMm: number;
  leftMarginMm: number;
  rightMarginMm: number;
  topMarginMm: number;
  bottomMarginMm: number;
} {
  return {
    columnGapMm: geometry.columnGapMm,
    leftMarginMm: geometry.leftMarginMm,
    rightMarginMm: geometry.rightMarginMm,
    topMarginMm: geometry.topMarginMm,
    bottomMarginMm: geometry.bottomMarginMm,
  };
}

export function emptyLabelCollection(): ClientLabelPatternCollection {
  return { version: 2, activeKey: null, patterns: {}, fileMappings: {} };
}

export function collectionPatternKeys(
  collection: ClientLabelPatternCollection | null | undefined,
): ClientLabelPatternKey[] {
  if (!collection) return [];
  return CLIENT_LABEL_PATTERN_KEYS.filter(key => collection.patterns[key]);
}

export function activePatternFromCollection(
  collection: ClientLabelPatternCollection | null | undefined,
): ClientLabelPattern | null {
  if (!collection?.activeKey) return null;
  return collection.patterns[collection.activeKey] ?? null;
}

export function activeFileMappingFromCollection(
  collection: ClientLabelPatternCollection | null | undefined,
): ClientLabelFileMapping | null {
  if (!collection?.activeKey) return null;
  const raw = collection.fileMappings?.[collection.activeKey];
  if (!raw) {
    return collection.activeKey === 'ponto_mix'
      ? defaultFileMappingForKey('ponto_mix')
      : null;
  }
  return normalizeClientLabelFileMapping(raw, collection.activeKey);
}

export function serializeClientLabelCollection(
  collection: ClientLabelPatternCollection,
): ClientLabelPatternCollection {
  const patterns: Partial<Record<ClientLabelPatternKey, ClientLabelPattern>> = {};
  for (const key of CLIENT_LABEL_PATTERN_KEYS) {
    const raw = collection.patterns[key];
    if (!raw) continue;
    patterns[key] = normalizeClientLabelPattern(raw, key);
  }
  const fileMappings: Partial<Record<ClientLabelPatternKey, ClientLabelFileMapping>> = {};
  for (const key of CLIENT_LABEL_PATTERN_KEYS) {
    if (!patterns[key]) continue;
    const rawMap = collection.fileMappings?.[key];
    if (rawMap || key === 'ponto_mix') {
      fileMappings[key] = normalizeClientLabelFileMapping(rawMap, key);
    }
  }
  const keys = collectionPatternKeys({ version: 2, activeKey: null, patterns });
  const activeKey =
    collection.activeKey && patterns[collection.activeKey]
      ? collection.activeKey
      : (keys[0] ?? null);
  return {
    version: 2,
    activeKey,
    patterns,
    fileMappings: Object.keys(fileMappings).length > 0 ? fileMappings : undefined,
  };
}

/** jsonb a gravar: v2 com 1+ tipos, ou null quando o cliente não tem padrão. */
export function toPersistedLabelPattern(
  collection: ClientLabelPatternCollection,
): ClientLabelPatternCollection | null {
  const serialized = serializeClientLabelCollection(collection);
  return collectionPatternKeys(serialized).length > 0 ? serialized : null;
}

function patternsFromV2Raw(
  patternsRaw: unknown,
): Partial<Record<ClientLabelPatternKey, ClientLabelPattern>> {
  const patterns: Partial<Record<ClientLabelPatternKey, ClientLabelPattern>> = {};
  if (Array.isArray(patternsRaw)) {
    for (const item of patternsRaw) {
      if (!item || typeof item !== 'object') continue;
      const key = (item as { key?: unknown }).key;
      if (!isClientLabelPatternKey(key)) continue;
      patterns[key] = normalizeClientLabelPattern(item, key);
    }
    return patterns;
  }
  if (!patternsRaw || typeof patternsRaw !== 'object') return patterns;
  const obj = patternsRaw as Record<string, unknown>;
  for (const key of CLIENT_LABEL_PATTERN_KEYS) {
    if (obj[key] == null) continue;
    patterns[key] = normalizeClientLabelPattern(obj[key], key);
  }
  return patterns;
}

function fileMappingsFromRaw(
  raw: unknown,
  patterns: Partial<Record<ClientLabelPatternKey, ClientLabelPattern>>,
): Partial<Record<ClientLabelPatternKey, ClientLabelFileMapping>> | undefined {
  const out: Partial<Record<ClientLabelPatternKey, ClientLabelFileMapping>> = {};
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const key of CLIENT_LABEL_PATTERN_KEYS) {
    if (!patterns[key]) continue;
    if (obj[key] != null || key === 'ponto_mix') {
      out[key] = normalizeClientLabelFileMapping(obj[key], key);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Aceita v1 (um tipo) e v2 (vários tipos) sem perder o legado. */
export function normalizeClientLabelCollection(raw: unknown): ClientLabelPatternCollection {
  if (!raw || typeof raw !== 'object') return emptyLabelCollection();
  const obj = raw as Record<string, unknown>;

  if (obj.version === 2) {
    const patterns = patternsFromV2Raw(obj.patterns);
    const keys = collectionPatternKeys({ version: 2, activeKey: null, patterns });
    const activeKey =
      isClientLabelPatternKey(obj.activeKey) && patterns[obj.activeKey]
        ? obj.activeKey
        : (keys[0] ?? null);
    return {
      version: 2,
      activeKey,
      patterns,
      fileMappings: fileMappingsFromRaw(obj.fileMappings, patterns),
    };
  }

  if (isClientLabelPatternKey(obj.key)) {
    const pattern = normalizeClientLabelPattern(obj, obj.key);
    const patterns = { [pattern.key]: pattern };
    return {
      version: 2,
      activeKey: pattern.key,
      patterns,
      fileMappings: fileMappingsFromRaw(undefined, patterns),
    };
  }

  return emptyLabelCollection();
}

export function activatePattern(
  collection: ClientLabelPatternCollection,
  key: ClientLabelPatternKey,
): ClientLabelPatternCollection {
  const existing = collection.patterns[key];
  const fileMappings = { ...(collection.fileMappings ?? {}) };
  if (!fileMappings[key] && key === 'ponto_mix') {
    fileMappings[key] = defaultFileMappingForKey(key);
  }
  return {
    version: 2,
    activeKey: key,
    patterns: {
      ...collection.patterns,
      [key]: existing ?? defaultPatternForKey(key),
    },
    fileMappings,
  };
}

export function upsertActivePattern(
  collection: ClientLabelPatternCollection,
  pattern: ClientLabelPattern,
): ClientLabelPatternCollection {
  return {
    version: 2,
    activeKey: pattern.key,
    patterns: {
      ...collection.patterns,
      [pattern.key]: normalizeClientLabelPattern(pattern, pattern.key),
    },
    fileMappings: collection.fileMappings,
  };
}

export function upsertActiveFileMapping(
  collection: ClientLabelPatternCollection,
  key: ClientLabelPatternKey,
  mapping: ClientLabelFileMapping,
): ClientLabelPatternCollection {
  return {
    ...collection,
    version: 2,
    fileMappings: {
      ...(collection.fileMappings ?? {}),
      [key]: normalizeClientLabelFileMapping(mapping, key),
    },
  };
}

export function removePattern(
  collection: ClientLabelPatternCollection,
  key: ClientLabelPatternKey,
): ClientLabelPatternCollection {
  const patterns = { ...collection.patterns };
  delete patterns[key];
  const fileMappings = { ...(collection.fileMappings ?? {}) };
  delete fileMappings[key];
  const remaining = collectionPatternKeys({ version: 2, activeKey: null, patterns });
  return {
    version: 2,
    activeKey: collection.activeKey === key ? (remaining[0] ?? null) : collection.activeKey,
    patterns,
    fileMappings: Object.keys(fileMappings).length > 0 ? fileMappings : undefined,
  };
}

export function savedPatternStatusLabel(raw: unknown): string {
  const labels = collectionPatternKeys(normalizeClientLabelCollection(raw)).map(patternLabel);
  return labels.length === 0 ? 'sem padrão' : labels.join(' + ');
}
