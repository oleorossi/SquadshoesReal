/**
 * Ordenação de cores otimizada para fluxo de fábrica.
 *
 * Princípio: cores CLARAS primeiro, ESCURAS por último — minimiza
 * changeover de máquina/linha (limpa pigmento/cola escura só 1× no
 * fim do dia em vez de a cada troca).
 *
 * Buckets:
 *   0 — Brancos (Branco, Cru, Off-white, Marfim)
 *   1 — Pasteis (Bege, Areia, Nude, Champagne, Pérola)
 *   2 — Cores claras saturadas (Rosa, Amarelo, Verde claro, Azul claro)
 *   3 — Cores médias (Vermelho, Verde, Azul, Roxo)
 *   4 — Cores escuras (Marrom, Café, Vinho, Marinho, Chocolate, Caramelo)
 *   5 — Preto (sempre por último)
 *
 * Dentro do mesmo bucket: ordem alfabética (estabilidade).
 *
 * Adotado em fábricas de calçado/têxtil — bate com prática Lectra e
 * literatura de mixed-model sequencing aplicado a cores.
 */

// Patterns derivados da auditoria das 24 cores reais em produção (mai/2026).
// Cores específicas do catálogo Squad/Lojão Niteroi: COGUMELO/CARVALHO/TÂMARA/
// WHISKY (madeira/terrosos = bucket 4), TAN/MILK/OURO LIGHT (claros = 0-2),
// ROSE (variação de rosa = bucket 2), COBRE (metal escuro = 4).
const BUCKETS: ReadonlyArray<{ bucket: number; patterns: RegExp[] }> = [
  { bucket: 5, patterns: [/^preto/i, /^black/i, /preto\b/i, /\bpb\b/i] },
  { bucket: 4, patterns: [
    /marrom/i, /caf[eé]/i, /vinho/i, /marinho/i, /chocolate/i, /caramelo/i,
    /azul\s+escuro/i, /verde\s+escuro/i, /grafite/i,
    // Terrosos / madeira / metais escuros (auditoria 22/05/2026)
    /cogumelo/i, /carvalho/i, /whisky/i, /t[aâ]mara/i, /cobre/i, /castanh/i,
    /conhaque/i, /tabaco/i, /noz/i,
  ] },
  { bucket: 3, patterns: [/vermelho/i, /verde/i, /azul/i, /roxo/i, /violeta/i, /lil[aá]s/i, /carmim/i, /coral/i, /laranja/i] },
  { bucket: 2, patterns: [
    /\brosa/i, /\brose\b/i, /rosad/i, /amarelo/i, /turquesa/i, /menta/i,
    // Tons claros/dourados (auditoria 22/05/2026): OURO LIGHT, dourado claro
    /\bouro\b.*light/i, /ouro\s+claro/i, /dourado\s+claro/i,
  ] },
  { bucket: 1, patterns: [
    /bege/i, /areia/i, /nude/i, /champagne/i, /p[eé]rola/i, /caramel(?!o)/i,
    // Variações de bege/tan (auditoria 22/05/2026)
    /\btan\b/i, /\bkhaki?\b/i, /\bsand\b/i,
  ] },
  { bucket: 0, patterns: [
    /^branco/i, /^cru/i, /off[-\s]?white/i, /marfim/i, /natural/i,
    // Tons creme/leite (auditoria 22/05/2026): MILK, IVORY, ECRU
    /\bmilk\b/i, /\bivory\b/i, /\becru\b/i, /\bgelo\b/i,
  ] },
];

export const colorBucket = (color: string): number => {
  const normalized = (color || '').trim();
  if (!normalized) return 3;
  for (const { bucket, patterns } of BUCKETS) {
    for (const re of patterns) {
      if (re.test(normalized)) return bucket;
    }
  }
  return 3; // default = bucket médio
};

export const compareColors = (a: string, b: string): number => {
  const ba = colorBucket(a);
  const bb = colorBucket(b);
  if (ba !== bb) return ba - bb;
  return (a || '').localeCompare(b || '', 'pt-BR');
};
