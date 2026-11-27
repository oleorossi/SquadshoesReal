import { HUBS, navigationCatalog, type NavigationResource } from '@/data/navigation';

/**
 * Busca de telas do command palette. O rótulo curto da barra ("Fichas") não
 * é o que a pessoa digita ("ficha técnica"). Cada tela carrega o rótulo
 * atual, o antigo, o nome completo, sinônimos e o setor.
 */

export interface ScreenHit {
  path: string;
  label: string;
  sector: string;
  icon: NavigationResource['icon'];
  rank: number;
}

/** Rótulo antigo, nome completo e sinônimos — por rota. */
const EXTRA_ALIASES: Record<string, string[]> = {
  '/dashboard': ['início', 'home', 'dashboard'],
  '/sales': ['pedidos de venda', 'pedido de venda', 'PV', 'venda'],
  '/price-lists': ['tabela de preço', 'preço'],
  '/fichas-tecnicas': ['ficha técnica', 'fichas técnicas', 'ficha'],
  '/engenharia/fichas-rascunho': ['fichas em rascunho', 'rascunho de ficha'],
  '/engenharia': ['engenharia', 'planejamento', 'PCP'],
  '/materiais': ['materiais', 'almoxarifado'],
  '/fiscal': ['fiscal', 'nota fiscal', 'NF-e'],
  '/motor': ['motor', 'motor de produção', 'prazos do motor', 'prazos', 'capacidade', 'equipe por setor', 'equipe', 'reservas do ateliê', 'comprar até', 'recalcular fila', 'fila do dia', 'plano e agenda'],
  '/producao/corte-lookahead': ['fila de corte'],
  '/producao/kanban': ['modo gestão', 'kanban', 'gestão', 'central de produção'],
  '/producao/sequencia': ['sequência / liberação', 'liberação'],
  '/producao/estouro': ['estouro de produção'],
  '/producao/calculadora-grade': ['calculadora grade', 'calculadora de grade'],
  '/producao/planejamento': ['programação', 'programação de produção'],
  '/imprimir-fichas': ['imprimir fichas', 'fichas de operador'],
  '/ajuste-estoque': ['ajustes', 'ajuste de estoque'],
  '/estoque/qualidade': ['qualidade de estoque'],
  '/purchase-orders': ['ordens de compra', 'ordem de compra', 'OC'],
  '/purchase-orders/per-pv': ['compras por pedido', 'por pedido', 'OCs por pedido'],
  '/compras/pendencias-material': ['relatório de pendência', 'pendência de material'],
  '/compras/inspecao': ['inspeção de recebimento', 'inspeção recebimento'],
  '/custos-insumos': ['custos de insumos'],
  '/purchase-planning': ['MRP', 'planejamento de compras'],
  '/picking': ['separação de materiais'],
  '/conferencia-saida': ['conferência de saída'],
  '/label-system': ['etiquetagem'],
  '/etiquetagem-cliente': ['ETIQUETAGEM CLIENTE', 'etiquetagem cliente'],
  '/bank-reconciliation': ['conciliação bancária'],
  '/cnab': ['boletos'],
  '/fichas-montadores': ['ficha de montadores', 'ficha montadores'],
  '/rh?tab=ponto&subtab=corrigir': ['corrigir ponto'],
  '/admin/aprovacao-ordens-compra': ['aprovação de ordens de compra'],
  '/atelie': ['ateliê', 'cabedal', 'prestador', 'prestadores', 'OS', 'ordem de serviço'],
  '/terceirizados': ['prestador', 'prestadores', 'OS', 'ordem de serviço'],
  '/nfe': ['nota fiscal', 'notas fiscais', 'NF-e'],
  '/rh': ['RH', 'recursos humanos'],
};

const SECTOR_BY_GROUP: Record<string, string> = {
  Sistema: 'Configurações',
  Início: 'Painel',
};

interface IndexedScreen {
  path: string;
  label: string;
  sector: string;
  icon: NavigationResource['icon'];
  isHub: boolean;
  phrases: string[];
  words: string[];
}

