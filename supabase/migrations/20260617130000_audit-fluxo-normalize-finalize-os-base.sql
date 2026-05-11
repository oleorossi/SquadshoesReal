-- =============================================================================
-- AUDIT FLUXO COMPLETO — fixes pipeline/sectors/OS base
-- =============================================================================
-- Cobre:
--   🔴 S3 — trigger normalize coloca Aviamento(3) antes Costura(4); conflita com
--         stage_order() SQL (costura=3,mesa=4) e frontend STAGE_ORDER. UPDATE em
--         technical_sheets quebra ordem.
--   🔴 S4 — finalize_production_sector hardcoded com setores antigos (Corte/
--         Aviamento/Preparação/Montagem/Expedição); não inicia 3 prep paralelos.
--   🔴 O2 — OS criada não debita material base (couro/napa).
-- =============================================================================

-- ─── S3: alinha trigger normalize com stage_order() canônico ────────────────
-- Ordem canônica: corte_palmilha(1) → corte_forracao(2) → costura(3) →
--                  mesa/Aviamento(4) → silk(5) → colagem(6) → montagem(7) →
--                  solagem(8) → acabamento(9) → expedicao(10).
CREATE OR REPLACE FUNCTION public.tg_normalize_production_sectors()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_canonical text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_input text[];
  v_normalized text[];
  v_clean jsonb;
  v_had_corte boolean := false;
BEGIN
  IF NEW.production_sectors IS NULL OR jsonb_typeof(NEW.production_sectors) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(value) INTO v_input
  FROM jsonb_array_elements_text(NEW.production_sectors);

  IF v_input IS NULL THEN RETURN NEW; END IF;

  v_had_corte := 'Corte' = ANY(v_input);

  -- Legacy → canonical: 'Corte'→'Corte Palmilha', 'Forração'→'Corte Forração',
  -- 'Mesa'→'Aviamento'. Apply distinct.
  SELECT array_agg(DISTINCT
    CASE
      WHEN x = 'Corte' THEN 'Corte Palmilha'
      WHEN x = 'Forração' THEN 'Corte Forração'
      WHEN x = 'Mesa' THEN 'Aviamento'
      ELSE x
    END
  )
  INTO v_normalized
  FROM unnest(v_input) x;

  -- Se tinha 'Corte' legado: pode significar tanto Palmilha quanto Forração
  -- (fluxos antigos não distinguiam). Adiciona Corte Forração também pra evitar
  -- perda de setor — alinhado com PR1 que separou os dois.
  IF v_had_corte THEN
    v_normalized := v_normalized || ARRAY['Corte Forração'];
  END IF;

  SELECT jsonb_agg(s.value)
  INTO v_clean
  FROM (
    SELECT c.value, c.ord
    FROM unnest(v_canonical) WITH ORDINALITY AS c(value, ord)
    WHERE c.value = ANY(v_normalized)
    ORDER BY c.ord
  ) s;

  NEW.production_sectors := COALESCE(v_clean, '[]'::jsonb);
  RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tg_normalize_production_sectors() TO authenticated;


