/**
 * Fonte ÚNICA da taxonomia de setores produtivos (frontend).
 *
 * Antes esta informação vivia DUPLICADA em ≥4 lugares (sectorCapacity.ts tinha
 * dois mapas idênticos `SECTOR_NORMALIZE`/`SECTOR_NORMALIZE_PUB`, leadTime.ts
 * tinha sua própria cópia do tipo `SectorKey`, e ProductionDailySchedule.tsx
 * tinha `SECTOR_NORM` + `DISPLAY_SECTORS`). Qualquer setor novo exigia editar
 * todos — e os mapas chegaram a DIVERGIR (ProductionDailySchedule mapeava
 * "costura"→corte_forracao, legado pré-PR2, enquanto o motor mapeava
 * "costura"→costura). Centralizar aqui elimina o drift.
 *
 * ⚠ Sincronizar `SECTOR_NORMALIZE` com a função SQL `sector_display_to_enum`
 * (migration 20260506120000+). São os dois lados da mesma normalização.
 */

export type SectorKey =
  | 'corte_palmilha' | 'corte_forracao'
  | 'costura_palmilha' | 'costura_cabedal'
  | 'mesa' | 'silk'
  | 'colagem' | 'montagem' | 'solagem' | 'acabamento' | 'expedicao'
  // legacy aliases — 'corte' virou corte_palmilha (pré PR1) e a 'costura'
  // única virou os dois setores acima (migration 20261001120000).
  | 'corte' | 'costura';

/**
 * Normalização nome-de-exibição → enum canônico. Cobre as grafias atuais
 * (pós PR1-PR3) E os aliases legados que ainda vivem em
 * `technical_sheets.production_sectors` de fichas antigas. Sem isto,
 * `hasSector('Corte Palmilha')` não casaria fichas com ["Corte","Forração",…].
 */
export const SECTOR_NORMALIZE: Record<string, SectorKey> = {
  // canônico pós PR1-PR3
  'corte palmilha': 'corte_palmilha',
  'corte fibra': 'corte_palmilha',
  'corte forração': 'corte_forracao',
  'corte forracao': 'corte_forracao',
  'aviamento':      'mesa',
  'mesa':           'mesa',
  // Costura dividida em dois setores paralelos (2026-10-01). O legado
  // 'costura' resolve pra PALMILHA: era ela que a etapa única representava em
  // toda ficha (a de cabedal é opt-in por ficha, ver a migration).
  'costura palmilha': 'costura_palmilha',
  'costura cabedal':  'costura_cabedal',
  'costura':          'costura_palmilha',
  'silk':           'silk',
  'colagem':        'colagem',
  'montagem':       'montagem',
  'solagem':        'solagem',
  'acabamento':     'acabamento',
  'expedição':      'expedicao',
  'expedicao':      'expedicao',
  // aliases legados pré-PR1
  'corte':          'corte_palmilha',
  'palmilha':       'corte_palmilha',
  'forração':       'corte_forracao',
  'forracao':       'corte_forracao',
  'serigrafia':     'silk',
};

/** Normaliza uma grafia de setor para o enum canônico (ou a própria string
 *  minúscula quando desconhecida — nunca casa um setor real). */
export function normalizeSector(s: string): string {
  return SECTOR_NORMALIZE[s.toLowerCase().trim()] ?? s.toLowerCase().trim();
}

/** Uma ficha tem o setor? Lista vazia = sem restrição (todos ativos). */
export function sheetHasSector(sheet: { production_sectors?: unknown } | null | undefined, canonical: string): boolean {
  const sectors = Array.isArray(sheet?.production_sectors) ? (sheet!.production_sectors as string[]) : [];
  if (sectors.length === 0) return true;
  const target = normalizeSector(canonical);
  return sectors.some((s) => normalizeSector(s) === target);
}

/** Rótulo de usuário por enum de setor. */
export const SECTOR_LABELS: Record<SectorKey, string> = {
  corte_palmilha:   'Corte Fibra',
  corte_forracao:   'Corte Forração',
  costura_palmilha: 'Costura Palmilha',
  costura_cabedal:  'Costura Cabedal',
  mesa:             'Aviamento',   // enum interno é "mesa", label do usuário é Aviamento
  silk:             'Silk',
  colagem:          'Colagem',
  montagem:         'Montagem',
  solagem:          'Solagem',
  acabamento:       'Acabamento',
  expedicao:        'Expedição',
  // legacy aliases — pré rename de 2026-05-06 / pré divisão da costura
  corte:            'Corte',
  costura:          'Costura',
};

