/**
 * Helpers de conversão entre unidade de COMPRA e unidade de ESTOQUE/CONSUMO.
 *
 * Modelo Squad Shoes (mai/2026, Opção A):
 *   - `unit`           → unidade de estoque + consumo (a que a ficha técnica usa)
 *   - `purchase_unit`  → unidade da NF do fornecedor / contagem física
 *   - `conversion_rate`→ quanto de `unit` cabe em 1 `purchase_unit`
 *   - `dimensions_width` + `dimensions_unit` → largura para materiais
 *     lineares (m → dm²). A unidade é obrigatória: sem ela não há conversão.
 *
 * Use cases (diferente do unitConversion.ts que cuida do MRP):
 *   1. Entrada de compra: usuário digita qtd em purchase_unit → soma em unit
 *   2. Cadastro: auto-sugerir conversion_rate ou pedir largura
 *   3. Inventário: mostrar "≈ X placas/m" ao lado da qtd em dm²
 *   4. Custo: derivar unit_price (R$/dm²) de pack_price (R$/placa)
 *
 * Exemplos:
 *   Palmilha:   unit='dm²', purchase_unit='placa', conversion_rate=144
 *   Napa Soft:  unit='dm²', purchase_unit='m',     dimensions_width=10
 *   Cola PU:    unit='g',   purchase_unit='kg',    conversion_rate=1000
 */

import { normalizeUnit } from './unitConversion';

export type PurchaseConversionContext = {
  unit: string;
  purchase_unit?: string | null;
  conversion_rate?: number | null;
  /** Largura do material. Só é interpretada junto com `dimensions_unit`. */
  dimensions_width?: number | null;
  /** Unidade da largura ('mm' | 'cm' | 'dm' | 'm'). No banco a coluna
   *  products.dimensions_unit guarda quase sempre 'mm' — SEM normalizar, o
   *  fator m→dm² saía 100× inflado (F5-08, auditoria 2026-07: 1000 mm lidos
   *  como 1000 dm ⇒ 10.000 dm²/m em vez de 100). */
  dimensions_unit?: string | null;
};

/**
 * Normaliza a largura pra dm conforme `dimensions_unit`. Sem uma unidade
 * linear canônica não há conversão segura.
 */
function widthInDm(ctx: PurchaseConversionContext): number | null {
  const w = Number(ctx.dimensions_width ?? 0);
  if (!Number.isFinite(w) || w <= 0 || !ctx.dimensions_unit) return null;
  const u = ctx.dimensions_unit.trim().toLowerCase();
  if (u === 'mm') return w / 100;
  if (u === 'cm') return w / 10;
  if (u === 'm') return w * 10;
  if (u === 'dm') return w;
  return null;
}

/**
 * Resolve a unidade ao CANÔNICO antes de decidir a regra de conversão. Sem
 * isto, sinônimos não-canônicos (`metro`/`metros`/`mt`, `dm2`/`m2`) caíam por
 * fora dos ramos m→dm²/m² e o fator virava 1 em silêncio — inflando a
 * quantidade ~100× num material de área cuja unidade de compra estava grafada
 * `metro` em vez de `m`. A grafia canônica mora em unitConversion.normalizeUnit
 * (mesma fonte do MRP/NF). `lc` segue só pra rótulos de exibição.
 */
const lc = (s: string | null | undefined) => normalizeUnit(s);

