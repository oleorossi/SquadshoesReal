-- Lançamento de Corte Cabedal e Costura Cabedal por faixa de faca.
--
-- A faixa vem de technical_sheets.knife_size_ranges
-- ([{"label":"P","sizes":["34","35"]}, ...]). O total de pares continua no
-- command canônico. Esta migration não reescreve o motor, não mexe na fila,
-- não altera status de PV e não grava dado de OP.
--
-- point_by_size_mode: total | size | knife_range.
-- Setores que já lançam por numeração ficam em size. Corte Cabedal e
-- Costura Cabedal nascem em knife_range. Ficha sem faixa continua pelo total.
-- Numeração da grade fora de toda faixa vira uma faixa com o próprio número.
-- A Costura, com o limite do setor anterior ligado, não passa do que o Corte
-- já lançou naquela faixa.

ALTER TABLE public.sector_settings
  ADD COLUMN IF NOT EXISTS point_by_size_mode text NOT NULL DEFAULT 'total';

ALTER TABLE public.sector_settings
  DROP CONSTRAINT IF EXISTS sector_settings_point_by_size_mode_check;

ALTER TABLE public.sector_settings
  ADD CONSTRAINT sector_settings_point_by_size_mode_check
  CHECK (point_by_size_mode IN ('total', 'size', 'knife_range'));

COMMENT ON COLUMN public.sector_settings.point_by_size_mode IS
  'Como o chão lança o setor: total de pares, numeração (size) ou faixa de faca P/M/G (knife_range).';

ALTER TABLE public.sector_settings DISABLE TRIGGER tg_sector_settings_recompute;

UPDATE public.sector_settings
   SET point_by_size_mode = 'size'
 WHERE point_by_size
   AND point_by_size_mode IS DISTINCT FROM 'knife_range';

UPDATE public.sector_settings
   SET point_by_size_mode = 'knife_range',
       point_by_size = false
 WHERE lower(btrim(sector)) IN (
   'corte cabedal', 'corte de cabedal',
   'costura cabedal', 'costura de cabedal'
 );

ALTER TABLE public.sector_settings ENABLE TRIGGER tg_sector_settings_recompute;

