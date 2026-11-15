import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101046800_elastico-especial-g-strap-catalog.sql'),
  'utf8',
);
const policy = readFileSync(
  resolve(ROOT, 'src/lib/technicalStrapSourcePolicy.ts'),
  'utf8',
);
const sourceEditor = readFileSync(
  resolve(ROOT, 'src/components/technical-sheets/TechnicalStrapSourceEditor.tsx'),
  'utf8',
);

describe('ELÁSTICO ESPECIAL G no seletor Família e medida canônicas', () => {
  it('seeda tipo + medidas 20/25/30 buy-ready no catálogo canônico', () => {
    expect(migration).toContain("'ELÁSTICO ESPECIAL G'");
    expect(migration).toContain("'20 mm'");
    expect(migration).toContain("'25 mm'");
    expect(migration).toContain("'30 mm'");
    expect(migration).toContain("'sempre_sku_acabado'");
    expect(migration).toContain('artisanal_strap_types_name_norm_uq');
    expect(migration).toContain('v_active_count < 3');
  });

  it('marca as folhas de estoque como tira acabada', () => {
    expect(migration).toContain('is_artisanal_strap = true');
    expect(migration).toContain('c5b1b9c0-7c52-4776-958f-fb49e7835911');
  });

  it('a policy resolve grupo acabado pelo inventário quando não há variante Hub', () => {
    expect(policy).toContain('buyReadyGroupsFromInventory');
    expect(policy).toContain("origem_padrao !== 'sempre_sku_acabado'");
    expect(policy).toContain('if (!measureId)');
  });

  it('não acusa falta de origem antes de escolher a medida', () => {
    expect(sourceEditor).toContain('!!line.measure_id && policy.loaded');
    expect(sourceEditor).toContain('Selecione a família e a medida para ver a origem.');
  });
});
