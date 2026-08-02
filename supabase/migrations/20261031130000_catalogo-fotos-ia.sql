-- ═══════════════════════════════════════════════════════════════════════════
-- Catálogo com fotos geradas por IA (decisões do dono, 2026-08-01):
--   • catalog_colors  — cartela de cores do CATÁLOGO, independente de `colors`
--     (que pertence às fichas técnicas, não tem hex preenchido e tem nomes
--     duplicados). Seed com a cartela oficial de 22 cores.
--   • catalog_photos  — fotos de estúdio geradas pela Edge Function
--     `generate-catalog-photo` (gpt-image-1), armazenadas no bucket público
--     `reference-images` sob o prefixo catalog/.
-- A lâmina do catálogo é montada no cliente (canvas) — não há tabela de lâmina.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.catalog_colors (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  hex text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  grupo text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_catalog_colors_nome
  on public.catalog_colors (lower(trim(nome)));

alter table public.catalog_colors enable row level security;

drop policy if exists catalog_colors_select on public.catalog_colors;
create policy catalog_colors_select on public.catalog_colors
  for select using (is_approved_user());
drop policy if exists catalog_colors_insert on public.catalog_colors;
create policy catalog_colors_insert on public.catalog_colors
  for insert with check (is_approved_user());
drop policy if exists catalog_colors_update on public.catalog_colors;
create policy catalog_colors_update on public.catalog_colors
  for update using (is_approved_user());
drop policy if exists catalog_colors_delete on public.catalog_colors;
create policy catalog_colors_delete on public.catalog_colors
  for delete using (is_approved_user());

create table if not exists public.catalog_photos (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid references public.technical_sheets(id) on delete set null,
  reference_code text,
  color_nome text not null,
  color_hex text,
  image_url text not null,
  source_image_url text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_catalog_photos_reference
  on public.catalog_photos (reference_id, created_at desc);

alter table public.catalog_photos enable row level security;

drop policy if exists catalog_photos_select on public.catalog_photos;
create policy catalog_photos_select on public.catalog_photos
  for select using (is_approved_user());
-- INSERT acontece pela Edge Function (service role, bypassa RLS); a policy
-- abaixo existe pra permitir registro manual futuro sem nova migration.
drop policy if exists catalog_photos_insert on public.catalog_photos;
create policy catalog_photos_insert on public.catalog_photos
  for insert with check (is_approved_user());
drop policy if exists catalog_photos_delete on public.catalog_photos;
create policy catalog_photos_delete on public.catalog_photos
  for delete using (is_approved_user());

-- Seed da cartela oficial (idempotente — não sobrescreve edições do usuário)
insert into public.catalog_colors (nome, hex, grupo, ordem) values
  ('PRETO',      '#1A1A1B', 'Tons Escuros e Amadeirados', 1),
  ('TÂMARA',     '#5D3A2D', 'Tons Escuros e Amadeirados', 2),
  ('NEW WHISKY', '#8B5A2B', 'Tons Escuros e Amadeirados', 3),
  ('NEW TAN',    '#B68A64', 'Tons Escuros e Amadeirados', 4),
  ('NATURAL',    '#D2B48C', 'Tons Escuros e Amadeirados', 5),
  ('COGUMELO',   '#B8A99A', 'Tons Escuros e Amadeirados', 6),
  ('CARMIM',     '#A83232', 'Tons Vibrantes e Quentes',   7),
  ('CERRADO',    '#B5651D', 'Tons Vibrantes e Quentes',   8),
  ('CAPPUCCINO', '#967959', 'Tons Vibrantes e Quentes',   9),
  ('TEQUILA',    '#D4B179', 'Tons Vibrantes e Quentes',  10),
  ('PORCELANA',  '#EBE0C5', 'Tons Vibrantes e Quentes',  11),
  ('LIMONCELLO', '#FDFD96', 'Tons Vibrantes e Quentes',  12),
  ('ORGANZA',    '#E9C7AC', 'Tons Pastéis e Suaves',     13),
  ('DÁLIA',      '#E8C1C1', 'Tons Pastéis e Suaves',     14),
  ('ADOCICADO',  '#F4E4E9', 'Tons Pastéis e Suaves',     15),
  ('PICOLÉ',     '#C5C5E2', 'Tons Pastéis e Suaves',     16),
  ('OFF WHITE',  '#E8E9E4', 'Tons Pastéis e Suaves',     17),
  ('CHANTILLY',  '#F2E8D5', 'Tons Pastéis e Suaves',     18),
  ('ERVA-MATE',  '#7B846F', 'Tons Natureza e Base',      19),
  ('GRAPE',      '#C2C690', 'Tons Natureza e Base',      20),
  ('BABY BLUE',  '#BDD4E7', 'Tons Natureza e Base',      21),
  ('BRANCO',     '#FFFFFF', 'Tons Natureza e Base',      22)
on conflict ((lower(trim(nome)))) do nothing;
