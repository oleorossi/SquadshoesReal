-- ============================================================================
-- P0 Segurança — lockdown de acesso anon  (auditoria de sistema 2026-06-29)
--
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn no mesmo dia; este arquivo é o
-- registro no repo. Fecha 3 achados P0 da auditoria:
--   A1 — ~21 RPCs mutadoras chamáveis estavam executáveis pelo `anon` (chave
--        pública do bundle) → qualquer um sem login criava produto, avançava
--        produção, debitava estoque. Verificado ao vivo: 100% das funções
--        executáveis por anon também o eram por authenticated, então revogar de
--        PUBLIC/anon e re-conceder a authenticated/service_role NÃO quebra fluxo
--        logado. Trigger fns (tg_*/fn_sync_*) ficam de fora — rodam em contexto
--        de trigger e não precisam de grant ao chamador.
--   A2 — `bom_part_sector_map` e `sector_minutes_default` tinham RLS off + anon
--        com DML/TRUNCATE. São lidas só por funções definer server-side (o
--        frontend não acessa direto). RLS ligado; leitura p/ authenticated;
--        escrita admin-gated (defense-in-depth).
--   B5 — `_audit_stock_sync_20260614`: tabela temp de auditoria esquecida
--        (RLS off, anon-writable) → drop.
-- ============================================================================

-- A1 ─────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'advance_order_to_sector','commit_picking_session','populate_picking_session_from_sale_order',
        'create_product_with_initial_stock','create_artisanal_product_with_stock',
        'debit_packaging_for_order_atomic','generate_bom_operations',
        'recompute_sale_order_cmv_recognition','refresh_supplier_lead_time_stats',
        'send_all_terceirizacao_os','send_terceirizacao_os','update_terceirizacao_os_qty',
        'upsert_po_item_atomic','upsert_ready_stock_atomic','apply_inventory_count',
        'open_inventory_count','record_receipt_inspection','move_stock_status',
        'create_po_from_quotation','mdfe_draft_from_manifest','apply_time_study_to_bom'
      ])
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- A2 ─────────────────────────────────────────────────────────────────────────
alter table public.bom_part_sector_map   enable row level security;
alter table public.sector_minutes_default enable row level security;
revoke all on public.bom_part_sector_map   from anon;
revoke all on public.sector_minutes_default from anon;

drop policy if exists bom_part_sector_map_read  on public.bom_part_sector_map;
drop policy if exists bom_part_sector_map_write on public.bom_part_sector_map;
create policy bom_part_sector_map_read  on public.bom_part_sector_map
  for select to authenticated using (true);
create policy bom_part_sector_map_write on public.bom_part_sector_map
  for all to authenticated using (public.user_has_role('admin')) with check (public.user_has_role('admin'));

drop policy if exists sector_minutes_default_read  on public.sector_minutes_default;
drop policy if exists sector_minutes_default_write on public.sector_minutes_default;
create policy sector_minutes_default_read  on public.sector_minutes_default
  for select to authenticated using (true);
create policy sector_minutes_default_write on public.sector_minutes_default
  for all to authenticated using (public.user_has_role('admin')) with check (public.user_has_role('admin'));

-- B5 ─────────────────────────────────────────────────────────────────────────
drop table if exists public._audit_stock_sync_20260614;
