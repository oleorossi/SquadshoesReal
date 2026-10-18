import { supabase } from '@/integrations/supabase/client';
import { createGroupColorProduct } from '@/lib/groupColorProducts';

export interface CreateWidthLeafInput {
  familyId: string;
  widthMm: number;
  defaultUnitPrice?: number | null;
  /** Se true, clona cores ativas da folha `cloneFromLeafId` (saldo 0). */
  cloneColors?: boolean;
  cloneFromLeafId?: string | null;
}

export interface CreateWidthLeafResult {
  ok: boolean;
  leafId?: string;
  leafName?: string;
  error?: string;
  cloned?: number;
  cloneErrors?: string[];
}

/** Nome canônico curto da bitola — único globalmente em product_groups.name. */
export function widthLeafName(widthMm: number): string {
  return `${Math.round(widthMm)}MM`;
}

export function parseWidthMm(raw: string | number): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Cria um grupo-folha `NNMM` sob uma família, com dimensions_width e
 * default_unit_price. Opcionalmente clona cores de outra bitola.
 */
export async function createWidthLeafGroup(input: CreateWidthLeafInput): Promise<CreateWidthLeafResult> {
  const widthMm = parseWidthMm(input.widthMm);
  if (widthMm == null) {
    return { ok: false, error: 'Informe a largura em milímetros (ex.: 20).' };
  }
  if (!input.familyId) {
    return { ok: false, error: 'Família técnica não informada.' };
  }

  const leafName = widthLeafName(widthMm);
  const { data: family, error: familyError } = await (supabase as any)
    .from('product_groups')
    .select('id, name, sector, is_family, consumption_unit, shared_specs')
    .eq('id', input.familyId)
    .maybeSingle();
  if (familyError) return { ok: false, error: familyError.message };
  if (!family || family.is_family !== true) {
    return { ok: false, error: 'O destino precisa ser uma família técnica.' };
  }

  const { data: existing } = await supabase
    .from('product_groups')
    .select('id')
    .ilike('name', leafName)
    .limit(1);
  if ((existing || []).length > 0) {
    return { ok: false, error: `Já existe um grupo chamado ${leafName}. Escolha outra largura ou renomeie o existente.` };
  }

  const defaultPrice = input.defaultUnitPrice != null && Number.isFinite(Number(input.defaultUnitPrice))
    ? Number(input.defaultUnitPrice)
    : null;

  const { data: created, error: insertError } = await (supabase as any)
    .from('product_groups')
    .insert({
      name: leafName,
      description: `Bitola ${widthMm} mm de ${family.name}`,
      sector: family.sector,
      is_family: false,
      parent_group_id: family.id,
      shared_specs: true,
      consumption_unit: family.consumption_unit || 'm',
      dimensions_length: 0,
      dimensions_width: widthMm,
      dimensions_thickness: 0,
      dimensions_unit: 'mm',
      auto_component_sheet: false,
      is_color_agnostic: false,
      is_bom_color_source: false,
      is_artisanal_strap: false,
      default_unit_price: defaultPrice,
    })
    .select('id, name')
    .single();

  if (insertError || !created) {
    return { ok: false, error: insertError?.message || 'Falha ao criar a largura.' };
  }

  let cloned = 0;
  const cloneErrors: string[] = [];
  if (input.cloneColors && input.cloneFromLeafId) {
    const { data: sourceColors } = await supabase
      .from('products')
      .select('color, unit')
      .eq('group_id', input.cloneFromLeafId)
      .eq('active', true);
    const unit = (sourceColors || []).find((p: any) => p.unit)?.unit || 'm';
    for (const row of sourceColors || []) {
      const color = String((row as any).color || '').trim();
      if (!color) continue;
      const result = await createGroupColorProduct({
        groupId: created.id,
        groupName: created.name,
        color,
        stockUnit: unit,
      });
      if (result.status === 'created') cloned += 1;
      else if (result.status === 'error') cloneErrors.push(`${color}: ${result.error}`);
    }
  }

  return {
    ok: true,
    leafId: created.id,
    leafName: created.name,
    cloned,
    cloneErrors: cloneErrors.length ? cloneErrors : undefined,
  };
}
