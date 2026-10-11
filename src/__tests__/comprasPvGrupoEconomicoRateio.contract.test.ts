import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Spec: specs/integracao-estoque-pv-compras.md — etapa 2 (compra pela necessidade
// total, múltiplo, OC por grupo econômico, aviso em vez de bloqueio) + RPCs das telas.
const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20270101035700_compras_pv_grupo_economico_rateio.sql'),
  'utf8',
);

function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `função ${name} ausente`).toBeGreaterThanOrEqual(0);
  const end = sql.slice(start).search(/\n\$(function)?\$;/);
  expect(end, `fim da função ${name} ausente`).toBeGreaterThan(0);
  return sql.slice(start, start + end);
}

describe('compra automática do PV (contract)', () => {
  const proc = () => fnBody('process_sale_order_purchase_shortages');

  it('Q1/Q16: só compra item com falta, e compra a NECESSIDADE TOTAL (soma da grade ou needed_qty)', () => {
    const body = proc();
    expect(body).toMatch(/WHERE COALESCE\(need\.shortage, 0\) > 0/);
    expect(body).toMatch(/need\.needed_qty\s*\)\s*AS buy_qty/);
    // a quantidade da linha sai de buy_qty, não da falta
    expect(body).toMatch(/po_normalize_line\(\s*m\.material_id,\s*m\.buy_qty,/);
  });

  it('Q14: arredonda PARA CIMA pelo múltiplo de compra (produto, senão grupo)', () => {
    const body = proc();
    expect(body).toMatch(
      /COALESCE\(NULLIF\(p\.purchase_multiple, 0\), NULLIF\(pg\.purchase_multiple, 0\)\) AS purchase_multiple/,
    );
    expect(body).toMatch(/CEIL\(n\.out_qty \/ m\.purchase_multiple\) \* m\.purchase_multiple/);
  });

  it('só recalcula o empenho de PV aprovado/em produção', () => {
    expect(proc()).toMatch(/IF v_status IN \('Aprovado', 'Em Produção'\) THEN/);
  });

  it('Q10: PVs do mesmo grupo econômico dividem a OC do fornecedor', () => {
    expect(fnBody('sale_order_purchase_scope_key')).toMatch(/'eg:' \|\| c\.economic_group_id::text/);
    const body = proc();
    expect(body).toMatch(/v_idem := 'auto_pv:outbox:' \|\| v_supplier_key \|\| ':' \|\| v_scope;/);
    // vários PVs escrevem na mesma OC: serializa
    expect(body).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_idem, 0\)\)/);
    // uma OC passa a aceitar efeitos de vários PVs
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS sale_order_purchase_shortage_effects_purchase_order_id_key/);
  });

  it('OC compartilhada é remontada pela soma das contribuições e volta a aguardar aprovação', () => {
    const rebuild = fnBody('rebuild_pv_purchase_order_from_effects');
    expect(rebuild).toMatch(/e\.effect_status = 'editable'/);
    expect(rebuild).toMatch(/replace_pv_purchase_order_items_from_effects\(p_purchase_order_id\)/);
    expect(rebuild).toMatch(/approval_status = 'pendente_aprovacao'/);
    expect(rebuild).toMatch(/source_pv_ids = v_pvs/);
  });

  it('Q13: PV sem falta/cancelado sai da OC; OC sem nenhum PV é cancelada; OC aprovada vira alerta', () => {
    const rebuild = fnBody('rebuild_pv_purchase_order_from_effects');
    expect(rebuild).toMatch(
      /IF cardinality\(v_pvs\) = 0 THEN\s*PERFORM public\.close_pv_purchase_order_without_contributors/,
    );
    expect(fnBody('close_pv_purchase_order_without_contributors')).toMatch(/status = 'cancelled'/);
    const body = proc();
    expect(body).toMatch(/effect_status = 'no_shortage'/);
    expect(body).toMatch(/obsolete_purchase_order_not_system_editable/);
    expect(body).toMatch(/oc_obsoleta_exige_reconciliacao_manual/);
  });
});

describe('Q12: falta de material avisa, não bloqueia (contract)', () => {
  it('gate de fábrica ignora só o motivo "falta …" do corte', () => {
    const gate = fnBody('sale_order_item_factory_gate_block_reason');
    expect(gate).toMatch(/IF v_reason LIKE 'falta %' THEN\s*RETURN NULL;/);
    // cadastro incompleto continua bloqueando
    expect(gate).toMatch(/RETURN 'item sem referencia'/);
    expect(gate).toMatch(/atelier_item_block_reason\(p_item_id\)/);
  });
});

