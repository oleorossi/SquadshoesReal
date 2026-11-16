import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Deadlock Ateliê × aprovação (PV-00249).
 *
 * Job do Ateliê só nasce após Aprovado; o factory gate + pré-voo + atomic
 * exigiam job antes do confirm → "sem job" eterno. Ateliê incompleto tem que
 * ADIAR a OP, não recusar a aprovação.
 *
 * ⚠ Aponta para a migration que define o comportamento AGORA.
 */

const MIG = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101047100_atelier_deferral_nao_bloqueia_aprovacao.sql',
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

describe('Ateliê deferral não bloqueia aprovação (contrato)', () => {
  it('expõe predicados de deferral de pipeline', () => {
    expect(MIG).toContain('factory_gate_is_atelier_pipeline_deferral');
    expect(MIG).toContain('factory_gate_reason_is_atelier_deferral');
    expect(MIG).toContain('atelier_item_block_reason(p_item_id)');
    expect(CODE).toMatch(/Ateliê —%/);
    expect(CODE).toMatch(/cabedal complexo%/);
  });

  it('selo da lista não mostra Ateliê incompleto como "Não aprova"', () => {
    const list = CODE.slice(CODE.indexOf('list_sale_order_factory_gate_blocks'));
    expect(list).toContain('factory_gate_is_atelier_pipeline_deferral(soi.id)');
    expect(list).toContain('sale_order_item_corte_material_gate_block_reason');
    expect(list).toMatch(/falta %/);
  });

  it('pré-voo do enqueue ignora deferral Ateliê e ainda checa cadastro de corte', () => {
    expect(CODE).toContain('factory_gate_is_atelier_pipeline_deferral(v_item.item_id)');
    expect(CODE).toContain('sale_order_item_corte_material_gate_block_reason(v_item.item_id)');
  });

  it('atomic CONTINUEa skip Ateliê em vez de RAISE; completeza exclui deferidos sem OP', () => {
    expect(CODE).toContain('factory_gate_reason_is_atelier_deferral(v_res ->> \'reason\')');
    expect(CODE).toMatch(/IF public\.factory_gate_reason_is_atelier_deferral[\s\S]*?CONTINUE;/);
    expect(CODE).toContain('factory_gate_is_atelier_pipeline_deferral(soi.id)');
    expect(CODE).toMatch(/NOT EXISTS \([\s\S]*?FROM public\.orders o/);
  });

  it('não reabre perda de corte nem exige job no confirm', () => {
    expect(CODE).not.toMatch(/waste_pct|consumption_loss_pct/);
    expect(CODE).not.toContain('rode Reaplicar no Ateliê');
  });
});
