-- Lançamento de produção por numeração.
--
-- O apontamento canônico (execute_production_pointing_command /
-- apontar_producao_setor_impl) continua dono do TOTAL de pares: relatório,
-- pagamento por produção e progresso leem quantity / quantity_processed.
-- Esta migration só acrescenta o detalhe por número e um flag no cadastro
-- do setor. Não reescreve o motor, não mexe na fila, não altera
-- status de PV e não grava dado de OP.
--
-- Suposição: "Costura de Palmilha" e "Acabamento de Palmilha" são o mesmo
-- setor no cadastro (rename de exibição, chave costura_palmilha). O flag
-- nasce ligado em Palmilha · Fibra, Palmilha · Forração e Acabamento
-- Palmilha, inclusive nas grafias antigas (Corte Fibra, Corte Forração,
-- Costura Palmilha). Os demais setores seguem pelo total. O dono liga ou
-- desliga em Produção → Setores.
--
-- Lançamento antigo não tem grade. O saldo por número desconta só o que foi
-- gravado com numeração; o miolo sem número reduz a grade restante até a
-- soma fechar os pares que ainda faltam (scale_grade_to_total).

ALTER TABLE public.sector_settings
  ADD COLUMN IF NOT EXISTS point_by_size boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sector_settings.point_by_size IS
  'Lançamento do chão pede a quantidade por numeração. O total de pares continua sendo a soma.';

ALTER TABLE public.sector_settings DISABLE TRIGGER tg_sector_settings_recompute;

UPDATE public.sector_settings
   SET point_by_size = true
 WHERE lower(btrim(sector)) IN (
   'palmilha · fibra', 'palmilha fibra', 'corte fibra', 'corte palmilha', 'corte de fibra',
   'palmilha · forração', 'palmilha · forracao', 'palmilha forração', 'palmilha forracao',
   'corte forração', 'corte forracao', 'corte de forração', 'corte de forracao',
   'forração', 'forracao',
   'acabamento palmilha', 'acabamento de palmilha',
   'costura palmilha', 'costura de palmilha', 'costura'
 );

ALTER TABLE public.sector_settings ENABLE TRIGGER tg_sector_settings_recompute;

ALTER TABLE public.production_pointings
  ADD COLUMN IF NOT EXISTS size_breakdown jsonb;

COMMENT ON COLUMN public.production_pointings.size_breakdown IS
  'Pares deste lançamento por numeração. Soma = quantity. NULL = lançamento só pelo total.';

CREATE OR REPLACE FUNCTION public.size_breakdown_sum(p_breakdown jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(trunc((value)::numeric)), 0)::integer
    FROM jsonb_each_text(COALESCE(p_breakdown, '{}'::jsonb))
   WHERE value ~ '^-?[0-9]+(\.[0-9]+)?$';
$$;

ALTER TABLE public.production_pointings
  DROP CONSTRAINT IF EXISTS production_pointings_size_breakdown_sum;

ALTER TABLE public.production_pointings
  ADD CONSTRAINT production_pointings_size_breakdown_sum
  CHECK (
    size_breakdown IS NULL
    OR (
      jsonb_typeof(size_breakdown) = 'object'
      AND public.size_breakdown_sum(size_breakdown) = quantity
    )
  );

