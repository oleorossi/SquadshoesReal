-- Auditoria de segurança: fecha RPCs privilegiadas expostas pelo default EXECUTE
-- de authenticated. Toda função nova passa a exigir GRANT explícito.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

-- Funções internas nunca devem ser endpoints diretos do PostgREST.
REVOKE ALL ON FUNCTION public.force_delete_product(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compact_sale_order_items(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compact_orders_by_ref_color(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_op_service_orders(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.double_upper_consumption(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.relink_direct_component(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_orphan_direct_components() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_sheet_sector_operation(uuid, text, text, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- Reinsere o acesso autenticado APENAS depois de instalar as verificações
-- internas. Isto preserva a UI existente sem confiar em controles do browser.
DO $hardening$
DECLARE
  v_fn regprocedure;
  v_def text;
  v_guard text;
BEGIN
  FOR v_fn, v_guard IN
    SELECT * FROM (VALUES
      ('public.force_delete_product(uuid)'::regprocedure, 'admin'),
      ('public.compact_sale_order_items(uuid)'::regprocedure, 'admin'),
      ('public.compact_orders_by_ref_color(uuid)'::regprocedure, 'admin'),
      ('public.generate_op_service_orders(uuid,jsonb)'::regprocedure, 'admin,gerente,producao'),
      ('public.double_upper_consumption(uuid[])'::regprocedure, 'admin,gerente'),
      ('public.relink_direct_component(uuid,uuid)'::regprocedure, 'admin,gerente'),
      ('public.set_sheet_sector_operation(uuid,text,text,numeric,numeric)'::regprocedure, 'admin,gerente')
    ) AS g(fn, roles)
  LOOP
    v_def := pg_get_functiondef(v_fn);
    v_def := regexp_replace(v_def, E'\\nBEGIN\\n', E'\\nBEGIN\\n  IF auth.role() <> ''service_role'' AND NOT public.user_has_any_role(ARRAY[' ||
      (SELECT string_agg(quote_literal(r), ',') FROM unnest(string_to_array(v_guard, ',')) r) ||
      E']) THEN RAISE EXCEPTION ''Permission denied''; END IF;\\n', 1, 1, '');
    EXECUTE v_def;
  END LOOP;
END $hardening$;

CREATE OR REPLACE FUNCTION public.list_orphan_direct_components()
RETURNS TABLE(dead_product_id uuid, names text[], sheets_count integer, sheet_names text[], quantities numeric[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.user_has_any_role(ARRAY['admin','gerente']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  RETURN QUERY
    SELECT (dc ->> 'product_id')::uuid,
      array_agg(DISTINCT btrim(COALESCE(dc ->> 'product_name', ''))), count(DISTINCT ts.id)::int,
      array_agg(DISTINCT COALESCE(NULLIF(btrim(ts.name), ''), ts.code)),
      array_agg(DISTINCT COALESCE((dc ->> 'quantity')::numeric, 0))
    FROM public.technical_sheets ts, LATERAL jsonb_array_elements(ts.direct_components) dc
    WHERE ts.direct_components IS NOT NULL AND jsonb_typeof(ts.direct_components) = 'array'
      AND dc ->> 'product_id' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = (dc ->> 'product_id')::uuid)
    GROUP BY 1 ORDER BY 3 DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.force_delete_product(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compact_sale_order_items(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compact_orders_by_ref_color(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_op_service_orders(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.double_upper_consumption(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.relink_direct_component(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_orphan_direct_components() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_sheet_sector_operation(uuid, text, text, numeric, numeric) TO authenticated, service_role;

-- Único endpoint humano de compactação: exige administração e mantém as duas
-- primitivas de trabalho inacessíveis diretamente.
CREATE OR REPLACE FUNCTION public.compact_sale_order(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_items_kept int; v_items_removed int;
  v_ops_kept int; v_ops_removed int; v_nf_skipped int;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied: apenas administradores podem consolidar PV/OP';
  END IF;
  SELECT * INTO v_ops_kept, v_ops_removed, v_nf_skipped
    FROM public.compact_orders_by_ref_color(p_sale_order_id);
  IF v_nf_skipped > 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'NF-e emitida — PV imutável');
  END IF;
  SELECT * INTO v_items_kept, v_items_removed
    FROM public.compact_sale_order_items(p_sale_order_id);
  RETURN jsonb_build_object('items_kept', COALESCE(v_items_kept,0),
    'items_removed', COALESCE(v_items_removed,0),
    'ops_kept', COALESCE(v_ops_kept,0), 'ops_removed', COALESCE(v_ops_removed,0));
END;
$function$;
REVOKE ALL ON FUNCTION public.compact_sale_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compact_sale_order(uuid) TO authenticated, service_role;

-- Não permitir que uma OP já finalizada impeça a recriação legítima da OP do item.
DROP INDEX IF EXISTS public.uq_orders_active_per_sale_order_item;

-- Garante que uma OS originada de PV não exceda a OP. A validação está no banco
-- para cobrir chamadas diretas, RPCs e fluxos futuros.
CREATE OR REPLACE FUNCTION public.tg_guard_service_order_from_op()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE v_order_qty numeric;
BEGIN
  IF NEW.order_id IS NULL OR NEW.source_sale_order_id IS NULL THEN RETURN NEW; END IF;
  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = NEW.order_id;
  IF v_order_qty IS NULL THEN RAISE EXCEPTION 'OP de origem não encontrada'; END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 OR NEW.quantity > v_order_qty THEN
    RAISE EXCEPTION 'Quantidade da OS (%) deve estar entre 1 e a quantidade da OP (%)', NEW.quantity, v_order_qty;
  END IF;
  IF COALESCE(NEW.target_sector, '') NOT IN
     ('corte_cabedal','costura','corte_palmilha','corte_forracao','silk','montagem','solagem','acabamento') THEN
    RAISE EXCEPTION 'Setor de terceirização inválido: %', NEW.target_sector;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_guard_service_order_from_op ON public.service_orders;
CREATE TRIGGER trg_guard_service_order_from_op
  BEFORE INSERT OR UPDATE OF order_id, source_sale_order_id, quantity, target_sector
  ON public.service_orders FOR EACH ROW EXECUTE FUNCTION public.tg_guard_service_order_from_op();
