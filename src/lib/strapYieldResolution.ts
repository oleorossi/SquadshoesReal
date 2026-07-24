// ═══════════════════════════════════════════════════════════════════════════
// Resolução do RENDIMENTO da tira artesanal por napa-base (tira, base)
// ═══════════════════════════════════════════════════════════════════════════
// A base da tira vem da FICHA TÉCNICA da referência (materialFamily) — spec
// `tira-base-napa-por-ficha-tecnica.md`. O rendimento (m de tira por m de napa)
// é por base porque depende da LARGURA DO ROLO daquela base. Antes, quando não
// existia receita `(tira, base_da_ficha)`, a linha ficava `pending` e caía fora
// do total do MATERIAL BASE ("N itens ficaram fora do total — cadastro
// incompleto") — mesmo quando o rendimento era derivável das receitas já
// cadastradas da MESMA tira em outras bases.
//
// Este resolvedor fecha esse buraco SEM converter às cegas (o medo original da
// spec era atribuir os metros à napa ERRADA — aqui o nome da base continua
// vindo da ficha; só o FATOR de conversão é herdado):
//   1. receita exata `(tira, base)` → usa (comportamento de antes);
//   2. sem receita exata, com largura do rolo da base alvo cadastrada
//      (`product_groups.dimensions_width`):
//      a. outra base com a MESMA largura de rolo → mesmo corte, mesmo
//         rendimento — reusa e marca `derivedFrom`;
//      b. outra base com largura conhecida ≠ → escala proporcional
//         (rendimento ∝ largura do rolo) e marca `derivedFrom`;
//   3. sem largura do rolo alvo: só herda se TODAS as receitas existentes da
//      tira concordarem no mesmo rendimento (unânime) — se divergem, não dá
//      pra escolher com segurança;
//   4. nada de onde derivar → null (a linha continua `pending`, como antes).
//
// Linhas derivadas ENTRAM no total do MATERIAL BASE e a UI mostra a origem
// ("rendimento herdado de NAPA SOFT") em vez do aviso âmbar de cadastro.
//
// ⚠ Não confundir com `strapYield.ts` (Calculadora de Tiras — rendimento
// geométrico contínuo por largura). Aqui a fonte é a RECEITA cadastrada
// (`artisanal_recipes.yield_per_meter`, valor medido), e a largura do rolo só
// entra pra decidir se/como herdar entre bases.

/** Receita ativa de UMA tira: base + rendimento (m de tira por m de napa). */
export type StrapBaseRecipe = { baseName: string; yieldPerMeter: number };

export type StrapYieldResolution = {
  yieldPerMeter: number;
  /** Presente quando o rendimento foi HERDADO de outra base (não medido). */
  derivedFrom?: string;
};

const norm = (s: string | null | undefined): string =>
  (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Mesma precisão das parcelas do MATERIAL BASE (baseMaterialTotal.ts).
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolve o rendimento de uma tira na `baseName` alvo a partir das receitas
 * ativas da própria tira (todas as bases). `rollWidthMm(base)` devolve a
 * largura do rolo cadastrada no grupo da base, em mm (0/ausente = desconhecida).
 * Pura e determinística (candidatas ordenadas por nome de base).
 */
export function resolveStrapYield(opts: {
  baseName: string;
  recipes: StrapBaseRecipe[];
  rollWidthMm?: (baseName: string) => number;
}): StrapYieldResolution | null {
  const target = norm(opts.baseName);
  if (!target) return null;

  const valid = (opts.recipes || [])
    .filter((r) => (Number(r.yieldPerMeter) || 0) > 0 && norm(r.baseName))
    .sort((a, b) => a.baseName.localeCompare(b.baseName, 'pt-BR'));

  const exact = valid.find((r) => norm(r.baseName) === target);
  if (exact) return { yieldPerMeter: Number(exact.yieldPerMeter) };

  // Dedup por base (a mesma tira pode ter várias receitas na mesma base via
  // nomes de grupo/aplicação — a 1ª na ordem alfabética vence, determinístico).
  const othersByBase = new Map<string, StrapBaseRecipe>();
  for (const r of valid) {
    const b = norm(r.baseName);
    if (b !== target && !othersByBase.has(b)) othersByBase.set(b, r);
  }
  const others = Array.from(othersByBase.values());
  if (others.length === 0) return null;

  const widthOf = (b: string) => Math.max(0, Number(opts.rollWidthMm?.(b)) || 0);
  const wTarget = widthOf(opts.baseName);

  if (wTarget > 0) {
    // Mesma largura de rolo ⇒ mesma geometria de corte ⇒ mesmo rendimento.
    const same = others.find((r) => widthOf(r.baseName) === wTarget);
    if (same) return { yieldPerMeter: Number(same.yieldPerMeter), derivedFrom: same.baseName };
    // Larguras diferentes mas conhecidas ⇒ rendimento escala com a largura.
    const known = others.find((r) => widthOf(r.baseName) > 0);
    if (known) {
      const scaled = round2(Number(known.yieldPerMeter) * (wTarget / widthOf(known.baseName)));
      if (scaled > 0) return { yieldPerMeter: scaled, derivedFrom: known.baseName };
    }
  }

  // Sem largura do rolo alvo: herda só quando as receitas existentes são
  // UNÂNIMES no rendimento (ex.: NAPA SOFT e NAPA MADRID ambas 60 m/m).
  const yields = new Set(others.map((r) => Number(r.yieldPerMeter)));
  if (yields.size === 1) {
    return {
      yieldPerMeter: Number(others[0].yieldPerMeter),
      derivedFrom: others.map((r) => r.baseName).join(' / '),
    };
  }
  return null;
}
