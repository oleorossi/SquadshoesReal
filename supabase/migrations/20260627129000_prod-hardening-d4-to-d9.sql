-- =============================================================================
-- 20260627129000 — Hardening D4-D9 (production layer)
-- =============================================================================
--
-- Bundles fixes for D4 through D9 of the audit. Each block is independent
-- and idempotent. Listed in order of dependency.

-- ──────────────────────────────────────────────────────────────────────────────
-- D4 — auto_assign_sale_order_to_wave: stages com enum canônico
-- ──────────────────────────────────────────────────────────────────────────────
-- Bug: a função inseria apenas 5 stages legacy
-- ('corte','costura','montagem','solagem','acabamento') quando hoje os stages
-- canônicos (pós-PR 2/PR 3) são 10. Ondas auto-criadas ficavam com schema
-- incompleto; updateMesaCapacity (.eq('stage','mesa')) afetava 0 rows.
CREATE OR REPLACE FUNCTION public.auto_assign_sale_order_to_wave(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so RECORD;
  v_code text;
  v_wave_id uuid;
  v_row RECORD;
  v_wave_item_id uuid;
BEGIN
  SELECT id, status, delivery_deadline INTO v_so
    FROM sale_orders WHERE id = p_sale_order_id;

  IF v_so.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_so.status NOT IN ('Aprovado','Em Produção') THEN
    RETURN NULL;
  END IF;

  v_code := 'AUTO-' || to_char(COALESCE(v_so.delivery_deadline::date, CURRENT_DATE), 'IYYY-IW');

  INSERT INTO production_waves (code, name, status, earliest_deadline)
  VALUES (v_code, v_code, 'draft', v_so.delivery_deadline)
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  IF v_wave_id IS NULL THEN
    SELECT id INTO v_wave_id FROM production_waves WHERE code = v_code;
  END IF;

  -- FIX D4: 10 stages canônicos (PR 2 + PR 3). Antes só 5 legacy.
  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY[
    'corte_palmilha','corte_forracao','costura','mesa','silk',
    'colagem','montagem','solagem','acabamento','expedicao'
  ]) AS s
  ON CONFLICT DO NOTHING;

  FOR v_row IN
    SELECT
      soi.id AS source_item_id,
      so.id AS sale_order_id,
      so.client_id,
      COALESCE(c.razao_social, so.id::text) AS store_name,
      soi.reference_id,
      COALESCE(soi.color,'') AS color,
      COALESCE(soi.quantity,0)::numeric AS qty,
      COALESCE(soi.grade,'{}'::jsonb) AS grade,
      (SELECT sole_product_id FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = p_sale_order_id
  LOOP
    IF v_row.qty <= 0 THEN CONTINUE; END IF;

    INSERT INTO production_wave_items (
      wave_id, reference_id, sole_product_id, color, store_name,
      client_id, total_quantity, grade
    )
    VALUES (
      v_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, v_row.store_name,
      v_row.client_id, v_row.qty, v_row.grade
    )
    RETURNING id INTO v_wave_item_id;

    INSERT INTO production_wave_item_sources (
      wave_item_id, sale_order_id, sale_order_item_id, quantity, grade
    )
    VALUES (
      v_wave_item_id, v_row.sale_order_id, v_row.source_item_id, v_row.qty, v_row.grade
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_wave_id;
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────────
-- D5 — trigger pronto-na-cor: bidirectional (restaura setores ao desligar)
-- ──────────────────────────────────────────────────────────────────────────────
-- Bug: trigger só removia Corte Palmilha/Corte Forração/Costura quando
-- insole_ready_made=true. Ao desligar a flag, setores não voltavam, ficha
-- ficava sem fluxo de corte/costura.
CREATE OR REPLACE FUNCTION public.tg_strip_cut_sectors_when_ready_made()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_arr jsonb;
  v_required text[] := ARRAY['Corte Palmilha','Corte Forração','Costura'];
  v_canonical text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento'
  ];
  v_sector text;
  v_exists boolean;
BEGIN
  IF NEW.production_sectors IS NULL THEN
    NEW.production_sectors := '[]'::jsonb;
  END IF;

  IF NEW.insole_ready_made = true THEN
    -- Remove cut+costura sectors (idempotente)
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
      INTO v_arr
      FROM jsonb_array_elements_text(NEW.production_sectors) AS t(value)
     WHERE LOWER(TRIM(value)) NOT IN ('corte palmilha','corte forração','corte forracao','costura');
    NEW.production_sectors := v_arr;
  ELSE
    -- D5 FIX: ao desligar pronto-na-cor, restaura os 3 setores se estiverem
    -- faltando. Preserva qualquer setor ad-hoc adicionado manualmente.
    FOREACH v_sector IN ARRAY v_required LOOP
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.production_sectors) AS t(value)
         WHERE LOWER(TRIM(value)) = LOWER(v_sector)
      ) INTO v_exists;
      IF NOT v_exists THEN
        NEW.production_sectors := NEW.production_sectors || to_jsonb(v_sector);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────────
