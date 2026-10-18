import { supabase } from '@/integrations/supabase/client';
import { createProductsWithStock } from '@/lib/stockCommand';
import { MATERIAL_BASE_SECTOR } from '@/lib/categoryFromGroup';
import { calculationMethodForUnit } from '@/lib/groupColorProducts';
import type { ProductGroup } from '@/hooks/useGroups';

/**
 * Grupo de material que nasce COM cor — spec `grupo-cor-obrigatoria.md`.
 *
 * Saiu do antigo `QuickFamilyDialog` quando a criação de grupo virou porta
 * única (`GroupCreateDialog`). Grupo vazio era invisível no seletor da ficha
 * (só lista grupo com item ativo) e não tinha como ganhar a 1ª cor pelas abas —
 * a NAPA ROOTS ficou assim em 11/10/2026.
 */

/** Unidades-base aceitas para material cortado de bobina/placa (área/linear). */
export const AREA_STOCK_UNITS = ['m', 'cm', 'dm²', 'm²', 'placa'] as const;

export type ColorRequirement = 'required' | 'ask' | 'none';

/** Setores em que todo item tem cor (medido: ~100% dos itens ativos). */
const COLOR_REQUIRED_SECTORS = new Set(['Cabedal', 'Forração da Palmilha', 'Solado']);

/**
 * Decide se o grupo precisa nascer com cor.
 * - `required`: Cabedal, Forração da Palmilha, Solado.
 * - `ask`: Componente — só 28 de 42 itens têm cor, então o usuário responde
 *   "Varia por cor?" sem resposta pré-marcada.
 * - `none`: família técnica, tira (Material Base / tira acabada — Hub de Tiras)
 *   e setores sem cor (Palmilha, Químicos, Ferramentas, Fôrma).
 */
export function colorRequirement(input: {
  sector: string | null | undefined;
  isFamily: boolean;
  isArtisanalStrap: boolean;
}): ColorRequirement {
  const sector = (input.sector || '').trim();
  if (input.isFamily || input.isArtisanalStrap || !sector || sector === MATERIAL_BASE_SECTOR) return 'none';
  if (COLOR_REQUIRED_SECTORS.has(sector)) return 'required';
  if (sector === 'Componente') return 'ask';
  return 'none';
}

