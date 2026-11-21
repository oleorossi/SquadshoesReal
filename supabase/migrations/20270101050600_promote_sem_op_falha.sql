-- promocao_sem_op_20270101050600
--
-- PV-00255 (5c14d390-7965-493c-8bdf-c1fdbe7420f7): o job promote
-- c70ae8e6-62fd-4aa5-9e20-f2dc204dc59c terminou succeeded sem nenhuma
-- linha em orders. promote_sale_order_item devolve skipped quando
-- atelier_item_block_reason não é nulo ("Ateliê — … ainda sem job" ou
-- "cabedal complexo…"). A 47100 faz CONTINUE e tira o item da completeza.
-- A 47400 só barra a troca de status quando já existe job com recebimento
-- parcial — item sem job passa. 0 = 0, status vira Em Produção, job ok.
--
-- Aprovado continua podendo adiar a OP do Ateliê. Em Produção não:
-- item produzível sem OP faz a promoção falhar.
--
-- Não altera PV-00236, PV-2026-00083 nem PV-00249.
-- A única escrita de pedido autorizada é a re-materialização oficial do
-- PV-00255 (promote_sale_order_atomic_internal). Idempotente: OP viva
-- não é duplicada. Se o portão recusar, a recusa fica no NOTICE e nenhuma
-- OP é forçada.

SET LOCAL statement_timeout = '600s';

-- ── Diagnóstico (antes de mudar a função) ────────────────────────────────
DO $diag_promote_sem_op$
DECLARE
  v_text text;
  v_row record;
BEGIN
  SELECT COALESCE(string_agg(
           format(
             '%s cor=%s setores=%s atelier=%s gate=%s',
             COALESCE(ts.code, '?'),
             COALESCE(soi.color, ''),
             COALESCE(public.atelier_reference_street_sectors(soi.reference_id)::text, '{}'),
             COALESCE(public.atelier_item_block_reason(soi.id), ''),
             COALESCE(public.sale_order_item_factory_gate_block_reason(soi.id), '')
           ),
           ' | ' ORDER BY soi.id
         ), '')
    INTO v_text
    FROM public.sale_order_items soi
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7';
  RAISE NOTICE 'pv255_itens %', v_text;

  SELECT COALESCE(string_agg(so.order_number, ', ' ORDER BY so.order_number), '')
    INTO v_text
    FROM public.sale_orders so
   WHERE so.deleted_at IS NULL
     AND so.status = 'Em Produção'
     AND so.order_number IS DISTINCT FROM 'PV-00249'
     AND NOT EXISTS (
       SELECT 1
         FROM public.orders production_order
        WHERE production_order.sale_order_id = so.id
          AND production_order.deleted_at IS NULL
          AND COALESCE(production_order.status, '') NOT IN (
            'Cancelada', 'Cancelado', 'cancelled',
            'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
            'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
            'Faturado', 'Rascunho'
          )
     );
  RAISE NOTICE 'em_producao_sem_op_aberta %', v_text;

  FOR v_row IN
    SELECT so.order_number,
           so.updated_at,
           o.order_number AS op,
           o.status AS op_status,
           o.deleted_at,
           left(COALESCE(o.notes, ''), 160) AS notes
      FROM public.sale_orders so
      JOIN public.orders o ON o.sale_order_id = so.id
     WHERE so.order_number IN ('PV-00236', 'PV-2026-00083')
     ORDER BY so.order_number, o.deleted_at
  LOOP
    RAISE NOTICE 'pv_op_apagada % op=% status=% deleted_at=% pv_updated_at=% notas=%',
      v_row.order_number, v_row.op, v_row.op_status, v_row.deleted_at,
      v_row.updated_at, v_row.notes;
  END LOOP;

  FOR v_row IN
    SELECT so.order_number, a.action, a.resource, a.timestamp, left(COALESCE(a.error_message, ''), 160) AS error_message
      FROM public.audit_logs a
      JOIN public.sale_orders so
        ON so.id::text = a.resource_id
        OR so.id::text = a.resource
     WHERE so.order_number IN ('PV-00236', 'PV-2026-00083')
       AND a.timestamp >= '2026-11-16 14:00:00+00'
       AND a.timestamp < '2026-11-16 15:00:00+00'
     ORDER BY a.timestamp
  LOOP
    RAISE NOTICE 'pv_audit_16nov % % % % %',
      v_row.order_number, v_row.timestamp, v_row.action, v_row.resource, v_row.error_message;
  END LOOP;
END;
$diag_promote_sem_op$;

