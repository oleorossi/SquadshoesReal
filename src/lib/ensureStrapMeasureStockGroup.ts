/**
 * Garante grupo de estoque para medida do Hub (grill 19/10/2026).
 * Nome canônico: `TIPO NMM` (ex.: TIRA CHATA 20MM). Se já existir (case-insensitive),
 * só religa o mapa medida → grupo.
 */
import { MATERIAL_BASE_SECTOR } from '@/lib/categoryFromGroup';
import { supabase } from '@/integrations/supabase/client';

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedSupabaseClient {
  from: (table: string) => {
    select: (columns: string) => {
      ilike: (column: string, pattern: string) => {
        limit: (n: number) => PromiseLike<UntypedQueryResult>;
      };
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<UntypedQueryResult>;
      };
    };
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => PromiseLike<UntypedQueryResult>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<UntypedQueryResult>;
    };
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => PromiseLike<UntypedQueryResult>;
  };
}

const db = supabase as unknown as UntypedSupabaseClient;

/** `TIRA CHATA` + `20` → `TIRA CHATA 20MM`. */
export function strapStockGroupName(typeName: string, finishedWidthMm: number): string {
  const type = String(typeName || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  const width = Number(finishedWidthMm);
  if (!type) throw new Error('Informe o nome do tipo de tira.');
  if (!(width > 0)) throw new Error('Informe a medida final (mm).');
  const widthLabel = Number.isInteger(width)
    ? String(width)
    : String(Math.round(width * 10) / 10).replace(/\.0$/, '');
  return `${type} ${widthLabel}MM`;
}

export interface EnsureStrapMeasureStockGroupResult {
  strapGroupId: string;
  groupName: string;
  created: boolean;
}

async function findGroupByName(name: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await db.from('product_groups').select('id, name').ilike('name', name).limit(5);
  if (error) throw error;
  const rows = Array.isArray(data) ? data as Array<{ id: string; name: string }> : [];
  const exact = rows.find((row) => row.name.trim().toUpperCase() === name.toUpperCase());
  return exact || rows[0] || null;
}

/**
 * Cria ou reutiliza o grupo e grava `strap_hub_measure_group_map`.
 * Flags: Material Base, is_artisanal_strap, strap_uses_napa, origem prestador.
 */
export async function ensureStrapMeasureStockGroup(input: {
  measureId: string;
  typeName: string;
  finishedWidthMm: number;
  cutBandWidthMm?: number | null;
}): Promise<EnsureStrapMeasureStockGroupResult> {
  const groupName = strapStockGroupName(input.typeName, input.finishedWidthMm);
  const existing = await findGroupByName(groupName);

  let strapGroupId: string;
  let created = false;

  if (existing?.id) {
    strapGroupId = existing.id;
    const patch: Record<string, unknown> = {
      is_artisanal_strap: true,
      strap_uses_napa: true,
      updated_at: new Date().toISOString(),
    };
    if (input.cutBandWidthMm != null && input.cutBandWidthMm > 0) {
      patch.strap_cut_band_width_mm = input.cutBandWidthMm;
    }
    // Não sobrescreve strap_origin se o grupo já existir (pode ser fábrica).
    const { error: updateError } = await db.from('product_groups').update(patch).eq('id', strapGroupId);
    if (updateError) throw updateError;
  } else {
    const insertPayload: Record<string, unknown> = {
      name: groupName,
      description: `Grupo de tira criado pelo Hub · ${groupName}`,
      sector: MATERIAL_BASE_SECTOR,
      is_artisanal_strap: true,
      strap_uses_napa: true,
      strap_origin: 'prestador',
      consumption_unit: 'm',
      shared_specs: true,
      is_color_agnostic: false,
      is_family: false,
      auto_component_sheet: false,
      parent_group_id: null,
    };
    if (input.cutBandWidthMm != null && input.cutBandWidthMm > 0) {
      insertPayload.strap_cut_band_width_mm = input.cutBandWidthMm;
    }
    const { data, error } = await db.from('product_groups').insert(insertPayload).select('id, name').single();
    if (error) {
      // Corrida: outro save criou o mesmo nome — religa.
      if ((error as { code?: string }).code === '23505') {
        const raced = await findGroupByName(groupName);
        if (!raced?.id) throw error;
        strapGroupId = raced.id;
      } else {
        throw error;
      }
    } else {
      const row = data as { id: string; name: string } | null;
      if (!row?.id) throw new Error('Grupo criado sem identificador.');
      strapGroupId = row.id;
      created = true;
    }
  }

  const { error: mapError } = await db.from('strap_hub_measure_group_map').upsert(
    { measure_id: input.measureId, strap_group_id: strapGroupId, updated_at: new Date().toISOString() },
    { onConflict: 'measure_id' },
  );
  if (mapError) throw mapError;

  return { strapGroupId, groupName, created };
}