-- D6 — recalcular ondas quando capacidade da ficha técnica muda
-- ──────────────────────────────────────────────────────────────────────────────
-- Bug: editar *_capacity_per_day em uma ficha não recomputava as ondas que já
-- usam essa ficha. Datas em production_waves.*_start_date ficavam congeladas.
CREATE OR REPLACE FUNCTION public.tg_recalc_waves_on_capacity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_wave_id uuid;
BEGIN
  IF NEW.cutting_capacity_per_day IS DISTINCT FROM OLD.cutting_capacity_per_day
     OR NEW.sewing_capacity_per_day IS DISTINCT FROM OLD.sewing_capacity_per_day
     OR NEW.assembly_capacity_per_day IS DISTINCT FROM OLD.assembly_capacity_per_day
     OR NEW.finishing_capacity_per_day IS DISTINCT FROM OLD.finishing_capacity_per_day
     OR NEW.silk_capacity_per_day IS DISTINCT FROM OLD.silk_capacity_per_day
     OR NEW.gluing_capacity_per_day IS DISTINCT FROM OLD.gluing_capacity_per_day
     OR NEW.soling_capacity_per_day IS DISTINCT FROM OLD.soling_capacity_per_day
     OR NEW.mesa_daily_capacity IS DISTINCT FROM OLD.mesa_daily_capacity
     OR NEW.costura_capacity_per_day IS DISTINCT FROM OLD.costura_capacity_per_day
  THEN
    FOR v_wave_id IN
      SELECT DISTINCT pwi.wave_id
        FROM production_wave_items pwi
       WHERE pwi.reference_id = NEW.id
    LOOP
      BEGIN
        PERFORM public.update_wave_timeline(v_wave_id);
      EXCEPTION WHEN OTHERS THEN
        -- Não bloqueia o UPDATE da ficha se a recomputação falhar.
        NULL;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_waves_on_capacity_change ON public.technical_sheets;
CREATE TRIGGER trg_recalc_waves_on_capacity_change
  AFTER UPDATE ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_recalc_waves_on_capacity_change();

-- ──────────────────────────────────────────────────────────────────────────────
-- D7 — sync OP a partir de alterações em sale_order_items
-- ──────────────────────────────────────────────────────────────────────────────
-- Bug: quando PV já está em produção, adicionar item ou alterar quantity em
-- sale_order_items não criava/atualizava a OP correspondente.
CREATE OR REPLACE FUNCTION public.tg_sync_orders_from_sale_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so_status text;
  v_sale_order_id uuid;
  v_existing_op_id uuid;