-- Teto por número para o saldo cheio do setor (sem o corte do fluxo parcial;
-- a janela aperta isso antes de enviar).
CREATE OR REPLACE FUNCTION public.pointing_size_caps(
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
  v_target jsonb;
  v_known jsonb := '{}'::jsonb;
  v_raw jsonb := '{}'::jsonb;
  v_known_sum integer := 0;
  v_raw_sum integer := 0;
  v_pair_remaining integer;
  v_k text;
  v_v integer;
BEGIN
  SELECT os.quantity_total, os.quantity_processed, o.grade
    INTO v_total, v_processed, v_grade
    FROM public.order_stages os
    JOIN public.orders o ON o.id = os.order_id
   WHERE os.order_id = p_order_id
     AND public.canonical_stage_name(os.stage_name) = public.canonical_stage_name(p_stage_name)
   ORDER BY (os.stage_name = p_stage_name) DESC, os.stage_order, os.id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'pending', '{}'::jsonb,
      'known', '{}'::jsonb,
      'pair_remaining', 0
    );
  END IF;

  v_target := public.scale_grade_to_total(COALESCE(v_grade, '{}'::jsonb), GREATEST(v_total, 0));
  SELECT COALESCE(jsonb_object_agg(key, trunc((value)::numeric)::integer), '{}'::jsonb)
    INTO v_target
    FROM jsonb_each_text(COALESCE(v_target, '{}'::jsonb))
   WHERE left(key, 1) <> '_'
     AND value ~ '^-?[0-9]+(\.[0-9]+)?$'
     AND trunc((value)::numeric) > 0;

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

  SELECT COALESCE(SUM((value)::integer), 0)
    INTO v_known_sum
    FROM jsonb_each_text(v_known);

  FOR v_k, v_v IN
    SELECT key, trunc((value)::numeric)::integer
      FROM jsonb_each_text(v_target)
  LOOP
    IF v_v - COALESCE((v_known ->> v_k)::integer, 0) > 0 THEN
      v_raw := jsonb_set(
        v_raw,
        ARRAY[v_k],
        to_jsonb(v_v - COALESCE((v_known ->> v_k)::integer, 0))
      );
    END IF;
  END LOOP;

  v_pair_remaining := GREATEST(COALESCE(v_total, 0) - COALESCE(v_processed, 0), 0);
  SELECT COALESCE(SUM((value)::integer), 0) INTO v_raw_sum FROM jsonb_each_text(v_raw);

  IF v_raw_sum > v_pair_remaining THEN
    v_raw := public.scale_grade_to_total(v_raw, v_pair_remaining);
    SELECT COALESCE(jsonb_object_agg(key, trunc((value)::numeric)::integer), '{}'::jsonb)
      INTO v_raw
      FROM jsonb_each_text(COALESCE(v_raw, '{}'::jsonb))
     WHERE left(key, 1) <> '_'
       AND value ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND trunc((value)::numeric) > 0;
  END IF;

  RETURN jsonb_build_object(
    'pending', COALESCE(v_raw, '{}'::jsonb),
    'known', COALESCE(v_known, '{}'::jsonb),
    'pair_remaining', v_pair_remaining,
    'legacy_unallocated', GREATEST(COALESCE(v_processed, 0) - v_known_sum, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pointing_size_caps(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pointing_size_caps(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_capture_pointing_size_breakdown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
  v_payload jsonb;
  v_sizes jsonb;
  v_sum integer;
BEGIN
  v_raw := current_setting('app.pointing_size_breakdown', true);
  IF v_raw IS NULL OR btrim(v_raw) = '' THEN
    RETURN NEW;
  END IF;

  v_payload := v_raw::jsonb;
  IF public.canonical_stage_name(COALESCE(v_payload ->> 'stage', ''))
     IS DISTINCT FROM public.canonical_stage_name(NEW.stage_name) THEN
    RETURN NEW;
  END IF;

  v_sizes := COALESCE(v_payload -> 'sizes', '{}'::jsonb);
  v_sum := public.size_breakdown_sum(v_sizes);
  IF v_sum IS DISTINCT FROM NEW.quantity THEN
    RETURN NEW;
  END IF;

  NEW.size_breakdown := v_sizes;
  PERFORM set_config('app.pointing_size_breakdown', '', true);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_capture_pointing_size_breakdown() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_aa_capture_pointing_size_breakdown ON public.production_pointings;
CREATE TRIGGER trg_aa_capture_pointing_size_breakdown
  BEFORE INSERT ON public.production_pointings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_capture_pointing_size_breakdown();

-- Envolve o command canônico. Não recria o motor: valida a grade, publica o
-- detalhe num GUC da transação e deixa o INSERT existente gravar o total.
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
  v_by_size boolean := false;
  v_caps jsonb;
  v_pending jsonb;
  v_known jsonb;
  v_pair_remaining integer;
  v_clean jsonb := '{}'::jsonb;
  v_sum integer := 0;
  v_key text;
  v_value numeric;
  v_cap integer;
  v_receipt jsonb;
  v_result jsonb;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id é obrigatório' USING ERRCODE = '22004';
  END IF;

  -- Mesmo cadeado do command, tomado primeiro. Retry com o mesmo id devolve
  -- o recibo sem revalidar a grade (o saldo já mudou na primeira gravação).
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

  SELECT COALESCE(bool_or(s.point_by_size), false)
    INTO v_by_size
    FROM public.sector_settings s
   WHERE public.canonical_stage_name(s.sector) = public.canonical_stage_name(p_stage_name);

  IF NOT v_by_size OR COALESCE(p_quantity, 0) = 0 THEN
    RETURN public.execute_production_pointing_command(
      p_order_id, p_stage_name, p_quantity, p_operator_employee_id, p_note,
      p_finalize, p_confirmed_warnings, p_expected_stage_updated_at,
      p_client_request_id, p_skip_stage_names
    );
  END IF;

  IF p_size_breakdown IS NULL OR jsonb_typeof(p_size_breakdown) <> 'object' THEN
    RAISE EXCEPTION 'Lançamento por numeração exige a grade deste apontamento.'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN
    SELECT key, (value)::numeric
      FROM jsonb_each_text(p_size_breakdown)
  LOOP
    IF left(v_key, 1) = '_' OR btrim(v_key) = '' THEN
      RAISE EXCEPTION 'Numeração inválida: %.', v_key USING ERRCODE = '22023';
    END IF;
    IF v_value <> trunc(v_value) THEN
      RAISE EXCEPTION 'A numeração % precisa ser um número inteiro de pares.', v_key
        USING ERRCODE = '22023';
    END IF;
    IF trunc(v_value) = 0 THEN
      CONTINUE;
    END IF;
    IF (COALESCE(p_quantity, 0) > 0 AND trunc(v_value) < 0)
       OR (COALESCE(p_quantity, 0) < 0 AND trunc(v_value) > 0) THEN
      RAISE EXCEPTION 'A numeração % está com sinal diferente do lançamento.', v_key
        USING ERRCODE = '22023';
    END IF;
    v_clean := jsonb_set(v_clean, ARRAY[v_key], to_jsonb(trunc(v_value)::integer));
    v_sum := v_sum + trunc(v_value)::integer;
  END LOOP;

  IF v_sum IS DISTINCT FROM p_quantity THEN
    RAISE EXCEPTION 'A soma das numerações (%) não fecha os % pares do lançamento.', v_sum, p_quantity
      USING ERRCODE = '22023';
  END IF;

  v_caps := public.pointing_size_caps(p_order_id, p_stage_name);
  v_pending := COALESCE(v_caps -> 'pending', '{}'::jsonb);
  v_known := COALESCE(v_caps -> 'known', '{}'::jsonb);
  v_pair_remaining := COALESCE((v_caps ->> 'pair_remaining')::integer, 0);

  IF p_quantity > 0 THEN
    IF v_sum > v_pair_remaining THEN
      RAISE EXCEPTION 'Este lançamento (% pares) passa o saldo do setor (%).', v_sum, v_pair_remaining
        USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_value IN
      SELECT key, (value)::integer FROM jsonb_each_text(v_clean)
    LOOP
      v_cap := COALESCE((v_pending ->> v_key)::integer, 0);
      IF v_value > v_cap THEN
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
        RAISE EXCEPTION 'Numeração % : não há % pares lançados para estornar (há %).', v_key, abs(v_value), v_cap
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
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
  'Apontamento por numeração. A soma entra no command canônico; a grade grava em production_pointings.size_breakdown.';
