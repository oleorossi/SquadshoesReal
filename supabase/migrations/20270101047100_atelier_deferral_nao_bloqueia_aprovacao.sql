-- Deadlock Ateliê × aprovação (PV-00249).
--
-- Sintoma: PV em Rascunho com I701/I90 no catálogo Ateliê mostra "Não aprova"
-- com "status: sem job — rode Reaplicar no Ateliê" e o confirm é recusado.
--
-- Causa: três camadas exigiam job do Ateliê ANTES da aprovação, mas
-- `materialize_cabedal_prep_demands` só roda em status Aprovado/Em Produção
-- (outbox pós-confirm). Ciclo: sem aprovar → sem job → sem aprovar.
--
-- Design canônico (spec atelie-corte-antecipado R2/R6 + mig 31100):
--   confirm → Aprovado (OP dos itens Ateliê ADIADA) → materializa jobs →
--   corte/envio/retorno → OP nasce quando o gate libera.
-- `promote_sale_order_item` já devolvia skipped (não RAISE) pro Ateliê; o
-- problema é que o pré-voo do enqueue, o selo da lista e o check final do
-- atomic transformavam esse adiamento em recusa dura.
--
-- Esta migration: Ateliê incompleto = deferral (não bloqueia aprovação).
-- Cadastro de corte incompleto (não-'falta %') continua barrando.

