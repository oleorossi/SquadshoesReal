import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atelierProductionHoldBlocksStatus } from '@/lib/atelierProductionHold';

/**
 * Cabedal complexo pode aprovar e não pode entrar em Em Produção sem retorno.
 *
 * A 47100 adiou a OP nos dois alvos do mesmo atomic (Aprovado e Em Produção).
 * Esta migration separa os dois. Aponta para o arquivo que define o
 * comportamento AGORA.
 */

const MIG = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101047200_em_producao_espera_retorno_atelie.sql',
  ),
  'utf8',
);

const DEFER = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101047100_atelier_deferral_nao_bloqueia_aprovacao.sql',
  ),
  'utf8',
);

const RELEASE = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101042500_atelier_interno_prestador_kit.sql',
  ),
  'utf8',
);

function semComentarios(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !/^\s*--/.test(line))
    .join('\n');
}

const CODE = semComentarios(MIG);

function entre(sql: string, inicio: string, fim: string): string {
  const from = sql.indexOf(inicio);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = sql.indexOf(fim, from + inicio.length);
  expect(to).toBeGreaterThan(from);
  return sql.slice(from, to);
}

describe('Em Produção espera o retorno do Ateliê', () => {
  it('aprovar com Ateliê pendente passa', () => {
    expect(atelierProductionHoldBlocksStatus('Aprovado', true)).toBe(false);
    const trigger = entre(
      CODE,
      'FUNCTION public.tg_zz_block_em_producao_sem_retorno_atelie()',
      'COMMENT ON FUNCTION public.tg_zz_block_em_producao_sem_retorno_atelie()',
    );
    expect(trigger).toContain("NEW.status = 'Em Produção'");
    expect(trigger).toContain("OLD.status IS DISTINCT FROM 'Em Produção'");
    expect(trigger).not.toContain("'Aprovado'");
    expect(CODE).toContain(
      "IF v_target = 'Em Produção' AND v_so.status IS DISTINCT FROM 'Em Produção' THEN",
    );
    // O deferral da aprovação permanece na migration anterior, intacto.
    expect(DEFER).toMatch(/factory_gate_reason_is_atelier_deferral[\s\S]*?CONTINUE;/);
    expect(CODE).not.toContain('CONTINUE');
  });

  it('Em Produção com Ateliê pendente é bloqueado e nomeia item e job', () => {
    expect(atelierProductionHoldBlocksStatus('Em Produção', true)).toBe(true);
    expect(CODE).toContain('assert_sale_order_atelier_returned_for_production');
    expect(CODE).toMatch(/IF v_msg IS NOT NULL THEN\s+RAISE EXCEPTION '%', v_msg/);
    expect(CODE).toContain(
      'Não é possível colocar o pedido em Em Produção: o cabedal complexo ainda não voltou para a fábrica.',
    );
    expect(CODE).toContain('Jobs pendentes:');
    expect(CODE).toContain('factory_gate_is_atelier_pipeline_deferral(soi.id)');
    expect(CODE).toContain('atelier_item_block_reason(soi.id)');
    expect(CODE).toContain('j.id');
    expect(CODE).toContain('BEFORE UPDATE OF status ON public.sale_orders');
    expect(CODE).toContain('list_sale_order_atelier_production_blocks');
    const page = readFileSync(
      resolve(__dirname, '../pages/SaleOrders.tsx'),
      'utf8',
    );
    expect(page).toContain('SaleOrderAtelierProductionHoldBadge');
    expect(page).toContain('useSaleOrderAtelierProductionHolds');
  });

  it('Em Produção depois do retorno passa', () => {
    expect(atelierProductionHoldBlocksStatus('Em Produção', false)).toBe(false);
    // Sem deferral a lista sai vazia, a mensagem é NULL e o RAISE não corre.
    expect(CODE).toMatch(/WHEN count\(\*\) = 0 THEN NULL::text/);
    expect(CODE).toContain('AND gate.reason IS NOT NULL');
    const gate = RELEASE.slice(RELEASE.indexOf('FUNCTION public.atelier_item_block_reason'));
    expect(gate).toMatch(/v_mode = 'internal'[\s\S]*?v_status IS DISTINCT FROM 'done'/);
    expect(gate).toMatch(/v_status IS DISTINCT FROM 'received_at_factory'/);
    // O filtro de job pendente usa os mesmos dois status de liberação.
    expect(CODE).toContain("j.execution_mode = 'internal' AND j.pipeline_status = 'done'");
    expect(CODE).toContain("j.pipeline_status = 'received_at_factory'");
    expect(MIG).toContain('promote_sale_order_item cria a OP');
  });

  it('não mexe em dado de produção nem reabre perda de corte', () => {
    expect(CODE).not.toMatch(/\bUPDATE\s+public\.sale_orders\b/i);
    expect(CODE).not.toMatch(/\bINSERT\s+INTO\s+public\.(sale_orders|sale_order_items|cabedal_prep_jobs)\b/i);
    expect(CODE).not.toMatch(/waste_pct|consumption_loss_pct/);
  });
});
