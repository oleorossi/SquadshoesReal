import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Aba controlada pela URL — a fonte única de qual aba está aberta.
 *
 * ## Por que existe
 *
 * A auditoria de arquitetura de informação (29/07/2026) encontrou **55 de 62
 * arquivos com abas que não escrevem nada na URL**: trocar de aba não mudava o
 * endereço, então F5 e o botão Voltar devolviam o usuário à primeira aba e ele
 * perdia onde estava. Sete telas ainda guardavam a aba em `localStorage`, que
 * ganhava do link — quem abria um deep-link caía na aba salva, não na pedida.
 *
 * Cada tela resolvia isso do seu jeito (ou não resolvia). Este hook é o
 * contrato único.
 *
 * ## O contrato
 *
 * 1. **A aba default é a AUSÊNCIA do parâmetro.** Selecionar o default limpa a
 *    URL em vez de escrever `?tab=default` — URL curta é URL compartilhável.
 * 2. **Clique do usuário faz `push`; normalização faz `replace`.** Sem isso o
 *    Voltar vira armadilha: o usuário volta e cai no mesmo lugar, porque a
 *    normalização empilhou uma entrada no histórico.
 * 3. **Parâmetros alheios são preservados.** Nunca `setSearchParams({ tab })` —
 *    isso descarta filtros, IDs de seleção e contexto. Foi o modo de falha mais
 *    comum encontrado na auditoria.
 * 4. Valor inválido cai no default e some da URL, com `replace`.
 * 5. Trocar a aba-pai limpa os filhos incompatíveis (`clearOnChange`).
 * 6. **`localStorage` perde para a URL** (`migrateFrom`): sem parâmetro, o valor
 *    salvo é lido UMA vez e vira URL canônica; com parâmetro válido, o salvo é
 *    ignorado.
 */
export interface UseUrlTabStateOptions<T extends string> {
  /** Valores canônicos aceitos. Qualquer outra coisa cai no default. */
  values: readonly T[];
  defaultValue: T;
  /** Nome do parâmetro. `tab` para a navegação principal, `subtab` para a filha. */
  param?: string;
  /** Chaves antigas → valor canônico. Continuam funcionando como ENTRADA. */
  aliases?: Record<string, T>;
  /** Parâmetros legados lidos uma vez e normalizados para `param` (ex.: `view`, `sub`). */
  legacyParams?: readonly string[];
  /** Parâmetros filhos a remover quando este muda (ex.: `tab` limpa `subtab`). */
  clearOnChange?: readonly string[];
  /** Chave de `localStorage` a migrar uma vez e abandonar. */
  migrateFrom?: string;
}

export interface UseUrlTabState<T extends string> {
  value: T;
  setValue: (next: T, options?: { history?: 'push' | 'replace' }) => void;
}

function readStoredTab(key: string | undefined): string | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    // `usePersistedState` grava JSON; versões mais antigas gravavam a string crua.
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

export function useUrlTabState<T extends string>({
  values,
  defaultValue,
  param = 'tab',
  aliases,
  legacyParams,
  clearOnChange,
  migrateFrom,
}: UseUrlTabStateOptions<T>): UseUrlTabState<T> {
  const [searchParams, setSearchParams] = useSearchParams();

  const valid = useMemo(() => new Set<string>(values), [values]);

  /** Traduz qualquer entrada (canônica, alias ou lixo) para um valor canônico. */
  const canonicalize = useCallback(
    (raw: string | null): T | null => {
      if (!raw) return null;
      if (valid.has(raw)) return raw as T;
      const aliased = aliases?.[raw];
      return aliased && valid.has(aliased) ? aliased : null;
    },
    [valid, aliases],
  );

  const rawFromParam = searchParams.get(param);
  const fromParam = canonicalize(rawFromParam);

  const rawFromLegacy = useMemo(() => {
    for (const legacy of legacyParams ?? []) {
      const found = searchParams.get(legacy);
      if (found) return { key: legacy, raw: found };
    }
    return null;
  }, [legacyParams, searchParams]);
  const fromLegacy = canonicalize(rawFromLegacy?.raw ?? null);

  // A migração de localStorage acontece UMA vez por montagem. Sem essa trava, o
  // usuário que voltasse pro default (parâmetro ausente) seria puxado de volta
  // pra aba salva e não conseguiria sair dela.
  const migrated = useRef(false);
  const fromStorage = useMemo(() => {
    if (migrated.current) return null;
    return canonicalize(readStoredTab(migrateFrom));
  }, [canonicalize, migrateFrom]);

  // Precedência: URL canônica > parâmetro legado > localStorage > default.
  // O storage só entra quando a URL está MUDA. Se veio `?tab=lixo`, o usuário
  // pediu algo — respondemos com o default, não com a aba que ele abriu ontem.
  const urlEstaMuda = rawFromParam === null && rawFromLegacy === null;
  const value: T = fromParam ?? fromLegacy ?? (urlEstaMuda ? fromStorage ?? defaultValue : defaultValue);

  const writeValue = useCallback(
    (next: T, history: 'push' | 'replace') => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          // Parâmetro legado some assim que a URL canônica é escrita.
          for (const legacy of legacyParams ?? []) params.delete(legacy);
          if (next === defaultValue) params.delete(param);
          else params.set(param, next);
          for (const child of clearOnChange ?? []) params.delete(child);
          return params;
        },
        { replace: history === 'replace' },
      );
    },
    [setSearchParams, legacyParams, defaultValue, param, clearOnChange],
  );

  // Normalização: alias, parâmetro legado, valor inválido e migração de storage
  // convergem para a URL canônica — sempre com `replace`, nunca empilhando
  // histórico, porque o usuário não pediu essas navegações.
  useEffect(() => {
    const precisaNormalizarAlias = rawFromParam !== null && rawFromParam !== value;
    const precisaAbsorverLegado = rawFromLegacy !== null;
    const precisaLimparDefault = rawFromParam !== null && value === defaultValue;
    const precisaMigrarStorage =
      !migrated.current && rawFromParam === null && !rawFromLegacy && fromStorage != null && fromStorage !== defaultValue;

    if (migrateFrom && !migrated.current) migrated.current = true;

    if (precisaLimparDefault || precisaNormalizarAlias || precisaAbsorverLegado || precisaMigrarStorage) {
      writeValue(value, 'replace');
    }
    // `value` já resume rawFromParam/rawFromLegacy/fromStorage; as demais deps
    // são estáveis.
  }, [rawFromParam, rawFromLegacy, value, defaultValue, fromStorage, migrateFrom, writeValue]);

  const setValue = useCallback(
    (next: T, options?: { history?: 'push' | 'replace' }) => {
      if (!valid.has(next)) return;
      // Interação humana empilha histórico: o Voltar tem que desfazer o clique.
      writeValue(next, options?.history ?? 'push');
    },
    [valid, writeValue],
  );

  return { value, setValue };
}