-- ─── S4: finalize_production_sector com paralelismo ─────────────────────────
-- Comportamento:
--   1. Marca p_current_sector como 'concluido' em order_stages
--   2. Resolve próximo(s) stage(s) a iniciar — respeitando paralelismo PR3:
--        a. Se p_current_sector ∈ {Corte Palmilha, Corte Forração, Aviamento}:
--           continua mesmo set paralelo enquanto algum prep não terminou. Quando
--           os 3 estão concluídos, inicia Costura.
--        b. Caso contrário: pega próximo stage_order > current.
--   3. Atualiza orders.status / production_step / last_sector_finished_at
--   4. Inicia automaticamente Corte Palmilha + Corte Forração + Aviamento ao
--      mesmo tempo se OP foi recém-aprovada (status='Reservado' → 'Em Produção').
DROP FUNCTION IF EXISTS public.finalize_production_sector(uuid, text) CASCADE;
CREATE OR REPLACE FUNCTION public.finalize_production_sector(
  p_order_id uuid,
  p_current_sector text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prep_sectors text[] := ARRAY['Corte Palmilha','Corte Forração','Aviamento'];
  v_is_prep boolean := p_current_sector = ANY(v_prep_sectors);
  v_all_prep_done boolean;
  v_pending_prep text[];
  v_next_stage_row RECORD;
  v_next_sectors text[];
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- 1. Marca atual como concluído.
  UPDATE public.order_stages
     SET status = 'concluido',
         completed_at = now(),
         updated_at = now()
   WHERE order_id = p_order_id
     AND stage_name = p_current_sector
     AND status <> 'concluido';

  -- 2. Resolve próximo(s).
  IF v_is_prep THEN
    -- Se p_current era um dos preps, verifica se TODOS os prep da OP terminaram.
    SELECT array_agg(stage_name)
      INTO v_pending_prep
      FROM public.order_stages
     WHERE order_id = p_order_id
       AND stage_name = ANY(v_prep_sectors)
       AND status <> 'concluido';

    v_all_prep_done := (v_pending_prep IS NULL OR array_length(v_pending_prep, 1) IS NULL);

    IF v_all_prep_done THEN
      -- Todos os prep concluídos: inicia Costura (próximo único).
      v_next_sectors := ARRAY[
        (SELECT stage_name FROM public.order_stages
          WHERE order_id = p_order_id
            AND status = 'pendente'
          ORDER BY stage_order ASC
          LIMIT 1)
      ];
    ELSE
      -- Ainda há prep pendente — não move OP de stage. Próximos prep continuam
      -- já iniciados em paralelo. Não precisa fazer nada além de retornar.
      v_next_sectors := ARRAY[]::text[];
    END IF;
  ELSE
    -- Setor sequencial (não-prep): pega o próximo único.
    SELECT array_agg(stage_name)
      INTO v_next_sectors
      FROM (
        SELECT stage_name
          FROM public.order_stages
         WHERE order_id = p_order_id
           AND status = 'pendente'
         ORDER BY stage_order ASC
         LIMIT 1
      ) s;
  END IF;

  -- 3. Marca próximo(s) como em_andamento + started_at.
  IF v_next_sectors IS NOT NULL AND array_length(v_next_sectors, 1) > 0 THEN
    UPDATE public.order_stages
       SET status = 'em_andamento',
           started_at = COALESCE(started_at, now()),
           updated_at = now()
     WHERE order_id = p_order_id
       AND stage_name = ANY(v_next_sectors)
       AND status = 'pendente';
  END IF;

  -- 4. Atualiza orders.production_step pra refletir setor ativo principal.
  --    Quando há múltiplos prep paralelos, escolhe o primeiro ainda pendente
  --    (apresentação UI).
  UPDATE public.orders o
     SET production_step = COALESCE(
           (SELECT s.stage_name
              FROM public.order_stages s
             WHERE s.order_id = o.id
               AND s.status = 'em_andamento'
             ORDER BY s.stage_order ASC
             LIMIT 1),
           o.production_step
         ),
         last_sector_finished_at = now(),
         status = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM public.order_stages s
              WHERE s.order_id = o.id
                AND s.status <> 'concluido'
           ) THEN 'Finalizado'
           ELSE o.status
         END,
         updated_at = now()
   WHERE o.id = p_order_id;

  v_result := jsonb_build_object(
    'success', true,
    'closed_sector', p_current_sector,
    'next_sectors', COALESCE(to_jsonb(v_next_sectors), '[]'::jsonb),
    'all_prep_done', v_all_prep_done
  );
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_production_sector(uuid, text) TO authenticated;