CREATE OR REPLACE FUNCTION public.pointing_knife_range_caps(
  p_order_id uuid,
  p_stage_name text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_processed integer;
  v_grade jsonb;
  v_raw jsonb;
  v_bucket jsonb;
  v_label text;
  v_size text;
  v_qty integer;
  v_sum integer;
  v_ranges jsonb := '[]'::jsonb;
  v_sizes jsonb := '{}'::jsonb;
  v_target jsonb := '{}'::jsonb;
  v_known jsonb := '{}'::jsonb;
  v_own jsonb := '{}'::jsonb;
  v_pending jsonb := '{}'::jsonb;
  v_used text[] := ARRAY[]::text[];
  v_known_sum integer := 0;
  v_own_sum integer := 0;
  v_pair_remaining integer;
  v_flow integer;
  v_check boolean := true;
  v_up_sector text;
  v_up_processed integer := 0;
  v_up_known jsonb := '{}'::jsonb;
  v_up_sum integer := 0;
  v_legacy boolean := false;
  v_key text;
  v_room integer;
  v_left integer;
BEGIN
  SELECT os.quantity_total, os.quantity_processed, COALESCE(o.grade, '{}'::jsonb), ts.knife_size_ranges
    INTO v_total, v_processed, v_grade, v_raw
    FROM public.order_stages os
    JOIN public.orders o ON o.id = os.order_id
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
   WHERE os.order_id = p_order_id
     AND public.canonical_stage_name(os.stage_name) = public.canonical_stage_name(p_stage_name)
   ORDER BY (os.stage_name = p_stage_name) DESC, os.stage_order, os.id
   LIMIT 1;

  IF NOT FOUND
     OR v_raw IS NULL
     OR jsonb_typeof(v_raw) <> 'array'
     OR jsonb_array_length(v_raw) = 0 THEN
    RETURN jsonb_build_object(
      'mode', 'total',
      'warning', 'Ficha sem faixas P/M/G cadastradas',
      'pending', '{}'::jsonb,
      'known', '{}'::jsonb,
      'own_pending', '{}'::jsonb,
      'pair_remaining', GREATEST(COALESCE(v_total, 0) - COALESCE(v_processed, 0), 0)
    );
  END IF;

  FOR v_bucket IN
    SELECT value FROM jsonb_array_elements(v_raw)
  LOOP
    v_label := btrim(COALESCE(v_bucket ->> 'label', ''));
    IF v_label = '' OR left(v_label, 1) = '_' THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_bucket -> 'sizes') IS DISTINCT FROM 'array' THEN
      CONTINUE;
    END IF;
    FOR v_size IN
      SELECT jsonb_array_elements_text(v_bucket -> 'sizes')
    LOOP
      v_size := btrim(v_size);
      IF v_size = '' OR v_size = ANY (v_used) OR left(v_size, 1) = '_' THEN
        CONTINUE;
      END IF;
      IF NOT (v_grade ? v_size) OR COALESCE(v_grade ->> v_size, '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
        CONTINUE;
      END IF;
      v_qty := trunc((v_grade ->> v_size)::numeric)::integer;
      IF v_qty <= 0 THEN
        CONTINUE;
      END IF;
      v_used := v_used || v_size;
      v_sizes := jsonb_set(
        v_sizes,
        ARRAY[v_label],
        COALESCE(v_sizes -> v_label, '[]'::jsonb) || jsonb_build_array(v_size),
        true
      );
      v_target := jsonb_set(
        v_target,
        ARRAY[v_label],
        to_jsonb(COALESCE((v_target ->> v_label)::integer, 0) + v_qty),
        true
      );
    END LOOP;
  END LOOP;

  v_ranges := '[]'::jsonb;
  FOR v_label IN
    SELECT key FROM jsonb_each(v_sizes)
  LOOP
    v_ranges := v_ranges || jsonb_build_array(jsonb_build_object(
      'label', v_label,
      'sizes', v_sizes -> v_label,
      'extra', false
    ));
  END LOOP;

  FOR v_size, v_qty IN
    SELECT key, trunc((value)::numeric)::integer
      FROM jsonb_each_text(v_grade)
     WHERE left(key, 1) <> '_'
       AND value ~ '^[0-9]+(\.[0-9]+)?$'
       AND trunc((value)::numeric) > 0
  LOOP
    IF v_size = ANY (v_used) THEN
      CONTINUE;
    END IF;
    v_ranges := v_ranges || jsonb_build_array(jsonb_build_object(
      'label', v_size,
      'sizes', jsonb_build_array(v_size),
      'extra', true
    ));
    v_target := jsonb_set(v_target, ARRAY[v_size], to_jsonb(v_qty), true);
    v_sizes := jsonb_set(v_sizes, ARRAY[v_size], jsonb_build_array(v_size), true);
  END LOOP;

  IF v_target = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'mode', 'total',
      'warning', 'Ficha sem faixas P/M/G cadastradas',
      'pending', '{}'::jsonb,
      'known', '{}'::jsonb,
      'own_pending', '{}'::jsonb,
      'pair_remaining', GREATEST(COALESCE(v_total, 0) - COALESCE(v_processed, 0), 0)
    );
  END IF;

  SELECT COALESCE(jsonb_object_agg(sz, qty), '{}'::jsonb)
    INTO v_known
    FROM (
      SELECT e.key AS sz, SUM(trunc((e.value)::numeric))::integer AS qty
        FROM public.production_pointings p
        CROSS JOIN LATERAL jsonb_each_text(p.size_breakdown) e
       WHERE p.order_id = p_order_id
         AND p.size_breakdown IS NOT NULL
         AND public.canonical_stage_name(p.stage_name) = public.canonical_stage_name(p_stage_name)
         AND left(e.key, 1) <> '_'
         AND e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
       GROUP BY e.key
      HAVING SUM(trunc((e.value)::numeric)) > 0
    ) summed;

  SELECT COALESCE(SUM((value)::integer), 0) INTO v_known_sum FROM jsonb_each_text(v_known);

  FOR v_key, v_qty IN
    SELECT key, trunc((value)::numeric)::integer FROM jsonb_each_text(v_target)
  LOOP
    v_left := v_qty - COALESCE((v_known ->> v_key)::integer, 0);
    IF v_left > 0 THEN
      v_own := jsonb_set(v_own, ARRAY[v_key], to_jsonb(v_left), true);
    END IF;
  END LOOP;

  v_pair_remaining := GREATEST(COALESCE(v_total, 0) - COALESCE(v_processed, 0), 0);
  SELECT COALESCE(SUM((value)::integer), 0) INTO v_own_sum FROM jsonb_each_text(v_own);
  IF v_own_sum > v_pair_remaining THEN
    v_own := public.scale_grade_to_total(v_own, v_pair_remaining);
    SELECT COALESCE(jsonb_object_agg(key, trunc((value)::numeric)::integer), '{}'::jsonb)
      INTO v_own
      FROM jsonb_each_text(COALESCE(v_own, '{}'::jsonb))
     WHERE left(key, 1) <> '_'
       AND value ~ '^[0-9]+(\.[0-9]+)?$'
       AND trunc((value)::numeric) > 0;
  END IF;

  v_pending := v_own;

  SELECT ss.flow_order, COALESCE(ss.check_prev_sector_limit, true)
    INTO v_flow, v_check
    FROM public.sector_settings ss
   WHERE public.canonical_stage_name(ss.sector) = public.canonical_stage_name(p_stage_name)
   ORDER BY (ss.sector = p_stage_name) DESC, ss.flow_order
   LIMIT 1;

  IF COALESCE(v_check, true) THEN
    IF public.canonical_stage_name(p_stage_name) = 'Costura Cabedal' THEN
      SELECT ss.sector
        INTO v_up_sector
        FROM public.sector_settings ss
        JOIN public.order_stages os
          ON public.canonical_stage_name(os.stage_name) = public.canonical_stage_name(ss.sector)
         AND os.order_id = p_order_id
       WHERE public.canonical_stage_name(ss.sector) = 'Corte Cabedal'
       LIMIT 1;
    ELSE
      SELECT ss.sector
        INTO v_up_sector
        FROM public.sector_settings ss
        JOIN public.order_stages os
          ON public.canonical_stage_name(os.stage_name) = public.canonical_stage_name(ss.sector)
         AND os.order_id = p_order_id
       WHERE ss.point_by_size_mode = 'knife_range'
         AND ss.flow_order < COALESCE(v_flow, 0)
         AND public.canonical_stage_name(ss.sector) IS DISTINCT FROM public.canonical_stage_name(p_stage_name)
       ORDER BY ss.flow_order DESC
       LIMIT 1;
    END IF;

    IF v_up_sector IS NOT NULL THEN
      SELECT COALESCE(os.quantity_processed, 0)
        INTO v_up_processed
        FROM public.order_stages os
       WHERE os.order_id = p_order_id
         AND public.canonical_stage_name(os.stage_name) = public.canonical_stage_name(v_up_sector)
       LIMIT 1;

      SELECT COALESCE(jsonb_object_agg(sz, qty), '{}'::jsonb)
        INTO v_up_known
        FROM (
          SELECT e.key AS sz, SUM(trunc((e.value)::numeric))::integer AS qty
            FROM public.production_pointings p
            CROSS JOIN LATERAL jsonb_each_text(p.size_breakdown) e
           WHERE p.order_id = p_order_id
             AND p.size_breakdown IS NOT NULL
             AND public.canonical_stage_name(p.stage_name) = public.canonical_stage_name(v_up_sector)
             AND left(e.key, 1) <> '_'
             AND e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
           GROUP BY e.key
          HAVING SUM(trunc((e.value)::numeric)) > 0
        ) summed;

      SELECT COALESCE(SUM((value)::integer), 0) INTO v_up_sum FROM jsonb_each_text(v_up_known);

      IF v_up_processed > 0 AND v_up_sum = 0 THEN
        v_legacy := true;
        v_up_sector := NULL;
      ELSE
        v_pending := '{}'::jsonb;
        FOR v_key, v_qty IN
          SELECT key, trunc((value)::numeric)::integer FROM jsonb_each_text(v_own)
        LOOP
          v_room := GREATEST(
            COALESCE((v_up_known ->> v_key)::integer, 0) - COALESCE((v_known ->> v_key)::integer, 0),
            0
          );
          v_left := LEAST(v_qty, v_room);
          IF v_left > 0 THEN
            v_pending := jsonb_set(v_pending, ARRAY[v_key], to_jsonb(v_left), true);
          END IF;
        END LOOP;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'mode', 'knife_range',
    'warning', NULL,
    'ranges', v_ranges,
    'faixas', v_sizes,
    'target', v_target,
    'known', COALESCE(v_known, '{}'::jsonb),
    'own_pending', COALESCE(v_own, '{}'::jsonb),
    'pending', COALESCE(v_pending, '{}'::jsonb),
    'pair_remaining', v_pair_remaining,
    'legacy_unallocated', GREATEST(COALESCE(v_processed, 0) - v_known_sum, 0),
    'upstream_sector', v_up_sector,
    'upstream_known', CASE WHEN v_up_sector IS NULL THEN NULL ELSE v_up_known END,
    'upstream_legacy', v_legacy
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pointing_knife_range_caps(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pointing_knife_range_caps(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.execute_production_pointing_by_size(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid,
  p_note text,
  p_finalize boolean,
  p_confirmed_warnings text[],
  p_expected_stage_updated_at timestamptz,
  p_client_request_id uuid,
  p_skip_stage_names text[] DEFAULT NULL,
  p_size_breakdown jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mode text := 'total';
  v_caps jsonb;
  v_pending jsonb;
  v_own jsonb;
  v_known jsonb;
  v_pair_remaining integer;
  v_clean jsonb := '{}'::jsonb;
  v_sum integer := 0;
  v_key text;
  v_value numeric;
  v_cap integer;
  v_own_cap integer;
  v_receipt jsonb;
  v_result jsonb;
  v_upstream text;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id é obrigatório' USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));

  SELECT r.response
    INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;

  IF FOUND THEN
    RETURN public.execute_production_pointing_command(
      p_order_id, p_stage_name, p_quantity, p_operator_employee_id, p_note,
      p_finalize, p_confirmed_warnings, p_expected_stage_updated_at,
      p_client_request_id, p_skip_stage_names
    );
  END IF;

  SELECT CASE
           WHEN COALESCE(bool_or(s.point_by_size_mode = 'knife_range'), false) THEN 'knife_range'
           WHEN COALESCE(bool_or(s.point_by_size), false)
             OR COALESCE(bool_or(s.point_by_size_mode = 'size'), false) THEN 'size'
           ELSE 'total'
         END
    INTO v_mode
    FROM public.sector_settings s
   WHERE public.canonical_stage_name(s.sector) = public.canonical_stage_name(p_stage_name);

  IF COALESCE(v_mode, 'total') = 'knife_range' AND COALESCE(p_quantity, 0) <> 0 THEN
    v_caps := public.pointing_knife_range_caps(p_order_id, p_stage_name);
    IF COALESCE(v_caps ->> 'mode', 'total') = 'total' THEN
      v_mode := 'total';
    END IF;
  END IF;

  IF COALESCE(v_mode, 'total') = 'total' OR COALESCE(p_quantity, 0) = 0 THEN
    RETURN public.execute_production_pointing_command(
      p_order_id, p_stage_name, p_quantity, p_operator_employee_id, p_note,
      p_finalize, p_confirmed_warnings, p_expected_stage_updated_at,
      p_client_request_id, p_skip_stage_names
    );
  END IF;

  IF v_mode = 'size' AND (p_size_breakdown IS NULL OR jsonb_typeof(p_size_breakdown) <> 'object') THEN
    RAISE EXCEPTION 'Lançamento por numeração exige a grade deste apontamento.'
      USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'knife_range' AND (p_size_breakdown IS NULL OR jsonb_typeof(p_size_breakdown) <> 'object') THEN
    RAISE EXCEPTION 'Lançamento por faixa exige as faixas deste apontamento.'
      USING ERRCODE = '22023';
  END IF;

  IF v_mode = 'knife_range' AND v_caps IS NULL THEN
    v_caps := public.pointing_knife_range_caps(p_order_id, p_stage_name);
  ELSIF v_mode = 'size' THEN
    v_caps := public.pointing_size_caps(p_order_id, p_stage_name);
  END IF;

  FOR v_key, v_value IN
    SELECT key, (value)::numeric
      FROM jsonb_each_text(p_size_breakdown)
  LOOP
    IF left(v_key, 1) = '_' OR btrim(v_key) = '' THEN
      CONTINUE;
    END IF;
    IF v_value <> trunc(v_value) THEN
      IF v_mode = 'knife_range' THEN
        RAISE EXCEPTION 'A faixa % precisa ser um número inteiro de pares.', v_key
          USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'A numeração % precisa ser um número inteiro de pares.', v_key
        USING ERRCODE = '22023';
    END IF;
    IF trunc(v_value) = 0 THEN
      CONTINUE;
    END IF;
    IF (COALESCE(p_quantity, 0) > 0 AND trunc(v_value) < 0)
       OR (COALESCE(p_quantity, 0) < 0 AND trunc(v_value) > 0) THEN
      IF v_mode = 'knife_range' THEN
        RAISE EXCEPTION 'A faixa % está com sinal diferente do lançamento.', v_key
          USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'A numeração % está com sinal diferente do lançamento.', v_key
        USING ERRCODE = '22023';
    END IF;
    v_clean := jsonb_set(v_clean, ARRAY[v_key], to_jsonb(trunc(v_value)::integer));
    v_sum := v_sum + trunc(v_value)::integer;
  END LOOP;

  IF v_sum IS DISTINCT FROM p_quantity THEN
    IF v_mode = 'knife_range' THEN
      RAISE EXCEPTION 'A soma das faixas (%) não fecha os % pares do lançamento.', v_sum, p_quantity
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'A soma das numerações (%) não fecha os % pares do lançamento.', v_sum, p_quantity
      USING ERRCODE = '22023';
  END IF;

  v_pending := COALESCE(v_caps -> 'pending', '{}'::jsonb);
  v_own := COALESCE(v_caps -> 'own_pending', v_pending);
  v_known := COALESCE(v_caps -> 'known', '{}'::jsonb);
  v_pair_remaining := COALESCE((v_caps ->> 'pair_remaining')::integer, 0);
  v_upstream := NULLIF(v_caps ->> 'upstream_sector', '');

  IF p_quantity > 0 THEN
    IF v_sum > v_pair_remaining THEN
      RAISE EXCEPTION 'Este lançamento (% pares) passa o saldo do setor (%).', v_sum, v_pair_remaining
        USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_value IN
      SELECT key, (value)::integer FROM jsonb_each_text(v_clean)
    LOOP
      v_own_cap := COALESCE((v_own ->> v_key)::integer, 0);
      v_cap := COALESCE((v_pending ->> v_key)::integer, 0);
      IF v_mode = 'knife_range' AND v_value > v_own_cap THEN
        RAISE EXCEPTION 'Faixa %: % passa o saldo de % pares.', v_key, v_value, v_own_cap
          USING ERRCODE = '22023';
      END IF;
      IF v_mode = 'knife_range' AND v_upstream IS NOT NULL AND v_value > v_cap THEN
        RAISE EXCEPTION 'Faixa %: % passa o que % já lançou (% pares; ainda libera %).',
          v_key, v_value, v_upstream,
          COALESCE((v_caps -> 'upstream_known' ->> v_key)::integer, 0), v_cap
          USING ERRCODE = '22023';
      END IF;
      IF v_mode = 'size' AND v_value > v_cap THEN
        RAISE EXCEPTION 'Numeração % : % passa o saldo de % pares.', v_key, v_value, v_cap
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  ELSE
    FOR v_key, v_value IN
      SELECT key, (value)::integer FROM jsonb_each_text(v_clean)
    LOOP
      v_cap := COALESCE((v_known ->> v_key)::integer, 0);
      IF abs(v_value) > v_cap THEN
        IF v_mode = 'knife_range' THEN
          RAISE EXCEPTION 'Faixa %: não há % pares lançados para estornar (há %).', v_key, abs(v_value), v_cap
            USING ERRCODE = '22023';
        END IF;
        RAISE EXCEPTION 'Numeração % : não há % pares lançados para estornar (há %).', v_key, abs(v_value), v_cap
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  IF v_mode = 'knife_range' AND v_caps ? 'faixas' THEN
    v_clean := jsonb_set(v_clean, ARRAY['_faixas'], COALESCE(v_caps -> 'faixas', '{}'::jsonb), true);
  END IF;

  PERFORM pg_catalog.set_config(
    'app.pointing_size_breakdown',
    jsonb_build_object(
      'stage', public.canonical_stage_name(p_stage_name),
      'sizes', v_clean
    )::text,
    true
  );

  BEGIN
    v_result := public.execute_production_pointing_command(
      p_order_id, p_stage_name, p_quantity, p_operator_employee_id, p_note,
      p_finalize, p_confirmed_warnings, p_expected_stage_updated_at,
      p_client_request_id, p_skip_stage_names
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('app.pointing_size_breakdown', '', true);
    RAISE;
  END;

  PERFORM pg_catalog.set_config('app.pointing_size_breakdown', '', true);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_production_pointing_by_size(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid, text[], jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.execute_production_pointing_by_size(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid, text[], jsonb
) TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_production_pointing_by_size(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid, text[], jsonb
) IS
  'Apontamento por numeração ou por faixa de faca. A soma entra no command canônico; o detalhe grava em production_pointings.size_breakdown.';
