import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  isPostgresBusyError,
  runSaleOrderCommandWithBusyRetry,
} from '@/lib/saleOrderCommand';

const ROOT = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(ROOT, 'supabase/migrations', file), 'utf8');

const YIELDS = read('20270101025900_strap_drain_yields_to_interactive_save.sql');
const ROLE_TIMEOUT = read('20270101025600_raise_authenticator_statement_timeout.sql');

const HOOK = readFileSync(resolve(ROOT, 'src/hooks/useSaleOrders.ts'), 'utf8');

describe('worker de tira cede a vez ao save interativo (20270101025900)', () => {
  it('o teto de tempo vai no COMANDO do cron — em `SET` na função é no-op', () => {
    // Medido: função com `SET statement_timeout TO '2s'` dormiu 6s sem ser
    // cortada; o mesmo SET como statement antes do SELECT cortou em 2s. O timer
    // arma no início do statement de fora e não é reagendado depois.
    expect(YIELDS).toContain("SET lock_timeout='2s'; SET statement_timeout='25s'; SELECT public.drain_strap_demand_jobs(");
    const signature = YIELDS.slice(
      YIELDS.indexOf('CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs('),
      YIELDS.indexOf('AS $$'),
    );
    expect(signature).toContain("SET search_path TO 'public'");
    expect(signature).not.toMatch(/SET\s+statement_timeout/i);
    expect(signature).not.toMatch(/SET\s+lock_timeout/i);
  });

  it('o teto do worker fica ABAIXO da espera que o save tolera', () => {
    // A garantia inteira é essa desigualdade: 25s de posse máxima das napas pelo
    // worker < 30s que o PostgREST espera por um lock. Invertida, o save volta a
    // estourar lock_timeout e a devolver "banco ocupado".
    const cap = YIELDS.match(/SET statement_timeout='(\d+)s'/);
    const tolerance = ROLE_TIMEOUT.match(/ALTER ROLE authenticated SET lock_timeout = '(\d+)s'/);
    expect(cap).not.toBeNull();
    expect(tolerance).not.toBeNull();
    expect(Number(cap![1])).toBeLessThan(Number(tolerance![1]));
    // E a migration se recusa a aplicar se alguém baixar o lado do PostgREST.
    expect(YIELDS).toContain("'lock_timeout=30s' = ANY (v_authed)");
  });

  it('trabalho de fundo desiste rápido em vez de entrar na fila do save', () => {
    expect(YIELDS).toContain("SET lock_timeout='2s'");
    expect(YIELDS).toContain('WHEN lock_not_available OR serialization_failure OR deadlock_detected THEN');
  });

  it('passada cedida é visível: a linha do job não registra (o claim rola atrás)', () => {
    expect(YIELDS).toContain('RAISE WARNING');
    expect(YIELDS).toContain("'blocked', v_blocked");
    expect(YIELDS).toContain("'blocked_sqlstate', v_blocked_state");
  });

  it('segue FUNCTION chamada por SELECT — pg_cron não aceita COMMIT', () => {
    expect(YIELDS).toContain('CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs(');
    expect(YIELDS).not.toMatch(/CREATE OR REPLACE PROCEDURE public\.drain_strap_demand_jobs/);
    expect(YIELDS).toContain("v_command LIKE '%CALL %'");
  });
});

describe('retry do save atravessa a passada do worker', () => {
  it('espera acumulada passa da passada mais longa já medida (23,1s)', async () => {
    vi.useFakeTimers();
    try {
      const busy = Object.assign(new Error('canceling statement due to lock timeout'), {
        code: '55P03',
      });
      expect(isPostgresBusyError(busy)).toBe(true);

      const waits: number[] = [];
      const spy = vi
        .spyOn(globalThis, 'setTimeout')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation(((fn: () => void, ms?: number) => {
          waits.push(ms ?? 0);
          fn();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as any);

      const run = vi.fn().mockRejectedValue(busy);
      await expect(runSaleOrderCommandWithBusyRetry(run)).rejects.toBe(busy);

      spy.mockRestore();
      // 1 tentativa + 3 repetições: o retry fixo de 1500ms anterior caía dentro
      // da MESMA passada do worker e falhava de novo (PV-00168, 18/09/2026).
      expect(run).toHaveBeenCalledTimes(4);
      expect(waits).toHaveLength(3);
      const floor = waits.reduce((sum, ms) => sum + ms, 0);
      expect(floor).toBeGreaterThan(23_100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('erro que não é contenção sobe na primeira tentativa', async () => {
    const readiness = new Error('Readiness gate recusou o comando');
    const run = vi.fn().mockRejectedValue(readiness);
    await expect(runSaleOrderCommandWithBusyRetry(run)).rejects.toBe(readiness);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sucesso na repetição devolve o recibo sem propagar o erro', async () => {
    vi.useFakeTimers();
    try {
      const spy = vi
        .spyOn(globalThis, 'setTimeout')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation(((fn: () => void) => {
          fn();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as any);
      const run = vi
        .fn()
        .mockRejectedValueOnce(new Error('deadlock detected'))
        .mockResolvedValue({ ok: true });
      await expect(runSaleOrderCommandWithBusyRetry(run)).resolves.toEqual({ ok: true });
      expect(run).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('os dois comandos de PV usam o helper — nada de retry fixo de 1500ms', () => {
    expect(HOOK).not.toMatch(/setTimeout\(resolve, 1500\)/);
    const uses = HOOK.match(/runSaleOrderCommandWithBusyRetry\(runExecute\)/g) ?? [];
    expect(uses).toHaveLength(2);
  });
});
