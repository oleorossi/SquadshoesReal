-- Tabela: public.ficha_montadores  (Ficha de Montadores)
-- A tabela JÁ está aplicada em produção (projeto ssvxfoybzmjlypnipqzn), criada via
-- SQL Editor/MCP. Este arquivo apenas RASTREIA o schema no repositório. Tudo aqui é
-- IDEMPOTENTE (if not exists / drop policy if exists) pra um eventual `db push` do
-- GitHub Action não quebrar ao reencontrar objetos já existentes.
--
-- RLS no mesmo padrão das demais tabelas: leitura autenticada, escrita via is_approved_user().

create table if not exists public.ficha_montadores (
  id uuid primary key default gen_random_uuid(),
  dia date not null default current_date,
  montador text,
  solado text,
  grade text not null default 'adulto',
  numeracoes jsonb not null default '[]'::jsonb,   -- ex.: ["34","35",...]
  quantidades jsonb not null default '[]'::jsonb,  -- ex.: ["1","1","3",...] (paralelo a numeracoes)
  total integer not null default 0,                -- soma das quantidades
  copias integer not null default 1,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint ficha_montadores_grade_chk check (grade in ('adulto','infantil'))
);

create index if not exists ficha_montadores_dia_idx
  on public.ficha_montadores (dia desc, criado_em desc);

alter table public.ficha_montadores enable row level security;

drop policy if exists "ficha_montadores_select_auth" on public.ficha_montadores;
create policy "ficha_montadores_select_auth" on public.ficha_montadores
  for select to authenticated using (true);

drop policy if exists "ficha_montadores_insert_approved" on public.ficha_montadores;
create policy "ficha_montadores_insert_approved" on public.ficha_montadores
  for insert to authenticated with check (is_approved_user());

drop policy if exists "ficha_montadores_update_approved" on public.ficha_montadores;
create policy "ficha_montadores_update_approved" on public.ficha_montadores
  for update to authenticated using (is_approved_user()) with check (is_approved_user());

drop policy if exists "ficha_montadores_delete_approved" on public.ficha_montadores;
create policy "ficha_montadores_delete_approved" on public.ficha_montadores
  for delete to authenticated using (is_approved_user());
