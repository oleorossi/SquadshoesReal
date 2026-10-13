import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (file: string) =>
  readFileSync(resolve(ROOT, 'supabase/migrations', file), 'utf8');

/** O contrato vivo do drain é esta migration — ela faz CREATE OR REPLACE por
 *  cima da 25800. Teste que lê o arquivo antigo passa verde enquanto a função
 *  viva perde a guarda (mesma armadilha documentada no CLAUDE.md). */
const WATCHDOG = read('20270101040000_watchdog-fila-de-tiras-destrava-job-venenoso.sql');

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
