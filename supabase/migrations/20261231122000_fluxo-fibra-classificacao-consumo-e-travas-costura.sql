-- Fluxo físico aprovado pelo dono (13/08/2026)
--
-- 1. "Corte Palmilha" é o setor de CORTE DE FIBRA. Mantemos o enum interno
--    corte_palmilha para não quebrar ondas históricas, mas a operação passa a
--    usar o nome Corte Fibra.
-- 2. Costura Palmilha não inicia sem pares entregues em Corte Fibra.
--    Costura Cabedal só existe em roteiros sem corte a fio e, quando existe,
--    não inicia sem Corte Cabedal.
-- 3. Novas fichas nascem em rascunho. Para publicar/validar, cada item de BOM
--    precisa informar o setor físico que consome o material. Fichas anteriores
--    à migration permanecem em transição gradual e não são bloqueadas.

ALTER TABLE public.sheet_materials
  ADD COLUMN IF NOT EXISTS consumption_sector text;

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS component_consumption_sectors jsonb NOT NULL DEFAULT
    '{"fibra":"Corte Fibra","forracao_palmilha":"Corte Forração","cabedal":"Corte Cabedal","solado":"Solagem"}'::jsonb,
  ADD COLUMN IF NOT EXISTS consumption_routing_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.sheet_materials
  DROP CONSTRAINT IF EXISTS sheet_materials_consumption_sector_check;

ALTER TABLE public.sheet_materials
  ADD CONSTRAINT sheet_materials_consumption_sector_check
  CHECK (consumption_sector IS NULL OR consumption_sector IN (
    'Corte Fibra', 'Corte Forração', 'Corte Cabedal', 'Costura Palmilha',
    'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem',
    'Acabamento'
  ));

COMMENT ON COLUMN public.sheet_materials.consumption_sector IS
  'Setor físico que consome o item no início da operação. Obrigatório para publicar fichas criadas após a migration.';

-- Nome operacional novo. Dados de OP e apontamentos são um ledger histórico:
-- nunca os reescreva só para trocar uma nomenclatura de interface.
UPDATE public.sector_settings
   SET sector = 'Corte Fibra'
 WHERE sector = 'Corte Palmilha';

UPDATE public.technical_sheets
   SET production_sectors = (
     SELECT jsonb_agg(CASE WHEN value = 'Corte Palmilha' THEN 'Corte Fibra' ELSE value END)
       FROM jsonb_array_elements_text(production_sectors)
   )
 WHERE production_sectors IS NOT NULL
   AND jsonb_typeof(production_sectors) = 'array'
   AND production_sectors ? 'Corte Palmilha';

-- `order_stages`, `production_pointings` e `production_schedule` existentes
-- ficam como foram gravados. O frontend resolve "Corte Palmilha" como alias
-- de exibição de "Corte Fibra"; OPs novas já nascem com o nome novo.