function fold(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function phrase(value: string): string {
  return fold(value)
    .replace(/[/·,;|+]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  const folded = phrase(value);
  return folded ? folded.split(' ') : [];
}

/** Plural simples do pt-BR: fichas→ficha, ordens→ordem, ações→ação. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('oes')) return `${word.slice(0, -3)}ao`;
  if (word.length > 4 && word.endsWith('ns')) return `${word.slice(0, -2)}m`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function withinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length === right.length) {
      i += 1;
      j += 1;
    } else if (left.length > right.length) {
      i += 1;
    } else {
      j += 1;
    }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

function wordMatches(queryWord: string, targetWord: string): boolean {
  if (queryWord === targetWord) return true;
  const querySingular = singular(queryWord);
  const targetSingular = singular(targetWord);
  if (querySingular.length >= 3 && querySingular === targetSingular) return true;
  if (queryWord.length >= 3 && queryWord.length < targetWord.length && targetWord.startsWith(queryWord)) return true;
  if (queryWord.length >= 4 && targetWord.length >= 4 && withinOneEdit(queryWord, targetWord)) return true;
  return false;
}

function sectorFor(item: NavigationResource): string {
  const ownHub = HUBS.find((hub) => hub.path === item.path);
  if (ownHub) return ownHub.label;
  const parent = HUBS.find((hub) => hub.children.some((child) => child.path === item.path));
  if (parent) return parent.label;
  const byGroup = HUBS.find((hub) => hub.groups.includes(item.group));
  if (byGroup) return byGroup.label;
  return SECTOR_BY_GROUP[item.group] ?? item.group;
}

function displayLabel(item: NavigationResource): string {
  return HUBS.find((hub) => hub.path === item.path)?.label ?? item.label;
}

function buildIndex(): IndexedScreen[] {
  return navigationCatalog
    .filter((item) => item.surfaces.some((surface) => surface === 'command' || surface === 'hub' || surface === 'hub-child'))
    .map((item) => {
      const label = displayLabel(item);
      const sector = sectorFor(item);
      const raw = [
        label,
        item.label,
        sector,
        item.group,
        SECTOR_BY_GROUP[item.group],
        ...(EXTRA_ALIASES[item.path] ?? []),
      ].filter((value): value is string => !!value);
      const phrases = [...new Set(raw.map(phrase).filter(Boolean))];
      const words = [...new Set(phrases.flatMap(tokenize))];
      return {
        path: item.path,
        label,
        sector,
        icon: item.icon,
        isHub: HUBS.some((hub) => hub.path === item.path),
        phrases,
        words,
      };
    });
}

const SCREEN_INDEX = buildIndex();

function rankHit(queryPhrase: string, entry: IndexedScreen): number {
  const labelPhrase = phrase(entry.label);
  let rank = 100;
  if (queryPhrase === labelPhrase) rank = 400;
  else if (labelPhrase.startsWith(queryPhrase)) rank = 300;
  else if (entry.phrases.includes(queryPhrase)) rank = 200;
  if (entry.isHub && (phrase(entry.sector) === queryPhrase || entry.phrases.includes(queryPhrase)) && rank < 250) {
    rank = 250;
  }
  return rank;
}

/** Telas que casam a busca, da mais relevante para a menos. Query vazia não lista nada. */
export function searchScreens(query: string | null | undefined): ScreenHit[] {
  const queryWords = tokenize(query ?? '');
  if (queryWords.length === 0) return [];
  const queryPhrase = queryWords.join(' ');
  const hits: ScreenHit[] = [];
  for (const entry of SCREEN_INDEX) {
    const matched = queryWords.every((word) => entry.words.some((target) => wordMatches(word, target)));
    if (!matched) continue;
    hits.push({
      path: entry.path,
      label: entry.label,
      sector: entry.sector,
      icon: entry.icon,
      rank: rankHit(queryPhrase, entry),
    });
  }
  hits.sort((left, right) => right.rank - left.rank || left.label.localeCompare(right.label, 'pt-BR') || left.path.localeCompare(right.path));
  return hits;
}
