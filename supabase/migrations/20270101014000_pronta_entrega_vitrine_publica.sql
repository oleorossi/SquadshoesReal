-- Pronta entrega: vitrine publica por token + inbox de pedidos do cliente.
-- Nao abre SELECT anon em ready_stock. Cliente so passa pelas RPCs abaixo.

CREATE TABLE IF NOT EXISTS public.ready_stock_public_link (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ready_stock_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'lido', 'atendido', 'cancelado')),
  customer_name text NOT NULL,
  customer_phone text,
  customer_email text,
  notes text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_pairs integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ready_stock_public_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ready_stock_inquiries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ready_stock_public_link FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.ready_stock_inquiries FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ready_stock_public_link TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.ready_stock_inquiries TO authenticated;
GRANT ALL ON TABLE public.ready_stock_public_link TO service_role;
GRANT ALL ON TABLE public.ready_stock_inquiries TO service_role;

DROP POLICY IF EXISTS ready_stock_public_link_staff ON public.ready_stock_public_link;
CREATE POLICY ready_stock_public_link_staff ON public.ready_stock_public_link
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS ready_stock_inquiries_staff ON public.ready_stock_inquiries;
CREATE POLICY ready_stock_inquiries_staff ON public.ready_stock_inquiries
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

DROP POLICY IF EXISTS ready_stock_inquiries_staff_upd ON public.ready_stock_inquiries;
CREATE POLICY ready_stock_inquiries_staff_upd ON public.ready_stock_inquiries
  FOR UPDATE TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

CREATE OR REPLACE FUNCTION public.ensure_ready_stock_public_link()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ready_stock_public_link%ROWTYPE;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.ready_stock_public_link WHERE id = true;
  IF NOT FOUND THEN
    INSERT INTO public.ready_stock_public_link (id, token, active)
    VALUES (true, encode(gen_random_bytes(16), 'hex'), true)
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'token', v_row.token,
    'active', v_row.active
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_ready_stock_public_link()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ready_stock_public_link%ROWTYPE;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ready_stock_public_link (id, token, active)
  VALUES (true, encode(gen_random_bytes(16), 'hex'), true)
  ON CONFLICT (id) DO UPDATE
    SET token = EXCLUDED.token,
        active = true,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('token', v_row.token, 'active', v_row.active);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_ready_stock(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM public.ready_stock_public_link link
     WHERE link.token = p_token
       AND link.active
  ) INTO v_ok;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'items', COALESCE((
      SELECT jsonb_agg(row_to_json(q))
      FROM (
        SELECT
          rs.id,
          rs.reference_id,
          rs.color,
          rs.size,
          rs.quantity,
          rs.notes,
          ts.name AS ref_name,
          ts.code AS ref_code,
          ts.shoe_category,
          ts.sale_price,
          ts.image_url,
          ts.color_images,
          ts.brand
        FROM public.ready_stock rs
        LEFT JOIN public.technical_sheets ts ON ts.id = rs.reference_id
        WHERE rs.quantity > 0
        ORDER BY ts.code, rs.color, rs.size
      ) q
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_public_ready_stock_inquiry(
  p_token text,
  p_customer_name text,
  p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
  v_id uuid;
  v_pairs integer;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM public.ready_stock_public_link link
     WHERE link.token = p_token
       AND link.active
  ) INTO v_ok;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN');
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPTY_CART');
  END IF;

  IF COALESCE(btrim(p_customer_name), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED');
  END IF;

  SELECT COALESCE(SUM(GREATEST((elem ->> 'quantity')::integer, 0)), 0)
    INTO v_pairs
    FROM jsonb_array_elements(p_items) elem;

  IF v_pairs <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPTY_CART');
  END IF;

  INSERT INTO public.ready_stock_inquiries (
    customer_name, customer_phone, customer_email, notes, items, total_pairs
  ) VALUES (
    btrim(p_customer_name),
    NULLIF(btrim(COALESCE(p_customer_phone, '')), ''),
    NULLIF(btrim(COALESCE(p_customer_email, '')), ''),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_items,
    v_pairs
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'total_pairs', v_pairs);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_ready_stock_public_link() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rotate_ready_stock_public_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_ready_stock_public_link() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rotate_ready_stock_public_link() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_public_ready_stock(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_ready_stock(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_public_ready_stock_inquiry(text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_ready_stock_inquiry(text, text, text, text, text, jsonb) TO anon, authenticated, service_role;
