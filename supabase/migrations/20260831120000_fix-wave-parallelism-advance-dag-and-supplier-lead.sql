-- =============================================================================
-- Correções do motor de paralelismo por setor (auditoria 2026-06-29)
-- =============================================================================
-- Decisões do dono da fábrica (2026-06-29):
--   M1: Costura roda DE VERDADE em paralelo com a prep (Corte Palmilha ‖ Corte
--       Forração ‖ Aviamento ‖ Costura). Antes o cálculo de datas já a tratava
--       como prep paralela (compute_wave_timeline GREATEST), mas o DAG de
--       EXECUÇÃO (guard + inferência de started_at) exigia Costura ⟵ {Corte
--       Forração, Aviamento} — serializando-a. Esta migration RELAXA o DAG para
--       Costura ser prep sem pré-requisito, eliminando a contradição
--       planejamento × execução.
--   B4: a cadeia sequencial termina no Acabamento (Expedição é via pickup, não
--       entra no lead). Frontend alinhado em sectorCapacity.ts.
--
-- Achados corrigidos:
--   M1  — Costura prep paralela no guard e na inferência de started_at.
--   M2/M3/M4 — advance_order_to_sector passa a concluir o FECHO TRANSITIVO de
--        predecessores do DAG real (não o prefixo linear do array), parando de
--        force-concluir ramos paralelos irmãos (ex.: arrastar p/ Colagem não
--        conclui mais Silk indevidamente; arrastar p/ Costura não conclui mais
--        Corte Palmilha). Com isso os timestamps dos setores prep deixam de ser
--        colapsados num único now().
--   M5  — v_lead_supplier passa a derivar a necessidade de material do motor
--        CANÔNICO (calculate_order_consumption), incluindo solado, tiras e
--        componentes de ficha (cabedal/forro/palmilha), não só sheet_materials.
--   B1  — fallback de lead do Corte Palmilha: lead_time_costura_dias → lead_time_corte_dias.
--   B3  — Costura passa a respeitar lead_time_costura_dias no fallback (era ELSE 1 fixo).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) compute_wave_timeline — B1, B3, M5
-- -----------------------------------------------------------------------------
-- search_path inclui extensions p/ get_material_conversion_info/unaccent usados
-- na derivação canônica de necessidade (mesma do get_wave_material_needs).
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
 RETURNS TABLE(earliest_deadline date, corte_palmilha_start_date date, corte_forracao_start_date date, costura_start_date date, mesa_start_date date, silk_start_date date, colagem_start_date date, montagem_start_date date, solagem_start_date date, acabamento_start_date date, acabamento_end_date date, pickup_tuesday_date date, pickup_friday_date date, material_ready_date date, purchase_deadline date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lead_palmilha int; v_lead_forracao int; v_lead_costura int; v_lead_mesa int;
  v_lead_silk int; v_lead_colagem int; v_lead_montagem int; v_lead_solagem int;
  v_lead_acab int; v_lead_buffer int; v_lead_supplier int;
  v_deadline date; v_lead_prep_max int; v_post_prep int;
  v_seq_start date; v_earliest_prep date; v_acab_start date; v_acab_end date;
  v_pickup_tue date; v_pickup_fri date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;
  SELECT
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END
      ELSE 0 END), 1),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.costura_capacity_per_day::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
      THEN CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
      THEN CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END), 2),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
       v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- M5: necessidade de material via motor CANÔNICO (calculate_order_consumption),
  -- igual fn_projected_demand / get_wave_material_needs — inclui solado, tiras e
  -- componentes de ficha (cabedal/forro/palmilha), não só sheet_materials. Sem
  -- isso, um solado em falta (item de maior lead típico) deixava v_lead_supplier=0
  -- e o purchase_deadline prometia compra antes do fisicamente possível.
  WITH items_with_cons AS (
    SELECT COALESCE(public.calculate_order_consumption(
        soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
        (SELECT key::integer FROM jsonb_each_text(soi.grade)
          WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
      ), '[]'::jsonb) AS cons
    FROM sale_order_items soi
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT (line ->> 'product_id')::uuid AS product_id,
           (line ->> 'required')::numeric AS required,
           (line ->> 'unit') AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  needed AS (
    SELECT product_id,
      COALESCE(SUM(required) FILTER (WHERE unit IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(product_id) conv LIMIT 1), 1), 1)
      + COALESCE(SUM(required) FILTER (WHERE unit IS NOT NULL), 0) AS total_needed
    FROM exploded
    GROUP BY product_id
  )
  SELECT COALESCE(MAX(CASE WHEN n.total_needed > GREATEST(0, COALESCE(p.quantity,0) - COALESCE(p.reserved_stock,0))
         THEN public.get_effective_supplier_lead_days(p.id, NULL) ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM needed n
    JOIN products p ON p.id = n.product_id
   WHERE n.total_needed > 0;

  -- Costura é PREP PARALELA (junto com palmilha/forração/mesa); v_seq_start =
  -- início da cadeia sequencial (= silk_start). A cadeia termina no Acabamento
  -- (Expedição é via pickup, não entra no lead — B4).
  v_post_prep := v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem + v_lead_silk;
  v_lead_prep_max := GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa, v_lead_costura);
  v_seq_start := add_business_days(v_deadline, -v_post_prep)::date;
  v_earliest_prep := add_business_days(v_seq_start, -v_lead_prep_max)::date;
  v_acab_start := add_business_days(v_deadline, -v_lead_acab)::date;
  v_acab_end := v_deadline;
  v_pickup_fri := public.next_dow(v_acab_end, 5);
  v_pickup_tue := public.next_dow(add_business_days(v_acab_start, GREATEST(1, v_lead_acab/2))::date, 2);
  IF v_pickup_tue >= v_pickup_fri THEN v_pickup_tue := v_pickup_fri - 3; END IF;
  RETURN QUERY SELECT v_deadline,
    add_business_days(v_seq_start, -v_lead_palmilha)::date,
    add_business_days(v_seq_start, -v_lead_forracao)::date,
    add_business_days(v_seq_start, -v_lead_costura)::date,
    add_business_days(v_seq_start, -v_lead_mesa)::date,
    v_seq_start,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem))::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem))::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem))::date,
    v_acab_start, v_acab_end, v_pickup_tue, v_pickup_fri,
    add_business_days(v_earliest_prep, -v_lead_buffer)::date,
    add_business_days(v_earliest_prep, -(v_lead_buffer + v_lead_supplier))::date;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 2) fn_guard_manual_stage_transition — M1: Costura é prep paralela (sem pré-req)