CREATE OR REPLACE FUNCTION public.canonical_stage_order(p_stage_name text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_stage_name
    WHEN 'Corte Fibra'       THEN 1
    WHEN 'Corte Palmilha'    THEN 1 -- alias histórico
    WHEN 'Corte Forração'    THEN 2
    WHEN 'Corte Forracao'    THEN 2
    WHEN 'Corte Cabedal'     THEN 2
    WHEN 'Costura Palmilha'  THEN 3
    WHEN 'Costura'           THEN 3
    WHEN 'Costura Cabedal'   THEN 4
    WHEN 'Aviamento'         THEN 5
    WHEN 'Mesa'              THEN 5
    WHEN 'Silk'              THEN 6
    WHEN 'Colagem'           THEN 7
    WHEN 'Montagem'          THEN 8
    WHEN 'Solagem'           THEN 9
    WHEN 'Acabamento'        THEN 10
    WHEN 'Expedição'         THEN 11
    WHEN 'Expedicao'         THEN 11
    ELSE 99
  END;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_stage_name(p_stage_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE lower(trim(COALESCE(p_stage_name, '')))
    WHEN 'corte palmilha' THEN 'Corte Fibra'
    WHEN 'corte fibra' THEN 'Corte Fibra'
    WHEN 'corte forracao' THEN 'Corte Forração'
    WHEN 'corte forração' THEN 'Corte Forração'
    WHEN 'mesa' THEN 'Aviamento'
    WHEN 'aviamento' THEN 'Aviamento'
    WHEN 'costura' THEN 'Costura Palmilha'
    WHEN 'costura palmilha' THEN 'Costura Palmilha'
    WHEN 'costura cabedal' THEN 'Costura Cabedal'
    WHEN 'corte cabedal' THEN 'Corte Cabedal'
    WHEN 'silk' THEN 'Silk'
    WHEN 'colagem' THEN 'Colagem'
    WHEN 'montagem' THEN 'Montagem'
    WHEN 'solagem' THEN 'Solagem'
    WHEN 'acabamento' THEN 'Acabamento'
    WHEN 'expedição' THEN 'Expedição'
    WHEN 'expedicao' THEN 'Expedição'
    ELSE trim(COALESCE(p_stage_name, ''))
  END;
$function$;

CREATE OR REPLACE FUNCTION public.sector_display_to_enum(p_name text)
 RETURNS production_stage_enum
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE lower(trim(p_name))
    WHEN 'corte fibra'       THEN 'corte_palmilha'::production_stage_enum
    WHEN 'corte palmilha'    THEN 'corte_palmilha'::production_stage_enum
    WHEN 'corte forração'    THEN 'corte_forracao'::production_stage_enum
    WHEN 'corte forracao'    THEN 'corte_forracao'::production_stage_enum
    WHEN 'corte cabedal'     THEN 'corte_cabedal'::production_stage_enum
    WHEN 'costura palmilha'  THEN 'costura'::production_stage_enum
    WHEN 'costura cabedal'   THEN 'costura'::production_stage_enum
    WHEN 'costura'           THEN 'costura'::production_stage_enum
    WHEN 'mesa'              THEN 'mesa'::production_stage_enum
    WHEN 'aviamento'         THEN 'mesa'::production_stage_enum
    WHEN 'silk'              THEN 'silk'::production_stage_enum
    WHEN 'colagem'           THEN 'colagem'::production_stage_enum
    WHEN 'montagem'          THEN 'montagem'::production_stage_enum
    WHEN 'solagem'           THEN 'solagem'::production_stage_enum
    WHEN 'acabamento'        THEN 'acabamento'::production_stage_enum
    WHEN 'expedição'         THEN 'expedicao'::production_stage_enum
    WHEN 'expedicao'         THEN 'expedicao'::production_stage_enum
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_normalize_production_sectors()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical text[] := ARRAY[
    'Corte Fibra','Corte Forração','Corte Cabedal','Costura Palmilha','Costura Cabedal',
    'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_input text[]; v_normalized text[]; v_clean jsonb;
BEGIN
  IF NEW.production_sectors IS NULL OR jsonb_typeof(NEW.production_sectors) <> 'array' THEN RETURN NEW; END IF;
  SELECT array_agg(value) INTO v_input FROM jsonb_array_elements_text(NEW.production_sectors);
  IF v_input IS NULL THEN RETURN NEW; END IF;
  SELECT array_agg(DISTINCT CASE
    WHEN x IN ('Corte','Corte Palmilha') THEN 'Corte Fibra'
    WHEN x = 'Forração' THEN 'Corte Forração'
    WHEN x = 'Mesa' THEN 'Aviamento'
    WHEN x = 'Costura' THEN 'Costura Palmilha'
    ELSE x END)
  INTO v_normalized FROM unnest(v_input) x;
  IF 'Corte' = ANY(v_input) THEN v_normalized := v_normalized || ARRAY['Corte Forração']; END IF;
  IF NOT ('Expedição' = ANY(v_normalized)) THEN v_normalized := v_normalized || ARRAY['Expedição']; END IF;
  SELECT jsonb_agg(s.value) INTO v_clean FROM (
    SELECT c.value, c.ord FROM unnest(v_canonical) WITH ORDINALITY c(value, ord)
    WHERE c.value = ANY(v_normalized) ORDER BY c.ord
  ) s;
  NEW.production_sectors := COALESCE(v_clean, '[]'::jsonb);
  RETURN NEW;
END;
$function$;

-- Guard server-side: vale para Kanban, apontamento em lote e integrações.
CREATE OR REPLACE FUNCTION public.fn_guard_manual_stage_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_required text[]; v_missing text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status = 'pendente' THEN RETURN NEW; END IF;
  v_required := CASE NEW.stage_name
    WHEN 'Corte Fibra' THEN ARRAY[]::text[]
    WHEN 'Corte Forração' THEN ARRAY[]::text[]
    WHEN 'Corte Cabedal' THEN ARRAY[]::text[]
    WHEN 'Aviamento' THEN ARRAY[]::text[]
    WHEN 'Mesa' THEN ARRAY[]::text[]
    WHEN 'Silk' THEN ARRAY[]::text[]
    WHEN 'Costura Palmilha' THEN ARRAY['Corte Fibra']
    WHEN 'Costura Cabedal' THEN ARRAY['Corte Cabedal']
    WHEN 'Costura' THEN ARRAY['Corte Fibra']
    WHEN 'Colagem' THEN ARRAY['Corte Fibra','Costura Palmilha','Costura Cabedal']
    WHEN 'Montagem' THEN ARRAY['Colagem']
    WHEN 'Solagem' THEN ARRAY['Montagem']
    WHEN 'Acabamento' THEN ARRAY['Solagem']
    WHEN 'Expedição' THEN ARRAY['Acabamento']
    ELSE NULL END;
  IF v_required IS NULL OR cardinality(v_required) = 0 THEN RETURN NEW; END IF;
  SELECT os.stage_name INTO v_missing FROM public.order_stages os
   WHERE os.order_id = NEW.order_id AND os.stage_name = ANY(v_required)
     AND os.status <> 'concluido' AND COALESCE(os.quantity_processed, 0) = 0 LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Setor "%" ainda não entregou pares — não dá para iniciar "%".', v_missing, NEW.stage_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- Novas fichas começam sempre em rascunho. A aprovação posterior é o portão.
CREATE OR REPLACE FUNCTION public.tg_new_sheet_starts_as_draft()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_ficha := 'rascunho';
    NEW.consumption_routing_required := true;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_new_sheet_starts_as_draft ON public.technical_sheets;
CREATE TRIGGER trg_new_sheet_starts_as_draft
  BEFORE INSERT ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_new_sheet_starts_as_draft();

CREATE OR REPLACE FUNCTION public.tg_block_incomplete_new_sheet_publication()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_missing integer;
BEGIN
  IF NEW.status_ficha IN ('publicada', 'validada')
     AND COALESCE(OLD.status_ficha, 'rascunho') NOT IN ('publicada', 'validada')
     AND NEW.consumption_routing_required THEN
    SELECT count(*) INTO v_missing FROM public.sheet_materials sm
     WHERE sm.sheet_id = NEW.id AND (sm.consumption_sector IS NULL OR btrim(sm.consumption_sector) = '');
    IF v_missing > 0 THEN
      RAISE EXCEPTION 'Não é possível publicar a ficha: % item(ns) do BOM estão sem setor de consumo.', v_missing
        USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(NEW.insole_material, '') <> ''
       AND COALESCE(NEW.component_consumption_sectors ->> 'fibra', '') = '' THEN
      RAISE EXCEPTION 'Não é possível publicar a ficha: informe o setor de consumo da fibra.' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(NEW.lining_material, '') <> ''
       AND COALESCE(NEW.component_consumption_sectors ->> 'forracao_palmilha', '') = '' THEN
      RAISE EXCEPTION 'Não é possível publicar a ficha: informe o setor da forração da palmilha.' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(NEW.upper_material, '') <> ''
       AND COALESCE(NEW.component_consumption_sectors ->> 'cabedal', '') = '' THEN
      RAISE EXCEPTION 'Não é possível publicar a ficha: informe o setor de consumo do cabedal.' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(NEW.sole_material, '') <> ''
       AND COALESCE(NEW.component_consumption_sectors ->> 'solado', '') = '' THEN
      RAISE EXCEPTION 'Não é possível publicar a ficha: informe o setor de consumo do solado.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(COALESCE(NEW.direct_components, '[]'::jsonb)) component
       WHERE NULLIF(component ->> 'product_id', '') IS NOT NULL
         AND NULLIF(component ->> 'consumption_sector', '') IS NULL
    ) THEN
      RAISE EXCEPTION 'Não é possível publicar a ficha: há componente direto sem setor de consumo.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_block_incomplete_new_sheet_publication ON public.technical_sheets;
CREATE TRIGGER trg_block_incomplete_new_sheet_publication
  BEFORE UPDATE OF status_ficha ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_incomplete_new_sheet_publication();

UPDATE public.order_stages
   SET stage_order = public.canonical_stage_order(stage_name)
 WHERE public.canonical_stage_order(stage_name) <> 99
   AND stage_order IS DISTINCT FROM public.canonical_stage_order(stage_name);

-- ── Baixa física por setor ─────────────────────────────────────────────────
-- A reserva continua sendo criada na liberação da OP. A saída de estoque só
-- acontece quando pares entram em cada setor, sempre até o total já apontado.
-- Isso torna retries idempotentes e impede baixa parcial quando um dos itens
-- do setor não tiver saldo.

CREATE TABLE IF NOT EXISTS public.production_sector_material_debits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_stage_id uuid NOT NULL REFERENCES public.order_stages(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.material_reservations(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  stage_name text NOT NULL,
  pairs_covered numeric NOT NULL DEFAULT 0 CHECK (pairs_covered >= 0),
  quantity_debited numeric NOT NULL DEFAULT 0 CHECK (quantity_debited >= 0),
  grade_debited jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_stage_id, reservation_id)
);

ALTER TABLE public.production_sector_material_debits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved users can view production sector debits" ON public.production_sector_material_debits;
CREATE POLICY "Approved users can view production sector debits"
  ON public.production_sector_material_debits FOR SELECT TO authenticated USING (public.is_approved_user());
REVOKE ALL ON public.production_sector_material_debits FROM anon;
GRANT SELECT ON public.production_sector_material_debits TO authenticated;

CREATE INDEX IF NOT EXISTS idx_production_sector_material_debits_order_stage
  ON public.production_sector_material_debits(order_id, order_stage_id);

CREATE OR REPLACE FUNCTION public.resolve_consumption_sector(
  p_reference_id uuid, p_product_id uuid, p_component text, p_source text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sector text; v_sheet public.technical_sheets%ROWTYPE;
BEGIN
  -- BOM é explícito e tem precedência sobre a taxonomia de componente.
  SELECT sm.consumption_sector INTO v_sector
    FROM public.sheet_materials sm
   WHERE sm.sheet_id = p_reference_id AND sm.product_id = p_product_id
     AND NULLIF(btrim(sm.consumption_sector), '') IS NOT NULL
   ORDER BY sm.created_at NULLS LAST, sm.id
   LIMIT 1;
  IF v_sector IS NOT NULL THEN RETURN v_sector; END IF;

  SELECT * INTO v_sheet FROM public.technical_sheets WHERE id = p_reference_id;
  IF FOUND AND jsonb_typeof(COALESCE(v_sheet.direct_components, '[]'::jsonb)) = 'array' THEN
    SELECT NULLIF(btrim(component ->> 'consumption_sector'), '') INTO v_sector
      FROM jsonb_array_elements(v_sheet.direct_components) component
     WHERE component ->> 'product_id' = p_product_id::text
       AND NULLIF(btrim(component ->> 'consumption_sector'), '') IS NOT NULL
     LIMIT 1;
    IF v_sector IS NOT NULL THEN RETURN v_sector; END IF;
  END IF;

  -- Fallback de transição para fichas já existentes. Fichas novas são
  -- bloqueadas na publicação até terem roteamento explícito.
  RETURN CASE lower(coalesce(p_component, ''))
    WHEN 'solado' THEN 'Solagem'
    WHEN 'palmilha' THEN 'Corte Fibra'
    WHEN 'forração palmilha' THEN 'Corte Forração'
    WHEN 'forracao palmilha' THEN 'Corte Forração'
    WHEN 'cabedal' THEN 'Corte Cabedal'
    WHEN 'forração' THEN 'Corte Cabedal'
    WHEN 'forracao' THEN 'Corte Cabedal'
    WHEN 'fachete' THEN 'Aviamento'
    WHEN 'tiras' THEN 'Aviamento'
    WHEN 'químicos' THEN 'Colagem'
    WHEN 'quimicos' THEN 'Colagem'
    WHEN 'embalagem' THEN 'Acabamento'
    ELSE 'Aviamento'
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_assign_reservation_consumption_sector()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_reference_id uuid; v_component text; v_source text;
BEGIN
  IF COALESCE(NEW.metadata ->> 'consumption_sector', '') <> '' THEN RETURN NEW; END IF;
  SELECT reference_id INTO v_reference_id FROM public.orders WHERE id = NEW.order_id;
  v_component := COALESCE(NEW.metadata ->> 'component', '');
  v_source := COALESCE(NEW.metadata ->> 'source', '');
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
    'consumption_sector', public.resolve_consumption_sector(v_reference_id, NEW.product_id, v_component, v_source)
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assign_reservation_consumption_sector ON public.material_reservations;
CREATE TRIGGER trg_assign_reservation_consumption_sector
  BEFORE INSERT ON public.material_reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_reservation_consumption_sector();

CREATE OR REPLACE FUNCTION public.debit_reserved_materials_for_sector(
  p_order_id uuid, p_order_stage_id uuid, p_stage_name text, p_pairs numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order_qty numeric; v_stage text := public.canonical_stage_name(p_stage_name);
  v_res record; v_already numeric; v_target numeric; v_delta numeric;
  v_stock numeric; v_name text; v_grade jsonb; v_target_grade jsonb;
  v_new_grade jsonb; v_size text; v_required_size numeric; v_available_size numeric;
  v_prev_total numeric; v_total numeric; v_missing text[] := '{}';
BEGIN
  IF p_pairs <= 0 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('sector-debit:' || p_order_id::text));
  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF COALESCE(v_order_qty, 0) <= 0 THEN RAISE EXCEPTION 'OP sem quantidade válida para baixa por setor'; END IF;

  -- Primeiro valida TUDO. Assim uma falta nunca deixa baixa parcial no setor.
  FOR v_res IN
    SELECT mr.* FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND public.canonical_stage_name(COALESCE(mr.metadata ->> 'consumption_sector', '')) = v_stage
     ORDER BY mr.product_id, mr.id FOR UPDATE
  LOOP
    SELECT COALESCE(d.pairs_covered, 0) INTO v_already
      FROM public.production_sector_material_debits d
     WHERE d.order_stage_id = p_order_stage_id AND d.reservation_id = v_res.id FOR UPDATE;
    v_target := LEAST(p_pairs, v_order_qty);
    IF v_target <= COALESCE(v_already, 0) THEN CONTINUE; END IF;
    v_delta := v_res.quantity_reserved * (v_target - COALESCE(v_already, 0)) / v_order_qty;
    IF v_delta <= 0 THEN CONTINUE; END IF;
    IF COALESCE(v_res.metadata ->> 'kind', 'component') = 'sole_grade' THEN
      SELECT stock_grade, name INTO v_grade, v_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      FOR v_size, v_required_size IN SELECT key, value::numeric * (v_target - COALESCE(v_already, 0)) / v_order_qty FROM jsonb_each_text(COALESCE(v_res.metadata -> 'effective_grade', '{}'::jsonb))
      LOOP
        v_available_size := COALESCE((v_grade ->> v_size)::numeric, 0);
        IF v_available_size < v_required_size THEN v_missing := array_append(v_missing, format('%s tam. %s', v_name, v_size)); END IF;
      END LOOP;
    ELSE
      SELECT quantity, name INTO v_stock, v_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF COALESCE(v_stock, 0) < v_delta THEN v_missing := array_append(v_missing, v_name); END IF;
    END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente para iniciar %: %', p_stage_name, array_to_string(v_missing, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Só depois da validação integral faz as saídas e registra o ledger.
  FOR v_res IN
    SELECT mr.* FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id AND mr.status IN ('reserved', 'partially_consumed')
       AND public.canonical_stage_name(COALESCE(mr.metadata ->> 'consumption_sector', '')) = v_stage
     ORDER BY mr.product_id, mr.id FOR UPDATE
  LOOP
    SELECT COALESCE(d.pairs_covered, 0) INTO v_already FROM public.production_sector_material_debits d
     WHERE d.order_stage_id = p_order_stage_id AND d.reservation_id = v_res.id FOR UPDATE;
    v_target := LEAST(p_pairs, v_order_qty);
    IF v_target <= COALESCE(v_already, 0) THEN CONTINUE; END IF;
    v_delta := v_res.quantity_reserved * (v_target - COALESCE(v_already, 0)) / v_order_qty;
    IF v_delta <= 0 THEN CONTINUE; END IF;
    IF COALESCE(v_res.metadata ->> 'kind', 'component') = 'sole_grade' THEN
      SELECT COALESCE(stock_grade, '{}'::jsonb), name INTO v_grade, v_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      v_new_grade := v_grade; v_prev_total := 0; v_total := 0; v_target_grade := '{}'::jsonb;
      FOR v_size IN SELECT key FROM jsonb_each(v_grade) WHERE left(key, 1) <> '_' LOOP v_prev_total := v_prev_total + COALESCE((v_grade ->> v_size)::numeric, 0); END LOOP;
      FOR v_size, v_required_size IN SELECT key, value::numeric * (v_target - COALESCE(v_already, 0)) / v_order_qty FROM jsonb_each_text(COALESCE(v_res.metadata -> 'effective_grade', '{}'::jsonb))
      LOOP
        v_available_size := COALESCE((v_grade ->> v_size)::numeric, 0);
        v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available_size - v_required_size));
        v_target_grade := jsonb_set(v_target_grade, ARRAY[v_size], to_jsonb(v_required_size)); v_total := v_total + v_required_size;
      END LOOP;
      UPDATE public.products SET stock_grade = v_new_grade, quantity = quantity - v_total, updated_at = now() WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements(product_id, order_id, movement_type, quantity, previous_stock, new_stock, description)
      VALUES(v_res.product_id, p_order_id, 'out', v_total, v_prev_total, v_prev_total - v_total, 'Baixa por setor — ' || v_stage || ' (solado por grade)');
    ELSE
      SELECT quantity, name INTO v_stock, v_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      UPDATE public.products SET quantity = quantity - v_delta, updated_at = now() WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements(product_id, order_id, movement_type, quantity, previous_stock, new_stock, description)
      VALUES(v_res.product_id, p_order_id, 'out', v_delta, v_stock, v_stock - v_delta, 'Baixa por setor — ' || v_stage);
      v_target_grade := NULL; v_total := v_delta;
    END IF;
    INSERT INTO public.production_sector_material_debits(order_id, order_stage_id, reservation_id, product_id, stage_name, pairs_covered, quantity_debited, grade_debited)
    VALUES(p_order_id, p_order_stage_id, v_res.id, v_res.product_id, v_stage, v_target, COALESCE(v_total, v_delta), v_target_grade)
    ON CONFLICT(order_stage_id, reservation_id) DO UPDATE SET pairs_covered = EXCLUDED.pairs_covered,
      quantity_debited = public.production_sector_material_debits.quantity_debited + EXCLUDED.quantity_debited,
      grade_debited = COALESCE(EXCLUDED.grade_debited, public.production_sector_material_debits.grade_debited), updated_at = now();
    -- quantity_reserved é a obrigação original da OP: não a reduza, pois a
    -- próxima baixa proporcional precisa da mesma base. O progresso físico é
    -- registrado em quantity_consumed e no ledger por estágio.
    UPDATE public.material_reservations SET
      quantity_consumed = quantity_consumed + COALESCE(v_total, v_delta),
      status = CASE WHEN quantity_consumed + COALESCE(v_total, v_delta) >= quantity_reserved THEN 'consumed' ELSE 'partially_consumed' END,
      reservation_type = 'hard', consumed_at = CASE WHEN quantity_consumed + COALESCE(v_total, v_delta) >= quantity_reserved THEN now() ELSE consumed_at END, updated_at = now()
      WHERE id = v_res.id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_debit_materials_when_sector_starts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.quantity_processed > COALESCE(OLD.quantity_processed, 0) THEN
    PERFORM public.debit_reserved_materials_for_sector(NEW.order_id, NEW.id, NEW.stage_name, NEW.quantity_processed);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ab_debit_materials_when_sector_starts ON public.order_stages;
CREATE TRIGGER trg_ab_debit_materials_when_sector_starts
  BEFORE UPDATE OF quantity_processed ON public.order_stages
  FOR EACH ROW EXECUTE FUNCTION public.tg_debit_materials_when_sector_starts();

-- A finalização não pode "completar" a baixa de uma etapa que nunca entrou em
-- produção. Este trigger roda antes do settle legado (`trg_aa_settle...`) e
-- mantém a diferença como pendência auditável, sem reescrever OPs históricas.
CREATE OR REPLACE FUNCTION public.tg_preserve_unstarted_sector_reservations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido')
     AND COALESCE(OLD.status, '') IS DISTINCT FROM NEW.status THEN
    UPDATE public.material_reservations mr
       SET status = 'pending_reconciliation', updated_at = now(),
           notes = COALESCE(NULLIF(mr.notes, ''), '')
             || ' [pendente: setor de consumo não iniciado antes da finalização]'
     WHERE mr.order_id = NEW.id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND NULLIF(mr.metadata ->> 'consumption_sector', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.order_stages os
          WHERE os.order_id = NEW.id
            AND public.canonical_stage_name(os.stage_name) = public.canonical_stage_name(mr.metadata ->> 'consumption_sector')
            AND COALESCE(os.quantity_processed, 0) > 0
       );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aa0_preserve_unstarted_sector_reservations ON public.orders;
CREATE TRIGGER trg_aa0_preserve_unstarted_sector_reservations
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_preserve_unstarted_sector_reservations();