-- ── 1. Predicados de deferral ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.factory_gate_is_atelier_pipeline_deferral(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.atelier_item_block_reason(p_item_id) IS NOT NULL;
$$;

COMMENT ON FUNCTION public.factory_gate_is_atelier_pipeline_deferral(uuid) IS
  'True = item Ateliê ainda não liberou OP (sem job / pipeline incompleto). Adia OP; não recusa aprovação do PV.';

CREATE OR REPLACE FUNCTION public.factory_gate_reason_is_atelier_deferral(p_reason text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
     AND (
       p_reason LIKE 'Ateliê —%'
       OR p_reason LIKE 'Ateliê ·%'
       OR p_reason LIKE 'cabedal complexo%'
     );
$$;

COMMENT ON FUNCTION public.factory_gate_reason_is_atelier_deferral(text) IS
  'True = motivo de skip do promote é pipeline Ateliê (adiamento), não cadastro incompleto.';

REVOKE ALL ON FUNCTION public.factory_gate_is_atelier_pipeline_deferral(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.factory_gate_reason_is_atelier_deferral(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.factory_gate_is_atelier_pipeline_deferral(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.factory_gate_reason_is_atelier_deferral(text)
  TO authenticated, service_role;

-- ── 2. Selo "Não aprova": só cadastro que RECUSA aprovação ────────────────
-- Ateliê incompleto some daqui. Se o item Ateliê TAMBÉM tem cadastro de corte
-- incompleto, esse motivo continua aparecendo (via gate de corte).
CREATE OR REPLACE FUNCTION public.list_sale_order_factory_gate_blocks(p_sale_order_id uuid)
 RETURNS TABLE(item_id uuid, reference_code text, color text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT x.item_id, x.reference_code, x.color, x.reason
    FROM (
      SELECT soi.id AS item_id,
             COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?') AS reference_code,
             COALESCE(NULLIF(btrim(soi.color), ''), '—') AS color,
             CASE
               WHEN public.factory_gate_is_atelier_pipeline_deferral(soi.id) THEN
                 CASE
                   WHEN c.reason LIKE 'falta %' THEN NULL
                   ELSE NULLIF(btrim(COALESCE(c.reason, '')), '')
                 END
               ELSE NULLIF(btrim(COALESCE(f.reason, '')), '')
             END AS reason
        FROM public.sale_order_items soi
        LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
        CROSS JOIN LATERAL (
          SELECT public.sale_order_item_factory_gate_block_reason(soi.id) AS reason
        ) f
        CROSS JOIN LATERAL (
          SELECT public.sale_order_item_corte_material_gate_block_reason(soi.id) AS reason
        ) c
       WHERE soi.sale_order_id = p_sale_order_id
         AND soi.reference_id IS NOT NULL
         AND soi.production_excluded_at IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public.orders o
            WHERE o.sale_order_item_id = soi.id
              AND o.deleted_at IS NULL
              AND o.status NOT IN (
                'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
                'Concluído', 'Concluido', 'Concluída'
              )
         )
    ) x
   WHERE x.reason IS NOT NULL
   ORDER BY x.reference_code, x.color;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_sale_order_factory_gate_blocks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sale_order_factory_gate_blocks(uuid)
  TO authenticated, service_role;

-- ── 3. Pré-voo do enqueue: Ateliê não entra na lista de recusa ────────────
DO $patch_enqueue_atelier_deferral$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.enqueue_sale_order_materialization(uuid,text,text,bigint,text,jsonb,uuid)'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'enqueue_sale_order_materialization ausente';
  END IF;

  IF strpos(v_def, 'factory_gate_is_atelier_pipeline_deferral') > 0 THEN
    RAISE NOTICE 'enqueue já trata deferral Ateliê — skip';
    RETURN;
  END IF;

  v_old := $old$IF NULLIF(btrim(COALESCE(v_gap_text, '')), '') IS NOT NULL THEN
        v_gaps := v_gaps || format(
          '%s / %s — %s',
          v_item.reference_code,
          COALESCE(NULLIF(btrim(v_item.color), ''), '?'),
          v_gap_text
        );
      END IF;
    END LOOP;

    IF COALESCE(array_length(v_gaps, 1), 0) > 0 THEN
      RAISE EXCEPTION
        'Itens bloqueados para produção — resolva o cadastro antes de aprovar:%s%s',
        E'\n', array_to_string(v_gaps, E'\n')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;$old$;

  v_new := $new$IF NULLIF(btrim(COALESCE(v_gap_text, '')), '') IS NOT NULL THEN
        -- Ateliê incompleto adia a OP; não recusa confirm/promote.
        -- Cadastro de corte incompleto (exceto 'falta %') continua barrando.
        IF public.factory_gate_is_atelier_pipeline_deferral(v_item.item_id) THEN
          BEGIN
            v_gap_text := public.sale_order_item_corte_material_gate_block_reason(v_item.item_id);
          EXCEPTION WHEN OTHERS THEN
            v_gap_text := NULL;
          END;
          IF v_gap_text LIKE 'falta %' THEN
            v_gap_text := NULL;
          END IF;
        END IF;
      END IF;

      IF NULLIF(btrim(COALESCE(v_gap_text, '')), '') IS NOT NULL THEN
        v_gaps := v_gaps || format(
          '%s / %s — %s',
          v_item.reference_code,
          COALESCE(NULLIF(btrim(v_item.color), ''), '?'),
          v_gap_text
        );
      END IF;
    END LOOP;

    IF COALESCE(array_length(v_gaps, 1), 0) > 0 THEN
      RAISE EXCEPTION
        'Itens bloqueados para produção — resolva o cadastro antes de aprovar:%s%s',
        E'\n', array_to_string(v_gaps, E'\n')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;$new$;

  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION
      'Âncora do pré-voo de corte no enqueue não encontrada — corpo vivo divergiu';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_enqueue_atelier_deferral$;

-- ── 4. Atomic: skip Ateliê = CONTINUE; completeza ignora deferidos ────────
DO $patch_atomic_atelier_deferral$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'promote_sale_order_atomic_internal ausente';
  END IF;

  IF strpos(v_def, 'factory_gate_reason_is_atelier_deferral') > 0 THEN
    RAISE NOTICE 'atomic já trata deferral Ateliê — skip patch skip-raise';
  ELSE
    v_old := $old$IF COALESCE((v_res ->> 'skipped')::boolean, false) THEN
        RAISE EXCEPTION 'Item % foi ignorado pelo motor: %',
          v_item.id,
          COALESCE(v_res ->> 'reason', 'motivo desconhecido');
      END IF;$old$;

    v_new := $new$IF COALESCE((v_res ->> 'skipped')::boolean, false) THEN
        -- Ateliê incompleto: item fica sem OP (fila materializa depois do
        -- Aprovado). Não aborta o PV — era o deadlock "sem job".
        IF public.factory_gate_reason_is_atelier_deferral(v_res ->> 'reason') THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Item % foi ignorado pelo motor: %',
          v_item.id,
          COALESCE(v_res ->> 'reason', 'motivo desconhecido');
      END IF;$new$;

    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION
        'Âncora skip→RAISE do atomic não encontrada — corpo vivo divergiu';
    END IF;

    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
    SELECT pg_get_functiondef(
      'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
    ) INTO v_def;
  END IF;

  IF strpos(v_def, 'factory_gate_is_atelier_pipeline_deferral(soi.id)') > 0
     AND strpos(v_def, 'Promoção incompleta') > 0
     AND strpos(v_def, 'AND NOT EXISTS') > strpos(v_def, 'factory_gate_is_atelier_pipeline_deferral(soi.id)') THEN
    RAISE NOTICE 'atomic já exclui deferral Ateliê da completeza — skip';
    RETURN;
  END IF;

  v_old := $old$IF v_complete_count <> v_reference_item_count THEN
    RAISE EXCEPTION 'Promoção incompleta: % de % itens materializados',
      v_complete_count,
      v_reference_item_count;
  END IF;$old$;

  v_new := $new$-- Itens Ateliê ainda sem liberação (e sem OP) não precisam nascer nesta
  -- passada. Quem já tem OP ativa continua contando — senão a completeza
  -- acusaria "a mais" e abortaria PVs mistos.
  SELECT count(*)::integer
    INTO v_reference_item_count
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = p_sale_order_id
     AND soi.reference_id IS NOT NULL
     AND NOT (
       public.factory_gate_is_atelier_pipeline_deferral(soi.id)
       AND NOT EXISTS (
         SELECT 1
           FROM public.orders o
          WHERE o.sale_order_item_id = soi.id
            AND o.deleted_at IS NULL
            AND o.status NOT IN (
              'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
              'Concluído', 'Concluido', 'Concluída'
            )
       )
     );

  IF v_complete_count <> v_reference_item_count THEN
    RAISE EXCEPTION 'Promoção incompleta: % de % itens materializados',
      v_complete_count,
      v_reference_item_count;
  END IF;$new$;

  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION
      'Âncora de completeza do atomic não encontrada — corpo vivo divergiu';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_atomic_atelier_deferral$;
