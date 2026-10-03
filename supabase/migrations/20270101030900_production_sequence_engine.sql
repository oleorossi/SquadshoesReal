-- Motor de sequência oficial (specs/sequencia-producao.md) — Fase 1.
-- 1) Score de fechamento de PV para ORDER BY da fila
-- 2) recompute_production_schedule_impl_249 usa hierarquia pin → close PV → due → cor → ref
-- 3) release_corte_lookahead: cabedal complexo liberável só após received_at_factory
-- 4) list_production_sequence: leitura da ordem oficial das OPs em fila

CREATE OR REPLACE FUNCTION public.production_sequence_close_score(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT
        SUM(
          CASE WHEN EXISTS (
            SELECT 1
              FROM public.orders ox
             WHERE ox.sale_order_item_id = soi.id
               AND ox.deleted_at IS NULL
               AND COALESCE(ox.status, '') NOT IN ('Cancelada', 'Cancelado', 'Rascunho')
          ) THEN GREATEST(0, COALESCE(soi.quantity, 0))
          ELSE 0 END
        )::numeric
        / NULLIF(SUM(GREATEST(0, COALESCE(soi.quantity, 0))), 0)
      FROM public.sale_order_items soi
      WHERE soi.sale_order_id = p_sale_order_id
    ),
    0::numeric
  );
$$;

COMMENT ON FUNCTION public.production_sequence_close_score(uuid) IS
  'Fração de pares do PV já com OP viva (0–1). Sequência: maior = mais perto de fechar/faturar.';

