import { useState, useEffect } from 'react';

/**
 * useState que PERSISTE em localStorage pela `key`. Hidrata do storage na
 * primeira montagem (fallback p/ defaultValue) e grava a cada mudança.
 * Defensivo a SSR / quota / JSON inválido — nunca quebra o render.
 *
 * (Antes era um stub no-op que prometia persistência e não entregava: os
 * templates de etiqueta customizados evaporavam ao navegar.)
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota/serialização indisponível — mantém em memória, não quebra */
    }
  }, [key, state]);

  return [state, setState];
}
