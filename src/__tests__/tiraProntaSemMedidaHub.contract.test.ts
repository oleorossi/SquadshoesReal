import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101049900_tira_pronta_sem_medida_hub.sql'),
  'utf8',
);

describe('tira comprada pronta passa sem medida do Hub', () => {
  it('o writer só exige família/medida na tira artesanal', () => {
    const writer = sql.slice(0, sql.indexOf('$patch_alignment_measure$'));
    expect(writer).toContain("v_sheet_basis <> 'finished_product_group'");
    expect(writer).toContain('Linha tecnica sem familia/medida canonica; corrija a ficha no Estoque');
    expect(writer).toContain("public.try_parse_uuid(v_sheet_line ->> 'group_id')");
    expect(writer).toContain('Tira comprada pronta exige o grupo de estoque na ficha');
  });

  it('a guarda de alinhamento não recusa medida nula no grupo acabado', () => {
    const guard = sql.slice(sql.indexOf('$patch_alignment_measure$'));
    expect(guard).toContain("v_basis <> 'finished_product_group'");
    expect(guard).toContain('v_measure_id IS NULL OR v_strap_type_id IS NULL');
  });
});
