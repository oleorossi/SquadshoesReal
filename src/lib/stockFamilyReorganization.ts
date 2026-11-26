import type { ProductGroup } from '@/hooks/useGroups';
import { normalizeTaxonomyName } from '@/lib/footwearMaterialTaxonomy';

/**
 * Proposta de reorganização dos cadastros atuais (Família → Subgrupo → Cores).
 * Só calcula o plano; nada é gravado. A aplicação depende de autorização
 * explícita do Leonardo.
 */

export type ReorgCreateFamily = {
  kind: 'create_family';
  name: string;
  sector: string;
  reason: string;
};

export type ReorgRename = {
  kind: 'rename_group';
  id: string;
  from: string;
  to: string;
  reason: string;
};

export type ReorgMove = {
  kind: 'move_to_family';
  id: string;
  name: string;
  fromFamily: string | null;
  toFamily: string;
  sectorStays: string;
  skuCount: number;
  reason: string;
};

export type ReorgFillWidth = {
  kind: 'fill_width';
  id: string;
  name: string;
  from: number;
  to: number;
  reason: string;
};

export type StockFamilyReorgAction = ReorgCreateFamily | ReorgRename | ReorgMove | ReorgFillWidth;

const FORRACAO_MEMBERS = new Set([
  'NAPA SOFT',
  'NAPA SUDANI',
  'NAPA TITANIUM',
  'GLOW METALIC',
]);

const TIRAS_MEMBERS = new Set([
  'TIRA OVERLOCK 5MM',
  'TIRA CHATA COSTURADA 11MM',
  'TIRA CHATA 16MM',
  'TIRA STRASS 6MM',
  'TIRA STRASS 15MM',
  'ELASTICO FORRADO 7MM',
  'MEIA CANA 10MM',
  'OVERLOCK REDONDA 6MM',
  'TRANCA',
]);

/** Largura acabada inferida do nome (não usa a bitola de corte da napa). */
const WIDTH_FROM_NAME: Array<{ pattern: RegExp; width: number }> = [
  { pattern: /OVERLOCK\s+5\s*MM/i, width: 5 },
  { pattern: /OVERLOCK\s+REDONDA\s+6\s*MM/i, width: 6 },
  { pattern: /CHATA\s+COSTURADA\s+11\s*MM/i, width: 11 },
  { pattern: /CHATA\s+8\s*MM/i, width: 8 },
  { pattern: /CHATA\s+16\s*MM/i, width: 16 },
  { pattern: /CHATA\s+20\s*MM/i, width: 20 },
  { pattern: /CHATA\s+25\s*MM/i, width: 25 },
  { pattern: /FORRADO\s+7\s*MM/i, width: 7 },
  { pattern: /MEIA\s+CANA\s+10\s*MM/i, width: 10 },
  { pattern: /TRAN[CÇ]A/i, width: 3 },
];

function familyNameOf(group: ProductGroup, byId: Map<string, ProductGroup>): string | null {
  if (!group.parent_group_id) return null;
  return byId.get(group.parent_group_id)?.name ?? null;
}

export function finishedWidthFromGroupName(name: string): number | null {
  for (const rule of WIDTH_FROM_NAME) {
    if (rule.pattern.test(name)) return rule.width;
  }
  return null;
}