/**
 * Setores na ORDEM de exibição do fluxo de fábrica (exclui expedicao e os
 * aliases legacy). Telas de programação iteram esta lista.
 *
 * Ordem = fluxo real (2026-10-01): cortes primeiro, depois as duas costuras
 * em paralelo com o aviamento, depois a cadeia sequencial.
 */
export const DISPLAY_SECTORS: { key: SectorKey; label: string }[] = [
  { key: 'corte_palmilha',   label: SECTOR_LABELS.corte_palmilha },
  { key: 'corte_forracao',   label: SECTOR_LABELS.corte_forracao },
  { key: 'costura_palmilha', label: SECTOR_LABELS.costura_palmilha },
  { key: 'costura_cabedal',  label: SECTOR_LABELS.costura_cabedal },
  { key: 'mesa',             label: SECTOR_LABELS.mesa },
  { key: 'silk',             label: SECTOR_LABELS.silk },
  { key: 'colagem',          label: SECTOR_LABELS.colagem },
  { key: 'montagem',         label: SECTOR_LABELS.montagem },
  { key: 'solagem',          label: SECTOR_LABELS.solagem },
  { key: 'acabamento',       label: SECTOR_LABELS.acabamento },
];

/**
 * Nome de EXIBIÇÃO canônico de cada setor — é a grafia gravada em
 * `order_stages.stage_name`, `sector_settings.sector` e `production_schedule.sector`.
 * Use isto em vez de reescrever a lista de strings em cada hook/tela: listas locais
 * já divergiram (várias ficaram com a `Costura` única, que NÃO existe mais no banco
 * desde a migration 20261001120000 — hoje são `Costura Palmilha` e `Costura Cabedal`).
 */
export const SECTOR_FLOW: string[] = [
  'Corte Fibra', 'Corte Forração',
  'Costura Palmilha', 'Costura Cabedal', 'Aviamento',
  'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
];

/**
 * TOPOLOGIA — quem roda em paralelo com quem.
 *
 * Espelha `sector_settings.parallel_group` no banco (verificado em produção
 * 2026-07-29). Setor sem grupo é sequencial: só arranca quando o nível anterior
 * entrega.
 *
 *   Corte Fibra ‖ Corte Forração                        → grupo 'corte'
 *   Costura Palmilha ‖ Costura Cabedal ‖ Aviamento     → grupo 'costura_aviamento'
 *   Silk → Colagem → Montagem → Solagem → Acabamento → Expedição   (sequenciais)
 *
 * ⚠ Este mapa é o FALLBACK estático. Quando houver `sector_settings` em mão
 * (`useSectorSettings()`), prefira `parallelGroupsFromSettings()` — o dono pode
 * reagrupar setores pela tela /producao/setores e o banco é quem manda.
 */
export const SECTOR_PARALLEL_GROUP: Record<string, string | null> = {
  'Corte Fibra':      'corte',
  'Corte Forração':   'corte',
  'Costura Palmilha': 'costura_aviamento',
  'Costura Cabedal':  'costura_aviamento',
  'Aviamento':        'costura_aviamento',
  'Silk':             null,
  'Colagem':          null,
  'Montagem':         null,
  'Solagem':          null,
  'Acabamento':       null,
  'Expedição':        null,
};

/** Setores que rodam junto com `sector` (inclui ele mesmo). Sequencial → só ele. */
export function parallelPeers(
  sector: string,
  groups: Record<string, string | null> = SECTOR_PARALLEL_GROUP,
): string[] {
  const g = groups[sector] ?? null;
  if (!g) return [sector];
  return Object.keys(groups).filter((s) => groups[s] === g);
}

/**
 * Constrói o mapa de grupos a partir das linhas de `sector_settings` — a fonte
 * de verdade viva. Passe o resultado pra `parallelPeers` quando a tela já tiver
 * carregado os settings.
 */
export function parallelGroupsFromSettings(
  settings: ReadonlyArray<{ sector: string; parallel_group: string | null }>,
): Record<string, string | null> {
  if (!settings.length) return SECTOR_PARALLEL_GROUP;
  return settings.reduce<Record<string, string | null>>((acc, s) => {
    acc[s.sector] = s.parallel_group;
    return acc;
  }, {});
}
