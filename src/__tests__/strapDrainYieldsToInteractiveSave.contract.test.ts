import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  isPostgresBusyError,
  runSaleOrderCommandWithBusyRetry,
  SaleOrderCommandExecutionError,
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

/** Passa o setTimeout adiante na hora, guardando as esperas pedidas. */
function captureWaits(waits: number[]) {
  return vi
    .spyOn(globalThis, 'setTimeout')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as any);
}

/** Falha COM recibo terminal — é o que o servidor grava num deadlock de tira. */
function recordedDeadlock() {
  return new SaleOrderCommandExecutionError({
    ok: false,
    command: 'update',
    sale_order_id: 'pv',
    result: {},
    error: { code: '40P01', message: 'Modelo DS20 / OFF WHITE, TIRA 1: deadlock detected' },
  } as never);
}

describe('retry do save atravessa a passada do worker', () => {
  it('espera acumulada passa da passada mais longa já medida (23,1s)', async () => {
    const busy = Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    });
    expect(isPostgresBusyError(busy)).toBe(true);

    const waits: number[] = [];
    const spy = captureWaits(waits);
    const run = vi.fn().mockRejectedValue(busy);
    await expect(runSaleOrderCommandWithBusyRetry('pv:1:update:k', run)).rejects.toBe(busy);
    spy.mockRestore();

    // 1 tentativa + 3 repetições: o retry fixo de 1500ms anterior caía dentro da
    // MESMA passada do worker e falhava de novo (PV-00168, 18/09/2026).
    expect(run).toHaveBeenCalledTimes(4);
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThan(23_100);
  });

  it('recibo `failed` força chave NOVA — replay da mesma chave devolveria a falha', async () => {
    // Medido no PV-00168: o update deu 40P01 às 13:05:07, gravou recibo `failed`,
    // e a repetição às 13:05:13 voltou 200 com `idempotent_replay: true` — a
    // MESMA falha reapresentada. Com a chave repetida o retry é decorativo.
    const waits: number[] = [];
    const spy = captureWaits(waits);
    const keys: string[] = [];
    const run = vi.fn(async (key: string) => {
      keys.push(key);
      if (keys.length < 3) throw recordedDeadlock();
      return { ok: true };
    });

    await expect(
      runSaleOrderCommandWithBusyRetry('pv:1:update:k', run),
    ).resolves.toEqual({ ok: true });
    spy.mockRestore();

    expect(keys).toEqual(['pv:1:update:k', 'pv:1:update:k:retry1', 'pv:1:update:k:retry2']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contenção SEM recibo mantém a chave — o comando pode ter commitado', async () => {
    // Sem recibo não há prova de que nada foi aplicado: a resposta pode ter se
    // perdido depois do commit. Chave nova aqui gravaria o pedido duas vezes.
    const waits: number[] = [];
    const spy = captureWaits(waits);
    const keys: string[] = [];
    const run = vi.fn(async (key: string) => {
      keys.push(key);
      if (keys.length < 2) throw new Error('canceling statement due to statement timeout');
      return { ok: true };
    });

    await expect(
      runSaleOrderCommandWithBusyRetry('pv:1:update:k', run),
    ).resolves.toEqual({ ok: true });
    spy.mockRestore();

    expect(keys).toEqual(['pv:1:update:k', 'pv:1:update:k']);
  });

  it('erro que não é contenção sobe na primeira tentativa', async () => {
    const readiness = new Error('Readiness gate recusou o comando');
    const run = vi.fn().mockRejectedValue(readiness);
    await expect(
      runSaleOrderCommandWithBusyRetry('pv:1:update:k', run),
    ).rejects.toBe(readiness);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('os dois comandos de PV usam o helper — nada de retry fixo de 1500ms', () => {
    expect(HOOK).not.toMatch(/setTimeout\(resolve, 1500\)/);
    const uses = HOOK.match(/runSaleOrderCommandWithBusyRetry\(idempotencyKey, runExecute\)/g) ?? [];
    expect(uses).toHaveLength(2);
  });
});