describe('falta por PV para os avisos (contract)', () => {
  it('uma linha por material: várias OPs/reservas do mesmo material são somadas', () => {
    const body = fnBody('list_sale_order_material_shortages');
    expect(body).toMatch(/GROUP BY r\.so_id, r\.product_id\b/);
    expect(body).toMatch(/sum\(r\.quantity_short\) AS quantity_short/);
    // grade do solado somada balde a balde, não por reserva
    expect(body).toMatch(/GROUP BY r\.so_id, r\.product_id, e\.key/);
  });
});

describe('rateio da entrada editável (contract)', () => {
  const edit = () => fnBody('apply_inbound_allocation_edit');

  it('exige usuário aprovado e trava o produto antes de mexer', () => {
    const body = edit();
    expect(body).toMatch(/IF NOT public\.is_approved_user\(\) THEN/);
    expect(body.indexOf('lock_product_for_allocation(p_product_id)')).toBeLessThan(
      body.indexOf('DELETE FROM public.stock_inbound_allocations'),
    );
  });

  it('nunca rateia mais que o estoque livre, e reserva tem que ser do produto', () => {
    const body = edit();
    expect(body).toMatch(/Reserva do rateio não pertence ao produto/);
    expect(body).toMatch(/> v_free \+ 0\.000001 THEN\s*RAISE EXCEPTION 'Rateio maior que o estoque livre/);
  });

  it('rateio de reserva que já saiu do motor fica no rastreio (não é apagado)', () => {
    const body = edit();
    expect(body).toMatch(
      /CONTINUE WHEN NOT FOUND OR NOT public\.material_reservation_is_pv_managed\(v_res\);\s*PERFORM public\.move_reservation_short_to_covered[^;]*;\s*DELETE FROM public\.stock_inbound_allocations/,
    );
  });

  it('linha editada fica na entrada de onde veio (senão, na mais recente da janela)', () => {
    const body = edit();
    expect(body).toMatch(/ORDER BY a\.created_at DESC LIMIT 1/);
    expect(body).toMatch(/sm\.id = NULLIF\(v_item ->> 'stock_movement_id', ''\)::uuid\s*AND sm\.product_id = p_product_id/);
    expect(body).toMatch(/COALESCE\(v_item_movement, v_movement\)/);
  });

  it('mover falta→empenho não deixa nenhum dos dois negativo', () => {
    const move = fnBody('move_reservation_short_to_covered');
    expect(move).toMatch(/Rateio maior que a falta do PV na numeração/);
    expect(move).toMatch(/Rateio maior que a falta do PV'/);
  });
});

describe('permissões das funções novas (contract)', () => {
  const RPCS = [
    'list_sale_order_material_shortages(uuid[])',
    'product_supply_summary(uuid[])',
    'list_inbound_allocations(uuid[], timestamptz)',
    'list_open_shortages_for_products(uuid[])',
    'apply_inbound_allocation_edit(uuid, timestamptz, jsonb)',
    'list_group_stock_tracking(uuid, integer)',
  ];
  const INTERNOS = [
    'allocate_reservation_partial(uuid)',
    'allocate_sole_grade_reservation(uuid)',
    'reallocate_product_commitments(uuid, uuid)',
    'move_reservation_short_to_covered(uuid, text, numeric)',
    'rebuild_pv_purchase_order_from_effects(uuid)',
    'close_pv_purchase_order_without_contributors(uuid)',
    'replace_pv_purchase_order_items_from_effects(uuid)',
    'lock_product_for_allocation(uuid)',
    'sale_order_purchase_scope_key(uuid)',
    'pv_purchase_order_last_applied_digest(uuid)',
    'pv_purchase_order_is_system_editable(uuid, boolean)',
  ];
  const esc = (s: string) => s.replace(/[()[\]]/g, (c) => `\\${c}`);

  it('RPCs das telas: revoga de PUBLIC (não só de anon) e libera só authenticated', () => {
    for (const fn of RPCS) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc(fn)} FROM PUBLIC, anon;`));
      expect(sql, fn).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc(fn)} TO authenticated, service_role;`),
      );
    }
  });

  it('RPCs de leitura só devolvem dado para usuário aprovado', () => {
    for (const name of [
      'list_sale_order_material_shortages',
      'product_supply_summary',
      'list_inbound_allocations',
      'list_open_shortages_for_products',
      'list_group_stock_tracking',
    ]) {
      expect(fnBody(name), name).toMatch(/public\.is_approved_user\(\)/);
    }
  });

  it('auxiliares internos não são chamáveis pelo app', () => {
    for (const fn of INTERNOS) {
      expect(sql, fn).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc(fn)} FROM PUBLIC, anon, authenticated;`),
      );
      expect(sql, fn).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc(fn)} TO authenticated`));
    }
  });
});
