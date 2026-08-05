-- Hardening: fixa search_path nas 55 funcoes de public que ainda tinham search_path MUTAVEL.
--
-- Contexto (auditoria de seguranca 05/08/2026, advisor `function_search_path_mutable`):
-- as 351 funcoes SECURITY DEFINER de public JA tinham search_path fixado. As 55 restantes
-- sao SECURITY INVOKER (rodam como o chamador) -- risco menor, mas ainda sequestravel:
-- basta um role com CREATE em algum schema do search_path do chamador plantar um objeto
-- homonimo. Vale principalmente para as 24 que sao funcoes de TRIGGER: elas rodam sob o
-- search_path de quem faz o INSERT/UPDATE, nao sob um controlado.
--
-- POR QUE NAO MUDA COMPORTAMENTO
-- Toda referencia a schema NAO-public dentro dessas 55 ja e totalmente qualificada:
--   * capacity_set_updated_by / tg_economic_groups_audit / tg_payroll_payment_guard -> auth.uid()
--   * normalize_search -> extensions.unaccent('extensions.unaccent'::regdictionary, ...)
-- Como a resolucao nao depende do search_path nesses casos, `public, pg_temp` basta.
--
-- pg_temp vai por ULTIMO de proposito: se ficasse implicito (no inicio, que e o default do
-- Postgres), um usuario poderia criar uma tabela temporaria homonima e sequestrar a resolucao.
--
-- CUIDADO VERIFICADO ANTES DE APLICAR
-- normalize_search(text) alimenta 16 colunas GENERATED ALWAYS ... STORED (clients.search_norm,
-- products.search_norm, orders, sale_orders, ...) e br_today() e DEFAULT de
-- production_engine_runs.ran_on. Testado em transacao com ROLLBACK: a saida e byte-a-byte
-- identica antes/depois ('Acao C Unica 123-x Sao Jose' -> 'acaocunica123xsaojose'), logo os
-- valores ja materializados continuam validos e nao ha backfill a fazer.
-- Nenhuma das 55 aparece em expressao de INDICE (checado em pg_index), entao nao ha indice
-- funcional a reconstruir.
--
-- EFEITO COLATERAL CONHECIDO (aceito): funcao SQL com clausula SET deixa de ser "inlinable"
-- pelo planner. Sao helpers escalares pequenos (ficha_pares, po_norm_unit, punch_to_min...);
-- o custo e uma chamada de funcao por linha em vez da expressao expandida.

ALTER FUNCTION public.apply_time_study_to_bom(p_study_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.br_today() SET search_path = public, pg_temp;
ALTER FUNCTION public.caixa_collective_type(p_name text) SET search_path = public, pg_temp;
ALTER FUNCTION public.calculate_day_summary(p_punches jsonb, p_expected_min integer, p_tolerance_min integer, p_minimum_overtime integer, p_is_holiday boolean, p_has_lunch boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.capacity_sector_key(p_sector text) SET search_path = public, pg_temp;
ALTER FUNCTION public.capacity_sector_label(p_key text) SET search_path = public, pg_temp;
ALTER FUNCTION public.capacity_set_updated_by() SET search_path = public, pg_temp;
ALTER FUNCTION public.classify_movement_reason(p_type text, p_description text, p_order_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.ficha_is_chamada(p_origem text, p_numeracoes jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.ficha_pares(p_detalhe jsonb, p_total integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.ficha_valor(p_detalhe jsonb, p_total integer, p_vp numeric, p_vpm numeric, p_vpd numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.filter_caixa_by_packaging_mode(p_cons jsonb, p_packaging_mode text) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_group_sector_cascade_children() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_guard_group_parent() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_guard_product_group_is_leaf() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_client_commercial_defaults(p_client_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_group_stock_rollups() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_material_conversion_info(p_product_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_workflow_stats(p_id uuid, p_success boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_countable_purchase_unit(p_unit text) SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_order_color() SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_product_color() SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_search(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.packaging_mode_collective_type(p_mode text) SET search_path = public, pg_temp;
ALTER FUNCTION public.payroll_period_range(p_period text) SET search_path = public, pg_temp;
ALTER FUNCTION public.po_norm_unit(p_unit text) SET search_path = public, pg_temp;
ALTER FUNCTION public.punch_to_min(p jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.recompute_payroll_paid(p_run uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.scale_grade_to_total(p_grade jsonb, p_total numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.sector_grouping_config_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.strip_diagnostic_consumption_lines(p_cons jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.suggest_group_families() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_block_zero_unit_price() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_company_settings_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_economic_groups_audit() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_eg_contacts_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_enforce_sale_order_item_qty() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_guard_implausible_consumption() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_guard_implausible_sole_spec() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_note_tasks_touch() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_order_lots_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_payroll_lock_finalized() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_payroll_payment_guard() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_poi_coalesce_stock_snapshots() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_require_width_for_area_material() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_sale_orders_default_nfe_required() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_sdp_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_service_order_orphan_guard() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_stamp_order_stage_wip_timestamps() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_stock_movements_fill_reason() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_strip_invalid_direct_components() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_sync_payroll_paid() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_timesheet_periods_updated_at() SET search_path = public, pg_temp;

-- Trava anti-regressao: se sobrar QUALQUER funcao sql/plpgsql em public sem search_path,
-- a migration falha em vez de passar silenciosamente.
DO $$
DECLARE v_faltando text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_faltando
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND l.lanname IN ('sql', 'plpgsql')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%'
    );

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Funcoes em public ainda sem search_path fixado: %', v_faltando;
  END IF;
END $$;
