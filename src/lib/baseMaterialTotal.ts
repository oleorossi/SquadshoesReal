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
  /** Equivalente em material base quando a linha é tira artesanal.
   *  `pending` = a napa-base (família da ficha da referência) é conhecida mas
   *  não há rendimento exato cadastrado para ela
   *  → fica FORA do total e conta como "a cadastrar".
   */
  artisanal?: { baseName: string; baseQty: number; yieldPerMeter: number; pending?: boolean };
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

// ── Mesma leitura na geração de OC (Compras por Pedido) ────────────────────
// A OC não conhece `componentType` (vem de outra RPC, `compute_materials_per_pv`),
// então lá o material base é reconhecido pelo GRUPO do produto. O grupo já está
// disponível no dialog, que enriquece as linhas com o cadastro.

/** Famílias compradas em rolo. Extensível: se entrar uma base com outro nome,
 *  acrescentar aqui — ou promover a uma flag em `product_groups`, que é o certo
 *  quando isto passar de duas linhas. */
export const BASE_GROUP_PATTERN = /napa|couro/i;

/** O grupo é material base? `recipeBases` = `base_product_name` das receitas
 *  artesanais ativas, pra pegar base que não case com o padrão de nome. */
export function isBaseMaterialGroup(groupName: string, recipeBases?: Iterable<string>): boolean {
  const g = (groupName || '').trim();
  if (!g) return false;
  if (BASE_GROUP_PATTERN.test(g)) return true;
  const norm = g.toLowerCase();
  for (const b of recipeBases || []) {
    if ((b || '').trim().toLowerCase() === norm) return true;
  }
  return false;
}

export type PurchaseBaseInput = {
  /** Grupo do produto (`product_groups.name`), não o nome do produto. */
  groupName: string;
  unit: string;
  qty: number;
};

/** Total de material base sem arredondamento intermediário. */
export function computePurchaseBaseTotal(
  items: PurchaseBaseInput[],
  recipeBases?: Iterable<string>,
): BaseMaterialTotal | null {
  const byName = new Map<string, number>();
  for (const it of items) {
    if (!isBaseMaterialGroup(it.groupName, recipeBases)) continue;
    if (!BASE_LINEAR_UNITS.has((it.unit || '').toLowerCase())) continue;
    if (!(it.qty > 0)) continue;
    byName.set(it.groupName, (byName.get(it.groupName) || 0) + it.qty);
  }
  if (byName.size === 0) return null;
  const parts = Array.from(byName.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);
  return { total: parts.reduce((s, p) => s + p.qty, 0), parts, skipped: 0 };
}

/**
 * Tira que DEVERIA ter virado material base e não virou.
 *
 * O rollup de `compute_materials_per_pv` exige `products.is_artisanal` no
 * produto. Quando um único produto do grupo fica sem a flag, ele escapa: a OC
 * compra TIRA PRONTA em vez de napa — diferença comercial grande, hoje
 * silenciosa. Caso real (PV-00147, 20/07/2026): dos 24 produtos do grupo
 * "TIRA OVERLOCK 5MM", 23 têm a flag e só o CAPUCCINO não tinha → 645,12 m de
 * tira na OC no lugar de ~10,58 m de napa.
 *
 * A suspeita é derivada dos DADOS, não de nome chumbado: o grupo tem irmãos
 * marcados como artesanais e este produto não. Grupos 100% não-artesanais
 * (TIRA STRASS, que é comprada pronta mesmo) não disparam nada.
 */
export function isSuspectUnrolledArtisanal(
  product: { is_artisanal?: boolean | null; group_id?: string | null },
  artisanalCountByGroup: Map<string, number>,
): boolean {
  if (product?.is_artisanal) return false;
  const gid = product?.group_id;
  if (!gid) return false;
  return (artisanalCountByGroup.get(gid) || 0) > 0;
}

/** Soma o material base das linhas. Devolve null quando a seção não tem napa
 *  nenhuma (ex.: cor só de solado + linha) — a UI então não desenha a faixa. */
export function computeBaseMaterialTotal(rows: BaseMaterialInput[]): BaseMaterialTotal | null {
  const byName = new Map<string, number>();
  let skipped = 0;

  for (const r of rows) {
    // Tira com família conhecida (napa da ficha) mas SEM rendimento cadastrado
    // pra essa base → fora do total, conta como
    // "a cadastrar" (não converte às cegas pela base errada).
    if (r.artisanal?.pending) { skipped++; continue; }
    // Tira artesanal: conta o equivalente em napa, NUNCA os metros de tira
    // (169,20 m de tira = 2,82 m de napa; somar os 169,20 inflaria 60×).
    if (r.artisanal && r.artisanal.baseQty > 0) {
      const name = r.artisanal.baseName || 'Material base';
      byName.set(name, (byName.get(name) || 0) + r.artisanal.baseQty);
      continue;
    }
    if (!BASE_MATERIAL_COMPONENTS.has(r.componentType)) continue;
    if (!BASE_LINEAR_UNITS.has((r.productUnit || '').toLowerCase())) continue;
    if (r.widthMissing || r.warning) { skipped++; continue; }
    if (!(r.totalQuantity > 0)) continue;
    byName.set(r.groupName, (byName.get(r.groupName) || 0) + r.totalQuantity);
  }

  if (byName.size === 0) return null;
  const parts = Array.from(byName.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);
  return { total: parts.reduce((s, p) => s + p.qty, 0), parts, skipped };
}
