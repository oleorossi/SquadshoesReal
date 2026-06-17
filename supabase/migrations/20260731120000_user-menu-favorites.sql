-- Favoritos do menu lateral, por usuário.
--
-- Antes os favoritos viviam SÓ no localStorage do navegador (chave
-- 'menu-favorites'). Isso é por-navegador e por-origem, então eles sumiam ao:
--   • limpar cache/dados do site,
--   • abrir em outro navegador / dispositivo / aba anônima,
--   • mudar de domínio (migração Lovable → Vercel, URLs de deploy diferentes),
--   • reinstalar o PWA.
-- Agora persistem no banco, atrelados ao auth.uid(), e sobrevivem a tudo isso.
--
-- Modelo: 1 linha por usuário com a lista ORDENADA em JSONB no formato exato do
-- localStorage ([{ "name": "...", "path": "/..." }]) — preserva a ordem e mantém
-- o front simples (lê/escreve a lista inteira via upsert).

create table if not exists public.user_menu_favorites (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  favorites  jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_menu_favorites enable row level security;

-- Cada usuário só enxerga / altera os próprios favoritos.
drop policy if exists "user_menu_favorites_select_own" on public.user_menu_favorites;
create policy "user_menu_favorites_select_own"
  on public.user_menu_favorites for select
  using (auth.uid() = user_id);

drop policy if exists "user_menu_favorites_insert_own" on public.user_menu_favorites;
create policy "user_menu_favorites_insert_own"
  on public.user_menu_favorites for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_menu_favorites_update_own" on public.user_menu_favorites;
create policy "user_menu_favorites_update_own"
  on public.user_menu_favorites for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_menu_favorites_delete_own" on public.user_menu_favorites;
create policy "user_menu_favorites_delete_own"
  on public.user_menu_favorites for delete
  using (auth.uid() = user_id);