-- ── Em Produção: skip do Ateliê deixa de ser sucesso ─────────────────────
DO $patch_atomic_sem_op$
DECLARE
  v_def text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
  ) INTO v_def;

  IF pg_catalog.strpos(v_def, 'promocao_sem_op_20270101050600') > 0 THEN
    RAISE NOTICE 'atomic já recusa Em Produção sem OP';
    RETURN;
  END IF;

  v_old := $old$IF public.factory_gate_reason_is_atelier_deferral(v_res ->> 'reason') THEN
          CONTINUE;
        END IF;$old$;
  v_new := $new$IF public.factory_gate_reason_is_atelier_deferral(v_res ->> 'reason') THEN
          -- promocao_sem_op_20270101050600
          -- Aprovado adia a OP. Em Produção com skip foi succeeded sem OP
          -- (PV-00255). A promoção tem de falhar.
          IF p_target_status = 'Em Produção' THEN
            RAISE EXCEPTION
              'Promoção para Em Produção não gerou OP do item %: %',
              v_item.id,
              COALESCE(v_res ->> 'reason', 'motivo desconhecido');
          END IF;
          CONTINUE;
        END IF;$new$;

  v_hits := (
    pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'Âncora do skip Ateliê no atomic mudou (% ocorrencias)', v_hits;
  END IF;
  v_def := pg_catalog.replace(v_def, v_old, v_new);

  v_old := $old$PERFORM set_config('app.promote_sale_order_to_production', '1', true);$old$;
  v_new := $new$IF p_target_status = 'Em Produção' AND EXISTS (
    SELECT 1
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
       AND soi.production_excluded_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.orders o
          WHERE o.sale_order_item_id = soi.id
            AND o.deleted_at IS NULL
            AND COALESCE(o.status, '') NOT IN (
              'Cancelada', 'Cancelado', 'cancelled',
              'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
              'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
              'Faturado', 'Rascunho'
            )
       )
  ) THEN
    RAISE EXCEPTION 'Promoção recusada: item produzível ficou sem OP'
      USING ERRCODE = 'PZ108';
  END IF;

  PERFORM set_config('app.promote_sale_order_to_production', '1', true);$new$;

  v_hits := (
    pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'Âncora do set_config de promoção mudou (% ocorrencias)', v_hits;
  END IF;

  EXECUTE pg_catalog.replace(v_def, v_old, v_new);
END;
$patch_atomic_sem_op$;

-- Item sem job também barra a entrada em Em Produção. A 47400 só enxergava
-- job já criado com recebimento parcial, e o "ainda sem job" passava.
CREATE OR REPLACE FUNCTION public.sale_order_atelier_production_block_message(p_sale_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN count(*) = 0 THEN NULL::text
    ELSE
      'Não é possível colocar o pedido em Em Produção: o cabedal complexo ainda não voltou para a fábrica.'
      || E'\n'
      || string_agg(
           format(
             '%s / %s — %s',
             blocked.code,
             blocked.color,
             blocked.reason
           ),
           E'\n'
           ORDER BY blocked.code, blocked.color, blocked.item_id
         )
  END
    FROM (
      SELECT soi.id AS item_id,
             COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?') AS code,
             COALESCE(NULLIF(btrim(soi.color), ''), '—') AS color,
             public.atelier_item_block_reason(soi.id) AS reason
        FROM public.sale_order_items soi
        LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
         AND soi.reference_id IS NOT NULL
         AND soi.production_excluded_at IS NULL
    ) blocked
   WHERE blocked.reason IS NOT NULL;
$$;

COMMENT ON FUNCTION public.sale_order_atelier_production_block_message(uuid) IS
  'NULL = Em Produção pode criar OP. Texto = cabedal complexo sem retorno, inclusive item ainda sem job. Recebimento parcial (motivo nulo) não bloqueia.';

REVOKE ALL ON FUNCTION public.sale_order_atelier_production_block_message(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_order_atelier_production_block_message(uuid)
  TO authenticated, service_role;

-- ── Re-materialização oficial, só do PV-00255 ────────────────────────────
DO $repromote_pv255$
DECLARE
  v_msg text;
  v_ops integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.sale_orders so
     WHERE so.id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
       AND so.order_number = 'PV-00255'
       AND so.deleted_at IS NULL
  ) THEN
    RAISE NOTICE 'pv255_ausente';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
       AND o.deleted_at IS NULL
  ) THEN
    RAISE NOTICE 'pv255_ja_tem_op';
    RETURN;
  END IF;

  BEGIN
    PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
    PERFORM public.promote_sale_order_atomic_internal(
      '5c14d390-7965-493c-8bdf-c1fdbe7420f7',
      'Em Produção'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    RAISE NOTICE 'pv255_promote_recusou %', v_msg;
    RETURN;
  END;

  SELECT count(*)::integer
    INTO v_ops
    FROM public.orders o
   WHERE o.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
     AND o.deleted_at IS NULL;
  RAISE NOTICE 'pv255_ops_vivas %', v_ops;
END;
$repromote_pv255$;
