import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Recebimento parcial. A migration 47400 é a autoridade viva do portão,
 * do nascimento da OP e do teto da Montagem.
 */
const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101047400_atelier_recebimento_parcial.sql'),
  'utf8',
);

describe('recebimento parcial do Ateliê', () => {
  it('guarda o histórico e recusa soma acima dos pares', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.atelier_job_receipts');
    expect(SQL).toContain('ENABLE ROW LEVEL SECURITY');
    expect(SQL).toContain('REVOKE ALL ON TABLE public.atelier_job_receipts FROM PUBLIC, anon, authenticated');
    expect(SQL).toContain('partially_received');
    expect(SQL).toContain('partially_done');
    expect(SQL).toContain('Excede o job');
    expect(SQL).toContain('register_atelier_job_receipt');
  });

  it('estorno exige motivo e não fura o que a produção já apontou', () => {
    expect(SQL).toContain('reverse_atelier_job_receipt');
    expect(SQL).toContain('Informe o motivo do estorno');
    expect(SQL).toContain('atelier_downstream_consumed');
    expect(SQL).toContain('A produção já apontou');
  });

  it('jobs já conferidos nascem como 100% e a OP usa o saldo, não o total', () => {
    expect(SQL).toContain("pipeline_status IN ('received_at_factory', 'done')");
    expect(SQL).toContain('Backfill: conferido integralmente');
    expect(SQL).toContain('NEW.quantity_processed := LEAST(COALESCE(NEW.quantity_total, v_received), v_received)');
    expect(SQL).toContain('atelier_sync_stage_from_job');
  });

  it('Em Produção libera com saldo e a Montagem não passa dele', () => {
    expect(SQL).toContain('v_received <= 0');
    expect(SQL).toContain('ainda sem recebimento');
    expect(SQL).toContain("'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição'");
    expect(SQL).toContain('não pode passar desse saldo');
    expect(SQL).toContain('trg_zz_z_atelier_cap_downstream');
    expect(SQL).toContain('received_pairs');
  });
});