GRANT EXECUTE ON FUNCTION public.production_sequence_close_score(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Patch: ORDER BY da fila no recompute (impl_249)
-- ---------------------------------------------------------------------------
DO $patch_sequence_order$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.recompute_production_schedule_impl_249(text)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'recompute_production_schedule_impl_249(text) não encontrada';
  END IF;

  v_old := $old$row_number() OVER (
           ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                    q.due_date NULLS LAST, o.created_at, o.id
         ) AS prio$old$;

  v_new := $new$row_number() OVER (
           ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                    public.production_sequence_close_score(o.sale_order_id) DESC NULLS LAST,
                    q.due_date NULLS LAST,
                    lower(trim(COALESCE(o.color, ''))),
                    lower(trim(COALESCE((
                      SELECT ts.code FROM public.technical_sheets ts
                       WHERE ts.id = o.reference_id
                       LIMIT 1
                    ), ''))),
                    o.created_at, o.id
         ) AS prio$new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    IF pg_catalog.strpos(v_definition, 'production_sequence_close_score') > 0 THEN
      RAISE NOTICE 'ORDER BY da sequência já aplicado em impl_249 — skip';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Âncora ORDER BY clássica não encontrada em impl_249 — revisar manualmente';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$patch_sequence_order$;

-- ---------------------------------------------------------------------------
-- Lookahead release: complexo só após retorno do cabedal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_corte_lookahead_items(p_item_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_item public.sale_order_items%ROWTYPE;
  v_so public.sale_orders%ROWTYPE;
  v_res jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_criadas int := 0;
  v_pkg text;
  v_prep_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RAISE EXCEPTION 'Nenhum item selecionado' USING ERRCODE = '22023';
  END IF;

  FOR v_item_id IN
    SELECT x
      FROM unnest(p_item_ids) AS t(x)
     ORDER BY x
  LOOP
    SELECT * INTO v_item FROM public.sale_order_items WHERE id = v_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % não encontrado', v_item_id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('corte_lookahead:' || v_item.sale_order_id::text));

    SELECT * INTO v_so
      FROM public.sale_orders
     WHERE id = v_item.sale_order_id
       AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PV do item % não encontrado', v_item_id;
    END IF;

    IF v_so.status NOT IN ('Aprovado', 'Em Produção') THEN
      RAISE EXCEPTION 'PV % não está Aprovado/Em Produção (status %)',
        COALESCE(v_so.order_number, v_so.id::text), v_so.status;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.sale_order_item_id = v_item.id
         AND o.deleted_at IS NULL
         AND COALESCE(o.status, '') NOT IN ('Cancelada', 'Cancelado', 'Rascunho')
    ) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id,
        'reason', 'já possui OP'
      ));
      CONTINUE;
    END IF;

    IF v_item.reference_id IS NULL THEN
      RAISE EXCEPTION 'Item % sem referência', v_item_id;
    END IF;

    -- Cabedal complexo: só libera Corte interno após cabedal preparado na fábrica.
    IF EXISTS (
      SELECT 1 FROM public.atelier_complex_references a
       WHERE a.reference_id = v_item.reference_id
         AND COALESCE(a.active, true)
    ) THEN
      SELECT j.pipeline_status INTO v_prep_status
        FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = v_item.id
         AND COALESCE(j.pipeline_status, '') <> 'cancelled'
       ORDER BY j.updated_at DESC NULLS LAST
       LIMIT 1;

      IF v_prep_status IS DISTINCT FROM 'received_at_factory' THEN
        RAISE EXCEPTION
          'Item % é cabedal complexo — só libera após recebimento do cabedal (status atual: %)',
          v_item_id,
          COALESCE(v_prep_status, 'sem job');
      END IF;
    END IF;

    v_pkg := COALESCE(v_so.packaging_mode, 'individual_amarrado');

    v_res := public.promote_sale_order_item(
      v_item.id,
      'Em Produção',
      'Adiantada — Fila de Corte',
      v_so.delivery_deadline,
      true,
      v_pkg
    );

    IF COALESCE((v_res->>'skipped')::boolean, false) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id,
        'reason', COALESCE(v_res->>'reason', 'skipped')
      ));
      CONTINUE;
    END IF;

    v_criadas := v_criadas + 1;
    v_ops := v_ops || jsonb_build_array(v_res);

    IF v_so.status = 'Aprovado' THEN
      UPDATE public.sale_orders
         SET status = 'Em Produção',
             updated_at = now()
       WHERE id = v_so.id
         AND status = 'Aprovado';
      v_so.status := 'Em Produção';
    END IF;
  END LOOP;

  IF v_criadas = 0 AND jsonb_array_length(v_skipped) = cardinality(p_item_ids) THEN
    RAISE EXCEPTION 'Nenhuma OP criada — itens já tinham OP ou foram pulados'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'criadas', v_criadas,
    'ops', v_ops,
    'skipped', v_skipped
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Lista ordem oficial das OPs em production_queue (leitura)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_production_sequence()
RETURNS TABLE (
  order_id uuid,
  sale_order_id uuid,
  sale_order_item_id uuid,
  order_number text,
  color text,
  reference_code text,
  due_date date,
  pinned_position integer,
  close_score numeric,
  sequence_position integer,
  is_pinned boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.id AS order_id,
    o.sale_order_id,
    o.sale_order_item_id,
    o.order_number,
    o.color,
    ts.code AS reference_code,
    q.due_date,
    q.pinned_position,
    public.production_sequence_close_score(o.sale_order_id) AS close_score,
    row_number() OVER (
      ORDER BY (q.pinned_position IS NULL), q.pinned_position,
               public.production_sequence_close_score(o.sale_order_id) DESC NULLS LAST,
               q.due_date NULLS LAST,
               lower(trim(COALESCE(o.color, ''))),
               lower(trim(COALESCE(ts.code, ''))),
               o.created_at, o.id
    )::integer AS sequence_position,
    (q.pinned_position IS NOT NULL) AS is_pinned
  FROM public.production_queue q
  JOIN public.orders o ON o.id = q.order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  WHERE o.deleted_at IS NULL
    AND COALESCE(o.status, '') NOT IN (
      'Cancelada', 'Cancelado', 'cancelled',
      'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
      'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
      'Faturado', 'Rascunho'
    )
    AND public.is_approved_user();
$$;

COMMENT ON FUNCTION public.list_production_sequence() IS
  'Ordem oficial da fila (pin → fechar PV → due_date → cor → ref). Spec sequencia-producao.';

GRANT EXECUTE ON FUNCTION public.list_production_sequence() TO authenticated;
