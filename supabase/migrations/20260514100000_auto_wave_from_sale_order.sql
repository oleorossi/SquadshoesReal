-- ============================================================================
-- ONDAS AUTOMÁTICAS por PV (Recomendação A do relatório personalizado).
-- ============================================================================
-- Achado: 82% das OPs têm exatamente 12 pares (caixa única) porque
-- revendedores pequenos pedem 1 caixa por modelo/cor. A solução não é mexer
-- nas OPs — é AGRUPAR via production_waves pra que setores trabalhem
-- por LOTE consolidado por (referência + cor).
--
-- Quando um PV passa pra 'Em Produção' e tem >= wave_auto_min_ops OPs
-- (default 5), o trigger cria automaticamente uma onda agregando todas
-- as OPs do PV por (reference_id, color). A grade JSONB é mesclada
-- somando pares por tamanho.
--
-- Setores Costura/Corte/Mesa passam a ver "este PV é 480 pares do modelo
-- X" ao invés de "40 cartões de 12 pares cada". Throughput sobe sem
-- mexer no fluxo fiscal (cada OP individual continua existindo).
--
-- Idempotente: não cria onda se PV já tem uma onda automática.
-- Configurável: ajustar wave_auto_min_ops em system_settings.
-- ============================================================================

-- Threshold configurável
INSERT INTO public.system_settings(key, value)
VALUES ('wave_auto_min_ops', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.auto_create_wave_from_sale_order(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wave_id uuid;
  v_min_ops int;
  v_op_count int;
  v_total_pairs int;
  v_so RECORD;
  v_iso_year int;
  v_iso_week int;
  v_already_exists boolean;
BEGIN
  SELECT COALESCE((value::text)::int, 5) INTO v_min_ops
  FROM public.system_settings WHERE key='wave_auto_min_ops';
  v_min_ops := COALESCE(v_min_ops, 5);

  SELECT COUNT(*), COALESCE(SUM(quantity),0) INTO v_op_count, v_total_pairs
  FROM public.orders
  WHERE sale_order_id = p_sale_order_id
    AND status NOT IN ('Cancelada','Cancelado','cancelada','cancelado','Finalizado','finalizado');

  IF v_op_count < v_min_ops THEN RETURN NULL; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.production_wave_items pwi
    WHERE pwi.reference_id IN (
      SELECT reference_id FROM public.orders WHERE sale_order_id = p_sale_order_id
    )
    AND pwi.wave_id IN (
      SELECT pw.id FROM public.production_waves pw
      WHERE pw.notes LIKE '%auto:so=' || p_sale_order_id::text || '%'
    )
  ) INTO v_already_exists;
  IF v_already_exists THEN RETURN NULL; END IF;

  SELECT so.client_id,
         (SELECT MIN(o.planned_delivery) FROM public.orders o WHERE o.sale_order_id = p_sale_order_id) AS earliest
  INTO v_so
  FROM public.sale_orders so WHERE so.id = p_sale_order_id;

  v_iso_year := EXTRACT(ISOYEAR FROM COALESCE(v_so.earliest, CURRENT_DATE + 28));
  v_iso_week := EXTRACT(WEEK    FROM COALESCE(v_so.earliest, CURRENT_DATE + 28));

  INSERT INTO public.production_waves (
    code, week_start, week_end, status, total_pairs, total_items,
    earliest_deadline, start_mode, notes
  )
  VALUES (
    'AUTO-' || v_iso_year || '-' || lpad(v_iso_week::text, 2, '0') ||
      '-' || COALESCE((SELECT order_number FROM public.sale_orders WHERE id = p_sale_order_id), p_sale_order_id::text),
    date_trunc('week', COALESCE(v_so.earliest, CURRENT_DATE + 28)::timestamp)::date,
    (date_trunc('week', COALESCE(v_so.earliest, CURRENT_DATE + 28)::timestamp) + INTERVAL '6 days')::date,
    'draft', v_total_pairs, v_op_count,
    v_so.earliest, 'auto',
    'Onda auto-criada pelo trigger ao passar PV pra Em Produção. auto:so=' || p_sale_order_id::text
  )
  RETURNING id INTO v_wave_id;

  INSERT INTO public.production_wave_items (
    wave_id, reference_id, color, total_quantity, grade, sort_order, status,
    block_key, block_sequence, client_id, store_name
  )
  SELECT
    v_wave_id, o.reference_id, o.color,
    SUM(o.quantity)::int,
    (SELECT jsonb_object_agg(key, value)
       FROM (
         SELECT key, SUM((value)::numeric)::text::int AS value
         FROM public.orders o2, jsonb_each_text(COALESCE(o2.grade, '{}'::jsonb))
         WHERE o2.sale_order_id = p_sale_order_id
           AND o2.reference_id = o.reference_id
           AND COALESCE(o2.color,'') = COALESCE(o.color,'')
         GROUP BY key
       ) g
    ),
    row_number() OVER (ORDER BY o.reference_id, o.color)::int,
    'pending',
    o.reference_id::text || '|' || COALESCE(o.color,''),
    row_number() OVER (PARTITION BY o.reference_id ORDER BY o.color)::int,
    v_so.client_id, NULL
  FROM public.orders o
  WHERE o.sale_order_id = p_sale_order_id
    AND o.status NOT IN ('Cancelada','Cancelado','cancelada','cancelado','Finalizado','finalizado')
  GROUP BY o.reference_id, o.color;

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_create_wave_from_sale_order(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_auto_wave_on_sale_order_in_production()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Em Produção'
     AND (OLD.status IS NULL OR OLD.status <> 'Em Produção') THEN
    PERFORM public.auto_create_wave_from_sale_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_auto_wave_on_sale_order_in_production ON public.sale_orders;
CREATE TRIGGER tg_auto_wave_on_sale_order_in_production
  AFTER UPDATE OF status ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_auto_wave_on_sale_order_in_production();
