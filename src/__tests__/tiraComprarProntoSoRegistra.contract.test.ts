/**
 * Spec `tira-comprar-pronto-so-registra.md` + mig `20270101045300`.
 *
 * Comprar pronto de tira de NAPA só registra napa · cor + metros — sem INSERT
 * em products (era o "Escritor legado de produto de tira congelado" do PV I701
 * GLOW METALIC CHAMPAGNE em 01/11/2026).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const MIG = resolve(
  ROOT,
  'supabase/migrations/20270101045300_tira-comprar-pronto-so-registra.sql',
);
const ORIGEM = resolve(ROOT, 'src/lib/strapPvOrigem.ts');
const FORM = resolve(ROOT, 'src/components/sale-orders/SaleOrderItemForm.tsx');
const PAGE = resolve(ROOT, 'src/pages/SaleOrderForm.tsx');

describe('tira Comprar pronto só registra (45300)', () => {
  const mig = readFileSync(MIG, 'utf8');
  const origem = readFileSync(ORIGEM, 'utf8');
  const form = readFileSync(FORM, 'utf8');
  const page = readFileSync(PAGE, 'utf8');

  it('migration patcha writer, alinhamento e guarda com o marcador 45300', () => {
    expect(mig).toContain('strap_comprar_pronto_so_registra_20270101045300');
    expect(mig).toContain('prepare_sale_order_item_internal_straps');
    expect(mig).toContain('tg_validate_sale_order_item_strap_color_alignment');
    expect(mig).toContain('tg_version_and_guard_sale_order_item_strap_sourcing');
    expect(mig).toContain("'source_mode', 'buy_ready'");
    expect(mig).toContain("'finished_product_id', NULL");
    expect(mig).toContain("'strap_variant_id', NULL");
    expect(mig).toContain('gross_required_m');
    // O patch não escreve INSERT — só a guarda pós-fato cita a string.
    expect(mig).toContain("position('INSERT INTO public.products' IN v_def) > 0");
    expect(mig).toContain('ainda ha INSERT em products apos so-registra');
    // Substitui o RAISE de Hub da 45200.
    expect(mig).toContain('strap_pv_sku_acabado_exige_cadastro_hub_20270101045200');
  });

  it('tela libera Comprar pronto sem group_id e não coerces para Prestador', () => {
    expect(origem).toContain('tira-comprar-pronto-so-registra');
    expect(origem).toMatch(
      /export function strapLineAllowsBuyReadyOrigem[\s\S]*?return !!line;/,
    );
    expect(origem).not.toContain('export function coerceImpossibleBuyReadyStrapOrigem');
    expect(page).not.toContain('coerceImpossibleBuyReadyStrapOrigem');
    expect(form).not.toContain(
      'Nenhuma tira desta ficha tem grupo acabado cadastrado',
    );
  });
});