-- ─── BÔNUS: start_production_prep_parallel ──────────────────────────────────
-- Inicia os 3 prep paralelos (Corte Palmilha, Corte Forração, Aviamento) ao
-- mesmo tempo. Chamada quando OP entra em produção. Frontend (kanban) usa pra
-- visualmente sinalizar paralelismo.
CREATE OR REPLACE FUNCTION public.start_production_prep_parallel(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_started_count integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  UPDATE public.order_stages
     SET status = 'em_andamento',
         started_at = COALESCE(started_at, now()),
         updated_at = now()
   WHERE order_id = p_order_id
     AND stage_name IN ('Corte Palmilha','Corte Forração','Aviamento')
     AND status = 'pendente';

  GET DIAGNOSTICS v_started_count = ROW_COUNT;

  RETURN jsonb_build_object('started', v_started_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_production_prep_parallel(uuid) TO authenticated;


-- ─── O2: trigger debit base ao criar OS ─────────────────────────────────────
-- Quando uma service_order é criada com artisanal_recipe_id ≠ null, decrementa
-- estoque do produto base (couro/napa) proporcional aos artisanal_output_meters.
-- Match do base_product_name + artisanal_base_color via products.name + color.
CREATE OR REPLACE FUNCTION public.tg_debit_service_order_base()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recipe RECORD;
  v_product_id uuid;
  v_product_qty numeric;
  v_required numeric;
BEGIN
  IF NEW.artisanal_recipe_id IS NULL OR COALESCE(NEW.artisanal_output_meters, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('cancelado','cancelled','rejeitada') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
  IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Quantidade necessária do base = output_meters / yield_per_meter
  v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;

  -- Match: products.name = recipe.base_product_name + cor (se especificada)
  SELECT p.id, p.quantity INTO v_product_id, v_product_qty
    FROM public.products p
   WHERE p.active = true
     AND lower(trim(p.name)) = lower(trim(v_recipe.base_product_name))
     AND (NEW.artisanal_base_color IS NULL
          OR NEW.artisanal_base_color = ''
          OR lower(trim(coalesce(p.color, ''))) = lower(trim(NEW.artisanal_base_color)))
   ORDER BY (NEW.artisanal_base_color IS NOT NULL
             AND lower(trim(coalesce(p.color, ''))) = lower(trim(NEW.artisanal_base_color))) DESC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  IF v_product_id IS NULL THEN
    RAISE WARNING 'OS %: produto base "%" (cor %) não encontrado — não debitando estoque',
      NEW.order_number, v_recipe.base_product_name, COALESCE(NEW.artisanal_base_color, '');
    RETURN NEW;
  END IF;

  IF v_product_qty < v_required THEN
    RAISE WARNING 'OS %: estoque insuficiente de "%" (%) — disponível %, necessário %',
      NEW.order_number, v_recipe.base_product_name, COALESCE(NEW.artisanal_base_color, ''),
      v_product_qty, v_required;
  END IF;

  UPDATE public.products
     SET quantity   = GREATEST(0, quantity - v_required),
         updated_at = now()
   WHERE id = v_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock,
    description, order_id
  ) VALUES (
    v_product_id, 'out', v_required, v_product_qty,
    GREATEST(0, v_product_qty - v_required),
    'OS Artesanal ' || COALESCE(NEW.order_number, '?') ||
      ' — base "' || v_recipe.base_product_name || '"' ||
      CASE WHEN NEW.artisanal_base_color IS NOT NULL AND NEW.artisanal_base_color <> ''
           THEN ' (' || NEW.artisanal_base_color || ')' ELSE '' END,
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debit_service_order_base ON public.service_orders;
CREATE TRIGGER trg_debit_service_order_base
  AFTER INSERT ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_debit_service_order_base();


-- Trigger AFTER UPDATE pra estornar quando OS é cancelada.
CREATE OR REPLACE FUNCTION public.tg_revert_service_order_base_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_recipe RECORD;
  v_product_id uuid;
  v_required numeric;
BEGIN
  IF NEW.status IN ('cancelado','cancelled','rejeitada')
     AND OLD.status NOT IN ('cancelado','cancelled','rejeitada')
     AND NEW.artisanal_recipe_id IS NOT NULL
     AND COALESCE(NEW.artisanal_output_meters, 0) > 0 THEN

    SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
    IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN
      RETURN NEW;
    END IF;

    v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;

    SELECT p.id INTO v_product_id
      FROM public.products p
     WHERE p.active = true
       AND lower(trim(p.name)) = lower(trim(v_recipe.base_product_name))
       AND (NEW.artisanal_base_color IS NULL
            OR NEW.artisanal_base_color = ''
            OR lower(trim(coalesce(p.color, ''))) = lower(trim(NEW.artisanal_base_color)))
     LIMIT 1;

    IF v_product_id IS NOT NULL THEN
      UPDATE public.products
         SET quantity = quantity + v_required,
             updated_at = now()
       WHERE id = v_product_id;

      INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock,
        description, order_id
      )
      SELECT id, 'in', v_required,
             quantity - v_required, quantity,
             'Estorno OS ' || COALESCE(NEW.order_number, '?') || ' cancelada',
             NEW.id
        FROM public.products WHERE id = v_product_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revert_service_order_base_on_cancel ON public.service_orders;
CREATE TRIGGER trg_revert_service_order_base_on_cancel
  AFTER UPDATE OF status ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_revert_service_order_base_on_cancel();
