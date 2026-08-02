/**
 * Detecção de item/cor já cadastrado — FONTE ÚNICA.
 *
 * A cascata nasceu dentro do `ProductFormDialog` e por isso valia em 1 dos 7
 * caminhos que criam produto ou cor; o `levenshtein` já estava copiado em dois
 * arquivos e havia um terceiro normalizador no cadastro de tira. Aqui tudo vira
 * módulo puro (sem React) pra que todo caminho use exatamente a mesma regra.
 * Ver `specs/duplicata-no-cadastro.md`.
 *
 * ALCANCE POR EIXO — decidido por medição em 02/08/2026, não por palpite:
 *   - NOME e SKU varrem o ESTOQUE INTEIRO. Nome igual entre grupos diferentes
 *     tem 0 ocorrências hoje, então custa zero falso positivo e é o que pega o
 *     mesmo material cadastrado duas vezes.
 *   - TYPO DE COR fica dentro do GRUPO. Cor repete entre grupos por natureza
 *     (PRETO, CARAMELO e OFF WHITE existem em quase todos): alerta de cor fora
 *     do grupo atingiria 141 dos 173 produtos com cor — 81,5% — e alerta que
 *     sempre aparece é alerta sempre confirmado no automático.
 */
import type { Product } from '@/types/inventory';

export type DuplicateReason =
  | 'exact'         // nome igual + mesmo grupo
  | 'sku'           // SKU idêntico (estoque inteiro)
  | 'fuzzy_color'   // cor quase igual no mesmo grupo (CAPUCCINO × CAPPUCCINO)
  | 'normalized'    // nome igual após remover acento/caixa/pontuação
  | 'cross_group'   // nome igual em grupo diferente
  | 'fuzzy'         // typo de nome (Levenshtein ≤ 2)
  | 'two_words';    // 2+ palavras significativas em comum

export type DuplicateHit = { product: Product; reason: DuplicateReason };

export type DuplicateCandidate = {
  /** Presente na EDIÇÃO — o próprio produto nunca é a própria duplicata. */
  id?: string;
  name: string;
  color?: string | null;
  sku?: string | null;
  group_id?: string | null;
};

/** Rótulos em português — a sugestão precisa dizer POR QUE achou (R3.1). */
export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  exact: 'Mesmo nome, no mesmo grupo',
  sku: 'SKU idêntico',
  fuzzy_color: 'Cor quase igual, no mesmo grupo',
  normalized: 'Mesmo nome (ignorando acento e caixa)',
  cross_group: 'Mesmo nome, em outro grupo',
  fuzzy: 'Nome quase igual',
  two_words: 'Duas ou mais palavras em comum',
};

/** Normaliza pra comparação PRESERVANDO as palavras: minúsculas, sem acento,
 *  pontuação vira espaço, espaços colapsam. "Café Brûlée" === "cafe brulee". */
