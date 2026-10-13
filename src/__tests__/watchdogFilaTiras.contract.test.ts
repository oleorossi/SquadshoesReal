import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (file: string) =>
  readFileSync(resolve(ROOT, 'supabase/migrations', file), 'utf8');

/** ⚠ O contrato VIVO do drain é a 040100 — ela faz CREATE OR REPLACE por cima
 *  da 040000, que por sua vez veio por cima da 25800. Teste que lê só o arquivo
 *  antigo passa verde enquanto a função viva perde a guarda (armadilha
 *  documentada no CLAUDE.md). A 040000 continua coberta porque o watchdog dela
 *  foi PRESERVADO na 040100 como rede para falha que escapa do EXCEPTION. */
const WATCHDOG = read('20270101040000_watchdog-fila-de-tiras-destrava-job-venenoso.sql');
const STRIKE = read('20270101040100_strike-no-job-que-nao-cabe-no-orcamento.sql');

describe('Watchdog da fila de tiras — incidente 13/10/2026', () => {
  it('lê a evidência que sobrevive ao rollback, não a tabela de jobs', () => {
    // O rollback do statement timeout desfaz TODA escrita da transação,
    // inclusive o attempts++ do claim. A única evidência que resta é a que o
    // pg_cron grava por fora.
    expect(WATCHDOG).toContain('cron.job_run_details');
    expect(WATCHDOG).toContain("j.command ILIKE '%drain_strap_demand_jobs%'");
    expect(WATCHDOG).toContain('watchdog_strap_demand_queue_20270101040000');
  });

  it('isola o job e RETORNA na hora — sem processar na mesma passada', () => {
    const quarentena = WATCHDOG.indexOf("status = 'dead_letter'");
    const retorno = WATCHDOG.indexOf("'watchdog', 'quarantined'");
    const loop = WATCHDOG.indexOf('LOOP\n    EXIT WHEN v_processed');
    expect(quarentena).toBeGreaterThan(-1);
    expect(retorno).toBeGreaterThan(quarentena);
    // O RETURN tem que vir ANTES do laço de trabalho: seguir processando
    // arriscaria levar a quarentena junto no rollback do próximo timeout.
    expect(retorno).toBeLessThan(loop);
  });

  it('escolhe o suspeito com a MESMA ordem e os mesmos filtros do claim', () => {
    // Ordem diferente isolaria um job que o claim nunca escolheria, deixando
    // o venenoso na frente e matando um inocente por rodada.
    expect(WATCHDOG).toContain('ORDER BY j.next_attempt_at, j.created_at, j.id');
    expect(WATCHDOG).toContain("ativo.status = 'processing'");
    expect(WATCHDOG).toContain('j.source_revision >= coalesce(clock.revision, 0)');
  });

  it('só arma no disparo do pg_cron', () => {
    // Chamada manual de admin não tem histórico em cron.job_run_details que a
    // descreva; armar ali isolaria job por culpa de outro worker.
    expect(WATCHDOG).toContain("IF p_worker_id = 'pg_cron' THEN");
  });

  it('trata query_canceled junto dos outros SQLSTATEs que cedem a vez', () => {
    expect(WATCHDOG).toMatch(
      /WHEN lock_not_available OR serialization_failure OR deadlock_detected\s*\n\s*OR query_canceled THEN/,
    );
  });

  it('NÃO reintroduz "statement_timeout por job" — não funciona', () => {
    // statement_timeout conta a partir do statement de TOPO; dentro de uma
    // função plpgsql os comandos internos não são cronometrados em separado.
    // SET LOCAL aqui encurtaria a passada inteira, não o job.
    expect(WATCHDOG).not.toMatch(/SET\s+LOCAL\s+statement_timeout/i);
  });

  it('mantém a FUNCTION (pg_cron proíbe controle de transação)', () => {
    expect(WATCHDOG).toContain('CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs(');
    expect(WATCHDOG).not.toMatch(/CREATE OR REPLACE PROCEDURE public\.drain_strap_demand_jobs/);
    expect(WATCHDOG).not.toMatch(/^\s*COMMIT\s*;/m);
  });
});

/**
 * ERRATA medida no mesmo dia: capturar `query_canceled` fez a execução do cron
 * reportar `succeeded` mesmo sem completar nada, cegando o watchdog que conta
 * falhas. O strike resolve lendo o que o escopo EXTERNO consegue gravar.
 */
describe('Strike no job que não cabe no orçamento — errata da 040000', () => {
  it('a 040100 é o CREATE OR REPLACE vivo e preserva o watchdog da 040000', () => {
    expect(STRIKE).toContain('CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs(');
    expect(STRIKE).toContain('strike_job_sem_orcamento_20270101040100');
    // Os dois mecanismos cobrem sinais diferentes: o watchdog vê execução
    // `failed`, o strike vê cancelamento capturado. Remover um não é simplificar.
    expect(STRIKE).toContain('cron.job_run_details');
  });

  it('espia a cabeça ANTES do laço — depois do rollback não dá pra saber quem era', () => {
    const peek = STRIKE.indexOf('INTO v_cabeca');
    const loop = STRIKE.indexOf('LOOP\n    EXIT WHEN v_processed');
    expect(peek).toBeGreaterThan(-1);
    expect(peek).toBeLessThan(loop);
  });

  it('só credita strike quando NADA foi completado na passada', () => {
    // Com algum job completo, o cancelado não é mais a cabeça espiada —
    // creditar ali puniria um job inocente.
    expect(STRIKE).toContain('IF v_blocked > 0 AND v_processed = 0 AND v_cabeca IS NOT NULL THEN');
  });

  it('empurra next_attempt_at — é isso que tira o job pesado da CABEÇA', () => {
    expect(STRIKE).toMatch(/next_attempt_at = now\(\) \+ make_interval/);
    expect(STRIKE).toContain("THEN 'dead_letter' ELSE 'retry' END");
  });

  it('o strike fica FORA do bloco protegido, no escopo que sobrevive ao rollback', () => {
    const excecao = STRIKE.indexOf('OR query_canceled THEN');
    const fimLaco = STRIKE.indexOf('END LOOP;');
    const strike = STRIKE.indexOf('IF v_blocked > 0 AND v_processed = 0');
    expect(excecao).toBeLessThan(fimLaco);
    expect(strike).toBeGreaterThan(fimLaco);
  });
});
