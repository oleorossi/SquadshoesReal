import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101000600_otimizar-ciclo-ordem-servico.sql'),
  'utf8',
);

describe('ciclo industrial de OS — contrato SQL', () => {
  it('centraliza a criação por OP e nunca recicla uma OS cancelada', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.create_op_service_order/);
    expect(SQL).toMatch(/normalize_service_order_status\(status\) <> 'Cancelado'/);
    expect(SQL).toMatch(/DROP INDEX IF EXISTS public\.uq_os_per_op_sector/);
    expect(SQL).toMatch(/SELECT public\.create_op_service_order/);
    expect(SQL).not.toMatch(/status = 'Pendente'[\s\S]{0,180}WHERE so\.id = v_existing\.id/);
  });

  it('obriga despacho rastreado e bloqueia saída sem tarifa', () => {
    expect(SQL).toMatch(/NEW\.dispatch_tracked := true/);
    expect(SQL).toMatch(/CREATE TRIGGER trg_00_service_order_dispatch_preflight/);
    expect(SQL).toMatch(/OS sem tarifa/i);
    expect(SQL).toMatch(/tarifa do prestador alternativo/i);
    expect(SQL).toMatch(/CREATE TRIGGER trg_lock_service_order_terms_after_dispatch/);
  });

  it('trata despacho e conferência como ledgers imutáveis', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_lock_service_order_dispatch/);
    expect(SQL).toMatch(/CREATE TRIGGER trg_lock_service_order_return/);
    expect(SQL).toMatch(/Movimento de OS é imutável/);
  });

  it('garante uma conta por retorno e preserva o marcador interno FÁBRICA', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_per_service_order_return/);
    expect(SQL).toMatch(/ON CONFLICT \(reference_id\) WHERE reference_type = 'service_order_return' DO NOTHING/);
    expect(SQL).toMatch(/IF v_days >= 999 THEN RETURN NEW/);
    expect(SQL).toMatch(/IF v_payment_days >= 999 THEN RETURN NEW/);
  });

  it('expõe rastreabilidade, lacunas de geração e auditoria financeiro-operacional', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.service_order_events/);
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.list_service_order_generation_gaps/);
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.service_order_integrity_report/);
    expect(SQL).toMatch(/return_payable_drift/);
  });
});
