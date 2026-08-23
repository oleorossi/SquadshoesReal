-- O PV persiste a semana de faturamento como texto "YYYY-MM-S#" (ex.: 2026-09-S3).
-- jsonb_populate_record / SELECT INTO date / ::date no writer atômico recusam
-- esse token com: invalid input syntax for type date: "2026-09-S3".
-- Sanitiza o header nas RPCs públicas e reafirma o parser da semana como texto.

CREATE OR REPLACE FUNCTION public.parse_billing_week_or_date(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := nullif(btrim(p_value), '');
  v_year integer;
  v_month integer;
  v_week integer;
  v_first date;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN v::date;
  END IF;
  IF v ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
    v_year := split_part(v, '-', 1)::integer;
    v_month := split_part(v, '-', 2)::integer;
    v_week := substring(split_part(v, '-', 3) FROM 2)::integer;
    v_first := make_date(v_year, v_month, 1);
    RETURN greatest(
      v_first,
      v_first - (extract(isodow FROM v_first)::integer - 1) + ((v_week - 1) * 7)
    );
  END IF;
  IF v ~ '^\d{4}-W\d{1,2}$' THEN
    RETURN public.parse_iso_billing_week(v);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.parse_billing_week_or_date(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.parse_billing_week_or_date(text) TO authenticated;

COMMENT ON FUNCTION public.parse_billing_week_or_date(text) IS
  'Converte ISO date, YYYY-MM-S# ou YYYY-Www para date. Token ilegível vira NULL, nunca lança.';

CREATE OR REPLACE FUNCTION public.sanitize_sale_order_header_dates(p_header jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_header jsonb := coalesce(p_header, '{}'::jsonb);
  v_key text;
  v_parsed date;
  v_raw text;
  v_month text := nullif(btrim(v_header ->> 'delivery_month'), '');
  v_week text := nullif(btrim(v_header ->> 'delivery_week'), '');
  v_derived date;
BEGIN
  IF jsonb_typeof(v_header) <> 'object' THEN RETURN v_header; END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'delivery_deadline',
    'original_min_billing_date',
    'nfe_first_due_date'
  ] LOOP
    IF NOT (v_header ? v_key) THEN CONTINUE; END IF;
    v_raw := v_header ->> v_key;
    v_parsed := public.parse_billing_week_or_date(v_raw);
    IF v_parsed IS NOT NULL THEN
      v_header := v_header || jsonb_build_object(v_key, v_parsed);
    ELSIF nullif(btrim(coalesce(v_raw, '')), '') IS NULL THEN
      v_header := v_header || jsonb_build_object(v_key, null);
    ELSE
      -- Token ilegível: remove a chave para jsonb_populate_record não estourar
      -- e, no UPDATE, preservar o valor já gravado.
      v_header := v_header - v_key;
    END IF;
  END LOOP;

  IF (NOT (v_header ? 'delivery_deadline') OR v_header ->> 'delivery_deadline' IS NULL)
     AND v_month IS NOT NULL AND v_week IS NOT NULL THEN
    v_derived := public.parse_billing_week_or_date(v_month || '-' || v_week);
    IF v_derived IS NULL THEN
      v_derived := public.parse_billing_week_or_date(
        v_month || '-' || CASE WHEN v_week ~ '^S' THEN v_week ELSE 'S' || v_week END
      );
    END IF;
    IF v_derived IS NOT NULL THEN
      v_header := v_header || jsonb_build_object('delivery_deadline', v_derived);
    END IF;
  END IF;

  IF v_month IS NOT NULL AND v_week IS NOT NULL THEN
    IF v_week ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
      v_header := v_header || jsonb_build_object('billing_week', upper(v_week));
    ELSE
      v_header := v_header || jsonb_build_object('billing_week', v_month || '-' || v_week);
    END IF;
  END IF;

  RETURN v_header;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_sale_order_header_dates(jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sanitize_sale_order_header_dates(jsonb) TO authenticated;

COMMENT ON FUNCTION public.sanitize_sale_order_header_dates(jsonb) IS
  'Normaliza colunas date do header do PV antes de jsonb_populate_record. YYYY-MM-S# vira a segunda da semana.';

-- Parser da semana de faturamento: lê billing_week como texto (nunca INTO date)
-- para PVs já gravados com "2026-09-S3" não quebrarem o trigger de onda.
CREATE OR REPLACE FUNCTION public.resolve_billing_week_for_order(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing_week_text text;
  v_delivery_month text;
  v_delivery_week text;
  v_delivery date;
  v_lead_days int;
  v_target date;
  v_billing_date date;
BEGIN
  SELECT billing_week::text, delivery_month::text, delivery_week::text, delivery_deadline
    INTO v_billing_week_text, v_delivery_month, v_delivery_week, v_delivery
    FROM public.sale_orders
   WHERE id = p_sale_order_id;

  v_billing_date := public.parse_billing_week_or_date(v_billing_week_text);
  IF v_billing_date IS NULL AND coalesce(v_delivery_month, '') <> ''
     AND coalesce(v_delivery_week, '') <> '' THEN
    v_billing_date := public.parse_billing_week_or_date(v_delivery_month || '-' || v_delivery_week);
    IF v_billing_date IS NULL THEN
      v_billing_date := public.parse_billing_week_or_date(
        v_delivery_month || '-' || CASE WHEN v_delivery_week ~ '^S' THEN v_delivery_week ELSE 'S' || v_delivery_week END
      );
    END IF;
  END IF;

  IF v_billing_date IS NOT NULL THEN
    RETURN v_billing_date - ((EXTRACT(ISODOW FROM v_billing_date)::int - 1));
  END IF;

  IF v_delivery IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(ts.lead_time_corte_dias, 0)
       + COALESCE(ts.lead_time_costura_dias, 0)
       + COALESCE(ts.lead_time_montagem_dias, 0)
       + COALESCE(ts.lead_time_acabamento_dias, 0)
       + COALESCE(ts.lead_time_buffer_material_dias, 0)
    INTO v_lead_days
    FROM public.sale_order_items soi
    JOIN public.technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND (COALESCE(ts.lead_time_corte_dias, 0)
        + COALESCE(ts.lead_time_costura_dias, 0)
        + COALESCE(ts.lead_time_montagem_dias, 0)
        + COALESCE(ts.lead_time_acabamento_dias, 0)
        + COALESCE(ts.lead_time_buffer_material_dias, 0)) > 0
   ORDER BY 1 DESC
   LIMIT 1;

  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    SELECT COALESCE(lead_time_corte_dias, 0)
         + COALESCE(lead_time_costura_dias, 0)
         + COALESCE(lead_time_montagem_dias, 0)
         + COALESCE(lead_time_acabamento_dias, 0)
         + COALESCE(lead_time_buffer_material_dias, 0)
      INTO v_lead_days
      FROM public.default_lead_times
     ORDER BY shoe_category
     LIMIT 1;
  END IF;

  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    v_lead_days := 21;
  END IF;

  v_target := v_delivery - v_lead_days;
  RETURN v_target - ((EXTRACT(ISODOW FROM v_target)::int - 1));
END;
$$;

DO $$
BEGIN
  IF public.parse_billing_week_or_date('2026-09-S1') IS DISTINCT FROM DATE '2026-09-01' THEN
    RAISE EXCEPTION 'Regressao: S1 de setembro/2026 deve ficar em 2026-09-01';
  END IF;
  IF public.parse_billing_week_or_date('2026-09-S3') IS DISTINCT FROM DATE '2026-09-14' THEN
    RAISE EXCEPTION 'Regressao: S3 de setembro/2026 deve virar 2026-09-14';
  END IF;
  IF public.parse_billing_week_or_date('2026-09-14') IS DISTINCT FROM DATE '2026-09-14' THEN
    RAISE EXCEPTION 'Regressao: ISO date deve passar intacta';
  END IF;
  IF (public.sanitize_sale_order_header_dates(
        jsonb_build_object('delivery_deadline', '2026-09-S3',
                           'delivery_month', '2026-09',
                           'delivery_week', 'S3')
      ) ->> 'delivery_deadline') IS DISTINCT FROM '2026-09-14' THEN
    RAISE EXCEPTION 'Regressao: sanitize deve converter delivery_deadline 2026-09-S3';
  END IF;
END;
$$;

-- Writer público: sanitiza o header ANTES de jsonb_populate_record.
DO $$
BEGIN
  IF to_regprocedure('public.create_sale_order_atomic(jsonb,jsonb,uuid)') IS NOT NULL
     AND to_regprocedure('public.create_sale_order_atomic_pre_09100(jsonb,jsonb,uuid)') IS NULL THEN
    ALTER FUNCTION public.create_sale_order_atomic(jsonb,jsonb,uuid)
      RENAME TO create_sale_order_atomic_pre_09100;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_order_atomic_pre_09100(jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_sale_order_atomic(
  p_header jsonb,
  p_items jsonb,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.create_sale_order_atomic_pre_09100(
    public.sanitize_sale_order_header_dates(p_header),
    p_items,
    p_client_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid) IS
  'Cria PV atomicamente depois de converter tokens YYYY-MM-S# das colunas date.';

DO $$
BEGIN
  IF to_regprocedure('public.update_sale_order_with_teardown(uuid,jsonb,jsonb,uuid[])') IS NOT NULL
     AND to_regprocedure('public.update_sale_order_with_teardown_pre_09100(uuid,jsonb,jsonb,uuid[])') IS NULL THEN
    ALTER FUNCTION public.update_sale_order_with_teardown(uuid,jsonb,jsonb,uuid[])
      RENAME TO update_sale_order_with_teardown_pre_09100;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_sale_order_with_teardown_pre_09100(uuid, jsonb, jsonb, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_sale_order_with_teardown(
  p_order_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_teardown_op_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.update_sale_order_with_teardown_pre_09100(
    p_order_id,
    public.sanitize_sale_order_header_dates(p_header),
    p_items,
    p_teardown_op_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[]) IS
  'Edita PV atomicamente depois de converter tokens YYYY-MM-S# das colunas date.';