export function normalizeForCompare(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalização ESTRITA — remove tudo que não é letra ou dígito, inclusive
 * espaço ("NAPA SOFT" → "napasoft"). Serve pra comparar PARES nome+cor como
 * chave única, não pra casar palavras.
 *
 * NÃO é intercambiável com `normalizeForCompare`, que preserva as palavras
 * porque o passo `two_words` depende delas. As duas moram aqui pra encerrar a
 * terceira cópia de normalizador que existia no cadastro de tira (R1.2), mas
 * continuam sendo funções diferentes de propósito.
 */
export function normalizeStrict(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Distância de Levenshtein — quantas inserções/remoções/trocas transformam uma
 *  string na outra. Detecta typo curto ("Couro" × "Coura" = 1). O(n·m). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Procura um produto já cadastrado parecido com o candidato.
 *
 * `todos` tem que ser a lista COMPLETA de produtos (`useProducts()`), NUNCA a
 * lista renderizada na tela: a lista do estoque esconde cor zerada por padrão,
 * e comparar contra ela deixaria recadastrar uma cor escondida (R1.4).
 * Inativos entram de propósito — item desativado que volta é duplicata, e
 * reativar é melhor que criar de novo (R1.5).
 *
 * Devolve o PRIMEIRO acerto da cascata (não acumula), do mais forte pro mais
 * fraco. `null` = nada parecido.
 */
export function findDuplicate(
  candidato: DuplicateCandidate,
  todos: Product[],
): DuplicateHit | null {
  const rawName = (candidato.name || '').trim();
  if (!rawName) return null;

  const normalizedName = normalizeForCompare(rawName);
  const normalizedColor = normalizeForCompare(candidato.color || '');
  const normalizedSku = (candidato.sku || '').trim().toLowerCase();
  const groupId = candidato.group_id ?? null;

  const isSelf = (p: Product) => !!candidato.id && p.id === candidato.id;
  const sameGroup = (p: Product) =>
    (groupId && p.group_id === groupId) || (!groupId && !p.group_id);

  /**
   * R2.5 como INVARIANTE da cascata inteira, não regra de um passo.
   *
   * Num grupo que varia por cor o nome repete de propósito — as 10 linhas da
   * NAPA SANTORINE se chamam todas "NAPA SANTORINE". Um irmão de cor legítimo
   * já foi julgado no passo 4; se os passos de NOME (fuzzy e two_words) o
   * reencontrarem, cadastrar QUALQUER cor nova passa a disparar alerta —
   * "NAPA SOFT" dista 0 de "NAPA SOFT" e compartilha 2 palavras com ele.
   *
   * Era o comportamento antigo do `two_words`, que só não incomodava porque
   * valia num formulário só. Ao virar a regra dos caminhos de cadastro, ele
   * atingiria justamente o fluxo mais usado — cadastrar cor.
   */
  const irmaoDeCorLegitimo = (p: Product) =>
    sameGroup(p) && normalizeForCompare(p.name) === normalizedName;

  // 1. Nome idêntico no mesmo grupo.
  const exactMatch = todos.find(p => {
    if (isSelf(p)) return false;
    if (!sameGroup(p) || p.name.trim().toLowerCase() !== rawName.toLowerCase()) return false;
    const existingColor = (p.color || '').trim().toLowerCase();
    if (normalizedColor && existingColor && normalizedColor !== existingColor) return false;
    return true;
  });
  if (exactMatch) return { product: exactMatch, reason: 'exact' };

  // 2. SKU idêntico — estoque inteiro. SKU repetido é sempre erro (R2.1).
  if (normalizedSku) {
    const skuMatch = todos.find(p => !isSelf(p) && (p.sku || '').trim().toLowerCase() === normalizedSku);
    if (skuMatch) return { product: skuMatch, reason: 'sku' };
  }

  // 3. Typo de COR — só no mesmo grupo (R2.4). Vem antes do nome porque num
  //    grupo que varia por cor o nome é sempre o mesmo: é a cor que distingue.
  if (normalizedColor.length >= 4) {
    const colorTypo = todos.find(p => {
      if (isSelf(p) || !sameGroup(p)) return false;
      const existing = normalizeForCompare(p.color || '');
      if (existing.length < 4 || existing === normalizedColor) return false;
      if (Math.abs(existing.length - normalizedColor.length) > 2) return false;
      return levenshtein(existing, normalizedColor) <= 2;
    });
    if (colorTypo) return { product: colorTypo, reason: 'fuzzy_color' };
  }

  // 4. Nome normalizado igual, mesmo grupo — respeitando o R2.5.
  const normalizedMatch = todos.find(p => {
    if (isSelf(p) || !sameGroup(p)) return false;
    if (normalizeForCompare(p.name) !== normalizedName) return false;
    const existingColor = normalizeForCompare(p.color || '');
    if (normalizedColor && existingColor && normalizedColor !== existingColor) return false;
    return true;
  });
  if (normalizedMatch) return { product: normalizedMatch, reason: 'normalized' };

  // 5. Nome normalizado igual em OUTRO grupo — o material cadastrado duas
  //    vezes em famílias diferentes.
  const crossGroupMatch = todos.find(p => {
    if (isSelf(p) || sameGroup(p)) return false;
    return normalizeForCompare(p.name) === normalizedName;
  });
  if (crossGroupMatch) return { product: crossGroupMatch, reason: 'cross_group' };

  // 6. Typo de NOME — estoque inteiro (R2.2). Era limitado ao grupo, o que
  //    deixava passar justamente o material redigitado noutra família.
  if (normalizedName.length >= 6) {
    const fuzzyMatch = todos.find(p => {
      if (isSelf(p)) return false;
      const existing = normalizeForCompare(p.name);
      if (existing.length < 6) return false;
      if (irmaoDeCorLegitimo(p)) return false;   // R2.5
      if (Math.abs(existing.length - normalizedName.length) > 2) return false;
      return levenshtein(existing, normalizedName) <= 2;
    });
    if (fuzzyMatch) return { product: fuzzyMatch, reason: 'fuzzy' };
  }

  // 7. Duas ou mais palavras significativas em comum — o mais fraco da cascata.
  const words = normalizedName.split(/\s+/).filter(w => w.length >= 3);
  if (words.length >= 2) {
    const partialMatch = todos.find(p => {
      if (isSelf(p) || irmaoDeCorLegitimo(p)) return false;   // R2.5
      const existingWords = normalizeForCompare(p.name).split(/\s+/);
      return words.filter(w => existingWords.includes(w)).length >= 2;
    });
    if (partialMatch) return { product: partialMatch, reason: 'two_words' };
  }

  return null;
}
