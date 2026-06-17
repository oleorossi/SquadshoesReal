import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  tryReserveReload,
  hasRecoveryBudget,
  recoveryReloadsUsed,
} from '../recoveryReload';

// Constantes espelhadas de recoveryReload.ts (MAX_RELOADS=2, COOLDOWN_MS=10s,
// EPISODE_RESET_MS=60s) — se mudarem lá, atualizar aqui.
const COOLDOWN_MS = 10_000;
const EPISODE_RESET_MS = 60_000;

describe('recoveryReload — orçamento global de reload de recuperação', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('autoriza o primeiro reload e o contabiliza', () => {
    expect(recoveryReloadsUsed()).toBe(0);
    expect(hasRecoveryBudget()).toBe(true);
    expect(tryReserveReload()).toBe(true);
    expect(recoveryReloadsUsed()).toBe(1);
  });

  it('nega um segundo reload dentro do cooldown (anti-empilhamento)', () => {
    expect(tryReserveReload()).toBe(true);
    vi.advanceTimersByTime(COOLDOWN_MS - 1);
    expect(tryReserveReload()).toBe(false); // ainda em cooldown
    expect(recoveryReloadsUsed()).toBe(1); // não contabilizou o negado
  });

  it('autoriza o 2º reload após o cooldown, mas esgota no teto de 2 por episódio', () => {
    expect(tryReserveReload()).toBe(true); // #1
    vi.advanceTimersByTime(COOLDOWN_MS + 1);
    expect(tryReserveReload()).toBe(true); // #2
    expect(recoveryReloadsUsed()).toBe(2);
    expect(hasRecoveryBudget()).toBe(false);
    vi.advanceTimersByTime(COOLDOWN_MS + 1);
    expect(tryReserveReload()).toBe(false); // teto atingido
  });

  it('reabre o orçamento num episódio novo (passado EPISODE_RESET sem reload)', () => {
    expect(tryReserveReload()).toBe(true);
    vi.advanceTimersByTime(COOLDOWN_MS + 1);
    expect(tryReserveReload()).toBe(true); // esgota (2/2)
    expect(hasRecoveryBudget()).toBe(false);

    // Muito tempo depois sem novos reloads → episódio novo, orçamento cheio.
    vi.advanceTimersByTime(EPISODE_RESET_MS + 1);
    expect(recoveryReloadsUsed()).toBe(0);
    expect(hasRecoveryBudget()).toBe(true);
    expect(tryReserveReload()).toBe(true);
    expect(recoveryReloadsUsed()).toBe(1);
  });

  it('é resiliente a sessionStorage com lixo (não lança, trata como zerado)', () => {
    sessionStorage.setItem('app-recovery-reload', 'not json{');
    expect(() => recoveryReloadsUsed()).not.toThrow();
    expect(recoveryReloadsUsed()).toBe(0);
    expect(tryReserveReload()).toBe(true);
  });
});
