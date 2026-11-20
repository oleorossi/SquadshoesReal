-- Motor de cabedal: cadastro de preparo e simulação somente leitura.
-- Não preenche preparo, não cria OC, não realoca reserva.
-- A chave auto_motor_enabled nasce desligada.
-- urgente_release_without_material nasce desligado: urgente também espera material.

ALTER TABLE public.atelier_complex_references
  ADD COLUMN IF NOT EXISTS prep_business_days integer;

ALTER TABLE public.atelier_complex_references
  DROP CONSTRAINT IF EXISTS atelier_complex_references_prep_business_days_check;

ALTER TABLE public.atelier_complex_references
  ADD CONSTRAINT atelier_complex_references_prep_business_days_check
  CHECK (prep_business_days IS NULL OR (prep_business_days BETWEEN 0 AND 90));

COMMENT ON COLUMN public.atelier_complex_references.prep_business_days IS
  'Dias úteis de preparo do cabedal neste setor. NULL ou 0 mantém a folga fixa de 7 dias.';

ALTER TABLE public.atelier_settings
  ADD COLUMN IF NOT EXISTS auto_motor_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_horizon_business_days integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS weekly_purchase_cap_brl numeric,
  ADD COLUMN IF NOT EXISTS buffer_business_days integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS urgent_release_without_material boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.atelier_settings.auto_motor_enabled IS
  'Ligado, o motor passa a definir sequência, compra e liberação. Nasce desligado.';
COMMENT ON COLUMN public.atelier_settings.urgent_release_without_material IS
  'Se true, PV urgente pode ir ao chão sem material completo. Nasce false. O cabedal complexo ainda espera o Ateliê.';

-- Pronto do job: preparo preenchido substitui os 7 dias e usa dias úteis.
DO $prep_ready$
DECLARE
  v_fn regprocedure := 'public.materialize_cabedal_prep_demands(uuid)'::regprocedure;
  v_def text;
  v_old text := $old$    v_lead := COALESCE(
      (SELECT s.ready_before_billing_days FROM public.atelier_settings s WHERE s.id = 1),
      7
    );
    v_ready := CASE WHEN v_billing_start IS NOT NULL
                    THEN v_billing_start - v_lead END;$old$;
  v_new text := $new$    -- prep_business_days_20270101050000
    v_lead := COALESCE(
      (
        SELECT MAX(acr.prep_business_days)
          FROM public.atelier_complex_references acr
         WHERE acr.reference_id = r.reference_id
           AND acr.active IS TRUE
           AND acr.prep_business_days > 0
           AND acr.sector = ANY (v_sectors)
      ),
      (SELECT s.ready_before_billing_days FROM public.atelier_settings s WHERE s.id = 1),
      7
    );
    v_ready := CASE
      WHEN v_billing_start IS NULL THEN NULL
      WHEN EXISTS (
        SELECT 1
          FROM public.atelier_complex_references acr
         WHERE acr.reference_id = r.reference_id
           AND acr.active IS TRUE
           AND acr.prep_business_days > 0
           AND acr.sector = ANY (v_sectors)
      ) THEN public.add_business_days(v_billing_start, -v_lead)
      ELSE v_billing_start - v_lead
    END;$new$;
BEGIN
  v_def := pg_get_functiondef(v_fn);
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'materialize_cabedal_prep_demands(uuid) não encontrada';
  END IF;
  IF strpos(v_def, 'prep_business_days_20270101050000') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'materialize_cabedal_prep_demands: âncora da folga de 7 dias não encontrada';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$prep_ready$;

-- Se existir CHECK de order_type, inclui urgente sem apagar os valores atuais.
DO $order_type_urgente$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'public.sale_orders'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%order_type%'
  LOOP
    IF r.def ILIKE '%urgente%' THEN
      CONTINUE;
    END IF;
    IF r.def !~* 'order_type' THEN
      CONTINUE;
    END IF;
    v_def := regexp_replace(r.def, '\)\s*$', ', ''urgente'')');
    IF v_def = r.def THEN
      RAISE EXCEPTION 'CHECK de order_type em formato inesperado: %', r.def;
    END IF;
    EXECUTE format('ALTER TABLE public.sale_orders DROP CONSTRAINT %I', r.conname);
    EXECUTE format('ALTER TABLE public.sale_orders ADD CONSTRAINT %I %s', r.conname, v_def);
  END LOOP;
