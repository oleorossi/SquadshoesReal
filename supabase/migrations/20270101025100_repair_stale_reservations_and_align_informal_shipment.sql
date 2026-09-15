-- Lacunas 2–4 da auditoria do motor (2026-09-14):
--   2) RPC admin pra reservar o DELTA das OPs com reserva defasada vs ficha
--      (usa reserve_missing_materials_for_order — seguro inclusive em OPs com
--      fato físico / PZ105; NÃO chama resync_op_atomic).
--   4) Path informal (Em Produção) deixa de exigir OP já Finalizado na
--      conferência/romaneio — o register_order_shipment_command já fecha
--      etapas e marca OPs Finalizado, igual ao path Faturado.

BEGIN;

-- ---------------------------------------------------------------------------
-- 2) Admin: dry-run / apply do delta de reserva nas OPs stale
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_repair_stale_reservations(
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_op_id uuid;
  v_order_number text;
  v_sale_order_number text;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ops integer := 0;
  v_ok integer := 0;
  v_fail integer := 0;
  v_lines integer := 0;
BEGIN
  -- Postgres/migrations, service_role (MCP/jobs) ou admin/gerente autenticado.
  IF current_user NOT IN ('postgres', 'supabase_admin')
     AND COALESCE(current_setting('request.jwt.claim.role', true), '')
         <> 'service_role'
     AND (
       auth.uid() IS NULL
       OR NOT public.is_admin_or_gerente(auth.uid())
     ) THEN
    RAISE EXCEPTION 'Somente admin/gerente pode reparar reservas defasadas'
      USING ERRCODE = '42501';
  END IF;

  -- reserve_missing_materials_for_order exige is_approved_user(), que aceita
  -- service_role. Em sessão postgres/MCP não há JWT — propaga o claim localmente
  -- só nesta transação, depois da guarda admin acima.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT count(*)::integer INTO v_lines
    FROM public.list_ops_with_stale_reservations();

  FOR v_op_id, v_order_number, v_sale_order_number IN
    SELECT DISTINCT s.order_id, s.order_number, s.sale_order_number
      FROM public.list_ops_with_stale_reservations() s
     ORDER BY s.sale_order_number NULLS LAST, s.order_number
  LOOP
    v_ops := v_ops + 1;
    BEGIN
      v_res := public.reserve_missing_materials_for_order(v_op_id, p_dry_run);
      v_ok := v_ok + 1;
      v_results := v_results || jsonb_build_object(
        'order_id', v_op_id,
        'order_number', v_order_number,
        'sale_order_number', v_sale_order_number,
        'ok', true,
        'result', v_res
      );
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
      v_results := v_results || jsonb_build_object(
        'order_id', v_op_id,
        'order_number', v_order_number,
        'sale_order_number', v_sale_order_number,
        'ok', false,
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', COALESCE(p_dry_run, true),
    'stale_lines_before', v_lines,
    'ops_touched', v_ops,
    'ops_ok', v_ok,
    'ops_failed', v_fail,
    'ops_with_shortfall', (
      SELECT count(*)::integer
        FROM jsonb_array_elements(v_results) r
       WHERE COALESCE(jsonb_array_length(r->'result'->'shortfalls'), 0) > 0
    ),
    'results', v_results
  );
END;
$fn$;

COMMENT ON FUNCTION public.admin_repair_stale_reservations(boolean) IS
  'Admin/gerente: reserva o DELTA de material que a ficha atual pede e a OP ativa ainda não cobre (list_ops_with_stale_reservations → reserve_missing_materials_for_order). p_dry_run=true só simula. Não faz resync_op_atomic (seguro em OP com fato físico).';

REVOKE ALL ON FUNCTION public.admin_repair_stale_reservations(boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_repair_stale_reservations(boolean)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Alinhar preflight informal com path Faturado (romaneio fecha as OPs)
-- ---------------------------------------------------------------------------

DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_after text;
  v_old text;
  v_new text;
BEGIN
  SELECT p.oid, pg_catalog.pg_get_functiondef(p.oid)
    INTO v_oid, v_definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'register_order_shipment_command'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
       'p_sale_order_ids uuid[], p_expected_versions jsonb, p_manifest_id uuid, p_checked_by text, p_client_request_id uuid';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'register_order_shipment_command(uuid[],jsonb,uuid,text,uuid) ausente';
  END IF;

  v_old :=
    E'    IF v_so.status = ''Em Produção''\n'
    || E'       AND (\n'
    || E'         NOT EXISTS (\n'
    || E'           SELECT 1\n'
    || E'             FROM public.orders o\n'
    || E'            WHERE o.sale_order_id = v_so.id\n'
    || E'              AND o.deleted_at IS NULL\n'
    || E'              AND o.status NOT IN (''Cancelado'', ''Cancelada'')\n'
    || E'         )\n'
    || E'         OR EXISTS (\n'
    || E'           SELECT 1\n'
    || E'             FROM public.orders o\n'
    || E'            WHERE o.sale_order_id = v_so.id\n'
    || E'              AND o.deleted_at IS NULL\n'
    || E'              AND o.status NOT IN (\n'
    || E'                ''Finalizado'', ''FINALIZADO'', ''Faturado'',\n'
    || E'                ''Concluída'', ''Concluído'', ''Concluido'', ''completed'',\n'
    || E'                ''Cancelado'', ''Cancelada''\n'
    || E'              )\n'
    || E'         )\n'
    || E'       ) THEN\n'
    || E'      RAISE EXCEPTION ''PV % ainda possui OP em produção'', v_so.order_number\n'
    || E'        USING ERRCODE = ''PZ216'';\n'
    || E'    END IF;\n';

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    -- Idempotente: já patchado nesta ou em sessão anterior.
    IF pg_catalog.strpos(
         v_definition,
         'não possui OP ativa para expedir'
       ) > 0 THEN
      RAISE NOTICE
        'register_order_shipment_command já alinhado (gate Finalizado removido)';
      RETURN;
    END IF;
    RAISE EXCEPTION
      'Drift em register_order_shipment_command: gate OP-Finalizado informal ausente/alterado';
  END IF;

  v_new :=
    E'    -- Path informal / NF externa: o romaneio fecha etapas e marca OPs\n'
    || E'    -- Finalizado (igual ao path Faturado). Exigir Finalizado antes\n'
    || E'    -- bloqueava conferência de PV Em Produção sem NF.\n'
    || E'    IF v_so.status = ''Em Produção''\n'
    || E'       AND NOT EXISTS (\n'
    || E'         SELECT 1\n'
    || E'           FROM public.orders o\n'
    || E'          WHERE o.sale_order_id = v_so.id\n'
    || E'            AND o.deleted_at IS NULL\n'
    || E'            AND o.status NOT IN (''Cancelado'', ''Cancelada'')\n'
    || E'       ) THEN\n'
    || E'      RAISE EXCEPTION ''PV % não possui OP ativa para expedir'', v_so.order_number\n'
    || E'        USING ERRCODE = ''PZ216'';\n'
    || E'    END IF;\n';

  v_after := pg_catalog.replace(v_definition, v_old, v_new);
  IF v_after = v_definition THEN
    RAISE EXCEPTION
      'Drift em register_order_shipment_command: patch informal não aplicado';
  END IF;

  EXECUTE v_after;
END;
$migration$;

REVOKE ALL ON FUNCTION public.register_order_shipment_command(
  uuid[], jsonb, uuid, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_order_shipment_command(
  uuid[], jsonb, uuid, text, uuid
) TO authenticated, service_role;

COMMIT;
