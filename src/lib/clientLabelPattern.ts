/**
 * Contrato do padrão de etiqueta persistido em `clients.label_pattern`.
 *
 * Defaults do registry só semeiam o formulário; o que vale na emissão é o
 * jsonb gravado no cliente.
 */

export const CLIENT_LABEL_PATTERN_KEYS = ['baby_nalin', 'objetiva'] as const;
export type ClientLabelPatternKey = (typeof CLIENT_LABEL_PATTERN_KEYS)[number];

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

export interface ClientLabelPattern {
  version: 1;
  key: ClientLabelPatternKey;
  geometry: ClientLabelGeometry;
  branding: ClientLabelBranding;
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

/** Hangtag Objetiva — default editável até calibrar a faca real. */
export const OBJETIVA_DEFAULT_GEOMETRY: ClientLabelGeometry = {
  labelWidthMm: 42,
  labelHeightMm: 65,
  columns: 1,
  columnGapMm: 0,
  leftMarginMm: 1.5,
  rightMarginMm: 1.5,
  topMarginMm: 1.5,
  bottomMarginMm: 1.5,
};

export const OBJETIVA_DEFAULT_BRANDING: ClientLabelBranding = {
  logoUrl: null,
  motto: 'DEUS É FIEL',
  exchangeText: 'TROCA MANTER ESTA ETIQUETA',
  materialPrefix: 'PU/SO',
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
  return {
    version: 1,
    key: 'baby_nalin',
    geometry: { ...BABY_NALIN_DEFAULT_GEOMETRY },
    branding: { ...BABY_NALIN_DEFAULT_BRANDING },
  };
}

export function patternLabel(key: ClientLabelPatternKey): string {
  return key === 'objetiva' ? 'Objetiva' : 'Nalin';
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
  const base = defaultPatternForKey(
    raw && typeof raw === 'object' && (raw as { key?: string }).key === 'objetiva'
      ? 'objetiva'
      : raw && typeof raw === 'object' && (raw as { key?: string }).key === 'baby_nalin'
        ? 'baby_nalin'
        : fallbackKey,
  );

  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const geometryRaw = (obj.geometry && typeof obj.geometry === 'object'
    ? obj.geometry
    : {}) as Record<string, unknown>;
  const brandingRaw = (obj.branding && typeof obj.branding === 'object'
    ? obj.branding
    : {}) as Record<string, unknown>;

  return {
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
}

export function isClientLabelPatternKey(value: unknown): value is ClientLabelPatternKey {
  return value === 'baby_nalin' || value === 'objetiva';
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
