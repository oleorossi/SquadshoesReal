/**
 * Orçamento ÚNICO de recuperação por reload.
 *
 * # Problema
 *
 * O app tem três mecanismos que recarregam a página pra escapar de um
 * bundle/chunk obsoleto após deploy:
 *   1. `vite:preloadError`            (src/main.tsx)
 *   2. `chunkErrorHandler`            (error/unhandledrejection — src/lib/chunkErrorHandler.ts)
 *   3. `VersionChecker`               (mismatch de version.json)
 *
 * Antes, cada um tinha seu PRÓPRIO flag/contador em sessionStorage e não se
 * conheciam. Num cenário degradado (CDN ainda servindo index.html velho, ou um
 * vendor chunk diferente falhando), o #1 recarregava setando só a flag dele, o
 * #2 via a flag DELE ainda limpa e recarregava de novo, e o #3 somava as suas —
 * encadeando vários full-reloads e mascarando a causa raiz.
 *
 * # Solução
 *
 * UM contador global `{count, lastTs}` em sessionStorage, compartilhado pelos
 * três. `tryReserveReload()` autoriza (e contabiliza) um reload só se ainda há
 * orçamento E passou o cooldown desde o último. Episódios distantes no tempo
 * (> EPISODE_RESET_MS sem reload) zeram o contador, pra que uma falha nova
 * tempos depois tenha orçamento cheio. Esgotado o orçamento, cada caller faz o
 * seu fallback (deixar o erro aparecer / escalar pra UI de "Ctrl+Shift+R").
 */

const KEY = 'app-recovery-reload';
const MAX_RELOADS = 2;
const COOLDOWN_MS = 10_000;
const EPISODE_RESET_MS = 60_000;

interface RecoveryState {
  count: number;
  lastTs: number;
}

function read(): RecoveryState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.count === 'number' && typeof parsed?.lastTs === 'number') {
        return parsed as RecoveryState;
      }
    }
  } catch {
    /* sessionStorage indisponível / JSON inválido → estado zerado */
  }
  return { count: 0, lastTs: 0 };
}

function write(state: RecoveryState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Reloads de recuperação já gastos no episódio atual (zera após inatividade). */
export function recoveryReloadsUsed(): number {
  const { count, lastTs } = read();
  if (lastTs && Date.now() - lastTs > EPISODE_RESET_MS) return 0;
  return count;
}

/** Ainda há orçamento de recuperação no episódio atual? (não reserva nada) */
export function hasRecoveryBudget(): boolean {
  return recoveryReloadsUsed() < MAX_RELOADS;
}

/**
 * Tenta reservar UM reload de recuperação. Retorna `true` se autorizado (e já
 * contabiliza o gasto) ou `false` se estourou o orçamento OU está em cooldown.
 *
 * NÃO recarrega — quem chama faz `window.location.reload()`/`replace()` ao
 * receber `true`.
 */
export function tryReserveReload(): boolean {
  const now = Date.now();
  let state = read();

  // Episódio novo (faz tempo desde o último reload) → orçamento cheio de novo.
  if (state.lastTs && now - state.lastTs > EPISODE_RESET_MS) {
    state = { count: 0, lastTs: 0 };
  }

  // Cooldown: acabou de recarregar — não empilha outro reload agora.
  if (state.lastTs && now - state.lastTs < COOLDOWN_MS) return false;

  // Orçamento esgotado — desiste (deixa o caller fazer seu fallback).
  if (state.count >= MAX_RELOADS) return false;

  write({ count: state.count + 1, lastTs: now });
  return true;
}
