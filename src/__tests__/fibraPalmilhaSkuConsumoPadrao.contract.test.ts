import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd());
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/20270101021200_fibra-palmilha-sku-no-consumo-padrao.sql'),
  'utf8',
);
const HOOK = readFileSync(
  join(ROOT, 'src/hooks/useSoleGroupStandardConsumption.ts'),
  'utf8',
);
const PANEL = readFileSync(
  join(ROOT, 'src/components/soles-hub/SoleStandardConsumptionPanel.tsx'),
  'utf8',
);

describe('fibra palmilha — pin no Consumo Padrão', () => {
  it('migration relaxa kind só pra placa_palmilha e cria overload com sole_group_id', () => {
    expect(MIGRATION).toContain("role = 'placa_palmilha'");
    expect(MIGRATION).toContain('sole_group_standard_items_item_unique');
    expect(MIGRATION).toContain('p_sole_group_id uuid');
    expect(MIGRATION).toContain("matched_by text");
    expect(MIGRATION).toContain("'sole_group'");
    expect(MIGRATION).toContain('COALESCE(v_sheet.sole_group_id');
  });

  it('UI renomeia pra Fibra e exporta pin de material', () => {
    expect(HOOK).toContain("placa_palmilha: 'Fibra de palmilha'");
    expect(HOOK).toContain('ROLE_WITH_MATERIAL_PIN');
    expect(HOOK).toContain('materialProductId');
    expect(PANEL).toContain('ROLE_WITH_MATERIAL_PIN');
    // Caixa âmbar "Material para débito" + busca (38ff7e82) — o pin do SKU
    // que o estoque baixa. Não travar no placeholder antigo "Selecionar fibra".
    expect(PANEL).toContain('Material para débito');
    expect(PANEL).toContain('Buscar fibra / placa');
  });
});
