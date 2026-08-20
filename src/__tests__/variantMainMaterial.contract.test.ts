import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const CASCADE_SQL = read('supabase/migrations/20261027120000_variant-main-material-cascade.sql');
const DROP_INSOLE_SQL = read('supabase/migrations/20261027120800_drop-variant-drives-insole.sql');
const itemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');
const materialVariantColorGroup = read('src/lib/materialVariantColorGroup.ts');
const labelUtils = read('src/lib/labelUtils.ts');
const orderConsumption = read('src/lib/orderConsumption.ts');
const bomConsumption = read('src/lib/bomConsumption.ts');

/**
 * O `main_material_group_id` é o campo PRIMÁRIO do diálogo de variante: variante
 * nova costuma ter SÓ ele preenchido, sem nenhum pino por slot. Todo consumidor
 * que resolve material a partir da variante precisa enxergá-lo — senão a
 * variante "não existe" pra aquele caminho e ele cai no material da FICHA, em
 * silêncio. Foi assim que o EC23 vendeu NAPA SOFT e a produção cortou SUDANI.
 */
describe('material principal da variante — todo consumidor enxerga', () => {
  it('os 3 resolvers de material caem no material principal quando o slot não tem pino', () => {
    for (const fn of ['resolve_upper_material_for_variant', 'resolve_lining_material_for_variant']) {
      const body = CASCADE_SQL.split(`CREATE OR REPLACE FUNCTION public.${fn}`)[1]?.split('$function$;')[0];
      expect(body, `${fn} deve existir na migration`).toBeTruthy();
      expect(body, `${fn} deve ler main_material_group_id`).toContain('main_material_group_id');
      expect(body, `${fn} deve carimbar a origem variant_main`).toContain('variant_main');
    }
  });

  it('a cascata é travada por slot na ficha (protege material de identidade)', () => {
    expect(CASCADE_SQL).toContain('variant_drives_upper');
    expect(CASCADE_SQL).toContain('variant_drives_lining');
    // A trava entra na condição do fallback, não só na leitura.
    expect(CASCADE_SQL).toMatch(/IF v_drives AND v_main IS NOT NULL THEN/);
  });

  it('o caminho variant_group/variant_main preserva color_mismatch', () => {
    // Carimbar por cima do matched_by engoliria a cor não cadastrada, e o
    // hybrid_debit deixaria de PULAR a linha — debitaria a cor errada.
    const ocorrencias = CASCADE_SQL.match(/CASE WHEN r\.matched_by = 'color_mismatch'/g) || [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(6);
  });

  it('a PALMILHA não cascateia o material principal (slot é a PLACA, principal é napa)', () => {
    const body = DROP_INSOLE_SQL.split('CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant')[1]
      ?.split('$function$;')[0];
    expect(body).toBeTruthy();
    expect(body).not.toContain('main_material_group_id');
    expect(DROP_INSOLE_SQL).toContain('DROP COLUMN IF EXISTS variant_drives_insole');
  });

  it('o motor de consumo e a Lista de Separação leem o material principal', () => {
    for (const [nome, src] of [['orderConsumption', orderConsumption], ['bomConsumption', bomConsumption]] as const) {
      expect(src, `${nome} deve buscar a coluna`).toContain('main_material_group_id');
      expect(src, `${nome} deve respeitar a trava da ficha`).toContain('variant_drives_upper');
    }
    // E não pode ter sobrado a flag removida.
    expect(orderConsumption).not.toContain('variant_drives_insole');
    expect(bomConsumption).not.toContain('variant_drives_insole');
  });

  it('o PV oferece as cores do material principal, não as do material da ficha', () => {
    expect(itemForm, 'o form precisa buscar as travas pra espelhar a cascata')
      .toContain('variant_drives_upper');
    expect(itemForm).toContain('resolveMaterialVariantColorGroup');
    // A resolução foi centralizada: o material principal escolhe UM grupo e o
    // formulário lista somente os produtos ativos desse grupo exato.
    expect(materialVariantColorGroup).toContain('variant.main_material_group_id');
    expect(materialVariantColorGroup).toContain('activeProductColorsForGroup');
  });

  it('a etiqueta resolve o MATERIAL pelo material principal', () => {
    expect(labelUtils).toContain('main_material_group_id');
    // Precisa entrar nos 3 pontos: select, coleta de ids e montagem dos nomes —
    // faltando qualquer um, a variante é descartada e a etiqueta imprime a ficha.
    const usos = labelUtils.match(/main_material_group_id/g) || [];
    expect(usos.length).toBeGreaterThanOrEqual(3);
  });
});
