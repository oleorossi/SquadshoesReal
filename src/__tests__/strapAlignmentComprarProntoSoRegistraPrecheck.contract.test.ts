/**
 * Guarda de ALINHAMENTO × writer so-registra (45300).
 *
 * Bug (15/11/2026): Comprar pronto de tira de napa (TIRA CHATA 20 mm ·
 * GLOW METALIC · CHAMPAGNE) abortava o PV com
 *   "O pedido NÃO foi salvo. Tira sem cor/variante canonica congelada no PV"
 *
 * A 45300 fez o writer congelar buy_ready sem variante e sem SKU, e patchou
 * o ramo sku_acabado. A pré-checagem genérica da 40200 ainda exigia
 * variante OU finished_product_id — mutuamente impossível com o writer.
 *
 * ⚠ Este arquivo aponta para a migration que define a pré-checagem AGORA
 * (46800). Contrato lendo arquivo superado passa verde enquanto a função
 * viva perde uma guarda.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isCompleteStrapSourcingSelection } from '@/lib/strapSourcing';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FILE = '20270101046800_alinhamento-comprar-pronto-so-registra-precheck.sql';
const MARKER = 'strap_alinhamento_comprar_pronto_so_registra_precheck_20270101046800';
const migration = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

function latestMigrationMentioning(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let hit = '';
  for (const file of files) {
    if (readFileSync(resolve(MIGRATIONS, file), 'utf8').includes(needle)) hit = file;
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

const COLOR = '11111111-1111-4111-8111-111111111111';
const VARIANT = '22222222-2222-4222-8222-222222222222';
const SKU = '33333333-3333-4333-8333-333333333333';

describe('Alinhamento — Comprar pronto so-registra na pré-checagem (46800)', () => {
  it('é a migration canônica do marcador e patcha o corpo VIVO', () => {
    expect(latestMigrationMentioning(MARKER)).toBe(FILE);
    expect(migration).toContain('pg_get_functiondef');
    expect(migration).toContain(
      "'public.tg_validate_sale_order_item_strap_color_alignment()'",
    );
  });

  it('exige o ramo 45300 antes de afrouxar a pré-checagem', () => {
    expect(migration).toContain('strap_comprar_pronto_so_registra_20270101045300');
    expect(migration).toContain('aplique a 45300 antes da 46800');
  });

  it('casa com o texto exato da pré-checagem 40200 antes de substituir', () => {
    expect(migration).toContain(
      '       OR (v_source_variant_id IS NULL\n'
      + "           AND nullif(v_source ->> 'finished_product_id', '') IS NULL) THEN\n"
      + "      RAISE EXCEPTION 'Tira sem cor/variante canonica congelada no PV';",
    );
    expect(migration).toContain('hits=%); corpo mudou, revise 46800');
  });

  it('terceiro caminho: buy_ready só com cor completa a identidade', () => {
    expect(migration).toContain(
      '       OR (v_source_variant_id IS NULL\n'
      + "           AND nullif(v_source ->> 'finished_product_id', '') IS NULL\n"
      + "           AND v_source_mode IS DISTINCT FROM 'buy_ready') THEN",
    );
  });

  it('NÃO relaxa internal: sem variante continua barrado', () => {
    expect(migration).toContain('Pre-checagem relaxou internal sem variante; revise 46800');
    expect(migration).toContain("v_source_mode IS DISTINCT FROM 'buy_ready'");
  });

  it('cor canônica continua obrigatória', () => {
    expect(migration).toContain('Pre-checagem perdeu a exigencia de cor; revise 46800');
    expect(migration).toContain('IF v_line_color_id IS NULL\n');
    expect(migration).toContain(
      '       OR v_source_color_id IS DISTINCT FROM v_line_color_id\n',
    );
  });
});

describe('TS espelha a identidade so-registra de buy_ready', () => {
  it('buy_ready com só color_id é completo (napa so-registra)', () => {
    expect(isCompleteStrapSourcingSelection({
      source_mode: 'buy_ready',
      color_id: COLOR,
      strap_variant_id: null,
      finished_product_id: null,
    })).toBe(true);
  });

  it('buy_ready com SKU ou variante continua completo', () => {
    expect(isCompleteStrapSourcingSelection({
      source_mode: 'buy_ready',
      color_id: COLOR,
      strap_variant_id: VARIANT,
    })).toBe(true);
    expect(isCompleteStrapSourcingSelection({
      source_mode: 'buy_ready',
      color_id: COLOR,
      finished_product_id: SKU,
    })).toBe(true);
  });

  it('buy_ready sem cor continua incompleto; internal sem variante também', () => {
    expect(isCompleteStrapSourcingSelection({
      source_mode: 'buy_ready',
      color_id: null,
      finished_product_id: SKU,
    })).toBe(false);
    expect(isCompleteStrapSourcingSelection({
      source_mode: 'internal',
      color_id: COLOR,
      strap_variant_id: null,
      finished_product_id: SKU,
    })).toBe(false);
  });
});
