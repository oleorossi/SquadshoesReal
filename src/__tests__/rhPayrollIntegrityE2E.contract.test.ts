import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const POINT = read('supabase/migrations/20270101013400_integridade_importacao_ponto.sql');
const PAYROLL = read('supabase/migrations/20270101013500_integridade_adiantamentos_folha_pagamentos.sql');
const E2E = read('supabase/tests/rh_payroll_integrity_134_135.sql');

describe('E2E transacional de ponto, adiantamentos e folha', () => {
  it('é autocontido e sempre descarta os fixtures sintéticos', () => {
    const begin = E2E.indexOf('BEGIN;');
    const body = E2E.indexOf('DO $test$');
    const rollback = E2E.lastIndexOf('ROLLBACK;');

    expect(begin).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(begin);
    expect(rollback).toBeGreaterThan(body);
    expect(E2E).not.toMatch(/^COMMIT;$/m);
    expect(E2E).toContain("SET LOCAL statement_timeout = '60s'");
    expect(E2E).toContain("SET LOCAL lock_timeout = '10s'");
  });

  it('exercita arquivo real, UUID, lote, atomicidade, replay e quarentena', () => {
    expect(E2E).toContain('INSERT INTO storage.objects');
    expect(E2E).toContain("'timesheet-imports', v_file_path");
    expect(E2E).toContain("c.data_type = 'uuid'");
    expect(E2E).toContain("set_config('request.jwt.claim.role', 'authenticated', true)");
    expect(E2E).toContain("set_config('request.jwt.claim.sub', v_actor::text, true)");
    expect(E2E).toContain('autoria histórica ainda depende da existência da conta em auth.users');
    expect(E2E).toContain('v_first := public.import_time_records_with_archive');
    expect(E2E).toContain('v_replay := public.import_time_records_with_archive');
    expect(E2E).toContain("(v_replay->>'idempotent')::boolean IS TRUE");
    expect(E2E).toContain('replay com outra contagem de pré-descartes reutilizou o recibo idempotente');
    expect(E2E).toContain('usuário autenticado sem papel de RH conseguiu importar');
    expect(E2E).toContain('protocolo finalizado aceitou payload divergente');
    expect(E2E).toContain('INSERT forjado de protocolo % foi aceito');
    expect(E2E).toContain('protocolo finalizado foi alterado diretamente');
    expect(E2E).toContain('protocolo em erro foi alterado depois de finalizado');
    expect(E2E).toContain('batch_id foi reutilizado por outro protocolo');
    expect(E2E).toContain('file_path foi reutilizado por outro protocolo');
    expect(E2E).toContain('protocolo sem objeto no Storage foi processado');
    expect(E2E).toContain('falha atômica deixou batida parcial');
    expect(E2E).toContain('matrícula órfã não foi preservada na quarentena do lote');
    expect(E2E).toContain('resolver aceitou quarentena ainda sem vínculo em Pessoas');
    expect(E2E).toContain('resolver escolheu arbitrariamente entre vínculos ambíguos');
    expect(E2E).toContain('resolver não preservou autoria, lote, batidas ou vínculo canônico');
    expect(E2E).toContain('replay do resolver duplicou batida ou trocou o vínculo resolvido');
    expect(E2E).toContain('resolver inseriu batida dentro de período de ponto fechado');
    expect(E2E).toContain('fixture não fechou o período de ponto antes de testar o resolver');
    expect(E2E).toContain('role authenticated de RH não executou o resolver idempotente');
    expect(E2E).toContain('role anon executou o resolver da quarentena');
    expect(E2E).toContain("'punches', 'null'::jsonb");
    expect(E2E).toContain('punches JSON null foi aceito sobre um dia já aplicado');
    expect(E2E).toContain('punches nulo sobrescreveu a batida anteriormente aplicada');
    expect(E2E).toContain("coverage_scope, covered_employee_external_ids");
    expect(E2E).toContain("'all_employees', ARRAY[v_external_id, v_other_external_id, v_orphan_external_id]");
    expect(E2E).toContain('protocolo global omitiu funcionário vigente');
    expect(E2E).toContain("archived_at = TIMESTAMPTZ '2000-01-01 00:00:00+00'");
    expect(E2E).toContain('complete_punches achatou array 2D');
    expect(E2E).toContain('complete_punches gravou null como batida/auditoria');
  });

  it('exercita cobertura, claim/release e as fronteiras de pagamento', () => {
    expect(E2E).toContain('rascunho sem snapshot deixou de poder nascer');
    expect(E2E).toContain('INSERT criou folha fechada sem executar o writer atômico');
    expect(E2E).toContain('INSERT criou folha paga sem executar o writer atômico');
    expect(E2E).toContain('líquido fora de proventos − descontos foi aceito');
    expect(E2E).toContain('v_input_epoch := public.begin_payroll_calculation()');
    expect(E2E).toContain("'input_epoch', v_input_epoch");
    expect(E2E).toContain('mutação de fonte não avançou payroll_input_epoch');
    expect(E2E).toContain('snapshot obsoleto fechou a folha após mutação da fonte');
    expect(E2E).toContain('rejeição por frescor reivindicou adiantamento');
    expect(E2E).toContain('v_advance_id := public.create_employee_advance');
    expect(E2E).toContain('public.settle_employee_advance_external');
    expect(E2E).toContain('public.cancel_employee_advance');
    expect(E2E).toContain('RPC de cancelamento não preservou cadastro e trilha');
    expect(E2E).toContain('adiantamento com fração menor que um centavo foi aceito');
    expect(E2E).toContain('adiantamento aceitou comprovante inexistente no Storage');
    expect(E2E).toContain('replay do cadastro duplicou o adiantamento');
    expect(E2E).toContain('mesma chave de adiantamento aceitou payload conflitante');
    expect(E2E).toContain("UPDATE public.payroll_runs SET status = 'aprovado'");
    expect(E2E).toContain("a.status = 'deducted'");
    expect(E2E).toContain("a.pre_deduction_status = 'pending'");
    expect(E2E).toContain('folha de líquido zero não derivou para paga com equação íntegra');
    expect(E2E).toContain('folha de líquido zero fabricou pagamento');
    expect(E2E).toContain('folha sem cobertura diária foi aprovada');
    expect(E2E).toContain('pagamento de outra pessoa foi aceito na folha');
    expect(E2E).toContain('pagamento acima do saldo líquido foi aceito');
    expect(E2E).toContain('pagamento com fração menor que um centavo foi aceito');
    expect(E2E).toContain('pagamento aceitou path de recibo inexistente');
    expect(E2E).toContain('pagamento aceitou metadados divergentes do recibo');
    expect(E2E).toContain('public.register_payroll_payment');
    expect(E2E).toContain('public.reverse_payroll_payment');
    expect(E2E).toContain('linhas estornadas interferiram no limite ou na quitação');
    expect(E2E).toContain('estorno alterou o recibo do pagamento');
    expect(E2E).toContain('cliente adulterou approved_at/approved_by após aprovação');
    expect(E2E).toContain('cliente adulterou paid_at de folha paga');
    expect(E2E).toContain('cancelamento não preservou integralmente o documento salarial');
    expect(E2E).toContain('public.cancel_payroll_run');
    expect(E2E).toContain('cancelamento não gravou justificativa, autoria e data');
    expect(E2E).toContain('folha cancelada não liberou nova geração preservando o histórico');
    expect(E2E).toContain("a.status = 'pending'");
    expect(E2E).toContain('cancelamento não restaurou exatamente o estado aberto');
  });

  it('valida no catálogo vivo a remoção de policies, grants e triggers legados', () => {
    expect(E2E).toContain("p.tablename = 'time_import_logs'");
    expect(E2E).toContain("'time_import_logs_rh_insert'");
    expect(E2E).toContain('policies legadas sobreviveram em payroll_runs');
    expect(E2E).toContain('policy ampla legada sobre arquivos de RH sobreviveu');
    expect(E2E).toContain("has_table_privilege('authenticated', v_acl_table, 'TRUNCATE')");
    expect(E2E).toContain("has_table_privilege('authenticated', 'public.time_records', 'DELETE')");
    expect(E2E).toContain("has_table_privilege('authenticated', 'public.payroll_runs', 'DELETE')");
    expect(E2E).toContain("has_table_privilege('authenticated', 'public.employee_advances', 'INSERT')");
    expect(E2E).toContain("has_table_privilege('authenticated', 'public.payroll_payments', 'UPDATE')");
    expect(E2E).toContain("tgname = 'trg_zzzy_guard_payroll_integrity'");
    expect(E2E).toContain("tgname = 'trg_zzzz_lock_closed_payroll_snapshot'");
    expect(E2E).toContain("tgname IN ('tg_ficha_stamp_payment', 'tg_ficha_unstamp_payment')");
    expect(E2E).toContain('backfill não converteu folha aprovada de líquido zero para paga');
    expect(E2E).toContain('folha ainda pode ser apagada em cascata com o funcionário');
    expect(E2E).toContain('SET LOCAL ROLE authenticated');
    expect(E2E).toContain('role authenticated inseriu adiantamento sem RPC');
    expect(E2E).toContain('role authenticated inseriu pagamento sem RPC');
    expect(E2E).toContain('recibo referenciado foi substituído pela policy de retry');
    expect(E2E).toContain('DELETE SQL direto de recibo não foi bloqueado pelo Storage');
    expect(E2E).toContain('upload órfão não tem policy de remoção para novo retry');
  });

  it('trava no código SQL a ordem necessária para atomicidade e concorrência', () => {
    const protocolLock = POINT.indexOf('FROM public.time_import_logs');
    const storageProof = POINT.indexOf('FROM storage.objects', protocolLock);
    const innerImport = POINT.indexOf('v_result := public.import_time_records_safe', storageProof);
    const closeProtocol = POINT.indexOf('UPDATE public.time_import_logs', innerImport);

    expect(protocolLock).toBeGreaterThan(-1);
    expect(POINT.indexOf('FOR UPDATE', protocolLock)).toBeGreaterThan(protocolLock);
    expect(storageProof).toBeGreaterThan(protocolLock);
    expect(innerImport).toBeGreaterThan(storageProof);
    expect(closeProtocol).toBeGreaterThan(innerImport);
    expect(POINT).toContain('uq_time_import_logs_batch_id');
    expect(POINT).toContain('uq_time_import_logs_file_path');
    expect(POINT).toContain("jsonb_typeof(rec->'punches') IS DISTINCT FROM 'array'");

    const runLock = PAYROLL.indexOf('FROM public.payroll_runs WHERE id = v_run_id FOR UPDATE');
    const paidSum = PAYROLL.indexOf('FROM public.payroll_payments p', runLock);
    const overpayment = PAYROLL.indexOf('Pagamento excede o saldo da folha', paidSum);

    expect(runLock).toBeGreaterThan(-1);
    expect(paidSum).toBeGreaterThan(runLock);
    expect(overpayment).toBeGreaterThan(paidSum);
    expect(PAYROLL).toContain("set_config('app.employee_advance_command', 'claim', true)");
    expect(PAYROLL).toContain("set_config('app.employee_advance_command', 'release', true)");
    expect(PAYROLL).toMatch(/TG_OP = 'INSERT'[\s\S]*NEW\.status IN \('aprovado', 'pago'\)/);
    expect(PAYROLL).toContain('COALESCE(NEW.total_proventos, 0)');
    expect(PAYROLL).toContain('COALESCE(NEW.total_descontos, 0)');
    expect(PAYROLL).toContain('public.payroll_input_epoch');
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.begin_payroll_calculation()');
    expect(PAYROLL).toContain('trg_ab_payroll_require_fresh_inputs');
    expect(PAYROLL).toContain("NEW.calculation_snapshot->>'input_epoch'");
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.register_payroll_payment(');
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.reverse_payroll_payment');
    expect(PAYROLL).toContain('WHERE payroll_run_id = p_run AND reversed_at IS NULL');
  });
});
