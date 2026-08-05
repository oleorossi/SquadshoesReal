/**
 * Cores pelas quais um PRODUTO pode ser referenciado — FONTE ÚNICA.
 *
 * Existe porque o mesmo conceito ("qual é a cor deste produto?") era calculado de
 * dois jeitos dentro do PV, e os dois discordavam:
 *
 *   - o DROPDOWN de cor de tira montava as opções aceitando a cor explícita
 *     (`products.color`) **ou** a cor derivada do NOME;
 *   - a VALIDAÇÃO (`strapMissing`) perguntava só por `products.color`.
 *
 * Consequência (PV-00148/149/150/151, diagnosticado em 05/08/2026): um grupo cujos
 * produtos têm `color` VAZIO — a cor mora no nome — oferecia no dropdown uma cor que
 * a validação em seguida rejeitava como "sem produto no estoque". Era o caso de
 * `TIRA STRASS 15MM`, cujos 3 produtos ("Cristal com fundo branco", "Preto com fundo
 * preto", "Rosa com fundo rosado") têm `color = ''`. Quem cadastrava aprendia ali o
 * estilo de nome e o reusava em `TIRA STRASS 6MM` — onde os produtos TÊM `color`
 * (BRANCO / OFF WHITE / PRETO / ROSADO) e aquele texto não existe. Resultado na tela:
 * a tira de strass **não aparecia na lista** ao selecionar, porque o valor gravado no
 * PV não era nenhuma das opções montadas a partir do grupo.
 *
 * ⚠ Ao mexer aqui, mexe nos DOIS lados de uma vez — é esse o ponto do módulo. Se o
 * dropdown passar a oferecer um alias novo, a validação passa a aceitá-lo no mesmo
 * commit, e vice-versa.
 *
 * ⚠ NÃO é a mesma função do `Contractors.tsx`. Aquele arquivo tem uma cópia local com
 * semântica DIFERENTE de propósito: ela devolve `''` quando o nome não tem separador,
 * em vez de cair no nome inteiro. Lá o nome inteiro como cor produziria material
 * errado no casamento de terceirizados. As duas NÃO foram unificadas — se um dia
 * forem, é decisão que precisa passar pelo módulo de terceirizados, não por aqui.
 */

/** Só os campos lidos. `passthrough` — o resto do produto é ignorado. */
export interface ColorableProduct {
  name?: string | null;
  color?: string | null;
  group_id?: string | null;
  active?: boolean | null;
}

/** Grafia canônica pra comparar cor: sem espaço nas pontas, CAIXA ALTA. */
export function normalizeColor(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase();
}

/**
 * Cor DERIVADA do nome do produto.
 *
 * Ordem (preservada do comportamento original do seletor do PV):
 *   1. nome com `:`     → o que vem depois do último `:`   ("NAPA: PRETO" → "PRETO")
 *   2. nome com ` - `   → o que vem depois do último ` - ` ("NAPA - PRETO" → "PRETO")
 *   3. sem separador    → o nome INTEIRO, mas só quando não há `color` explícita.
 *      É o caso dos grupos em que a cor foi cadastrada como nome do produto.
 *      Com `color` preenchida o nome não vira alias, senão "Tira Strass 6mm Preto
 *      com fundo preto" viraria uma "cor" concorrente de `PRETO` no mesmo grupo.
 */
export function getDerivedProductColor(product: ColorableProduct): string {
  const explicitColor = product.color?.trim() || '';
  const productName = product.name?.trim() || '';
  if (productName.includes(':')) return productName.split(':').pop()?.trim() || '';
  if (productName.includes(' - ')) return productName.split(' - ').pop()?.trim() || '';
  return explicitColor ? '' : productName;
}

/**
 * TODAS as cores por que este produto atende: a explícita e a derivada do nome.
 * Sem normalizar — quem exibe decide a grafia; quem compara usa `normalizeColor`.
 */
export function productColorAliases(product: ColorableProduct): string[] {
  const out = new Set<string>();
  const explicitColor = product.color?.trim();
  const derivedColor = getDerivedProductColor(product);
  if (explicitColor) out.add(explicitColor);
  if (derivedColor) out.add(derivedColor);
  return Array.from(out);
}

/** O produto atende por esta cor? Comparação normalizada nos dois lados. */
export function productAnswersToColor(product: ColorableProduct, color: string): boolean {
  const target = normalizeColor(color);
  if (!target) return false;
  return productColorAliases(product).some((alias) => normalizeColor(alias) === target);
}

/**
 * Existe produto ATIVO no grupo que atenda por esta cor?
 * É a pergunta que a validação de tira faz — e agora usa exatamente o mesmo
 * conjunto de aliases que `colorsFromProducts` usou pra oferecer a opção.
 */
export function groupHasProductForColor(
  products: ColorableProduct[],
  groupId: string,
  color: string,
): boolean {
  if (!groupId) return false;
  return products.some(
    (p) => p.group_id === groupId && p.active !== false && productAnswersToColor(p, color),
  );
}

/** Cores oferecíveis de um grupo: união dos aliases dos produtos ativos, ordenada pt-BR. */
export function colorsFromProducts(products: ColorableProduct[], groupId: string): string[] {
  const out = new Set<string>();
  for (const p of products) {
    if (p.group_id !== groupId || p.active === false) continue;
    for (const alias of productColorAliases(p)) {
      const normalized = normalizeColor(alias);
      if (normalized) out.add(normalized);
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