-- -----------------------------------------------------------------------------
-- DAG unificado ao motor de datas (compute_wave_timeline):
--   Prep paralelo (sem dependência): Corte Palmilha, Corte Forração,
--                                     Aviamento (alias Mesa), Costura, Silk
--   Colagem    ⟵ Corte Palmilha + Corte Forração + Aviamento + Costura  (todo o prep)
--   Montagem   ⟵ Colagem ; Solagem ⟵ Montagem ; Acabamento ⟵ Solagem ;
--   Expedição  ⟵ Acabamento
-- Colagem (1º setor de montagem real) gateia em TODO o prep, garantindo que
-- Corte Forração/Aviamento — antes alcançados via Costura — continuem exigidos
-- mesmo com Costura agora paralela.
CREATE OR REPLACE FUNCTION public.fn_guard_manual_stage_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required text[];
  v_blocking text;
  v_blocking_status text;
BEGIN
  IF NEW.status <> 'em_andamento' OR OLD.status <> 'pendente' THEN
    RETURN NEW;
  END IF;

  v_required := CASE NEW.stage_name
    WHEN 'Corte Palmilha' THEN ARRAY[]::text[]
    WHEN 'Corte Forração' THEN ARRAY[]::text[]
    WHEN 'Aviamento'      THEN ARRAY[]::text[]
    WHEN 'Mesa'           THEN ARRAY[]::text[]
    WHEN 'Silk'           THEN ARRAY[]::text[]
    WHEN 'Costura'        THEN ARRAY[]::text[]
    WHEN 'Colagem'        THEN ARRAY['Corte Palmilha','Corte Forração','Aviamento','Mesa','Costura']
    WHEN 'Montagem'       THEN ARRAY['Colagem']
    WHEN 'Solagem'        THEN ARRAY['Montagem']
    WHEN 'Acabamento'     THEN ARRAY['Solagem']
    WHEN 'Expedição'      THEN ARRAY['Acabamento']
    ELSE NULL
  END;

  IF v_required IS NULL OR cardinality(v_required) = 0 THEN
    RETURN NEW;
  END IF;

  -- Só bloqueia por pré-requisitos que a OP REALMENTE tem (Mesa/Aviamento são
  -- aliases; uma OP tem um ou outro, não os dois).
  SELECT stage_name, status
    INTO v_blocking, v_blocking_status
  FROM public.order_stages
  WHERE order_id = NEW.order_id
    AND stage_name = ANY(v_required)
    AND status <> 'concluido'
  LIMIT 1;

  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'Setor "%": não pode iniciar porque o setor pré-requisito "%" não está finalizado (status atual: %).',
      NEW.stage_name, v_blocking, v_blocking_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_manual_stage_transition ON public.order_stages;
