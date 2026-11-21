/**
 * Padrão do catálogo (reference_base) não pode falhar o save porque a
 * normalização troca o group_id da linha pelo grupo do mapa Hub e a guarda
 * compara isso com a ficha.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101050400_tira_padrao_nao_diverge_ficha.sql',
), 'utf8');

describe('tira no padrão do catálogo não diverge da ficha', () => {
  it('não reescreve group_id de reference_base', () => {
    expect(migration).toContain('tira_padrao_nao_diverge_ficha_20270101050400');
    expect(migration).toContain("IS DISTINCT FROM 'reference_base'");
    expect(migration).toContain('normalize_strap_line_sempre_fabrica');
  });

  it('a guarda só acusa group_id em reference_base quando não é o mapa da medida', () => {
    expect(migration).toContain('strap_hub_measure_group_map');
    expect(migration).toContain("nullif(v_sheet_line ->> 'group_id', '') IS NOT NULL");
    expect(migration).toContain('Estrutura da tira no item diverge da ficha tecnica vigente');
  });
});
