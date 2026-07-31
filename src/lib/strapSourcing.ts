/**
 * Origem da tira: "corto aqui" × "compro pronta" — lado TS.
 *
 * Espelha a função SQL `resolve_strap_sourcing` (migration 20261021120000). A
 * decisão vive por LINHA DE TIRA do PV em `sale_order_items.strap_sourcing`
 * (jsonb), com default herdado de `products.is_artisanal`:
 *
 *   in_house  → quem sai do estoque é a NAPA (a tira é cortada aqui)
 *   purchased → quem sai do estoque é a PRÓPRIA tira (comprada pronta)
 *
 * ⚠ A CHAVE do mapa é contrato com o banco: `"<group_id>|<COR>"`, com a cor em
 * MAIÚSCULA, sem acento e sem espaços nas pontas — exatamente
 * `upper(btrim(unaccent(color)))` do SQL. Chave fora desse formato não é lida
 * por `resolve_strap_sourcing`, e o override vira no-op SILENCIOSO (o motor cai
 * no default do produto sem reclamar). Por isso a normalização mora aqui, numa
 * função só, testada.
 *
 * Ver specs/tira-artesanal-fonte-unica-e-os-cabedal.md §2.1.
 */

export type StrapSourcing = 'in_house' | 'purchased';

/** Mapa persistido em `sale_order_items.strap_sourcing`. */
export type StrapSourcingMap = Record<string, StrapSourcing>;

/** `upper(btrim(unaccent(color)))` do Postgres. */
export function normalizeStrapColorKey(color: string | null | undefined): string {
  return (color || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Nome da napa como o separador precisa ler: **material + cor**.
 *
 * A napa é um grupo com uma variação por cor (`products.name` = "NAPA SOFT" pra
 * todas, cor em `products.color`) — ver project_material_color_variation_pattern.
 * Mostrar só o nome do produto mandaria o separador procurar "NAPA SOFT" numa
 * prateleira com 20 cores. Alguns cadastros já embutem a cor no nome
 * ("NAPA SOFT: CAPUCCINO"); nesses, não repete.
 */
export function napaDisplayName(name: string | null | undefined, color: string | null | undefined): string {
  const base = (name || '').toString().trim();
  const c = (color || '').toString().trim();
  if (!c) return base;
  if (!base) return c;
  return normalizeStrapColorKey(base).includes(normalizeStrapColorKey(c)) ? base : `${base} ${c}`;
}

/** Chave canônica da linha de tira: `"<group_id>|<COR>"`. */
export function strapSourcingKey(groupId: string | null | undefined, color: string | null | undefined): string | null {
  const gid = (groupId || '').toString().trim();
  if (!gid) return null;
  return `${gid}|${normalizeStrapColorKey(color)}`;
}

/** Só aceita os dois valores que o SQL reconhece — qualquer outro é ausência. */
function asSourcing(v: unknown): StrapSourcing | null {
  return v === 'in_house' || v === 'purchased' ? v : null;
}

/**
 * O que o PV gravou para esta linha, se gravou. `null` = herda o cadastro do
 * produto (é a ausência que faz o motor cair em `products.is_artisanal`).
 */
export function getStrapSourcingOverride(
  map: StrapSourcingMap | null | undefined,
  groupId: string | null | undefined,
  color: string | null | undefined,
): StrapSourcing | null {
  const key = strapSourcingKey(groupId, color);
  if (!key || !map || typeof map !== 'object') return null;
  return asSourcing((map as Record<string, unknown>)[key]);
}

/** Decisão efetiva: override do PV vence; sem override, o default herdado. */
export function resolveStrapSourcing(
  map: StrapSourcingMap | null | undefined,
  groupId: string | null | undefined,
  color: string | null | undefined,
  inherited: StrapSourcing,
): StrapSourcing {
  return getStrapSourcingOverride(map, groupId, color) ?? inherited;
}

/**
 * Grava (ou limpa, com `value = null`) o override de uma linha, devolvendo um
 * mapa NOVO. Limpar remove a chave em vez de gravar o valor herdado: assim a
 * linha volta a seguir o cadastro do produto se ele mudar depois.
 */
export function setStrapSourcing(
  map: StrapSourcingMap | null | undefined,
  groupId: string | null | undefined,
  color: string | null | undefined,
  value: StrapSourcing | null,
): StrapSourcingMap {
  const base: StrapSourcingMap = {};
  for (const [k, v] of Object.entries(map || {})) {
    const s = asSourcing(v);
    if (s) base[k] = s;
  }
  const key = strapSourcingKey(groupId, color);
  if (!key) return base;
  if (value === null) delete base[key];
  else base[key] = value;
  return base;
}

/**
 * Descarta chaves que não correspondem a nenhuma linha de tira viva do item —
 * trocar a cor da tira deixaria o override antigo pendurado, e ele voltaria a
 * valer se a cor original fosse escolhida de novo por outro motivo.
 */
export function pruneStrapSourcing(
  map: StrapSourcingMap | null | undefined,
  straps: Array<{ group_id?: string | null; color?: string | null }> | null | undefined,
): StrapSourcingMap {
  const alive = new Set(
    (straps || [])
      .map((s) => strapSourcingKey(s?.group_id, s?.color))
      .filter((k): k is string => !!k),
  );
  const out: StrapSourcingMap = {};
  for (const [k, v] of Object.entries(map || {})) {
    const s = asSourcing(v);
    if (s && alive.has(k)) out[k] = s;
  }
  return out;
}
