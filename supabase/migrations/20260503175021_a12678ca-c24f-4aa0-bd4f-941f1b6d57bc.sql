
-- ── 1) Campos de expedição em sale_orders ────────────────────────────────────
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS shipped_at               timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_dispatch_at    timestamptz,
  ADD COLUMN IF NOT EXISTS modalidade_frete         text DEFAULT 'CIF'
    CHECK (modalidade_frete IN ('CIF','FOB','TERCEIRO','PROPRIO','SEM_FRETE')),
  ADD COLUMN IF NOT EXISTS transport_company_id     uuid
    REFERENCES public.transport_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS valor_frete              numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checked_by               text;

CREATE INDEX IF NOT EXISTS idx_sale_orders_shipped_at
  ON public.sale_orders (shipped_at) WHERE shipped_at IS NULL;

COMMENT ON COLUMN public.sale_orders.shipped_at IS
  'Data/hora de registro da expedição. NULL = ainda não expedido.';

COMMENT ON COLUMN public.sale_orders.modalidade_frete IS
  'Modalidade de frete para NF-e: CIF=0, FOB=1, TERCEIRO=2, PROPRIO=3, SEM_FRETE=9.';

-- ── 2) Romaneio de carga (loading manifest) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loading_manifests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_number   text NOT NULL,
  dispatch_date     date NOT NULL DEFAULT CURRENT_DATE,
  transport_company_id uuid REFERENCES public.transport_companies(id) ON DELETE SET NULL,
  driver_name       text,
  vehicle_plate     text,
  total_pairs       int DEFAULT 0,
  total_weight_kg   numeric(10,2) DEFAULT 0,
  total_volume_m3   numeric(8,4) DEFAULT 0,
  notes             text,
  status            text DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','dispatched')),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loading_manifest_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id     uuid NOT NULL REFERENCES public.loading_manifests(id) ON DELETE CASCADE,
  sale_order_id   uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  client_name     text,
  destination     text,
  volumes_count   int DEFAULT 1,
  total_pairs     int DEFAULT 0,
  weight_kg       numeric(10,2) DEFAULT 0,
  nfe_number      text,
  valor_nf        numeric(12,2) DEFAULT 0,
  notes           text
);

ALTER TABLE public.loading_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loading_manifest_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_loading_manifests" ON public.loading_manifests;
CREATE POLICY "authenticated_all_loading_manifests"
  ON public.loading_manifests FOR ALL TO authenticated
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS "authenticated_all_loading_manifest_items" ON public.loading_manifest_items;
CREATE POLICY "authenticated_all_loading_manifest_items"
  ON public.loading_manifest_items FOR ALL TO authenticated
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- ── 3) RPC register_order_shipment ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.register_order_shipment(p_sale_order_ids    uuid[], p_manifest_id       uuid, p_checked_by        text) CASCADE;
CREATE OR REPLACE FUNCTION public.register_order_shipment(
  p_sale_order_ids    uuid[],
  p_manifest_id       uuid     DEFAULT NULL,
  p_checked_by        text     DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.sale_orders
     SET shipped_at  = now(),
         checked_by  = p_checked_by
   WHERE id = ANY(p_sale_order_ids)
     AND shipped_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_manifest_id IS NOT NULL AND v_count > 0 THEN
    INSERT INTO public.loading_manifest_items (manifest_id, sale_order_id)
    SELECT p_manifest_id, unnest(p_sale_order_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_order_shipment(uuid[], uuid, text) TO authenticated;

-- ── 4) Sequência para número do romaneio ─────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.loading_manifest_seq START 1;

DROP FUNCTION IF EXISTS public.next_manifest_number() CASCADE;
CREATE OR REPLACE FUNCTION public.next_manifest_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'ROM-' || EXTRACT(YEAR FROM now())::text || '-' ||
         LPAD(nextval('public.loading_manifest_seq')::text, 4, '0');
$$;

GRANT EXECUTE ON FUNCTION public.next_manifest_number() TO authenticated;
