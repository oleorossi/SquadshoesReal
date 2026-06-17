import { useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Favoritos do menu lateral — persistidos NO BANCO por usuário.
 *
 * Antes viviam só no localStorage ('menu-favorites'), que é por-navegador e
 * por-origem — sumiam ao limpar cache, trocar de navegador/dispositivo ou
 * mudar de domínio. Agora a fonte da verdade é a tabela `user_menu_favorites`
 * (1 linha por usuário, lista ordenada em JSONB). O localStorage vira só um
 * CACHE pra render instantâneo enquanto o banco carrega.
 *
 * Comportamento:
 *  - Render imediato com o cache local (placeholderData) — sem flicker.
 *  - Busca o banco sempre que há sessão; o banco vence o cache local.
 *  - Migração one-shot: se o banco está vazio mas o navegador tem favoritos
 *    (cadastro antigo deste browser), sobe pro banco automaticamente.
 *  - Tolerante a falha: se a tabela ainda não existe / sem sessão / erro de
 *    rede, cai pro localStorage e nunca quebra a sidebar.
 */

export type MenuFavorite = { name: string; path: string };

const LS_KEY = 'menu-favorites';
// supabase-js tipado pelos types gerados; a tabela é nova (fora do types.ts),
// então acessamos via cast — padrão já usado em outros hooks do projeto.
const sb = supabase as any;

const readLocal = (): MenuFavorite[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((f: any) => f && f.path && f.name) : [];
  } catch {
    return [];
  }
};

const writeLocal = (favs: MenuFavorite[]) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(favs)); } catch { /* storage cheio/privado */ }
};

export function useMenuFavorites() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const migratedRef = useRef(false);
  const queryKey = ['menu-favorites', userId] as const;

  const { data: favorites = [] } = useQuery<MenuFavorite[]>({
    queryKey,
    enabled: !!userId,
    // mostra o cache local na hora; NÃO usa initialData (que marcaria como
    // "fresh" e poderia pular a busca no banco quando o local está vazio).
    placeholderData: (prev) => prev ?? readLocal(),
    staleTime: 30 * 1000,
    retry: 1,
    queryFn: async () => {
      // NUNCA lança: o handler global de erros do react-query exibiria um toast
      // ("Falha ao carregar menu-favorites…"). Favorito não é crítico e sempre
      // há o cache local — em qualquer falha (tabela ainda não migrada, sem
      // rede) caímos no localStorage silenciosamente.
      try {
        const { data, error } = await sb
          .from('user_menu_favorites')
          .select('favorites')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;

        const dbFavs: MenuFavorite[] = Array.isArray(data?.favorites)
          ? data.favorites.filter((f: any) => f && f.path && f.name)
          : [];

        // Migração one-shot do localStorage → banco quando o banco está vazio.
        if (dbFavs.length === 0 && !migratedRef.current) {
          const local = readLocal();
          if (local.length > 0) {
            migratedRef.current = true;
            try {
              await sb.from('user_menu_favorites').upsert(
                { user_id: userId, favorites: local, updated_at: new Date().toISOString() },
                { onConflict: 'user_id' },
              );
            } catch { /* tabela ainda não migrada: mantém só o local */ }
            writeLocal(local);
            return local;
          }
        }

        writeLocal(dbFavs); // espelha no cache local pra próxima carga ser instantânea
        return dbFavs;
      } catch (err: any) {
        console.warn('[menu-favorites] banco indisponível, usando cache local:', err?.message || err);
        return readLocal();
      }
    },
  });

  const persist = useCallback(async (next: MenuFavorite[]) => {
    // Otimista: cache local + cache do react-query já refletem antes do banco.
    writeLocal(next);
    queryClient.setQueryData(queryKey, next);
    if (!userId) return; // sem sessão: fica só no navegador (fallback)
    try {
      await sb.from('user_menu_favorites').upsert(
        { user_id: userId, favorites: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    } catch {
      // Banco indisponível (ex.: tabela ainda não migrada): mantém o local.
      // Não relança pra não derrubar a UI; revalida na próxima montagem.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, queryClient]);

  const toggleFavorite = useCallback((name: string, path: string) => {
    const current =
      (queryClient.getQueryData(queryKey) as MenuFavorite[] | undefined) ?? readLocal();
    const exists = current.some((f) => f.path === path);
    const next = exists
      ? current.filter((f) => f.path !== path)
      : [...current, { name, path }];
    void persist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist, queryClient]);

  const isFavorite = useCallback(
    (path: string) => favorites.some((f) => f.path === path),
    [favorites],
  );

  return { favorites, toggleFavorite, isFavorite };
}