CREATE TRIGGER trg_guard_manual_stage_transition
BEFORE UPDATE ON public.order_stages
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_manual_stage_transition();

-- -----------------------------------------------------------------------------
-- 3) tg_stamp_order_stage_wip_timestamps — M1: Costura prep (started_at = liberação)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_stamp_order_stage_wip_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_start timestamptz;
  v_required text[];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pendente' AND NEW.status = 'em_andamento' AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;
    IF NEW.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
       AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;

  -- Início inferido pelo DAG real, quando concluiu sem início. Costura agora é
  -- prep (sem pré-req) → started_at = liberação da OP, alinhado ao guard e ao
  -- compute_wave_timeline.
  IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NULL THEN
    v_required := CASE NEW.stage_name
      WHEN 'Colagem'    THEN ARRAY['Corte Palmilha','Corte Forração','Aviamento','Mesa','Costura']
      WHEN 'Montagem'   THEN ARRAY['Colagem']
      WHEN 'Solagem'    THEN ARRAY['Montagem']
      WHEN 'Acabamento' THEN ARRAY['Solagem']
      WHEN 'Expedição'  THEN ARRAY['Acabamento']
      ELSE ARRAY[]::text[]   -- prep (Corte Palmilha/Forração/Aviamento/Mesa/Costura/Silk) e desconhecidos
    END;
    IF cardinality(v_required) = 0 THEN
      SELECT min(created_at) INTO v_start FROM public.order_stages WHERE order_id = NEW.order_id;
    ELSE
      SELECT max(completed_at) INTO v_start FROM public.order_stages
        WHERE order_id = NEW.order_id AND stage_name = ANY(v_required) AND completed_at IS NOT NULL;
      IF v_start IS NULL THEN
        SELECT min(created_at) INTO v_start FROM public.order_stages WHERE order_id = NEW.order_id;
      END IF;
    END IF;
    IF v_start IS NOT NULL AND v_start <= NEW.completed_at THEN
      NEW.started_at := v_start;
    ELSE
      NEW.started_at := NEW.completed_at;
    END IF;
  END IF;

  IF NEW.started_at IS NOT NULL AND NEW.completed_at IS NOT NULL THEN
    NEW.actual_time_minutes := GREATEST(0, round(extract(epoch FROM (NEW.completed_at - NEW.started_at)) / 60.0, 2));
  END IF;
  RETURN NEW;
END;
$function$;

