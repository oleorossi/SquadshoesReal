import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Spec: specs/integracao-estoque-pv-compras.md — etapa 1
// (empenho parcial + falta por PV/numeração + quitação na entrada + defeitos 1 e 2).
const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20270101035100_empenho_parcial_falta_pv.sql'),
  'utf8',
);

function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `função ${name} ausente`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('\n$$;', start);
  return sql.slice(start, end);
}

describe('empenho parcial + falta do PV (contract)', () => {
  it('falta é coluna própria, nunca negativa, e não entra em reserved_stock', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS quantity_short numeric NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/CHECK \(quantity_short >= 0\)/);
    // reserved_stock continua = reserved − consumed: a falta não é somada lá.
    expect(sql).not.toMatch(/FUNCTION public\.sync_product_reserved_stock/);
  });

  it('empenho parcial: empenha LEAST(necessidade, físico − empenhado dos outros)', () => {
    const body = fnBody('allocate_reservation_partial');
    expect(body).toMatch(/v_give := LEAST\(v_want, GREATEST\(v_phys - v_others, 0\)\)/);
    expect(body).toMatch(/quantity_short = v_want - v_give/);
    expect(body).toMatch(/mr\.id <> p_reservation_id/);
  });

  it('solado: empenho balde a balde, com covered_grade/shortage_grade', () => {
    const body = fnBody('allocate_sole_grade_reservation');
    expect(body).toMatch(/effective_grade/);
    expect(body).toMatch(/'covered_grade', v_covered/);
    expect(body).toMatch(/'shortage_grade', v_shortage/);
    // balde conjugado é a própria chave do stock_grade — nunca dividido
    expect(body).not.toMatch(/split_part/);
  });

  it('realocação nunca cancela reserva: excesso vira falta, livre quita falta com registro', () => {
    const body = fnBody('reallocate_product_commitments');
    expect(body).toMatch(/quantity_short = quantity_short \+ v_cut/);
    expect(body).toMatch(/quantity_short = quantity_short - v_give/);
    expect(body).not.toMatch(/status = 'cancelled'/);
    expect(body).toMatch(/INSERT INTO public\.stock_inbound_allocations/);
    // Ateliê nunca é encolhido
    expect(body).toMatch(/NOT IN \('sole_grade', 'atelier_prep'\)/);
    // prioridade: encolhe a pior primeiro, quita a melhor primeiro
    expect(body).toMatch(/cover_priority\(mr\.sale_order_id, mr\.order_id\) DESC/);
    expect(body).toMatch(/cover_priority\(mr\.sale_order_id, mr\.order_id\) ASC/);
  });

  it('rebalance antigo vira alias da realocação (não cancela mais)', () => {
    const body = fnBody('rebalance_material_commitments_for_product');
    expect(body).toMatch(/reallocate_product_commitments\(p_product_id, NULL\)/);
  });

  it('entrada de estoque dispara a realocação com o id do movimento', () => {
    const body = fnBody('tg_cover_commitments_on_stock_in');
    expect(body).toMatch(/NEW\.movement_type = 'in'/);
    expect(body).toMatch(/reallocate_product_commitments\(NEW\.product_id, NEW\.id\)/);
  });

  it('aprovação do PV: commit zera a falta e passa pelo empenho parcial', () => {
    const body = fnBody('commit_sale_order_material_demand');
    expect(body).toMatch(/quantity_short = 0/);
    expect(body).toMatch(/allocate_reservation_partial\(v_existing\.id\)/);
    // consolidação de irmãs ANTES do empenho (senão contariam como "outros")
    expect(body.indexOf('consolidado em pv_commitment')).toBeLessThan(
      body.indexOf('allocate_reservation_partial(v_existing.id)'),
    );
  });

  it('injeções no corpo vivo falham alto se o marker sumir', () => {
    expect(sql).toMatch(/hybrid_debit: marker de adoção não encontrado/);
    expect(sql).toMatch(/quantity_reserved = mr\.quantity_reserved,/);
    expect(sql).toMatch(/debit_sole_stock_by_grade: marker do caminho soft não encontrado/);
    expect(sql).toMatch(/PERFORM public\.allocate_sole_grade_reservation\(v_res_id\)/);
    expect(sql).toMatch(/settle_open_reservations_for_order: marker não encontrado/);
    expect(sql).toMatch(/quantity_reserved = coalesce\(mr\.quantity_reserved, 0\) \+ mr\.quantity_short/);
  });

  it('defeito 1: posse do commitment vem de material_reservations.sale_order_id', () => {
    expect(sql).toMatch(/COALESCE\(mr\.sale_order_id, o\.sale_order_id\) IS DISTINCT FROM v_item\.sale_order_id/);
    expect(fnBody('compute_materials_per_pv')).toMatch(
      /coalesce\(mr\.sale_order_id,o\.sale_order_id\)=ANY\(p_pv_ids\)/,
    );
  });

  it('defeito 2: recompute no cálculo de compra, só para PV aprovado/em produção', () => {
    expect(sql).toMatch(/v_compute_version := v_order_version;\\n/);
    expect(sql).toMatch(/IF v_status IN \(''Aprovado'', ''Em Produção''\) THEN/);
    expect(sql).toMatch(/recompute_sale_order_material_commitments\(p_sale_order_id\)/);
  });

  it('backfill só toca linhas abertas gerenciadas (finalizados/cancelados intactos)', () => {
    const backfill = sql.slice(sql.indexOf('DO $backfill$'));
    expect(backfill).toMatch(/material_reservation_is_pv_managed\(mr\)/);
    expect(fnBody('material_reservation_is_pv_managed')).toMatch(
      /mr\.status IN \('reserved', 'partially_consumed'\)/,
    );
  });
});

describe('PV excluído/cancelado fora do motor de empenho (contract)', () => {
  const fix = readFileSync(
    join(process.cwd(), 'supabase/migrations/20270101035200_empenho_ignora_pv_excluido.sql'),
    'utf8',
  );

  it('predicado exclui PV com deleted_at ou status Cancelado (direto ou pela OP)', () => {
    expect(fix).toMatch(/so\.deleted_at IS NOT NULL OR so\.status = 'Cancelado'/);
    expect(fix).toMatch(/SELECT o\.sale_order_id FROM public\.orders o WHERE o\.id = mr\.order_id/);
  });

  it('só zera a falta — não cancela as reservas desses PVs (decisão do dono)', () => {
    expect(fix).toMatch(/SET quantity_short = 0/);
    expect(fix).not.toMatch(/status = 'cancelled'/);
  });
});