/** Sugestão de conversion_rate para pares unit↔purchase_unit comuns. */
export function suggestConversionRate(
  purchaseUnit: string,
  stockUnit: string,
): number | null {
  const pu = lc(purchaseUnit);
  const su = lc(stockUnit);

  if (pu === su) return 1;

  // Área (múltiplos diretos)
  if (pu === 'm²' && su === 'dm²') return 100;
  if (pu === 'dm²' && su === 'm²') return 0.01;
  if (pu === 'cm²' && su === 'dm²') return 0.01;

  // Massa
  if (pu === 'kg' && su === 'g') return 1000;
  if (pu === 'g' && su === 'kg') return 0.001;

  // Volume
  if (pu === 'l' && su === 'ml') return 1000;
  if (pu === 'ml' && su === 'l') return 0.001;

  // Comprimento (linear → linear) — simétrico nos dois sentidos pra o
  // cadastro sugerir o fator independente da ordem em que o usuário escolhe
  // compra/estoque (antes só tinha o sentido maior→menor; trocar a ordem
  // deixava cair no fallback 1 e gravava conversion_rate errado — ex.: 3
  // "Elástico 6MM" cm↔m ficaram com rate=1 em vez de 100).
  if (pu === 'm' && su === 'cm') return 100;
  if (pu === 'cm' && su === 'm') return 0.01;
  if (pu === 'm' && su === 'mm') return 1000;
  if (pu === 'mm' && su === 'm') return 0.001;
  if (pu === 'cm' && su === 'mm') return 10;
  if (pu === 'mm' && su === 'cm') return 0.1;

  // Linear → área: precisa largura — caller resolve via dimensions_width
  return null;
}

/**
 * Fator efetivo (qty unit por 1 qty purchase_unit), considerando
 * dimensions_width quando aplicável (m → dm²).
 */
export function effectiveConversionFactor(ctx: PurchaseConversionContext): number | null {
  return effectiveConversionFactorStrict(ctx);
}

/**
 * Retorna `null` quando purchase_unit ≠ unit e não há uma conversão segura.
 * Largura para materiais de área é obrigatória e precisa declarar a unidade.
 */