export function skuToken(value: string, fallback: string): string {
  const token = (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return token || fallback;
}

/** SKUs estáveis na ordem das cores. O Set nasce com todos os SKUs do banco e
 *  é atualizado a cada item para impedir colisão dentro do próprio lote. */
export function buildUniqueSkus(prefix: string, colors: string[], existingSkus: Array<string | null | undefined>): string[] {
  const visiblePrefix = skuToken(prefix, 'MAT');
  const used = new Set(existingSkus.map(sku => (sku || '').trim().toUpperCase()).filter(Boolean));

  return colors.map((color, index) => {
    const base = `${visiblePrefix}-${skuToken(color, `COR${index + 1}`)}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

/** Cores em CAIXA ALTA, sem vazio e sem repetição (ignora acento na comparação). */
export function normalizeColorList(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const color = (value || '').trim().toUpperCase();
    if (!color) continue;
    const key = color.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(color);
  }
  return out;
}

export interface CreateGroupWithColorsInput {
  group: {
    name: string;
    description: string;
    sector: string;
    auto_component_sheet: boolean;
    parent_group_id: string | null;
    dimensions_width: number | null;
    dimensions_length?: number | null;
    dimensions_thickness?: number | null;
    dimensions_unit: string | null;
  };
  colors: string[];
  /** Unidade-base de estoque — escolha explícita, nunca inferida. */
  unit: string;
  unitPrice: number;
  /** SKUs já usados no banco (para o sufixo de colisão). */
  existingSkus: Array<string | null | undefined>;
}

/**
 * Cria o grupo como "Linha com variantes" e um SKU por cor, saldo 0, pela
 * fronteira de estoque (`createProductsWithStock`). São duas operações: se o
 * lote falhar, o grupo criado AQUI é removido por `delete_empty_material_group`,
 * que trava o grupo e revalida o vazio na mesma transação (um COUNT+DELETE em
 * duas requisições poderia desagrupar produto concorrente — FK ON DELETE SET NULL).
 */
export async function createGroupWithColors(input: CreateGroupWithColorsInput): Promise<ProductGroup> {
  const colors = normalizeColorList(input.colors);
  const unit = input.unit.trim();
  const name = input.group.name.trim().toUpperCase();
  if (!name) throw new Error('Informe o nome do grupo.');
  if (colors.length === 0) throw new Error('Cadastre ao menos uma cor.');
  if (!unit) throw new Error('Selecione a unidade de estoque.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newGroup, error: groupError } = await (supabase as any)
    .from('product_groups')
    .insert({
      name,
      description: input.group.description,
      sector: input.group.sector,
      auto_component_sheet: input.group.auto_component_sheet,
      is_artisanal_strap: false,
      parent_group_id: input.group.parent_group_id,
      is_family: false,
      is_color_agnostic: false,
      shared_specs: true,
      // Linha com variantes exige unidade técnica (`chk_shared_group_has_consumption_unit`).
      // Sem ela o editor recebia shared_specs=true + unidade NULL e o save
      // posterior tentava apagar a unidade-base dos produtos.
      consumption_unit: unit,
      dimensions_width: input.group.dimensions_width,
      dimensions_length: input.group.dimensions_length ?? null,
      dimensions_thickness: input.group.dimensions_thickness ?? null,
      dimensions_unit: input.group.dimensions_unit,
    })
    .select('*')
    .single();

  if (groupError) {
    if (groupError.code === '23505') throw new Error('Já existe um grupo com este nome.');
    throw new Error('Falha ao criar grupo: ' + groupError.message);
  }
  if (!newGroup?.id) throw new Error('O grupo foi criado sem retornar um identificador.');

  try {
    const skus = buildUniqueSkus(skuToken(name, 'MAT'), colors, input.existingSkus);
    const width = Number(newGroup.dimensions_width) || 0;
    const created = await createProductsWithStock(colors.map((color, index) => ({
      name: `${name} - ${color}`,
      sku: skus[index],
      color,
      category: input.group.sector,
      group_id: newGroup.id,
      unit,
      purchase_unit: unit,
      production_unit: unit,
      purchase_order_unit: unit,
      conversion_rate: 1,
      calculation_method: calculationMethodForUnit(unit),
      unit_price: Number(input.unitPrice) || 0,
      supplier_id: null,
      active: true,
      dimensions_length: Number(newGroup.dimensions_length) || 0,
      dimensions_width: width,
      dimensions_thickness: Number(newGroup.dimensions_thickness) || 0,
      dimensions_unit: newGroup.dimensions_unit || 'mm',
      quantity: 0,
      reason: 'Cadastro de grupo com cor — sem saldo inicial',
    })));
    if (!created.success) {
      const code = created.errors?.[0]?.error;
      if (code === 'SKU_ALREADY_EXISTS') {
        throw new Error('Um SKU ou uma cor foi cadastrado por outra operação. Tente de novo para recalcular os sufixos.');
      }
      throw new Error('Falha ao criar as cores: ' + (code || 'erro desconhecido'));
    }
    return newGroup as ProductGroup;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: removed, error: cleanupError } = await (supabase as any)
      .rpc('delete_empty_material_group', { p_group_id: newGroup.id });
    if (cleanupError) {
      throw new Error(`${message} O grupo "${name}" ficou criado sem cor: ${cleanupError.message}`);
    }
    if (!removed) {
      throw new Error(`${message} O grupo "${name}" não foi removido porque já recebeu itens ou subgrupos.`);
    }
    throw new Error(`${message} Nada foi gravado — o grupo foi desfeito.`);
  }
}
