/**
 * Contrato: COMPONENTES exigem product_id (débito exato).
 * Reverte Q11-a; migration 20270101044800
 * (renomeada de 20270101044300 — colisão com turno-parcial-duas-batidas).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mig = readFileSync(
  'supabase/migrations/20270101044800_direct-components-sku-obrigatorio.sql',
  'utf8',
);
const sheets = readFileSync('src/pages/TechnicalSheets.tsx', 'utf8');
const order = readFileSync('src/lib/orderConsumption.ts', 'utf8');
const bom = readFileSync('src/lib/bomConsumption.ts', 'utf8');
const helpers = readFileSync('src/lib/directComponentGroup.ts', 'utf8');
const atelier = readFileSync('src/components/technical-sheets/AtelierReferencePanel.tsx', 'utf8');

describe('directComponentsSkuObrigatorio.contract', () => {
  it('migration exige RAISE no trigger e patch by_grade', () => {
    expect(mig).toContain('tg_strip_invalid_direct_components');
    expect(mig).toContain('RAISE EXCEPTION');
    expect(mig).toContain('precisa do item (SKU) final');
    expect(mig).toContain('direct-components-sku-obrigatorio');
    expect(mig).toContain('atelier_lot_kit_product_ids');
  });

  it('Engineering usa DirectComponentSelect e valida save', () => {
    expect(sheets).toContain('DirectComponentSelect');
    expect(sheets).toContain('validateDirectComponentsForSave');
    expect(sheets).not.toContain('DirectComponentGroupSelect');
    expect(sheets).not.toContain('ComponentColorMappingPanel');
    expect(sheets).toContain('component_colors_enabled = false');
  });

  it('helpers exigem UUID de product_id', () => {
    expect(helpers).toContain('validateDirectComponentsForSave');
    expect(helpers).toContain('isValidDirectComponentProductId');
    expect(helpers).toContain('débito exato');
  });

  it('motores usam só pin — sem swap por cor / component_colors', () => {
    expect(order).toContain('SKU pinado');
    expect(order).toContain('sem item (SKU) pinado');
    expect(order).not.toMatch(/Cadastro por GRUPO \(Q11-a\)/);
    expect(bom).toContain('SKU pinado obrigatório');
    expect(bom).not.toMatch(/componentColorMap\.get/);
  });

  it('Ateliê kit marca product_id, não só grupo', () => {
    expect(atelier).toContain('kitProductIds');
    expect(atelier).toContain('toggleKitProduct');
    expect(atelier).toContain('itens (SKU) de COMPONENTES');
  });
});
