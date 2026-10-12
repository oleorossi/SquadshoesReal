/**
 * Guarda de `sale_order_items.strap_sourcing` × writer do PV.
 *
 * Bug (12/10/2026): trocar a ORIGEM de uma tira `reference_base` para "Comprar
 * pronto" abortava o PV INTEIRO com
 *   "O pedido NÃO foi salvo. Origem/variante persistida invalida para linha <uuid>"
 *
 * O writer `prepare_sale_order_item_internal_straps` (marcador
 * strap_pv_sku_acabado_sem_variante_20270101031900) congela de propósito
 * `source_mode='buy_ready'` com `strap_variant_id = NULL` e
 * `finished_product_id = <SKU acabado>`. A guarda
 * `tg_version_and_guard_sale_order_item_strap_sourcing` (03200) exigia
 * `strap_variant_id` nos DOIS modos — recusava exatamente o que o writer
 * produzia. O lado TS já estava no contrato novo, por isso a tela liberava o
 * botão e só o banco recusava.
 *
 * ⚠ Este arquivo aponta para a migration que define a guarda AGORA (39600).
 * Contrato lendo arquivo superado passa verde enquanto a função viva perde uma
 * guarda — a prova do corpo VIVO está nas asserções pós-EXECUTE da própria
 * 39600, que falham alto na aplicação.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isCompleteStrapSourcingSelection,
  type StrapSourcingSelection,
} from '@/lib/strapSourcing';

const ROOT = resolve(__dirname, '../..');
const GUARD_MIGRATION =
  'supabase/migrations/20270101039600_guarda-strap-sourcing-aceita-sku-acabado.sql';
const migration = readFileSync(resolve(ROOT, GUARD_MIGRATION), 'utf8');

const COLOR = '11111111-1111-4111-8111-111111111111';
const VARIANT = '22222222-2222-4222-8222-222222222222';
const SKU = '33333333-3333-4333-8333-333333333333';

describe('Guarda de strap_sourcing — buy_ready identifica por SKU acabado', () => {
  it('casa com o texto exato da guarda 03200 antes de substituir', () => {
    // Se o corpo vivo mudar, a migration tem que FALHAR na aplicação em vez de
    // substituir nada — por isso ela confere hits=1 dos dois trechos.
    expect(migration).toContain(
      "OR nullif(v_value->>'strap_variant_id','') IS NULL THEN\n"
      + "      RAISE EXCEPTION 'Origem/variante persistida invalida para linha %',v_key;",
    );
    expect(migration).toContain("hits=%); corpo mudou, revise 39600");
    expect(migration).toContain("Comparacao de compromisso da guarda (03200) nao encontrada");
  });

  it('aceita buy_ready com finished_product_id e sem variante Hub', () => {
    expect(migration).toContain(
      "OR (v_value->>'source_mode'='buy_ready'\n"
      + "           AND nullif(v_value->>'strap_variant_id','') IS NULL\n"
      + "           AND nullif(v_value->>'finished_product_id','') IS NULL) THEN",
    );
  });

  it('NÃO relaxa internal: sem variante do Hub continua sendo dado invalido', () => {
    // Só o Hub resolve receita, rendimento e napa-base. internal sem variante
    // não tem como virar demanda de produção — relaxar aqui criaria linha morta.
    expect(migration).toContain(
      "OR (v_value->>'source_mode'='internal'\n"
      + "           AND nullif(v_value->>'strap_variant_id','') IS NULL)",
    );
    expect(migration).toContain('Guarda relaxou internal sem variante; revise 39600');
  });

  it('valida o UUID de cada campo, mas só quando ele está presente', () => {
    // O PERFORM ::uuid continua valendo para os dois campos; o que mudou é que
    // ele deixa de rodar sobre NULL (que era o estouro do caminho novo).
    expect(migration).toContain(
      "IF nullif(v_value->>'strap_variant_id','') IS NOT NULL THEN",
    );
    expect(migration).toContain(
      "IF nullif(v_value->>'finished_product_id','') IS NOT NULL THEN",
    );
    expect(migration).toContain("'UUID do SKU acabado invalido para linha %',v_key");
    expect(migration).toContain("'UUID da variante invalido para linha %',v_key");
  });

  it('a troca de origem apos compromisso compara TAMBEM o finished_product_id', () => {
    // Na identidade por SKU acabado a variante é NULL dos dois lados; sem esta
    // comparação, trocar o SKU de uma tira já comprometida (PO enviada, lote
    // iniciado) escaparia da guarda "Origem comprometida".
    expect(migration).toContain(
      "OR nullif(OLD.strap_sourcing->d.technical_strap_line_id::text->>'finished_product_id','')::uuid\n"
      + "          IS DISTINCT FROM nullif(NEW.strap_sourcing->d.technical_strap_line_id::text->>'finished_product_id','')::uuid",
    );
  });
});

describe('TS e SQL contam a mesma identidade de strap_sourcing', () => {
  const sel = (over: Partial<StrapSourcingSelection>): StrapSourcingSelection => ({
    source_mode: 'buy_ready',
    color_id: COLOR,
    ...over,
  });

  it('buy_ready: variante OU SKU acabado completam a identidade', () => {
    expect(isCompleteStrapSourcingSelection(sel({ strap_variant_id: VARIANT }))).toBe(true);
    expect(isCompleteStrapSourcingSelection(
      sel({ strap_variant_id: null, finished_product_id: SKU }),
    )).toBe(true);
  });

  it('buy_ready sem nenhum dos dois é incompleto nos dois lados', () => {
    expect(isCompleteStrapSourcingSelection(
      sel({ strap_variant_id: null, finished_product_id: null }),
    )).toBe(false);
  });

  it('internal exige a variante — SKU acabado não substitui', () => {
    expect(isCompleteStrapSourcingSelection(
      sel({ source_mode: 'internal', strap_variant_id: null, finished_product_id: SKU }),
    )).toBe(false);
    expect(isCompleteStrapSourcingSelection(
      sel({ source_mode: 'internal', strap_variant_id: VARIANT }),
    )).toBe(true);
  });

  it('cor canonica continua obrigatoria nos dois modos', () => {
    expect(isCompleteStrapSourcingSelection(
      sel({ color_id: null, finished_product_id: SKU }),
    )).toBe(false);
  });
});