-- Re-backfill de started_at com o DAG corrigido (Costura prep; Colagem ⟵ todo prep).
WITH rel AS (
  SELECT order_id, min(created_at) AS release_at FROM public.order_stages GROUP BY order_id
), calc AS (
  SELECT o.id, o.order_id, o.completed_at, o.stage_name,
    CASE WHEN (CASE o.stage_name
                 WHEN 'Colagem'    THEN ARRAY['Corte Palmilha','Corte Forração','Aviamento','Mesa','Costura']
                 WHEN 'Montagem'   THEN ARRAY['Colagem']
                 WHEN 'Solagem'    THEN ARRAY['Montagem']
                 WHEN 'Acabamento' THEN ARRAY['Solagem']
                 WHEN 'Expedição'  THEN ARRAY['Acabamento']
                 ELSE ARRAY[]::text[] END) = ARRAY[]::text[]
         THEN rel.release_at
         ELSE COALESCE(
           (SELECT max(p.completed_at) FROM public.order_stages p
             WHERE p.order_id = o.order_id
               AND p.stage_name = ANY(CASE o.stage_name
                 WHEN 'Colagem'    THEN ARRAY['Corte Palmilha','Corte Forração','Aviamento','Mesa','Costura']
                 WHEN 'Montagem'   THEN ARRAY['Colagem']
                 WHEN 'Solagem'    THEN ARRAY['Montagem']
                 WHEN 'Acabamento' THEN ARRAY['Solagem']
                 WHEN 'Expedição'  THEN ARRAY['Acabamento']
                 ELSE ARRAY[]::text[] END)
               AND p.completed_at IS NOT NULL),
           rel.release_at)
    END AS v_start
  FROM public.order_stages o
  JOIN rel ON rel.order_id = o.order_id
  WHERE o.completed_at IS NOT NULL
)
UPDATE public.order_stages os
   SET started_at = CASE WHEN calc.v_start IS NOT NULL AND calc.v_start <= calc.completed_at THEN calc.v_start ELSE NULL END
  FROM calc
 WHERE os.id = calc.id;

UPDATE public.order_stages
   SET actual_time_minutes = CASE WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
        THEN GREATEST(0, round(extract(epoch FROM (completed_at - started_at)) / 60.0, 2)) ELSE NULL END
 WHERE completed_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4) advance_order_to_sector — M2/M3/M4: conclui o FECHO TRANSITIVO de
--    predecessores do DAG real, não o prefixo linear do array.
-- -----------------------------------------------------------------------------
-- Antes: concluía TODA etapa com array_position < alvo (posição linear). Isso
-- force-concluía ramos paralelos irmãos (arrastar p/ Colagem concluía Silk;
-- arrastar p/ Costura concluía Corte Palmilha) — corrompendo silenciosamente o
-- estado do kanban e colapsando os timestamps dos prep num único now().
-- Agora: só conclui os pré-requisitos REAIS (fecho transitivo do DAG do alvo).
CREATE OR REPLACE FUNCTION public.advance_order_to_sector(
  p_order_id uuid,
  p_target text,
  p_operator uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_preds text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_stages WHERE order_id = p_order_id AND stage_name = p_target) THEN
    RAISE EXCEPTION 'Esta OP não passa pelo setor "%"', p_target;
  END IF;

  -- Fecho transitivo dos predecessores do alvo no DAG real (arestas filho→pai).
  -- Silk gateia em todo o prep (espelha compute_wave_timeline: Silk = 1º
  -- sequencial). Costura é prep (sem pré-req).
  WITH RECURSIVE edges(child, parent) AS (
    VALUES
      ('Silk','Corte Palmilha'), ('Silk','Corte Forração'), ('Silk','Aviamento'),
      ('Silk','Mesa'), ('Silk','Costura'),
      ('Colagem','Silk'),
      ('Montagem','Colagem'),
      ('Solagem','Montagem'),
      ('Acabamento','Solagem'),
      ('Expedição','Acabamento')
  ),
  preds(stage) AS (
    SELECT parent FROM edges WHERE child = p_target
    UNION
    SELECT e.parent FROM edges e JOIN preds pr ON e.child = pr.stage
  )
  SELECT COALESCE(array_agg(DISTINCT stage), ARRAY[]::text[]) INTO v_preds FROM preds;

  -- Conclui só os pré-requisitos reais ainda não concluídos. completed_at é
  -- carimbado pelo trigger. Setores paralelos irmãos NÃO são tocados.
  IF cardinality(v_preds) > 0 THEN
    UPDATE order_stages s
       SET status = 'concluido',
           completed_by = COALESCE(s.completed_by, auth.uid()),
           operator_employee_id = COALESCE(s.operator_employee_id, p_operator)
     WHERE s.order_id = p_order_id
       AND s.status <> 'concluido'
       AND s.stage_name = ANY(v_preds);
  END IF;

  -- Inicia o alvo se estiver pendente. O guard valida os pré-requisitos; se
  -- faltar algum, RAISE → rollback de tudo acima (atômico). started_at é
  -- carimbado pelo trigger.
  UPDATE order_stages
     SET status = 'em_andamento'
   WHERE order_id = p_order_id AND stage_name = p_target AND status = 'pendente';
END;
$$;