export function effectiveConversionFactorStrict(ctx: PurchaseConversionContext): number | null {
  const pu = lc(ctx.purchase_unit || ctx.unit);
  const su = lc(ctx.unit);

  if (pu === su) return 1;

  const rate = Number(ctx.conversion_rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const wDm = widthInDm(ctx);

  // Caso m linear → dm²: 1 m × W dm largura = 10*W dm²
  if (pu === 'm' && su === 'dm²') {
    return wDm ? 10 * wDm : null;
  }

  // Caso m linear → m²: largura em dm / 10
  if (pu === 'm' && su === 'm²') {
    return wDm ? wDm / 10 : null;
  }

  return rate;
}

/** Resultado do fator de recebimento ciente da unidade da LINHA da OC.
 *  `ok=false` ⇒ bloquear (reason explica); `factor` só é válido com ok=true. */
export type ReceiptFactorResult =
  | { ok: true; factor: number; basis: 'estoque' | 'compra'; reason?: string }
  | { ok: false; reason: string; factor?: number; basis?: 'estoque' | 'compra' };

/**
 * Fator de conversão do RECEBIMENTO de OC ciente da unidade gravada na LINHA
 * do item (F3-1/F5-02, auditoria 2026-07). Itens de OC existem em DUAS
 * convenções no banco:
 *  - unidade de COMPRA (MRP / per-PV / Wizard / manual): aplicar o fator
 *    estrito purchase_unit→unit (conversion_rate / largura);
 *  - unidade de ESTOQUE (geradores ROP legados `auto_create_purchase_order` /
 *    `generate_rop_purchase_suggestions` gravam unit=products.unit): fator 1.
 *    Aplicar o fator de compra cegamente aqui creditava 150× (PLACA EVA:
 *    item de 160 dm² virava 24.000 dm²).
 * Se a unidade da linha não casa com NENHUMA das duas, ou casa com a de compra
 * mas não existe regra segura, BLOQUEIA (espelho do needsConfig da NF) — nunca
 * aplica fator cego.
 */
export function receiptConversionFactor(
  itemUnit: string | null | undefined,
  ctx: PurchaseConversionContext & { name?: string | null },
): ReceiptFactorResult {
  const name = ctx.name || 'Produto';
  const su = lc(ctx.unit);
  const pu = lc(ctx.purchase_unit || ctx.unit);
  const iu = lc(itemUnit || '');

  // Linha denominada na unidade de ESTOQUE → a quantidade já está na unidade
  // do produto; fator 1 (mesmo que exista conversion_rate/largura cadastrados).
  if (itemUnit && iu === su) return { ok: true, factor: 1, basis: 'estoque' };

  // Linha na unidade de COMPRA (ou linha legada sem unidade — assume a
  // convenção histórica de compra): fator estrito, com bloqueio sem regra.
  if (!itemUnit || iu === pu) {
    const f = effectiveConversionFactorStrict(ctx);
    if (f == null) {
      return {
        ok: false,
        reason: `${name}: unidade de compra "${ctx.purchase_unit || ctx.unit}" sem regra de conversão pra "${ctx.unit}" — configure uma taxa maior que zero e, para área, a largura com unidade na Ficha de Componente antes de receber.`,
      };
    }
    return { ok: true, factor: f, basis: 'compra' };
  }

  // Unidade da linha não casa nem com compra nem com estoque → bloquear em vez
  // de chutar um fator (nunca creditar quantidade na unidade errada).
  return {
    ok: false,
    reason: `${name}: item da OC em "${itemUnit}" não casa nem com a unidade de compra ("${ctx.purchase_unit || '—'}") nem com a de estoque ("${ctx.unit}") — corrija a unidade do item ou o cadastro do produto antes de receber.`,
  };
}

/**
 * Média ponderada de preço (WAC) — MESMA fórmula do fluxo de NF
 * (XmlImportDialog/AddToStockDialog): newPrice = (oldQty×oldPrice +
 * addQty×addPrice) / newQty, com addPrice já em R$/unidade de ESTOQUE.
 * Fonte única pra NF e recebimento de OC não divergirem (F5-05).
 */
export function weightedAverageUnitPrice(
  oldQty: number,
  oldPrice: number,
  addQty: number,
  addPrice: number,
): number {
  const prevQty = Number(oldQty) || 0;
  const prevPrice = Number(oldPrice) || 0;
  const inQty = Number(addQty) || 0;
  const inPrice = Number(addPrice) || 0;
  const newQty = prevQty + inQty;
  if (newQty <= 0) return inPrice;
  return (prevQty * prevPrice + inQty * inPrice) / newQty;
}

/** Converte qty em purchase_unit → qty em stock unit. */
export function purchaseToStock(qtyPurchase: number, ctx: PurchaseConversionContext): number {
  const factor = effectiveConversionFactor(ctx);
  if (factor == null) throw new Error('Conversão de compra inválida: revise a taxa ou a largura do material.');
  return qtyPurchase * factor;
}

/** Converte qty em stock unit → qty em purchase_unit. Útil pra mostrar aproximação. */
export function stockToPurchase(qtyStock: number, ctx: PurchaseConversionContext): number | null {
  const f = effectiveConversionFactor(ctx);
  if (f == null || f <= 0) return null;
  return qtyStock / f;
}

/** Preço por purchase_unit (R$/placa) → preço por stock unit (R$/dm²). */
export function purchasePriceToUnitPrice(packPrice: number, ctx: PurchaseConversionContext): number | null {
  const f = effectiveConversionFactor(ctx);
  if (f == null || f <= 0) return null;
  return packPrice / f;
}

/** Inverso: R$/stock unit → R$/purchase unit. */
export function unitPriceToPurchasePrice(unitPrice: number, ctx: PurchaseConversionContext): number {
  const factor = effectiveConversionFactor(ctx);
  if (factor == null) throw new Error('Conversão de compra inválida: revise a taxa ou a largura do material.');
  return unitPrice * factor;
}

/** Descrição amigável do fator efetivo: "1 placa = 144 dm²" */
export function describeConversion(ctx: PurchaseConversionContext): string {
  const pu = ctx.purchase_unit || ctx.unit;
  const su = ctx.unit;
  if (lc(pu) === lc(su)) return 'Mesma unidade';
  const f = effectiveConversionFactor(ctx);
  if (f == null) return 'Conversão não configurada — informe taxa válida e, para área, largura com unidade.';
  const fStr = f >= 100 ? f.toFixed(0) : f >= 1 ? f.toFixed(2).replace(/\.?0+$/, '') : f.toFixed(4);
  return `1 ${pu} = ${fStr} ${su}`;
}

/** Indica se o produto precisa de dimensions_width pra conversão fazer sentido. */
export function needsWidthForConversion(ctx: PurchaseConversionContext): boolean {
  const pu = lc(ctx.purchase_unit);
  const su = lc(ctx.unit);
  return pu === 'm' && (su === 'dm²' || su === 'm²');
}

/**
 * Templates pré-definidos pros tipos de material mais comuns na fábrica.
 * Cobrem ~80% dos casos do Squad Shoes.
 */
export type ConversionTemplate = {
  key: string;
  label: string;
  description: string;
  unit: string;
  purchase_unit: string;
  conversion_rate: number;
  dimensions_width?: number;
  dimensions_unit?: string;
  example?: string;
};

export const CONVERSION_TEMPLATES: ConversionTemplate[] = [
  {
    key: 'palmilha-placa',
    label: 'Palmilha em placa',
    description: 'Compra em placas; consumo em dm². Ajuste o fator conforme tamanho da placa do fornecedor.',
    unit: 'dm²',
    purchase_unit: 'placa',
    conversion_rate: 144,
    example: 'Placa de 60×80cm = 48 dm². Placa de 100×120cm = 120 dm². Ajuste manualmente.',
  },
  {
    key: 'napa-rolo-1m',
    label: 'Napa / Couro sintético — rolo largura 1 m',
    description: 'Compra em metro linear; consumo em dm². Largura padrão do rolo: 1m.',
    unit: 'dm²',
    purchase_unit: 'm',
    conversion_rate: 100,
    dimensions_width: 10,
    dimensions_unit: 'dm',
    example: 'Rolo 13,7m × 1m = 1.370 dm². 1 m linear = 100 dm².',
  },
  {
    key: 'tecido-cabedal-14',
    label: 'Tecido cabedal/forração — largura 1,4 m',
    description: 'Compra em metro linear; largura típica de tecido 1,40 m.',
    unit: 'dm²',
    purchase_unit: 'm',
    conversion_rate: 140,
    dimensions_width: 14,
    dimensions_unit: 'dm',
    example: '1 m linear × 1,4 m largura = 140 dm².',
  },
  {
    key: 'tecido-cabedal-16',
    label: 'Tecido cabedal/forração — largura 1,6 m',
    description: 'Compra em metro linear; largura 1,60 m.',
    unit: 'dm²',
    purchase_unit: 'm',
    conversion_rate: 160,
    dimensions_width: 16,
    dimensions_unit: 'dm',
    example: '1 m linear × 1,6 m largura = 160 dm².',
  },
  {
    key: 'cola-balde-kg',
    label: 'Cola / químico em balde (kg → g)',
    description: 'Compra em kg; ficha consome em gramas. Conversão automática × 1000.',
    unit: 'g',
    purchase_unit: 'kg',
    conversion_rate: 1000,
    example: '1 balde 14 kg = 14.000 g.',
  },
  {
    key: 'liquido-l-ml',
    label: 'Líquido em galão (L → ml)',
    description: 'Compra em L; consumo em ml. Conversão × 1000.',
    unit: 'ml',
    purchase_unit: 'L',
    conversion_rate: 1000,
    example: '1 galão 5 L = 5.000 ml.',
  },
  {
    key: 'fitilho-rolo',
    label: 'Fitilho em rolo (m linear)',
    description: 'Compra em rolos; estoque em metros. Cadastre quantos m tem o rolo.',
    unit: 'm',
    purchase_unit: 'rolo',
    conversion_rate: 500,
    example: '1 rolo ≈ 500 m. Confirme com o fornecedor.',
  },
  {
    key: 'mesma-unidade',
    label: 'Compra = Consumo (sem conversão)',
    description: 'Acessórios, ilhós, fivelas, fechos — comprado e consumido na mesma unidade.',
    unit: 'un',
    purchase_unit: 'un',
    conversion_rate: 1,
  },
];

export function applyTemplate(template: ConversionTemplate): Partial<PurchaseConversionContext> & {
  unit: string;
  purchase_unit: string;
  conversion_rate: number;
  dimensions_width?: number;
  dimensions_unit?: string;
} {
  return {
    unit: template.unit,
    purchase_unit: template.purchase_unit,
    conversion_rate: template.conversion_rate,
    dimensions_width: template.dimensions_width,
    dimensions_unit: template.dimensions_unit,
  };
}