export function buildStockFamilyReorganizationPlan(
  groups: ProductGroup[],
  skuCountByGroup: Map<string, number> = new Map(),
): StockFamilyReorgAction[] {
  const actions: StockFamilyReorgAction[] = [];
  const byId = new Map(groups.map((group) => [group.id, group]));
  const byNorm = new Map(groups.map((group) => [normalizeTaxonomyName(group.name), group]));

  const forracao = byNorm.get('FORRACAO');
  if (!forracao) {
    actions.push({
      kind: 'create_family',
      name: 'FORRAÇÃO',
      sector: 'Forração da Palmilha',
      reason: 'Família principal para os materiais de forro (Napa Soft, Napa Titanium e afins). O setor de cada subgrupo permanece o atual.',
    });
  }

  const tiraFamily = byNorm.get('TIRAS') ?? byNorm.get('TIRA');
  if (tiraFamily && normalizeTaxonomyName(tiraFamily.name) === 'TIRA') {
    actions.push({
      kind: 'rename_group',
      id: tiraFamily.id,
      from: tiraFamily.name,
      to: 'TIRAS',
      reason: 'Deixa o nome da família no plural, como as outras famílias principais.',
    });
  }

  const chata25 = groups.find((group) => normalizeTaxonomyName(group.name) === 'TIRA CHATA 25MM' && group.name !== 'TIRA CHATA 25MM');
  if (chata25) {
    actions.push({
      kind: 'rename_group',
      id: chata25.id,
      from: chata25.name,
      to: 'TIRA CHATA 25MM',
      reason: 'Padroniza o nome do subgrupo em caixa alta, como as outras bitolas.',
    });
  }

  const targetForracao = forracao?.name ?? 'FORRAÇÃO';
  for (const group of groups) {
    if (group.is_family) continue;
    const norm = normalizeTaxonomyName(group.name);
    if (!FORRACAO_MEMBERS.has(norm)) continue;
    const from = familyNameOf(group, byId);
    if (from && normalizeTaxonomyName(from) === 'FORRACAO') continue;
    actions.push({
      kind: 'move_to_family',
      id: group.id,
      name: group.name,
      fromFamily: from,
      toFamily: targetForracao,
      sectorStays: group.sector || '—',
      skuCount: skuCountByGroup.get(group.id) ?? 0,
      reason: 'Passa a viver na família Forração. O setor (onde o material é aplicado) não muda.',
    });
  }

  const targetTiras = tiraFamily ? (normalizeTaxonomyName(tiraFamily.name) === 'TIRA' ? 'TIRAS' : tiraFamily.name) : 'TIRAS';
  if (!tiraFamily) {
    actions.push({
      kind: 'create_family',
      name: 'TIRAS',
      sector: 'Material Base',
      reason: 'Família principal para todos os tipos de tira (artesanal e pronta).',
    });
  }
  for (const group of groups) {
    if (group.is_family) continue;
    const norm = normalizeTaxonomyName(group.name);
    if (!TIRAS_MEMBERS.has(norm) && norm !== 'TIRA CHATA 8MM' && norm !== 'TIRA CHATA 20MM' && norm !== 'TIRA CHATA 25MM') continue;
    const from = familyNameOf(group, byId);
    if (from && (normalizeTaxonomyName(from) === 'TIRA' || normalizeTaxonomyName(from) === 'TIRAS')) continue;
    // Já cobertos acima só os que estão soltos ou em outra família (ex.: STRASS em COMPONENTES).
    if (!TIRAS_MEMBERS.has(norm)) continue;
    actions.push({
      kind: 'move_to_family',
      id: group.id,
      name: group.name,
      fromFamily: from,
      toFamily: targetTiras,
      sectorStays: group.sector || '—',
      skuCount: skuCountByGroup.get(group.id) ?? 0,
      reason: 'Passa a viver na família Tiras, com as outras bitolas. O setor e as características técnicas do subgrupo não mudam; as cores continuam no mesmo subgrupo.',
    });
  }

  for (const group of groups) {
    if (group.is_family) continue;
    const current = Number(group.dimensions_width) || 0;
    const inferred = finishedWidthFromGroupName(group.name);
    if (!inferred || current === inferred) continue;
    if (current > 0) continue;
    actions.push({
      kind: 'fill_width',
      id: group.id,
      name: group.name,
      from: current,
      to: inferred,
      reason: 'Preenche a largura acabada do subgrupo, hoje zerada. Não altera a bitola de corte da napa nem o estoque.',
    });
  }

  return actions;
}
