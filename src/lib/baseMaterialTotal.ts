// ═══════════════════════════════════════════════════════════════════════════
// TOTAL DO MATERIAL BASE por seção (a napa que uma cor inteira consome)
// ═══════════════════════════════════════════════════════════════════════════
// O modal de Consumo já mostra, linha a linha, de quanta napa cada tira sai
// ("≈ 2,82 m NAPA SOFT"), mas ninguém somava — quem compra fazia a conta no
// papel. Duas origens entram no MESMO total, porque na prática é uma napa só:
//   • TIRA artesanal → equivalente em base (`artisanal.baseQty`, metros já
//     divididos pelo rendimento do rolo);
//   • consumo DIRETO de napa (cabedal, forração, fachete, forração de palmilha)
//     → o próprio `totalQuantity`, que já é a napa cortada.
//
// Fica de fora o que não é napa e não se soma em metros com ela (solado em par,
// cola em kg, rebite em un, placa de EVA) — por isso o filtro é por TIPO DE
// COMPONENTE + unidade linear, e não "tudo que estiver em metro".
//
// ⚠ Por que não detectar pela receita artesanal: só NAPA SOFT é
// `base_product_name` de receita. A NAPA SUDANI da forração ficaria de fora e o
// total do COGUMELO daria 16,47 em vez de 36,74 (o número que o dono confere).

/** Componentes cujo consumo DIRETO já é o material base (napa cortada do rolo). */
export const BASE_MATERIAL_COMPONENTS = new Set([
  'Cabedal', 'Forração', 'Fachete', 'Forração Palmilha',
]);

/** Unidades lineares aceitas — o total do base é sempre em metros. */
export const BASE_LINEAR_UNITS = new Set(['m', 'metro', 'metros', 'mt']);

/** Forma mínima que o cálculo precisa de uma linha de consumo. */
export type BaseMaterialInput = {
  componentType: string;
  groupName: string;
  productUnit: string;
  totalQuantity: number;
  /** Consumo ~100× inflado (largura da ficha de componente não cadastrada). */
  widthMissing?: boolean;
  /** Consumo não calculado (ex.: solado fachetado sem specs). */
  warning?: string;
  /** Equivalente em material base quando a linha é tira artesanal. */
  artisanal?: { baseName: string; baseQty: number; yieldPerMeter: number };
};

export type BaseMaterialTotal = {
  /** Soma em metros de todas as origens. */
  total: number;
  /** Quebra por material (ex.: NAPA SOFT 16,47 · NAPA SUDANI 20,27), maior primeiro. */
  parts: { name: string; qty: number }[];
  /** Linhas de napa deixadas de fora por cadastro incompleto — entrariam
   *  ~100× infladas (largura faltando) ou sem consumo calculado. */
  skipped: number;
};

// Cada parcela é arredondada a 2 casas ANTES de somar, de propósito: é o valor
// que está impresso na linha ("≈ 3,85 m NAPA SOFT"). Somando os exatos, o
// COGUMELO daria 36,73 e o dono — que confere somando a coluna na mão — veria
// 36,74 na tela e 36,73 no total. Um total que não fecha com as parcelas
// visíveis destrói a confiança no número; 1 cm de erro acumulado não muda
// pedido de compra nenhum. Se um dia a linha passar a mostrar mais casas,
// mudar as duas coisas juntas.
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Soma o material base das linhas. Devolve null quando a seção não tem napa
 *  nenhuma (ex.: cor só de solado + linha) — a UI então não desenha a faixa. */
export function computeBaseMaterialTotal(rows: BaseMaterialInput[]): BaseMaterialTotal | null {
  const byName = new Map<string, number>();
  let skipped = 0;

  for (const r of rows) {
    // Tira artesanal: conta o equivalente em napa, NUNCA os metros de tira
    // (169,20 m de tira = 2,82 m de napa; somar os 169,20 inflaria 60×).
    if (r.artisanal && r.artisanal.baseQty > 0) {
      const name = r.artisanal.baseName || 'Material base';
      byName.set(name, (byName.get(name) || 0) + round2(r.artisanal.baseQty));
      continue;
    }
    if (!BASE_MATERIAL_COMPONENTS.has(r.componentType)) continue;
    if (!BASE_LINEAR_UNITS.has((r.productUnit || '').toLowerCase())) continue;
    if (r.widthMissing || r.warning) { skipped++; continue; }
    if (!(r.totalQuantity > 0)) continue;
    byName.set(r.groupName, (byName.get(r.groupName) || 0) + round2(r.totalQuantity));
  }

  if (byName.size === 0) return null;
  const parts = Array.from(byName.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);
  return { total: round2(parts.reduce((s, p) => s + p.qty, 0)), parts, skipped };
}
