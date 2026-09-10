-- =============================================================================
-- Componentes diretos "invisíveis" na UI — inclui inativos (não só apagados)
-- =============================================================================
-- Sintoma (PV-00194 / NL03 · Elástico 6MM):
--   Consumo SQL emite a linha (JOIN products SEM filtro active).
--   DirectComponentSelect só listava active=true → seletor em branco.
--   list_orphan_direct_components só pegava produto APAGADO → inativo escapava
--   do painel de Diagnósticos.
--
-- Esta migration:
--   1) list_orphan_direct_components passa a devolver também inactive
--      (coluna reason: 'deleted' | 'inactive')
--   2) relink_direct_component aceita origem inativa (além de apagada);
--      destino precisa ser ativo
-- Marcador: dc_inactive_blank_ui_20270101022700
--
-- ⚠ Postgres recusa CREATE OR REPLACE quando muda OUT/RETURNS TABLE
-- (SQLSTATE 42P13). A coluna `reason` é nova → DROP antes de recriar.
-- =============================================================================

DROP FUNCTION IF EXISTS public.list_orphan_direct_components();

CREATE OR REPLACE FUNCTION public.list_orphan_direct_components()
RETURNS TABLE(
  dead_product_id uuid,
  names text[],
  sheets_count integer,
  sheet_names text[],
  quantities numeric[],
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- dc_inactive_blank_ui_20270101022700
  IF auth.role() <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin','gerente']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  WITH broken AS (
    SELECT
      (dc ->> 'product_id')::uuid AS pid,
      btrim(COALESCE(dc ->> 'product_name', '')) AS snap_name,
      COALESCE(NULLIF(btrim(ts.name), ''), ts.code) AS sheet_label,
      ts.id AS sheet_id,
      COALESCE((dc ->> 'quantity')::numeric, 0) AS qty,
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = (dc ->> 'product_id')::uuid)
          THEN 'deleted'
        WHEN EXISTS (
          SELECT 1 FROM public.products p
           WHERE p.id = (dc ->> 'product_id')::uuid AND p.active IS NOT TRUE
        ) THEN 'inactive'
        ELSE NULL
      END AS why
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(ts.direct_components) dc
    WHERE ts.direct_components IS NOT NULL
      AND jsonb_typeof(ts.direct_components) = 'array'
      AND dc ->> 'product_id' IS NOT NULL
      AND (dc ->> 'product_id') ~* '^[0-9a-f-]{36}$'
  )
  SELECT
    b.pid,
    array_agg(DISTINCT NULLIF(b.snap_name, '')) FILTER (WHERE NULLIF(b.snap_name, '') IS NOT NULL),
    count(DISTINCT b.sheet_id)::int,
    array_agg(DISTINCT b.sheet_label),
    array_agg(DISTINCT b.qty),
    b.why
  FROM broken b
  WHERE b.why IS NOT NULL
  GROUP BY b.pid, b.why
  ORDER BY count(DISTINCT b.sheet_id) DESC, b.why, b.pid;
END;
$function$;

COMMENT ON FUNCTION public.list_orphan_direct_components() IS
  'Componentes diretos cujo product_id foi apagado OU está inativo. '
  'Inativo some do seletor da ficha (só lista active) mas o motor SQL ainda '
  'debita — reason=inactive. Apagado → reason=deleted.';

CREATE OR REPLACE FUNCTION public.relink_direct_component(
  p_dead_product_id uuid,
  p_new_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_new_name text;
  v_sheets int := 0;
  v_dead_active boolean;
BEGIN
  -- dc_inactive_blank_ui_20270101022700
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_dead_product_id IS NULL OR p_new_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id origem e destino são obrigatórios';
  END IF;
  IF p_dead_product_id = p_new_product_id THEN
    RAISE EXCEPTION 'Origem e destino são o mesmo produto';
  END IF;

  SELECT p.name INTO v_new_name
    FROM public.products p
   WHERE p.id = p_new_product_id AND p.active IS TRUE;
  IF v_new_name IS NULL THEN
    RAISE EXCEPTION 'Produto destino % não existe ou está inativo', p_new_product_id;
  END IF;

  SELECT p.active INTO v_dead_active
    FROM public.products p WHERE p.id = p_dead_product_id;
  -- Apagado (NULL) ou inativo (false) → pode religar.
  -- Ativo (true) → não é órfão; recusa.
  IF v_dead_active IS TRUE THEN
    RAISE EXCEPTION
      'Produto % ainda está ativo — isto religa apenas vínculo órfão ou inativo',
      p_dead_product_id;
  END IF;

  WITH alvo AS (
    SELECT ts.id
      FROM public.technical_sheets ts
     WHERE ts.direct_components IS NOT NULL
       AND jsonb_typeof(ts.direct_components) = 'array'
       AND ts.direct_components @> jsonb_build_array(
             jsonb_build_object('product_id', p_dead_product_id::text))
  ), novos AS (
    SELECT a.id,
           (SELECT jsonb_agg(
                     CASE WHEN dc ->> 'product_id' = p_dead_product_id::text
                          THEN dc
                               || jsonb_build_object('product_id', p_new_product_id::text)
                               || jsonb_build_object('product_name', v_new_name)
                          ELSE dc END
                     ORDER BY ord)
              FROM jsonb_array_elements(
                     (SELECT direct_components FROM public.technical_sheets WHERE id = a.id)
                   ) WITH ORDINALITY AS t(dc, ord)
           ) AS lista
      FROM alvo a
  ), upd AS (
    UPDATE public.technical_sheets ts
       SET direct_components = n.lista, updated_at = now()
      FROM novos n WHERE ts.id = n.id AND n.lista IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_sheets FROM upd;

  RETURN jsonb_build_object(
    'dead_product_id', p_dead_product_id,
    'new_product_id',  p_new_product_id,
    'new_product_name', v_new_name,
    'sheets_updated',  v_sheets
  );
END;
$function$;

COMMENT ON FUNCTION public.relink_direct_component(uuid, uuid) IS
  'Aponta componente direto órfão (apagado) ou inativo para um produto ATIVO '
  'em TODAS as fichas. Preserva quantity/unit_price e a ordem das linhas.';

REVOKE ALL ON FUNCTION public.list_orphan_direct_components() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_orphan_direct_components() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.relink_direct_component(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relink_direct_component(uuid, uuid) TO authenticated, service_role;
