/**
 * Helpers de conversão entre unidade de COMPRA e unidade de ESTOQUE/CONSUMO.
 *
 * Modelo Squad Shoes (mai/2026, Opção A):
 *   - `unit`           → unidade de estoque + consumo (a que a ficha técnica usa)
 *   - `purchase_unit`  → unidade da NF do fornecedor / contagem física
 *   - `conversion_rate`→ quanto de `unit` cabe em 1 `purchase_unit`
 *   - `dimensions_width` (em dm) → largura para materiais lineares (m → dm²)
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
  dimensions_width?: number | null;  // em dm
};

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
export function effectiveConversionFactor(ctx: PurchaseConversionContext): number {
  const pu = lc(ctx.purchase_unit || ctx.unit);
  const su = lc(ctx.unit);

  if (pu === su) return 1;

  // Caso m linear → dm²: 1 m × W dm largura = 10*W dm²
  if (pu === 'm' && su === 'dm²' && ctx.dimensions_width && ctx.dimensions_width > 0) {
    return 10 * ctx.dimensions_width;
  }

  // Caso m linear → m²: largura em dm / 10
  if (pu === 'm' && su === 'm²' && ctx.dimensions_width && ctx.dimensions_width > 0) {
    return ctx.dimensions_width / 10;
  }

  if (ctx.conversion_rate && ctx.conversion_rate > 0) return ctx.conversion_rate;

  return suggestConversionRate(pu, su) ?? 1;
}

/**
 * Variante ESTRITA: retorna null quando purchase_unit ≠ unit e não existe
 * NENHUMA regra (sem largura, sem conversion_rate, sem sugestão segura).
 * Use no RECEBIMENTO de compra pra bloquear o item em vez de creditar a
 * quantidade crua na unidade errada (o fluxo de NF já bloqueia com
 * needsConfig — este é o equivalente pro recebimento de OC).
 * `effectiveConversionFactor` (fallback 1) continua valendo pra displays.
 */
export function effectiveConversionFactorStrict(ctx: PurchaseConversionContext): number | null {
  const pu = lc(ctx.purchase_unit || ctx.unit);
  const su = lc(ctx.unit);
  if (pu === su) return 1;
  if (pu === 'm' && su === 'dm²' && ctx.dimensions_width && ctx.dimensions_width > 0) {
    return 10 * ctx.dimensions_width;
  }
  if (pu === 'm' && su === 'm²' && ctx.dimensions_width && ctx.dimensions_width > 0) {
    return ctx.dimensions_width / 10;
  }
  if (ctx.conversion_rate && ctx.conversion_rate > 0) return ctx.conversion_rate;
  return suggestConversionRate(pu, su);
}

/** Converte qty em purchase_unit → qty em stock unit. */
export function purchaseToStock(qtyPurchase: number, ctx: PurchaseConversionContext): number {
  return qtyPurchase * effectiveConversionFactor(ctx);
}

/** Converte qty em stock unit → qty em purchase_unit. Útil pra mostrar aproximação. */
export function stockToPurchase(qtyStock: number, ctx: PurchaseConversionContext): number {
  const f = effectiveConversionFactor(ctx);
  if (f <= 0) return 0;
  return qtyStock / f;
}

/** Preço por purchase_unit (R$/placa) → preço por stock unit (R$/dm²). */
export function purchasePriceToUnitPrice(packPrice: number, ctx: PurchaseConversionContext): number {
  const f = effectiveConversionFactor(ctx);
  if (f <= 0) return packPrice;
  return packPrice / f;
}

/** Inverso: R$/stock unit → R$/purchase unit. */
export function unitPriceToPurchasePrice(unitPrice: number, ctx: PurchaseConversionContext): number {
  return unitPrice * effectiveConversionFactor(ctx);
}

/** Descrição amigável do fator efetivo: "1 placa = 144 dm²" */
export function describeConversion(ctx: PurchaseConversionContext): string {
  const pu = ctx.purchase_unit || ctx.unit;
  const su = ctx.unit;
  if (lc(pu) === lc(su)) return 'Mesma unidade';
  const f = effectiveConversionFactor(ctx);
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
