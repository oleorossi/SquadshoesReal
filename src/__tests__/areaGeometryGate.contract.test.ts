import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Gate de geometria de área + conversão placa no motor SQL.
 * Fonte viva: migrations 20270101043300 / 20270101043400.
 */
const MIG_BACKFILL = 'supabase/migrations/20270101043300_area-geometry-gate-and-plate-conversion.sql';
const MIG_TRIGGERS = 'supabase/migrations/20270101043400_area-geometry-conversion-and-triggers.sql';

describe('area geometry gate — migration contract', () => {
  const backfill = readFileSync(MIG_BACKFILL, 'utf8');
  const triggers = readFileSync(MIG_TRIGGERS, 'utf8');

  it('backfill PL01 + list_area_geometry_gaps', () => {
    expect(backfill).toMatch(/list_area_geometry_gaps/);
    expect(backfill).toMatch(/PLACA 1\.0 EVA|caa8afb2/i);
  });

  it('get_material_conversion_info: placa = W×L; dm² = 1', () => {
    expect(triggers).toMatch(/get_material_conversion_info/);
    expect(triggers).toMatch(/v_prod_unit IN \('placa', 'placas'\)/);
    expect(triggers).toMatch(/v_plate_dm2 := \(v_w_mm \* v_l_mm\) \/ 10000/);
    expect(triggers).toMatch(/dm2_per_unit := 1/);
    expect(triggers).toMatch(/dm2_per_unit := 100/);
    expect(triggers).toMatch(/dm2_per_unit := 0\.01/);
  });

  it('triggers/RPC de gate apontam pro grupo', () => {
    expect(triggers).toMatch(/tg_require_area_geometry_for_area_unit|require_area_geometry/);
    expect(triggers).toMatch(/update_material_group_dimensions|tg_group_dims/);
    expect(triggers).toMatch(/grupo de estoque|Configure no grupo/i);
  });
});

describe('Lista Separação não usa calculateBomForOrders como motor', () => {
  it('PickingListPage chama calculatePickingListFromCanonical', () => {
    const page = readFileSync('src/pages/PickingListPage.tsx', 'utf8');
    expect(page).toMatch(/calculatePickingListFromCanonical/);
    expect(page).not.toMatch(/calculateBomForOrders\s*\(/);
  });

  it('pickingListCanonical materializa o relatório SQL canônico', () => {
    const src = readFileSync('src/lib/pickingListCanonical.ts', 'utf8');
    expect(src).toMatch(/fetchCanonicalConsumptionReport/);
    expect(src).not.toMatch(/import\s+\{[^}]*calculateBomForOrders/);
    expect(src).not.toMatch(/calculateBomForOrders\s*\(/);
  });
});

describe('produção não importa orderConsumption como motor', () => {
  it('PrintWorkSheetsPage e PurchasePlanningWizard / weekly usam helpers soltos', () => {
    const print = readFileSync('src/pages/../components/production/PrintWorkSheetsPage.tsx', 'utf8');
    const wizard = readFileSync('src/components/financial/PurchasePlanningWizard.tsx', 'utf8');
    const weekly = readFileSync('src/lib/weeklyPurchasingPlan.ts', 'utf8');
    expect(print).not.toMatch(/from ['"]@\/lib\/orderConsumption['"]/);
    expect(wizard).not.toMatch(/from ['"]@\/lib\/orderConsumption['"]/);
    expect(weekly).not.toMatch(/from ['"].*orderConsumption['"]/);
    expect(weekly).toMatch(/from ['"]\.\/bomClassify['"]/);
  });
});
