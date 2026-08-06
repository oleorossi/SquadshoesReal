-- ═══════════════════════════════════════════════════════════════════════════
-- Catálogo — dois consertos achados na auditoria de 06/08/2026:
--
-- 1) COR REMOVIDA NÃO PODIA SER RECADASTRADA.
--    `useDeleteCatalogColor` faz soft-delete (ativo = false), mas
--    `idx_catalog_colors_nome` é UNIQUE em lower(trim(nome)) SEM filtrar por
--    ativo. Resultado: remover "VERDE MENTA" e tentar cadastrar de novo estoura
--    `duplicate key value violates unique constraint`, com a mensagem crua do
--    Postgres num toast. 100% reproduzível.
--
--    Conserto por RPC em vez de índice parcial de propósito: índice parcial
--    (`where ativo`) deixaria acumular uma linha morta por nome recadastrado, e
--    o histórico da cartela viraria lixo. `upsert_catalog_color` REATIVA a linha
--    que já existe — a cor volta com o hex/grupo novos e sem duplicata.
--
-- 2) GERAR ERA DE ADMIN/GERENTE, DESTRUIR ERA DE TODO MUNDO.
--    A Edge Function exige admin/gerente pra gastar crédito de IA, mas as
--    policies deixavam QUALQUER usuário aprovado apagar `catalog_photos` e
--    desativar cores da cartela. Assimetria sem motivo: alinhado ao mesmo papel.
--    SELECT continua aberto a aprovado — ver catálogo é o ponto da tela.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Recadastro de cor ────────────────────────────────────────────────────
-- SECURITY INVOKER (default) de propósito: quem manda no acesso são as policies
-- de INSERT/UPDATE abaixo, não a função. Definer aqui viraria um bypass de RLS.
create or replace function public.upsert_catalog_color(
  p_nome text,
  p_hex text,
  p_grupo text default 'Minhas cores'
)
returns public.catalog_colors
language plpgsql
set search_path = public
as $$
declare
  v_nome text := upper(trim(p_nome));
  v_hex  text := upper(trim(p_hex));
  v_row  public.catalog_colors;
begin
  if v_nome = '' then
    raise exception 'Dê um nome pra cor.';
  end if;
  if v_hex !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Hex inválido (use #RRGGBB).';
  end if;

  insert into public.catalog_colors (nome, hex, grupo, ordem, ativo)
  values (v_nome, v_hex, coalesce(nullif(trim(p_grupo), ''), 'Minhas cores'), 99, true)
  on conflict ((lower(trim(nome)))) do update
    set hex   = excluded.hex,
        grupo = excluded.grupo,
        ativo = true          -- ressuscita a cor removida por soft-delete
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.upsert_catalog_color(text, text, text) is
  'Cadastra ou REATIVA uma cor da cartela do catálogo. Existe porque o soft-delete '
  '(ativo=false) mais o índice UNIQUE em lower(trim(nome)) impediam recadastrar uma '
  'cor removida (auditoria 06/08/2026).';

revoke all on function public.upsert_catalog_color(text, text, text) from public;
grant execute on function public.upsert_catalog_color(text, text, text) to authenticated;

-- ── 2) Simetria de permissão: quem gera é quem mexe ─────────────────────────
drop policy if exists catalog_photos_delete on public.catalog_photos;
create policy catalog_photos_delete on public.catalog_photos
  for delete using (public.is_admin_or_gerente(auth.uid()));

drop policy if exists catalog_photos_insert on public.catalog_photos;
create policy catalog_photos_insert on public.catalog_photos
  for insert with check (public.is_admin_or_gerente(auth.uid()));

drop policy if exists catalog_colors_insert on public.catalog_colors;
create policy catalog_colors_insert on public.catalog_colors
  for insert with check (public.is_admin_or_gerente(auth.uid()));

drop policy if exists catalog_colors_update on public.catalog_colors;
create policy catalog_colors_update on public.catalog_colors
  for update using (public.is_admin_or_gerente(auth.uid()))
  with check (public.is_admin_or_gerente(auth.uid()));

drop policy if exists catalog_colors_delete on public.catalog_colors;
create policy catalog_colors_delete on public.catalog_colors
  for delete using (public.is_admin_or_gerente(auth.uid()));
