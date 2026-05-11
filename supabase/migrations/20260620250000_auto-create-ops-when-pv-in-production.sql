-- Quando o PV vai pra 'Em Produção', criar automaticamente uma OP (orders)
-- por sale_order_item — antes só `force_sale_order_production` (admin) fazia
-- isso. Resultado: PVs em produção apareciam no Centro de Controle (waves)
-- mas SUMIAM da página de Etiquetas e da listagem de Ordens de Produção,
-- porque essas leem da tabela `orders`.

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
BEGIN
  IF NEW.status <> 'Em Produção' THEN RETURN NEW; END IF;
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
        'OP criada automaticamente ao mover PV pra Em Produção',
        'Em Produção',
        v_item.observation,
        NEW.delivery_deadline
      ) RETURNING id INTO v_op_id;
    ELSE
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
  WHEN (NEW.status = 'Em Produção')
  EXECUTE FUNCTION public.tg_sale_order_creates_ops_on_production();

GRANT EXECUTE ON FUNCTION public.tg_sale_order_creates_ops_on_production() TO authenticated;

-- Backfill: gera OPs pros PVs já em Em Produção/Faturado/Expedido/Concluído
-- que não tenham OP ainda. Não cria OP pra Cancelado/Rascunho/Aprovado.
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
  v_count int := 0;
BEGIN
  FOR v_pv IN
    SELECT id, delivery_deadline
      FROM public.sale_orders
     WHERE status IN ('Em Produção','Faturado','Expedido','Concluído')
       AND NOT EXISTS (
         SELECT 1 FROM public.orders o
          WHERE o.sale_order_id = sale_orders.id
       )
  LOOP
    FOR v_item IN
      SELECT id, reference_id, quantity, color, grade, observation
        FROM public.sale_order_items
       WHERE sale_order_id = v_pv.id
    LOOP
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id, v_item.quantity, COALESCE(v_item.color,''),
        COALESCE(v_item.grade, '{}'::jsonb),
        v_pv.id, v_item.id,
        'OP criada automaticamente (backfill)',
        'Em Produção',
        v_item.observation,
        v_pv.delivery_deadline
      ) RETURNING id INTO v_op_id;

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
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Backfill: % OPs criadas', v_count;
END $$;
