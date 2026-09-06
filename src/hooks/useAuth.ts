import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { clearQueryPersistence } from '@/lib/queryPersistence';

/**
 * useAuth — fonte de verdade da sessão do usuário.
 *
 * IMPORTANTE: o padrão recomendado pelo Supabase é registrar o listener
 * `onAuthStateChange` ANTES de chamar `getSession()`. Isso evita race
 * conditions em que a sessão chega via callback antes de o estado inicial
 * ser calculado. Não usamos mais `Promise.race` com timeout para cancelar
 * o `getSession()` — isso causava `loading=false` com `user=null` enquanto
 * a sessão real ainda estava chegando, derrubando todos os guards e
 * exibindo o banner de "Sessão Instável" em toda a aplicação.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 1) Registrar listener PRIMEIRO (não usar await dentro do callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mounted) return;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        setLoading(false);
      }
    );

    // 2) Depois consultar a sessão atual (sem timeout artificial)
    supabase.auth.getSession()
      .then(({ data: { session: initialSession } }) => {
        if (!mounted) return;
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[useAuth] getSession falhou:', err);
        if (mounted) setLoading(false);
      });

    // 3) Failsafe defensivo de 15s — só libera o loading; não afeta `user`,
    // que continua sendo atualizado pelo listener quando a sessão chegar.
    const failsafe = setTimeout(() => {
      if (mounted) {
        setLoading((prev) => {
          if (prev) console.warn('[useAuth] Failsafe de 15s liberou loading');
          return false;
        });
      }
    }, 15000);

    return () => {
      mounted = false;
      clearTimeout(failsafe);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    await clearQueryPersistence();
  };

  return { user, session, loading, signOut };
}
