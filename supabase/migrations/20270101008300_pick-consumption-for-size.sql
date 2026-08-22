-- =============================================================================
-- Lookup canônico de consumo por numeração
-- =============================================================================
--
-- A avaliação do motor mostrou três falhas no matching per-size (TS e SQL):
--   1. chave conjugada ("33/34") não casava com a grade numérica ("33"/"34");
--   2. 0 explícito era tratado como ausente (NULLIF(..., 0) / truthiness);
--   3. tamanho presente com 0 caía no escalar da ficha.
--
-- Este helper é a fonte única do lookup. calc_required_for_grade e
-- calculate_order_consumption_by_grade passam a usá-lo. Zero explícito é
-- valor válido; o escalar só entra quando a chave realmente não existe.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pick_consumption_for_size(
  p_per_size jsonb,
  p_size_key text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_raw text;
  v_first text;
  v_parts text[];
  v_part text;
  v_candidate text;
BEGIN
  IF p_per_size IS NULL
     OR jsonb_typeof(p_per_size) <> 'object'
     OR p_size_key IS NULL
     OR btrim(p_size_key) = '' THEN
    RETURN NULL;
  END IF;

  v_key := btrim(p_size_key);
  IF left(v_key, 1) = '_' THEN
    RETURN NULL;
  END IF;

  IF p_per_size ? v_key THEN
    v_raw := p_per_size ->> v_key;
    IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
      RETURN v_raw::numeric;
    END IF;
  END IF;

  v_first := split_part(v_key, '/', 1);
  IF v_first <> v_key AND v_first <> '' AND p_per_size ? v_first THEN
    v_raw := p_per_size ->> v_first;
    IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
      RETURN v_raw::numeric;
    END IF;
  END IF;

  v_parts := string_to_array(v_key, '/');

  FOR v_candidate IN
    SELECT k
      FROM jsonb_object_keys(p_per_size) AS k
     WHERE position('/' IN k) > 0
       AND EXISTS (
         SELECT 1
           FROM unnest(string_to_array(k, '/')) AS part
          WHERE part = ANY (v_parts)
       )
     ORDER BY
       CASE WHEN split_part(k, '/', 1) = ANY (v_parts) THEN 0 ELSE 1 END,
       k
     LIMIT 1
  LOOP
    v_raw := p_per_size ->> v_candidate;
    IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
      RETURN v_raw::numeric;
    END IF;
  END LOOP;

  IF position('/' IN v_key) > 0 THEN
    FOREACH v_part IN ARRAY v_parts
    LOOP
      IF v_part <> '' AND v_part <> v_key AND p_per_size ? v_part THEN
        v_raw := p_per_size ->> v_part;
        IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
          RETURN v_raw::numeric;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.pick_consumption_for_size(jsonb, text) IS
  'Lookup de consumo por numeração: chave exata, forma numérica, conjugada (33↔33/34). Zero explícito é válido; NULL só quando a chave não existe.';

GRANT EXECUTE ON FUNCTION public.pick_consumption_for_size(jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.calc_required_for_grade(
  p_consumption_per_size jsonb,
  p_order_grade          jsonb,
  p_quantity_per_unit    numeric,
  p_total_quantity       numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total      numeric := 0;
  v_size       text;
  v_pairs      numeric;
  v_cons       numeric;
  v_processed  boolean := false;
BEGIN
  IF p_consumption_per_size IS NOT NULL
     AND p_order_grade IS NOT NULL
     AND jsonb_typeof(p_consumption_per_size) = 'object'
     AND jsonb_typeof(p_order_grade) = 'object'
     AND (SELECT COUNT(*) FROM jsonb_object_keys(p_consumption_per_size)) > 0
     AND (SELECT COUNT(*) FROM jsonb_object_keys(p_order_grade)) > 0
  THEN
    FOR v_size, v_pairs IN
      SELECT key, value::text::numeric FROM jsonb_each_text(p_order_grade)
    LOOP
      IF left(v_size, 1) = '_' OR v_pairs IS NULL OR v_pairs <= 0 THEN
        CONTINUE;
      END IF;
      v_processed := true;
      v_cons := COALESCE(
        public.pick_consumption_for_size(p_consumption_per_size, v_size),
        p_quantity_per_unit
      );
      v_total := v_total + (v_pairs * COALESCE(v_cons, 0));
    END LOOP;

    IF v_processed THEN
      RETURN v_total;
    END IF;
  END IF;
  RETURN COALESCE(p_quantity_per_unit, 0) * COALESCE(p_total_quantity, 0);
END;
$$;

COMMENT ON FUNCTION public.calc_required_for_grade(jsonb, jsonb, numeric, numeric) IS
  'Σ pares × consumo por numeração. Casa chaves conjugadas e trata 0 explícito como valor. Escalar só quando a numeração não existe no JSONB.';

-- Patch calculate_order_consumption_by_grade: troca o lookup NULLIF(...,0)
-- pelo helper. regexp_replace cobre o pretty-print do pg_get_functiondef.
DO $patch_bygrade$
DECLARE
  v_def text;
  v_before text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade(uuid,jsonb,text,uuid) não existe';
  END IF;

  IF position('pick_consumption_for_size(v_sheet.upper_consumption_per_size' IN v_def) > 0 THEN
    RAISE NOTICE 'by_grade já usa pick_consumption_for_size na ficha — pulando patch da ficha';
  ELSE
    v_before := v_def;
    v_new := regexp_replace(
      v_def,
      'NULLIF\(\s*COALESCE\(\s*\(v_sheet\.(upper_consumption_per_size|lining_consumption_per_size|insole_consumption_per_size|insole_lining_consumption_per_size)\s*->>\s*\(?v_size::text\)?\)::numeric\s*,\s*0\)\s*,\s*0\)',
      'public.pick_consumption_for_size(v_sheet.\1, v_size::text)',
      'g'
    );
    IF v_new = v_before THEN
      RAISE EXCEPTION 'Âncora de lookup per-size da ficha não encontrada em calculate_order_consumption_by_grade';
    END IF;
    v_def := v_new;
  END IF;

  IF position('pick_consumption_for_size(public.get_sole_consumption_per_size' IN v_def) > 0 THEN
    RAISE NOTICE 'by_grade já usa pick_consumption_for_size no mapa do solado — pulando patch do solado';
  ELSE
    v_before := v_def;
    v_new := regexp_replace(
      v_def,
      'NULLIF\(\s*COALESCE\(\s*\(\s*public\.get_sole_consumption_per_size\(\s*(v_sole_product_id),\s*''(lining_consumption_per_size|insole_consumption_per_size|insole_lining_consumption_per_size|fachete_lining_consumption_per_size)''\s*\)\s*->>\s*v_size::text\)::numeric\s*,\s*0\)\s*,\s*0\)',
      'public.pick_consumption_for_size(public.get_sole_consumption_per_size(\1, ''\2''), v_size::text)',
      'g'
    );
    IF v_new = v_before THEN
      RAISE NOTICE 'Lookup get_sole_consumption_per_size não encontrado (pode ainda não estar no def vivo)';
    ELSE
      v_def := v_new;
    END IF;
  END IF;

  EXECUTE v_def;
END
$patch_bygrade$;

-- Strap debit / disponibilidade: mesmo matching (conjugada + 0 válido).
DO $patch_strap$
DECLARE
  r record;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('debit_strap_stock', 'check_stock_availability')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position('pick_consumption_for_size(v_per_size' IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_new := regexp_replace(
      v_def,
      'COALESCE\(\s*NULLIF\(\s*\(v_per_size\s*->>\s*v_size\)::numeric\s*,\s*0\)\s*,\s*v_consumption\s*\)',
      'COALESCE(public.pick_consumption_for_size(v_per_size, v_size), v_consumption)',
      'g'
    );
    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END
$patch_strap$;

-- Guardas de regressão no parity suite (introspecção + runtime do helper).
DO $patch_parity$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'run_consumption_parity_tests';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'run_consumption_parity_tests não existe — migration fora de ordem';
  END IF;

  IF position('pick_consumption_for_size_conjugada' IN v_def) > 0 THEN
    RAISE NOTICE 'Cases de pick_consumption_for_size já existem — nada a fazer';
    RETURN;
  END IF;

  v_new := replace(v_def,
$old$  case_name := 'bygrade_inclui_fachete';$old$,
$inj$  case_name := 'pick_consumption_for_size_existe';
  ok := to_regprocedure('public.pick_consumption_for_size(jsonb,text)') IS NOT NULL;
  message := 'helper canônico de matching por numeração deve existir'; RETURN NEXT;

  case_name := 'calc_required_usa_pick_consumption_for_size';
  ok := pg_get_functiondef('public.calc_required_for_grade(jsonb,jsonb,numeric,numeric)'::regprocedure)
        ILIKE '%pick_consumption_for_size%';
  message := 'calc_required_for_grade deve delegar o lookup a pick_consumption_for_size'; RETURN NEXT;

  case_name := 'bygrade_usa_pick_consumption_for_size';
  ok := v_bygrade ILIKE '%pick_consumption_for_size%';
  message := 'by_grade deve usar pick_consumption_for_size no lookup per-size'; RETURN NEXT;

  case_name := 'pick_consumption_for_size_conjugada';
  ok := public.pick_consumption_for_size('{"33/34": 8, "36": 9}'::jsonb, '33') = 8
    AND public.pick_consumption_for_size('{"33/34": 8}'::jsonb, '34') = 8
    AND public.pick_consumption_for_size('{"33": 7.5}'::jsonb, '33/34') = 7.5;
  message := '33 casa 33/34 e 33/34 casa 33'; RETURN NEXT;

  case_name := 'pick_consumption_for_size_zero_explicito';
  ok := public.pick_consumption_for_size('{"36": 0, "38": 8}'::jsonb, '36') = 0
    AND public.pick_consumption_for_size('{"36": 0}'::jsonb, '36') IS NOT NULL;
  message := '0 explícito é valor válido (não NULL)'; RETURN NEXT;

  case_name := 'calc_required_conjugada_e_zero';
  ok := public.calc_required_for_grade('{"33/34": 8, "36": 0}'::jsonb, '{"33": 2, "34": 2, "36": 1}'::jsonb, 6.5, 5) = 32;
  message := '2×8 + 2×8 + 1×0 = 32 (sem cair no escalar 6.5)'; RETURN NEXT;

  case_name := 'bygrade_inclui_fachete';$inj$);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'patch parity (case bygrade_inclui_fachete) não casou';
  END IF;

  EXECUTE v_new;
END
$patch_parity$;

DO $selftest$
DECLARE
  v_got numeric;
BEGIN
  v_got := public.pick_consumption_for_size('{"33/34": 8}'::jsonb, '33');
  IF v_got IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'self-test conjugada falhou: esperado 8, obtido %', v_got;
  END IF;
  v_got := public.pick_consumption_for_size('{"36": 0}'::jsonb, '36');
  IF v_got IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'self-test zero explícito falhou: esperado 0, obtido %', v_got;
  END IF;
  IF public.pick_consumption_for_size('{"36": 8}'::jsonb, '33') IS NOT NULL THEN
    RAISE EXCEPTION 'self-test ausente falhou: deveria ser NULL';
  END IF;
  v_got := public.calc_required_for_grade(
    '{"33/34": 8, "36": 0}'::jsonb,
    '{"33": 2, "34": 2, "36": 1}'::jsonb,
    6.5, 5
  );
  IF v_got IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'self-test calc_required falhou: esperado 32, obtido %', v_got;
  END IF;
END
$selftest$;
