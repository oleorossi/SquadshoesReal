-- ============================================================================
-- SEGURANÇA (advisors Supabase, auditoria 2026-06-09): funções SECURITY
-- DEFINER executáveis por `anon` — incluindo criação de produto COM estoque
-- por usuário não autenticado. Espelha o padrão de
-- 20260704130000_fiscal-revoke-anon-write-grants. Funções de trigger (tg_*)
-- rodam como owner via trigger — revogar EXECUTE de anon não afeta triggers.
-- `authenticated` mantém o acesso atual.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.create_artisanal_product_with_stock(text, text, numeric, text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_product_with_initial_stock(text, text, text, text, text, numeric, numeric, numeric, numeric, uuid, text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_sync_fichas_from_sole_grade_change() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_sole_size_key(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_orphan_reservations() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_supplier_lead_time_stats(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_item_brand(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_fill_component_sheet_dims_from_group() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_inherit_component_sheet_on_product() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_refresh_supplier_lead_time_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_release_reservations_on_order_terminal() FROM anon;
REVOKE EXECUTE ON FUNCTION public.tg_reverse_revenue_on_untracked_cancel() FROM anon;