BEGIN
  v_sale_order_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_sale_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT status INTO v_so_status FROM public.sale_orders WHERE id = v_sale_order_id;
  -- Só age se PV está em produção. Outros estados (Rascunho/Aprovado/etc.)
  -- são tratados pelo flow de Aprovação/auto-create-ops existente.
  IF v_so_status <> 'Em Produção' THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    -- Cria OP nova com o item adicionado
    INSERT INTO public.orders (
      reference_id, quantity, color, grade,
      sale_order_id, sale_order_item_id, status, notes
    )
    VALUES (
      NEW.reference_id, NEW.quantity, COALESCE(NEW.color,''),
      COALESCE(NEW.grade,'{}'::jsonb),
      v_sale_order_id, NEW.id, 'Reservado',
      'Auto-criada por alteração em PV (item adicionado)'
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT id INTO v_existing_op_id
      FROM public.orders
     WHERE sale_order_item_id = NEW.id
       AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')
     LIMIT 1;
    IF v_existing_op_id IS NOT NULL
       AND (NEW.quantity IS DISTINCT FROM OLD.quantity
            OR NEW.color IS DISTINCT FROM OLD.color
            OR NEW.grade IS DISTINCT FROM OLD.grade)
    THEN
      UPDATE public.orders
         SET quantity = NEW.quantity,
             color = COALESCE(NEW.color,''),
             grade = COALESCE(NEW.grade,'{}'::jsonb),
             updated_at = now(),
             notes = COALESCE(notes,'') || E'\n' || 'Atualizada por alteração em PV — qty=' || NEW.quantity::text
       WHERE id = v_existing_op_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_orders_from_sale_order_item ON public.sale_order_items;
CREATE TRIGGER trg_sync_orders_from_sale_order_item
  AFTER INSERT OR UPDATE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_orders_from_sale_order_item();

-- ──────────────────────────────────────────────────────────────────────────────
-- D8 + D9 — outsource bloqueia stage correto + AFTER INSERT
-- ──────────────────────────────────────────────────────────────────────────────
-- D8: ao terceirizar um setor prep (Corte Palmilha / Corte Forração / Mesa),
-- bloquear o "próximo stage_order" estava errado — esses 3 são paralelos.
-- O ponto de convergência real é Costura.
-- D9: trigger era AFTER UPDATE, então OS criada já em em_andamento (insert
-- direto) não bloqueava ninguém.

CREATE OR REPLACE FUNCTION public.tg_sync_op_block_on_outsource()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next_stage text;
  v_current_stage_order int;
  v_should_block boolean;
BEGIN
  IF NEW.related_order_id IS NULL OR NEW.sector IS NULL THEN
    RETURN NEW;
  END IF;

  -- D9 FIX: dispara também em INSERT direto com em_andamento (não só UPDATE)
  v_should_block := NEW.status = 'em_andamento'
                    AND NEW.service_date IS NOT NULL
                    AND (TG_OP = 'INSERT'
                         OR OLD.status IS DISTINCT FROM NEW.status
                         OR OLD.service_date IS DISTINCT FROM NEW.service_date);

  IF v_should_block THEN
    -- D8 FIX: prep paralelos (Corte Palmilha ‖ Corte Forração ‖ Aviamento)
    -- bloqueiam Costura (convergência), não o "próximo stage_order".
    IF NEW.sector IN ('Corte Palmilha','Corte Forração','Aviamento','Mesa') THEN
      v_next_stage := 'Costura';
    ELSE
      SELECT stage_order INTO v_current_stage_order
        FROM public.order_stages
       WHERE order_id = NEW.related_order_id
         AND stage_name = NEW.sector
       LIMIT 1;

      IF v_current_stage_order IS NOT NULL THEN
        SELECT stage_name INTO v_next_stage
          FROM public.order_stages
         WHERE order_id = NEW.related_order_id
           AND stage_order > v_current_stage_order
           AND status = 'pendente'
         ORDER BY stage_order ASC
         LIMIT 1;
      END IF;
    END IF;

    IF v_next_stage IS NOT NULL THEN
      UPDATE public.order_stages
         SET blocked_until = NEW.service_date,
             blocked_reason = format(
               'Aguardando OS terceirizada %s (%s) — prazo %s',
               COALESCE(NEW.order_number, NEW.id::text),
               NEW.sector,
               to_char(NEW.service_date, 'DD/MM/YYYY')
             ),
             updated_at = now()
       WHERE order_id = NEW.related_order_id
         AND stage_name = v_next_stage;
    END IF;
  END IF;

  -- Libera bloqueio quando OS conclui (preserva lógica original)
  IF (TG_OP = 'UPDATE' AND NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido')
     OR (TG_OP = 'UPDATE' AND NEW.status IN ('cancelado', 'cancelled')
         AND OLD.status IS DISTINCT FROM NEW.status)
  THEN
    UPDATE public.order_stages
       SET blocked_until = NULL,
           blocked_reason = NULL,
           updated_at = now()
     WHERE order_id = NEW.related_order_id
       AND blocked_reason ILIKE format('Aguardando OS terceirizada %s%%',
             COALESCE(NEW.order_number, NEW.id::text));
  END IF;

  RETURN NEW;
END;
$$;

-- D9: trigger agora dispara em INSERT também
DROP TRIGGER IF EXISTS trg_sync_op_block_on_outsource ON public.service_orders;
CREATE TRIGGER trg_sync_op_block_on_outsource
  AFTER INSERT OR UPDATE ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_op_block_on_outsource();
