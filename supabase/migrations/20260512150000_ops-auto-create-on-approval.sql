-- =============================================================================
-- 20260512150000 — Auto-criar OPs em PV "Aprovado" + backfill PV-00083
-- =============================================================================
-- Bug reportado em 2026-05-12: PV-2026-00083 (LOJÃO DE NITEROI, status Aprovado
-- de 31/03) não tinha OPs criadas — não aparecia na página /imprimir-fichas
-- nem em listas de OPs ativas. Causa: trigger anterior só criava OPs quando
-- status=='Em Produção'. PVs aprovados antes do trigger ficavam órfãos.
--
-- Mudanças:
-- 1) Trigger trg_sale_order_creates_ops_on_production agora dispara em
--    'Aprovado' (cria OPs como 'Reservado') E em 'Em Produção' (cria como
--    'Em Produção' OU promove OP existente).
-- 2) Backfill: cria OPs faltantes pro PV-2026-00083 com status 'Reservado'.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_ops_on_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_op_id uuid;
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_sectors text[];
  v_stage_name text;
  v_stage_idx int;
  v_target_op_status text;
BEGIN
  -- Aprovado → OP 'Reservado'; Em Produção → OP 'Em Produção'
  IF NEW.status = 'Aprovado' THEN
    v_target_op_status := 'Reservado';
  ELSIF NEW.status = 'Em Produção' THEN
    v_target_op_status := 'Em Produção';
  ELSE
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  FOR v_item IN
    SELECT id, reference_id, quantity, color, grade, observation
      FROM public.sale_order_items
     WHERE sale_order_id = NEW.id
  LOOP
    SELECT id INTO v_op_id
      FROM public.orders
     WHERE sale_order_item_id = v_item.id LIMIT 1;

    IF v_op_id IS NULL THEN
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id, v_item.quantity, COALESCE(v_item.color,''),
        COALESCE(v_item.grade, '{}'::jsonb),
        NEW.id, v_item.id,
        CASE v_target_op_status
          WHEN 'Reservado' THEN 'OP criada automaticamente ao aprovar PV'
          ELSE 'OP criada automaticamente ao mover PV pra Em Produção'
        END,
        v_target_op_status,
        v_item.observation,
        NEW.delivery_deadline
      ) RETURNING id INTO v_op_id;
    ELSIF v_target_op_status = 'Em Produção' THEN
      UPDATE public.orders
         SET status = 'Em Produção', updated_at = now()
       WHERE id = v_op_id
         AND status NOT IN ('Em Produção','Concluída','Cancelada','Faturado');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.order_stages WHERE order_id = v_op_id) THEN
      SELECT ARRAY(
        SELECT jsonb_array_elements_text(production_sectors)
          FROM public.technical_sheets
         WHERE id = v_item.reference_id
           AND production_sectors IS NOT NULL
           AND jsonb_typeof(production_sectors) = 'array'
           AND jsonb_array_length(production_sectors) > 0
      ) INTO v_sectors;

      IF v_sectors IS NULL OR array_length(v_sectors, 1) IS NULL THEN
        v_sectors := v_default_sectors;
      END IF;

      v_stage_idx := 1;
      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status,
          quantity_total, quantity_processed
        ) VALUES (
          v_op_id, v_stage_name, v_stage_idx, 'pendente',
          v_item.quantity, 0
        );
        v_stage_idx := v_stage_idx + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sale_order_creates_ops_on_production ON public.sale_orders;
CREATE TRIGGER trg_sale_order_creates_ops_on_production
  AFTER INSERT OR UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  WHEN (NEW.status IN ('Aprovado', 'Em Produção'))
  EXECUTE FUNCTION tg_sale_order_creates_ops_on_production();

-- Backfill: gera OPs faltantes pra TODOS os PVs aprovados/em produção
-- (qualquer um que tenha sale_order_items mas nenhuma OP). Idempotente.
DO $$
DECLARE
  v_pv RECORD;
  v_item RECORD;
  v_op_id uuid;
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_sectors text[];
  v_stage_name text;
  v_stage_idx int;
  v_op_status text;
BEGIN
  FOR v_pv IN
    SELECT so.id, so.order_number, so.status, so.delivery_deadline
      FROM public.sale_orders so
     WHERE so.status IN ('Aprovado','Em Produção')
       AND EXISTS (SELECT 1 FROM sale_order_items soi WHERE soi.sale_order_id = so.id)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.sale_order_id = so.id)
  LOOP
    v_op_status := CASE v_pv.status WHEN 'Aprovado' THEN 'Reservado' ELSE 'Em Produção' END;
    FOR v_item IN
      SELECT id, reference_id, quantity, color, grade, observation
        FROM public.sale_order_items WHERE sale_order_id = v_pv.id
    LOOP
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id, v_item.quantity, COALESCE(v_item.color,''),
        COALESCE(v_item.grade, '{}'::jsonb),
        v_pv.id, v_item.id,
        'OP criada via backfill 2026-05 (PV órfão pré-trigger)',
        v_op_status, v_item.observation, v_pv.delivery_deadline
      ) RETURNING id INTO v_op_id;

      SELECT ARRAY(
        SELECT jsonb_array_elements_text(production_sectors)
          FROM public.technical_sheets
         WHERE id = v_item.reference_id
           AND production_sectors IS NOT NULL
           AND jsonb_typeof(production_sectors) = 'array'
           AND jsonb_array_length(production_sectors) > 0
      ) INTO v_sectors;
      IF v_sectors IS NULL OR array_length(v_sectors,1) IS NULL THEN
        v_sectors := v_default_sectors;
      END IF;
      v_stage_idx := 1;
      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status, quantity_total, quantity_processed
        ) VALUES (v_op_id, v_stage_name, v_stage_idx, 'pendente', v_item.quantity, 0);
        v_stage_idx := v_stage_idx + 1;
      END LOOP;
    END LOOP;

    RAISE NOTICE 'Backfill: PV % (% status) → OPs criadas com status %',
      v_pv.order_number, v_pv.status, v_op_status;
  END LOOP;
END $$;
