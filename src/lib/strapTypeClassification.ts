/**
 * Classificação de tira no grupo de estoque.
 * Comprada pronta só é inequívoca quando o nome é strass, ainda não tem origem
 * e já existe SKU ativo em metros. O resto fica para decisão na tela.
 */

export type StrapKind = 'comprada_pronta' | 'artesanal_fabrica' | 'artesanal_prestador';

export interface StrapGroupLike {
  id: string;
  name: string;
  is_artisanal_strap?: boolean | null;
  is_family?: boolean | null;
  strap_origin?: StrapKind | 'comprar_pronto' | 'fabrica' | 'prestador' | null;
}

export interface StrapSkuLike {
  id: string;
  group_id?: string | null;
  name?: string | null;
  color?: string | null;
  unit?: string | null;
  active?: boolean | null;
}

export interface StrapClassificationRow {
  groupId: string;
  name: string;
  origin: string | null;
  skuCount: number;
  suggestion: 'comprada_pronta' | null;
  reason: string;
}

const STRAP_NAME = /tira|strass|el[aá]stic|tran[cç]/i;

export function isStrapGroupCandidate(group: StrapGroupLike): boolean {
  if (group.is_family) return false;
  if (group.is_artisanal_strap) return true;
  return STRAP_NAME.test(group.name || '');
}

export function activeMeterSkus(products: readonly StrapSkuLike[], groupId: string): StrapSkuLike[] {
  return products.filter((product) => product.group_id === groupId
    && product.active !== false
    && String(product.unit || '').trim().toLowerCase() === 'm');
}

export function strapRegistrationBlock(input: {
  isStrap: boolean;
  origin: string | null;
  meterSkuCount: number;
  yieldCount: number;
  yieldsKnown: boolean;
}): string | null {
  if (!input.isStrap) return null;
  if (!input.origin) return 'Defina se a tira é artesanal ou comprada pronta.';
  if (input.origin === 'comprar_pronto') {
    if (input.meterSkuCount === 0) {
      return 'Comprada pronta precisa de um SKU ativo em metros neste grupo. Cadastre a cor. O pedido não cria o produto.';
    }
    return null;
  }
  if (input.origin === 'fabrica' || input.origin === 'prestador') {
    if (!input.yieldsKnown) return 'Aguarde a leitura do rendimento antes de salvar a tira artesanal.';
    if (input.yieldCount <= 0) {
      return 'Tira artesanal precisa de rendimento m/m em pelo menos uma napa. Comprada pronta não usa esse número.';
    }
  }
  return null;
}

/** Só strass sem origem e com SKU ativo. Elástico e tira chata ficam pendentes. */
export function classifyStrapGroups(
  groups: readonly StrapGroupLike[],
  products: readonly StrapSkuLike[],
): { auto: StrapClassificationRow[]; pending: StrapClassificationRow[] } {
  const auto: StrapClassificationRow[] = [];
  const pending: StrapClassificationRow[] = [];
  for (const group of groups) {
    if (!isStrapGroupCandidate(group)) continue;
    const origin = group.strap_origin || null;
    const skus = activeMeterSkus(products, group.id);
    const row: StrapClassificationRow = {
      groupId: group.id,
      name: group.name,
      origin,
      skuCount: skus.length,
      suggestion: null,
      reason: '',
    };
    const strass = /strass/i.test(group.name || '');
    if (!origin && strass && skus.length > 0) {
      row.suggestion = 'comprada_pronta';
      row.reason = 'Strass sem origem, com SKU ativo em metros e sem rendimento de Hub nesta tela.';
      auto.push(row);
      continue;
    }
    if (!origin) {
      row.reason = 'Sem tipo. Escolha artesanal ou comprada pronta no grupo.';
      pending.push(row);
      continue;
    }
    if (origin === 'comprar_pronto' && skus.length === 0) {
      row.reason = 'Comprada pronta sem SKU ativo em metros.';
      pending.push(row);
      continue;
    }
    if ((origin === 'fabrica' || origin === 'prestador') && skus.length === 0) {
      row.reason = 'Artesanal sem SKU da tira acabada. Confira o rendimento por napa.';
      pending.push(row);
    }
  }
  auto.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  pending.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { auto, pending };
}