END
$order_type_urgente$;

CREATE OR REPLACE FUNCTION public.list_cabedal_motor_purchase_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.is_approved_user() THEN jsonb_build_object(
      'motor_enabled', false,
      'items', '[]'::jsonb,
      'stock', '[]'::jsonb
    )
    ELSE jsonb_build_object(
      'motor_enabled', COALESCE((SELECT s.auto_motor_enabled FROM public.atelier_settings s WHERE s.id = 1), false),
      'urgent_release_without_material', COALESCE((SELECT s.urgent_release_without_material FROM public.atelier_settings s WHERE s.id = 1), false),
      'purchase_horizon_business_days', COALESCE((SELECT s.purchase_horizon_business_days FROM public.atelier_settings s WHERE s.id = 1), 10),
      'weekly_purchase_cap_brl', (SELECT s.weekly_purchase_cap_brl FROM public.atelier_settings s WHERE s.id = 1),
      'buffer_business_days', COALESCE((SELECT s.buffer_business_days FROM public.atelier_settings s WHERE s.id = 1), 2),
      'ready_before_billing_days', COALESCE((SELECT s.ready_before_billing_days FROM public.atelier_settings s WHERE s.id = 1), 7),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sale_order_id', so.id,
          'order_number', so.order_number,
          'order_type', so.order_type,
          'billing_week', so.billing_week,
          'item_id', soi.id,
          'reference_code', COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), ''),
          'color', soi.color,
          'pairs', soi.quantity,
          'assembly_capacity_per_day', ts.assembly_capacity_per_day,
          'prep_business_days', (
            SELECT MAX(acr.prep_business_days)
              FROM public.atelier_complex_references acr
             WHERE acr.reference_id = soi.reference_id
               AND acr.active IS TRUE
               AND acr.prep_business_days > 0
          ),
          'explicit_complex', EXISTS (
            SELECT 1
              FROM public.atelier_complex_references acr
             WHERE acr.reference_id = soi.reference_id
               AND acr.active IS TRUE
               AND acr.sector IN ('costura_cabedal', 'aviamento')
          ),
          'materials', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'product_id', p.id,
              'product_name', p.name,
              'unit', p.unit,
              'required', agg.required,
              'unit_price', p.unit_price,
              'supplier_id', s.id,
              'supplier_name', s.name,
              'supplier_lead_days', NULLIF(p.supplier_lead_time_days, 0)
            ))
              FROM (
                SELECT mr.product_id,
                       SUM(COALESCE(mr.quantity_reserved, 0) + COALESCE(mr.quantity_short, 0)) AS required
                  FROM public.material_reservations mr
                  LEFT JOIN public.orders o ON o.id = mr.order_id
                 WHERE mr.status = 'reserved'
                   AND (
                     mr.sale_order_id = so.id
                     OR o.sale_order_item_id = soi.id
                   )
                 GROUP BY mr.product_id
              ) agg
              JOIN public.products p ON p.id = agg.product_id
              LEFT JOIN public.suppliers s ON s.id = p.supplier_id
             WHERE agg.required > 0
          ), '[]'::jsonb)
        ))
          FROM public.sale_orders so
          JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
          LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
         WHERE so.deleted_at IS NULL
           AND so.status IN ('Aprovado', 'Em Produção')
           AND soi.production_excluded_at IS NULL
           AND COALESCE(soi.quantity, 0) > 0
      ), '[]'::jsonb),
      'stock', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', p.id,
          'free', GREATEST(COALESCE(p.quantity, 0), 0)
        ))
          FROM public.products p
         WHERE p.id IN (
           SELECT mr.product_id
             FROM public.material_reservations mr
            WHERE mr.status = 'reserved'
         )
      ), '[]'::jsonb)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.list_cabedal_motor_purchase_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_cabedal_motor_purchase_snapshot() TO authenticated, service_role;

COMMENT ON FUNCTION public.list_cabedal_motor_purchase_snapshot() IS
  'Leitura da simulação de compras do motor de cabedal. Não grava OC nem reserva.';
