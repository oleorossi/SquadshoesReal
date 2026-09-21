-- Compras ↔ Produção (spec compras-producao-entrelacadas):
-- 1) Labels dos PVs na OC (order_number + client_order_number)
-- 2) purchase_by_date com setup (production_setup_times) + fallback buffer
-- 3) Fila de despacho: hold / advance / export mark
-- 4) Flag de XML no fornecedor
-- 5) View + RPCs para o hub /purchase-planning

-- ── Colunas ───────────────────────────────────────────────────────────────
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS source_pv_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dispatch_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dispatch_hold_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_hold_by uuid,
  ADD COLUMN IF NOT EXISTS dispatch_hold_reason text,
  ADD COLUMN IF NOT EXISTS exported_at timestamptz,
  ADD COLUMN IF NOT EXISTS export_xml_path text,
  ADD COLUMN IF NOT EXISTS sector_need_date date,
  ADD COLUMN IF NOT EXISTS setup_days_applied integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.purchase_orders.source_pv_labels IS
  'Lista {sale_order_id, order_number, client_order_number} dos PVs inclusos na OC.';
COMMENT ON COLUMN public.purchase_orders.dispatch_hold IS
  'Gestor segurou o envio no hub temporal; scheduler/export ignora.';
COMMENT ON COLUMN public.purchase_orders.exported_at IS
  'Momento em que PDF (+XML se couber) foi marcado como enviado.';
COMMENT ON COLUMN public.purchase_orders.sector_need_date IS
  'Início de uso no setor (âncora antes de lead/setup/buffer).';
COMMENT ON COLUMN public.purchase_orders.setup_days_applied IS
  'Dias de prep/setup subtraídos na data-limite (ceil minutos/480, piso 0).';

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS export_xml_layout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.suppliers.export_xml_layout IS
  'Quando true, o export da OC gera XML além do PDF (spec D18).';

-- Buffer padrão de prep quando não há linha em production_setup_times
CREATE TABLE IF NOT EXISTS public.purchase_dispatch_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  fallback_setup_days integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.purchase_dispatch_settings (id, fallback_setup_days)
VALUES (true, 1)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON TABLE public.purchase_dispatch_settings FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.purchase_dispatch_settings TO authenticated;
GRANT ALL ON TABLE public.purchase_dispatch_settings TO service_role;

-- ── Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_source_pv_labels(p_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'sale_order_id', so.id,
        'order_number', so.order_number,
        'client_order_number', so.client_order_number
      )
      ORDER BY so.order_number
    ),
    '[]'::jsonb
  )
  FROM public.sale_orders so
  WHERE so.id = ANY (COALESCE(p_ids, ARRAY[]::uuid[]))
    AND so.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.setup_days_for_sale_orders(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_max_minutes numeric;
  v_fallback integer;
BEGIN
  SELECT MAX(pst.setup_minutes)::numeric
    INTO v_max_minutes
    FROM public.production_setup_times pst
   WHERE EXISTS (
     SELECT 1
       FROM public.sale_order_items soi
      WHERE soi.sale_order_id = ANY (COALESCE(p_ids, ARRAY[]::uuid[]))
        AND (
          pst.from_reference_id IS NOT DISTINCT FROM soi.reference_id
          OR pst.to_reference_id IS NOT DISTINCT FROM soi.reference_id
          OR (pst.from_reference_id IS NULL AND pst.to_reference_id IS NULL)
        )
   );

  IF v_max_minutes IS NOT NULL AND v_max_minutes > 0 THEN
    -- Dia fabril de 8h: 480 min → 1 dia (ceil)
    RETURN GREATEST(1, CEILING(v_max_minutes / 480.0)::integer);
  END IF;

  SELECT fallback_setup_days INTO v_fallback
    FROM public.purchase_dispatch_settings WHERE id;
  RETURN COALESCE(v_fallback, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_po_need_and_purchase_dates(p_sale_order_ids uuid[])
RETURNS TABLE (
  sector_need_date date,
  purchase_by_date date,
  setup_days integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_deadline date;
  v_setup integer;
BEGIN
  SELECT t.purchase_deadline, t.material_ready_date
    INTO v_deadline, sector_need_date
    FROM public.compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  v_setup := public.setup_days_for_sale_orders(p_sale_order_ids);
  setup_days := v_setup;

  -- material_ready_date já é a âncora de chegada; setup empurra a compra para antes
  IF v_deadline IS NULL THEN
    purchase_by_date := NULL;
  ELSE
    purchase_by_date := (v_deadline - v_setup)::date;
  END IF;

  IF sector_need_date IS NULL THEN
    sector_need_date := v_deadline;
  END IF;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_purchase_order_dispatch_fields(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pvs uuid[];
  v_need date;
  v_buy date;
  v_setup integer;
BEGIN
  SELECT COALESCE(NULLIF(linked_sale_order_ids, '{}'::uuid[]),
                  NULLIF(source_pv_ids, '{}'::uuid[]))
    INTO v_pvs
    FROM public.purchase_orders
   WHERE id = p_po_id;

  IF v_pvs IS NULL THEN
    UPDATE public.purchase_orders
       SET source_pv_labels = '[]'::jsonb,
           updated_at = now()
     WHERE id = p_po_id;
    RETURN;
  END IF;

  SELECT d.sector_need_date, d.purchase_by_date, d.setup_days
    INTO v_need, v_buy, v_setup
    FROM public.compute_po_need_and_purchase_dates(v_pvs) d;

  UPDATE public.purchase_orders
     SET source_pv_labels = public.build_source_pv_labels(v_pvs),
         sector_need_date = COALESCE(v_need, sector_need_date),
         purchase_by_date = COALESCE(v_buy, purchase_by_date),
         setup_days_applied = COALESCE(v_setup, setup_days_applied),
         updated_at = now()
   WHERE id = p_po_id
     AND status IN ('suggested', 'draft', 'pending')
     AND exported_at IS NULL
     AND COALESCE(approval_status, 'pendente_aprovacao') = 'pendente_aprovacao';
END;
$$;

-- Trigger: labels + datas com setup em INSERT (e refresh em UPDATE de vínculos)
CREATE OR REPLACE FUNCTION public.tg_refresh_po_dispatch_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Evita loop: só reage a mudança de vínculos ou criação
  IF TG_OP = 'UPDATE'
     AND NEW.source_pv_ids IS NOT DISTINCT FROM OLD.source_pv_ids
     AND NEW.linked_sale_order_ids IS NOT DISTINCT FROM OLD.linked_sale_order_ids THEN
    RETURN NEW;
  END IF;

  PERFORM public.refresh_purchase_order_dispatch_fields(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_po_dispatch_fields ON public.purchase_orders;
CREATE TRIGGER trg_refresh_po_dispatch_fields
  AFTER INSERT OR UPDATE OF source_pv_ids, linked_sale_order_ids
  ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_po_dispatch_fields();

-- Preferir datas com setup no trigger legado de INSERT (quando purchase_by_date null)
CREATE OR REPLACE FUNCTION public.tg_set_po_purchase_by_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_pvs uuid[];
  v_row record;
BEGIN
  IF NEW.purchase_by_date IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_pvs := COALESCE(NULLIF(NEW.linked_sale_order_ids, '{}'::uuid[]),
                    NULLIF(NEW.source_pv_ids, '{}'::uuid[]));
  IF v_pvs IS NULL OR array_length(v_pvs, 1) IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_row FROM public.compute_po_need_and_purchase_dates(v_pvs);
  NEW.purchase_by_date := v_row.purchase_by_date;
  NEW.sector_need_date := COALESCE(NEW.sector_need_date, v_row.sector_need_date);
  NEW.setup_days_applied := COALESCE(v_row.setup_days, 0);
  NEW.source_pv_labels := public.build_source_pv_labels(v_pvs);
  RETURN NEW;
END;
$$;

-- ── RPCs do hub ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_purchase_order_dispatch_hold(
  p_purchase_order_id uuid,
  p_hold boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'não autorizado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.purchase_orders
     SET dispatch_hold = p_hold,
         dispatch_hold_at = CASE WHEN p_hold THEN now() ELSE NULL END,
         dispatch_hold_by = CASE WHEN p_hold THEN auth.uid() ELSE NULL END,
         dispatch_hold_reason = CASE WHEN p_hold THEN NULLIF(btrim(p_reason), '') ELSE NULL END,
         updated_at = now()
   WHERE id = p_purchase_order_id
     AND status IN ('suggested', 'draft', 'pending')
     AND exported_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC não elegível para hold' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true, 'hold', p_hold);
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_purchase_order_dispatch(p_purchase_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'não autorizado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.purchase_orders
     SET purchase_by_date = CURRENT_DATE,
         dispatch_hold = false,
         dispatch_hold_at = NULL,
         dispatch_hold_by = NULL,
         dispatch_hold_reason = NULL,
         updated_at = now()
   WHERE id = p_purchase_order_id
     AND status IN ('suggested', 'draft', 'pending')
     AND exported_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC não elegível para adiantar' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true, 'purchase_by_date', CURRENT_DATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_suggested_purchase_order(
  p_purchase_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'não autorizado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.purchase_orders
     SET status = 'cancelled',
         cancelled_at = now(),
         notes = concat_ws(
           E'\n',
           NULLIF(notes, ''),
           '[HUB] Cancelada: ' || COALESCE(NULLIF(btrim(p_reason), ''), 'sem motivo')
         ),
         updated_at = now()
   WHERE id = p_purchase_order_id
     AND auto_generated
     AND status IN ('suggested', 'draft')
     AND COALESCE(approval_status, 'pendente_aprovacao') = 'pendente_aprovacao'
     AND exported_at IS NULL
     AND snapshot_locked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC não elegível para cancelar' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_purchase_order_exported(
  p_purchase_order_id uuid,
  p_pdf_storage_path text DEFAULT NULL,
  p_xml_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() AND NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'não autorizado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.purchase_orders
     SET exported_at = now(),
         pdf_storage_path = COALESCE(NULLIF(p_pdf_storage_path, ''), pdf_storage_path),
         export_xml_path = COALESCE(NULLIF(p_xml_path, ''), export_xml_path),
         dispatch_hold = false,
         updated_at = now()
   WHERE id = p_purchase_order_id
     AND status NOT IN ('cancelled')
     AND exported_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC já exportada ou inválida' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true, 'exported_at', now());
END;
$$;

CREATE OR REPLACE VIEW public.v_purchase_dispatch_queue
WITH (security_invoker = true)
AS
SELECT
  po.id,
  po.order_number,
  po.status,
  po.approval_status,
  po.supplier_id,
  po.supplier_name,
  po.total_value,
  po.auto_generated,
  po.source_type,
  po.source_pv_ids,
  po.linked_sale_order_ids,
  po.source_pv_labels,
  po.purchase_by_date,
  po.promised_date,
  po.sector_need_date,
  po.setup_days_applied,
  po.dispatch_hold,
  po.dispatch_hold_at,
  po.dispatch_hold_reason,
  po.exported_at,
  po.export_xml_path,
  po.pdf_storage_path,
  po.created_at,
  po.updated_at,
  COALESCE(s.export_xml_layout, false) AS supplier_export_xml,
  CASE
    WHEN po.exported_at IS NOT NULL THEN 'exported'
    WHEN po.dispatch_hold THEN 'held'
    WHEN po.status IN ('suggested', 'draft')
         AND po.purchase_by_date IS NOT NULL
         AND po.purchase_by_date <= CURRENT_DATE THEN 'due'
    WHEN po.status IN ('suggested', 'draft') THEN 'ready'
    ELSE po.status
  END AS dispatch_state,
  (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'product_id', poi.product_id,
             'product_name', p.name,
             'color', poi.color,
             'quantity', poi.quantity,
             'unit', poi.unit
           ) ORDER BY p.name, poi.color), '[]'::jsonb)
      FROM public.purchase_order_items poi
      LEFT JOIN public.products p ON p.id = poi.product_id
     WHERE poi.purchase_order_id = po.id
  ) AS items_summary
FROM public.purchase_orders po
LEFT JOIN public.suppliers s ON s.id = po.supplier_id
WHERE po.auto_generated
  AND po.source_type = 'per_pv'
  AND po.status IN ('suggested', 'draft', 'pending')
  AND po.cancelled_at IS NULL;

GRANT SELECT ON public.v_purchase_dispatch_queue TO authenticated;

GRANT EXECUTE ON FUNCTION public.set_purchase_order_dispatch_hold(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_purchase_order_dispatch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_suggested_purchase_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_purchase_order_exported(uuid, text, text) TO authenticated;

-- Backfill labels + datas das OCs auto abertas
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
      FROM public.purchase_orders
     WHERE auto_generated
       AND source_type = 'per_pv'
       AND status IN ('suggested', 'draft', 'pending')
       AND exported_at IS NULL
  LOOP
    PERFORM public.refresh_purchase_order_dispatch_fields(r.id);
  END LOOP;
END $$;
