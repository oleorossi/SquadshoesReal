import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(ROOT, 'supabase/migrations', file), 'utf8');

// 25300 tentou COMMIT por job (PROCEDURE); 25700 achou que a cláusula SET era o
// bloqueio; 25800 provou em produção que o bloqueio é o próprio pg_cron.
const COMMIT_PER_JOB = read('20270101025300_drain_strap_demand_jobs_commit_per_job.sql');
const ALLOW_COMMIT = read('20270101025700_drain_strap_demand_jobs_allow_commit.sql');
const FOR_PG_CRON = read('20270101025800_drain_strap_demand_jobs_function_for_pg_cron.sql');

describe('drain_strap_demand_jobs — o contrato vivo é FUNCTION (20270101025800)', () => {
  it('o worker é FUNCTION: pg_cron executa o job dentro de transação e recusa COMMIT', () => {
    expect(FOR_PG_CRON).toContain('drain_strap_demand_jobs_function_for_pg_cron_20270101025800');
    expect(FOR_PG_CRON).toContain('DROP PROCEDURE IF EXISTS public.drain_strap_demand_jobs(integer, text)');
    expect(FOR_PG_CRON).toContain('CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs(');
    expect(FOR_PG_CRON).not.toMatch(/CREATE OR REPLACE PROCEDURE public\.drain_strap_demand_jobs/);
  });

  it('não sobra controle de transação no corpo — era o 2D000 de minuto em minuto', () => {
    const body = FOR_PG_CRON.split('$$')[1] ?? '';
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/^\s*COMMIT\s*;/m);
    expect(body).not.toMatch(/^\s*ROLLBACK\s*;/m);
  });

  it('o cron chama por SELECT; CALL é o bug de 16/09 voltando', () => {
    expect(FOR_PG_CRON).toContain("SELECT public.drain_strap_demand_jobs(100, 'pg_cron', 3000);");
    expect(FOR_PG_CRON).not.toMatch(/CALL public\.drain_strap_demand_jobs\(100/);
    // A migration se recusa a terminar se o cron tiver ficado em CALL.
    expect(FOR_PG_CRON).toContain("v_command ILIKE '%CALL %drain_strap_demand_jobs%'");
    expect(FOR_PG_CRON).toContain("v_command NOT ILIKE '%SELECT public.drain_strap_demand_jobs%'");
  });

  it('FUNCTION volta a exigir search_path fixo (SECURITY DEFINER injetável sem ele)', () => {
    expect(FOR_PG_CRON).toContain("SET search_path TO 'public'");
    expect(FOR_PG_CRON).toContain("'search_path=public' = ANY (v_config)");
  });

  it('o lote é limitado por TEMPO, não por contagem — foi o tempo que deadlockou', () => {
    expect(FOR_PG_CRON).toContain('p_time_budget_ms');
    // O orçamento só barra o INÍCIO de mais um job: nenhum job é cortado no meio,
    // então cada um continua atômico como a 25300 queria.
    expect(FOR_PG_CRON).toContain('EXIT WHEN v_processed > 0 AND clock_timestamp() - v_started >= v_budget');
  });

  it('passada concorrente é recusada em vez de empilhar backend no lock de netting', () => {
    expect(FOR_PG_CRON).toContain('pg_try_advisory_xact_lock');
    expect(FOR_PG_CRON).toContain("'strap-demand-drain:singleton'");
    expect(FOR_PG_CRON).toContain("'reason', 'drain_in_progress'");
  });
});

describe('drain_strap_demand_jobs — histórico que não pode voltar', () => {
  it('a 25300 escolheu PROCEDURE + COMMIT sob pg_cron (inviável por construção)', () => {
    expect(COMMIT_PER_JOB).toContain('CREATE OR REPLACE PROCEDURE public.drain_strap_demand_jobs(');
    expect(COMMIT_PER_JOB).toMatch(/\bCOMMIT\s*;/);
    expect(COMMIT_PER_JOB).toContain("CALL public.drain_strap_demand_jobs(100, 'pg_cron')");
  });

  it('a 25700 culpou a cláusula SET, e a 25800 registra a medição que a refuta', () => {
    expect(ALLOW_COMMIT).toContain('cláusula SET impede COMMIT');
    // O que provou o contrário: mesmo com proconfig NULL o CONTEXT só mudou de
    // linha (27 -> 36), enquanto o mesmo CALL fora do pg_cron passou.
    expect(FOR_PG_CRON).toContain('ERRATA DA 25700');
    expect(FOR_PG_CRON).toContain('line 36 at COMMIT');
    expect(FOR_PG_CRON).toContain('via SPI dentro de uma');
  });

  it('a razão de existir do lote curto continua escrita (deadlock do PV-00169)', () => {
    expect(COMMIT_PER_JOB).toContain('Anti-deadlock');
    expect(FOR_PG_CRON).toContain('PV-00169');
  });
});
