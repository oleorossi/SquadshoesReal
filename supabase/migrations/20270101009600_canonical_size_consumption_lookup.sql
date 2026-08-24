-- Lookup único de consumo por numeração.
--
-- Corrige três divergências dos motores SQL:
--   1. "33" não encontrava uma chave conjugada "33/34";
--   2. uma grade "33/34" não encontrava a chave individual "33";
--   3. zero explícito era convertido em ausência e caía no consumo escalar.
--
-- O arquivo legado 20270101008300 não pode ser reaplicado: desde então o
-- motor de tiras mudou e as assinaturas curtas ficaram obsoletas. Esta
-- migration preserva os corpos vivos e troca somente âncoras verificadas.

BEGIN;

DO $preflight$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
    'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)',
    'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)',
    'public.calc_required_for_grade(jsonb,jsonb,numeric,numeric)',
    'public._calc_required_per_size(jsonb,numeric,jsonb,numeric)',
    'public.order_strap_needs(jsonb,numeric,jsonb)',
    'public.calculate_strap_line_required_m(jsonb,numeric,jsonb)',
    'public.sole_papel_value_for_size(uuid,text,integer)',
    'public.tg_mirror_sole_papel_to_specs()',
    'public.list_missing_sole_consumption_sizes(uuid)',
    'public.preview_sale_order_strap_demand_draft_pre_05500(jsonb)',
    'public.run_consumption_parity_tests()'
  ]
  LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Preflight: função canônica ausente: %', v_signature;
    END IF;
  END LOOP;
END
$preflight$;

-- Overloads antigos desviavam chamadas com argumentos opcionais para motores
-- desatualizados e ainda herdavam EXECUTE de PUBLIC. Sem CASCADE: qualquer
-- dependência inesperada deve abortar toda a migration.
DROP FUNCTION IF EXISTS
  public.calculate_order_consumption_by_grade(uuid,jsonb,text);
DROP FUNCTION IF EXISTS
  public.calculate_order_consumption(uuid,numeric,text,integer);
DROP FUNCTION IF EXISTS
  public.check_stock_availability(uuid,integer,text,jsonb);

CREATE OR REPLACE FUNCTION public.pick_consumption_for_size(
  p_per_size jsonb,
  p_size_key text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- 1. Chave exata sempre vence.
  IF p_per_size ? v_key THEN
    v_raw := p_per_size ->> v_key;
    IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
      RETURN v_raw::numeric;
    END IF;
  END IF;

  -- 2. Grade conjugada pode usar a primeira chave individual do mapa.
  v_first := btrim(split_part(v_key, '/', 1));
  IF v_first <> v_key AND v_first <> '' AND p_per_size ? v_first THEN
    v_raw := p_per_size ->> v_first;
    IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
      RETURN v_raw::numeric;
    END IF;
  END IF;

  SELECT coalesce(array_agg(btrim(part)), ARRAY[]::text[])
    INTO v_parts
    FROM unnest(string_to_array(v_key, '/')) part
   WHERE btrim(part) <> '';

  -- 3. Tamanho individual encontra a chave conjugada que o contém.
  FOR v_candidate IN
    SELECT map_key
      FROM jsonb_object_keys(p_per_size) map_key
     WHERE position('/' IN map_key) > 0
       AND EXISTS (
         SELECT 1
           FROM unnest(string_to_array(map_key, '/')) map_part
          WHERE btrim(map_part) = ANY(v_parts)
       )
     ORDER BY
       CASE
         WHEN btrim(split_part(map_key, '/', 1)) = ANY(v_parts) THEN 0
         ELSE 1
       END,
       map_key
  LOOP
    v_raw := p_per_size ->> v_candidate;
    IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
      RETURN v_raw::numeric;
    END IF;
  END LOOP;

  -- 4. Como último fallback, grade conjugada tenta cada parte individual.
  IF position('/' IN v_key) > 0 THEN
    FOREACH v_part IN ARRAY v_parts
    LOOP
      IF v_part <> v_key AND p_per_size ? v_part THEN
        v_raw := p_per_size ->> v_part;
        IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
          RETURN v_raw::numeric;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.pick_consumption_for_size(jsonb,text) IS
  'Chave exata, forma individual e conjugada. Zero explícito é valor; NULL significa chave ausente.';

REVOKE ALL ON FUNCTION public.pick_consumption_for_size(jsonb,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pick_consumption_for_size(jsonb,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calc_required_for_grade(
  p_consumption_per_size jsonb,
  p_order_grade jsonb,
  p_quantity_per_unit numeric,
  p_total_quantity numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total numeric := 0;
  v_size text;
  v_pairs numeric;
  v_consumption numeric;
  v_processed boolean := false;
BEGIN
  IF p_consumption_per_size IS NOT NULL
     AND p_order_grade IS NOT NULL
     AND jsonb_typeof(p_consumption_per_size) = 'object'
     AND jsonb_typeof(p_order_grade) = 'object'
     AND p_consumption_per_size <> '{}'::jsonb
     AND p_order_grade <> '{}'::jsonb THEN
    FOR v_size, v_pairs IN
      SELECT key, value::text::numeric
        FROM jsonb_each(p_order_grade)
    LOOP
      IF left(v_size, 1) = '_'
         OR v_pairs IS NULL
         OR v_pairs <= 0 THEN
        CONTINUE;
      END IF;

      v_processed := true;
      v_consumption := coalesce(
        public.pick_consumption_for_size(p_consumption_per_size, v_size),
        p_quantity_per_unit,
        0
      );
      v_total := v_total + (v_pairs * v_consumption);
    END LOOP;

    IF v_processed THEN
      RETURN v_total;
    END IF;
  END IF;

  RETURN coalesce(p_quantity_per_unit, 0) * coalesce(p_total_quantity, 0);
END;
$function$;

COMMENT ON FUNCTION public.calc_required_for_grade(jsonb,jsonb,numeric,numeric) IS
  'Soma pares × consumo por numeração; zero explícito não cai no escalar.';

REVOKE ALL ON FUNCTION
  public.calc_required_for_grade(jsonb,jsonb,numeric,numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.calc_required_for_grade(jsonb,jsonb,numeric,numeric)
  TO authenticated, service_role;

-- Mantém o helper legado coerente enquanto ele existir, inclusive no caso em
-- que todas as numerações têm consumo explícito zero.
CREATE OR REPLACE FUNCTION public._calc_required_per_size(
  p_consumption_per_size jsonb,
  p_fallback_consumption numeric,
  p_order_grade jsonb,
  p_order_quantity numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total numeric := 0;
  v_size text;
  v_pairs numeric;
  v_per_pair numeric;
  v_grade_total numeric := 0;
  v_fichas numeric := 1;
  v_processed boolean := false;
BEGIN
  IF p_consumption_per_size IS NULL
     OR jsonb_typeof(p_consumption_per_size) <> 'object'
     OR p_consumption_per_size = '{}'::jsonb
     OR p_order_grade IS NULL
     OR jsonb_typeof(p_order_grade) <> 'object'
     OR p_order_grade = '{}'::jsonb THEN
    RETURN coalesce(p_fallback_consumption, 0)
      * coalesce(p_order_quantity, 0);
  END IF;

  SELECT coalesce(sum(value::text::numeric), 0)
    INTO v_grade_total
    FROM jsonb_each(p_order_grade)
   WHERE left(key, 1) <> '_'
     AND value::text::numeric > 0;

  IF v_grade_total > 0 AND coalesce(p_order_quantity, 0) > 0 THEN
    v_fichas := p_order_quantity / v_grade_total;
  END IF;

  FOR v_size, v_pairs IN
    SELECT key, value::text::numeric
      FROM jsonb_each(p_order_grade)
  LOOP
    IF left(v_size, 1) = '_'
       OR v_pairs IS NULL
       OR v_pairs <= 0 THEN
      CONTINUE;
    END IF;

    v_processed := true;
    v_per_pair := coalesce(
      public.pick_consumption_for_size(p_consumption_per_size, v_size),
      p_fallback_consumption,
      0
    );
    v_total := v_total + (v_pairs * v_fichas * v_per_pair);
  END LOOP;

  IF v_processed THEN
    RETURN v_total;
  END IF;

  RETURN coalesce(p_fallback_consumption, 0)
    * coalesce(p_order_quantity, 0);
END;
$function$;

REVOKE ALL ON FUNCTION
  public._calc_required_per_size(jsonb,numeric,jsonb,numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public._calc_required_per_size(jsonb,numeric,jsonb,numeric)
  TO authenticated, service_role;

-- Troca expressões exatas nos corpos vivos. Cada âncora tem contagem esperada;
-- qualquer drift aborta antes de publicar uma função parcialmente corrigida.
DO $patch_live_functions$
DECLARE
  v_patch record;
  v_function regprocedure;
  v_definition text;
  v_patched text;
  v_occurrences integer;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0)$old$,
        $new$public.pick_consumption_for_size(v_sheet.upper_consumption_per_size, v_size::text)$new$,
        1
      ),
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0)$old$,
        $new$public.pick_consumption_for_size(v_sheet.lining_consumption_per_size, v_size::text)$new$,
        1
      ),
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0)$old$,
        $new$public.pick_consumption_for_size(v_sheet.insole_consumption_per_size, v_size::text)$new$,
        1
      ),
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$NULLIF(COALESCE((v_sheet.insole_lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0)$old$,
        $new$public.pick_consumption_for_size(v_sheet.insole_lining_consumption_per_size, v_size::text)$new$,
        1
      ),
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$NULLIF(COALESCE((public.get_sole_consumption_per_size(
          v_sole_product_id, 'lining_consumption_per_size'
        ) ->> v_size::text)::numeric, 0), 0)$old$,
        $new$public.pick_consumption_for_size(public.get_sole_consumption_per_size(
          v_sole_product_id, 'lining_consumption_per_size'
        ), v_size::text)$new$,
        1
      ),
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$NULLIF(COALESCE((public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_consumption_per_size'
        ) ->> v_size::text)::numeric, 0), 0)$old$,
        $new$public.pick_consumption_for_size(public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_consumption_per_size'
        ), v_size::text)$new$,
        1
      ),
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$NULLIF(COALESCE((public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_lining_consumption_per_size'
        ) ->> v_size::text)::numeric, 0), 0)$old$,
        $new$public.pick_consumption_for_size(public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_lining_consumption_per_size'
        ), v_size::text)$new$,
        1
      ),
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$NULLIF(COALESCE((public.get_sole_consumption_per_size(
          v_sole_product_id, 'fachete_lining_consumption_per_size'
        ) ->> v_size::text)::numeric, 0), 0)$old$,
        $new$public.pick_consumption_for_size(public.get_sole_consumption_per_size(
          v_sole_product_id, 'fachete_lining_consumption_per_size'
        ), v_size::text)$new$,
        1
      ),
      (
        'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
        $old$COALESCE(NULLIF((sgsi.consumption_per_size ->> v_size::text)::numeric, 0), sgsi.consumption_per_pair)$old$,
        $new$COALESCE(public.pick_consumption_for_size(sgsi.consumption_per_size, v_size::text), sgsi.consumption_per_pair)$new$,
        2
      ),
      (
        'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)',
        $old$COALESCE((v_per_size ->> v_size)::numeric, v_consumption)$old$,
        $new$COALESCE(public.pick_consumption_for_size(v_per_size, v_size), v_consumption)$new$,
        1
      ),
      (
        'public.order_strap_needs(jsonb,numeric,jsonb)',
        $old$COALESCE((v_per_size ->> v_size)::numeric, v_consumption)$old$,
        $new$COALESCE(public.pick_consumption_for_size(v_per_size, v_size), v_consumption)$new$,
        1
      ),
      (
        'public.calculate_strap_line_required_m(jsonb,numeric,jsonb)',
        $old$coalesce(nullif(v_per_size ->> v_size, '')::numeric, v_default_cm)$old$,
        $new$coalesce(public.pick_consumption_for_size(v_per_size, v_size), v_default_cm)$new$,
        1
      ),
      (
        'public.sole_papel_value_for_size(uuid,text,integer)',
        $old$coalesce((i.consumption_per_size ->> p_size::text)::numeric, i.consumption_per_pair)$old$,
        $new$coalesce(public.pick_consumption_for_size(i.consumption_per_size, p_size::text), i.consumption_per_pair)$new$,
        1
      ),
      (
        'public.tg_mirror_sole_papel_to_specs()',
        $old$coalesce((v_per_size ->> v_size::text)::numeric, v_per_pair)$old$,
        $new$coalesce(public.pick_consumption_for_size(v_per_size, v_size::text), v_per_pair)$new$,
        1
      ),
      (
        'public.list_missing_sole_consumption_sizes(uuid)',
        $old$(public.get_sole_consumption_per_size(p_sole_id, 'lining_consumption_per_size') ->> sts.size::text)::numeric$old$,
        $new$public.pick_consumption_for_size(public.get_sole_consumption_per_size(p_sole_id, 'lining_consumption_per_size'), sts.size::text)$new$,
        1
      ),
      (
        'public.list_missing_sole_consumption_sizes(uuid)',
        $old$(public.get_sole_consumption_per_size(p_sole_id, 'insole_consumption_per_size') ->> sts.size::text)::numeric$old$,
        $new$public.pick_consumption_for_size(public.get_sole_consumption_per_size(p_sole_id, 'insole_consumption_per_size'), sts.size::text)$new$,
        1
      ),
      (
        'public.list_missing_sole_consumption_sizes(uuid)',
        $old$(public.get_sole_consumption_per_size(p_sole_id, 'fachete_lining_consumption_per_size') ->> sts.size::text)::numeric$old$,
        $new$public.pick_consumption_for_size(public.get_sole_consumption_per_size(p_sole_id, 'fachete_lining_consumption_per_size'), sts.size::text)$new$,
        1
      ),
      (
        'public.preview_sale_order_strap_demand_draft_pre_05500(jsonb)',
        $old$AND coalesce(
             nullif(v_line -> 'consumption_per_size' ->> g.key, '')::numeric,
             nullif(v_line ->> 'consumption', '')::numeric,
             0
           ) <= 0$old$,
        $new$AND public.pick_consumption_for_size(
             v_line -> 'consumption_per_size',
             g.key
           ) IS NULL
           AND coalesce(nullif(v_line ->> 'consumption', '')::numeric, 0) <= 0$new$,
        1
      )
    ) AS patches(signature, old_text, new_text, expected_count)
  LOOP
    v_function := to_regprocedure(v_patch.signature);
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'Patch recusado: função ausente: %', v_patch.signature;
    END IF;

    v_definition := pg_get_functiondef(v_function);
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_patch.old_text, ''))
    ) / length(v_patch.old_text);

    IF v_occurrences <> v_patch.expected_count THEN
      RAISE EXCEPTION
        'Patch recusado em %: esperado % ocorrência(s), encontrado %',
        v_patch.signature,
        v_patch.expected_count,
        v_occurrences;
    END IF;

    v_patched := replace(v_definition, v_patch.old_text, v_patch.new_text);
    EXECUTE v_patched;
  END LOOP;
END
$patch_live_functions$;

-- A disponibilidade é uma RPC autenticada; não deve expor estoque a anon ou
-- herdar o EXECUTE padrão de PUBLIC.
REVOKE ALL ON FUNCTION
  public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)
  TO authenticated, service_role;

-- Acrescenta casos permanentes à suíte de paridade sem copiar seu corpo atual.
DO $patch_parity$
DECLARE
  v_function regprocedure :=
    'public.run_consumption_parity_tests()'::regprocedure;
  v_definition text;
  v_patched text;
  v_anchor text := $anchor$  case_name := 'bygrade_inclui_fachete';$anchor$;
BEGIN
  v_definition := pg_get_functiondef(v_function);

  IF position('pick_consumption_for_size_conjugada' IN v_definition) = 0 THEN
    IF position(v_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Patch parity recusado: âncora não encontrada';
    END IF;

    v_patched := replace(
      v_definition,
      v_anchor,
      $cases$  case_name := 'pick_consumption_for_size_existe';
  ok := to_regprocedure('public.pick_consumption_for_size(jsonb,text)') IS NOT NULL;
  message := 'helper canônico de matching por numeração deve existir'; RETURN NEXT;

  case_name := 'calc_required_usa_pick_consumption_for_size';
  ok := pg_get_functiondef(
          'public.calc_required_for_grade(jsonb,jsonb,numeric,numeric)'::regprocedure
        ) ILIKE '%pick_consumption_for_size%';
  message := 'calc_required_for_grade deve delegar o lookup ao helper'; RETURN NEXT;

  case_name := 'bygrade_usa_pick_consumption_for_size';
  ok := v_bygrade ILIKE '%pick_consumption_for_size%';
  message := 'by_grade deve usar o helper no lookup per-size'; RETURN NEXT;

  case_name := 'pick_consumption_for_size_conjugada';
  ok := public.pick_consumption_for_size('{"33/34":8,"36":9}'::jsonb, '33') = 8
    AND public.pick_consumption_for_size('{"33/34":8}'::jsonb, '34') = 8
    AND public.pick_consumption_for_size('{"33":7.5}'::jsonb, '33/34') = 7.5;
  message := 'chaves individuais e conjugadas devem casar nos dois sentidos'; RETURN NEXT;

  case_name := 'pick_consumption_for_size_zero_explicito';
  ok := public.pick_consumption_for_size('{"36":0,"38":8}'::jsonb, '36') = 0
    AND public.pick_consumption_for_size('{"36":0}'::jsonb, '36') IS NOT NULL;
  message := 'zero explícito é valor válido, não ausência'; RETURN NEXT;

  case_name := 'calc_required_conjugada_e_zero';
  ok := public.calc_required_for_grade(
    '{"33/34":8,"36":0}'::jsonb,
    '{"33":2,"34":2,"36":1}'::jsonb,
    6.5,
    5
  ) = 32;
  message := '2×8 + 2×8 + 1×0 deve resultar em 32'; RETURN NEXT;

  case_name := 'strap_required_conjugada_e_zero';
  ok := public.calculate_strap_line_required_m(
    '{"consumption":6.5,"consumption_per_size":{"33/34":8,"36":0}}'::jsonb,
    5,
    '{"33":2,"34":2,"36":1}'::jsonb
  ) = 0.32;
  message := 'tira deve resultar em 32 cm = 0,32 m'; RETURN NEXT;

  case_name := 'bygrade_inclui_fachete';$cases$
    );

    IF v_patched = v_definition THEN
      RAISE EXCEPTION 'Patch parity recusado: definição não mudou';
    END IF;
    EXECUTE v_patched;
  END IF;
END
$patch_parity$;

DO $selftest$
DECLARE
  v_value numeric;
  v_definition text;
  v_count integer;
BEGIN
  IF public.pick_consumption_for_size(
       '{"33":5,"33/34":8}'::jsonb,
       '33'
     ) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'Self-test: chave exata não venceu a conjugada';
  END IF;

  IF public.pick_consumption_for_size(
       '{"33/34":8}'::jsonb,
       '34'
     ) IS DISTINCT FROM 8
     OR public.pick_consumption_for_size(
       '{"33":7.5}'::jsonb,
       '33/34'
     ) IS DISTINCT FROM 7.5 THEN
    RAISE EXCEPTION 'Self-test: matching conjugado falhou';
  END IF;

  IF public.pick_consumption_for_size(
       '{"36":0}'::jsonb,
       '36'
     ) IS DISTINCT FROM 0
     OR public.pick_consumption_for_size(
       '{"36":8}'::jsonb,
       '33'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Self-test: zero explícito/ausência falhou';
  END IF;

  v_value := public.calc_required_for_grade(
    '{"33/34":8,"36":0}'::jsonb,
    '{"33":2,"34":2,"36":1}'::jsonb,
    6.5,
    5
  );
  IF v_value IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Self-test calc_required: esperado 32, obtido %', v_value;
  END IF;

  v_value := public.calc_required_for_grade(
    '{"33":0,"34":0}'::jsonb,
    '{"33":1,"34":1}'::jsonb,
    6.5,
    2
  );
  IF v_value IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'Self-test calc_required: grade integralmente zero retornou %',
      v_value;
  END IF;

  v_value := public._calc_required_per_size(
    '{"33/34":8,"36":0}'::jsonb,
    6.5,
    '{"33":2,"34":2,"36":1}'::jsonb,
    5
  );
  IF v_value IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'Self-test _calc_required: esperado 32, obtido %', v_value;
  END IF;

  v_value := public.calculate_strap_line_required_m(
    '{"consumption":6.5,"consumption_per_size":{"33/34":8,"36":0}}'::jsonb,
    5,
    '{"33":2,"34":2,"36":1}'::jsonb
  );
  IF v_value IS DISTINCT FROM 0.32 THEN
    RAISE EXCEPTION 'Self-test tira: esperado 0.32, obtido %', v_value;
  END IF;

  v_definition := pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  );
  v_count := (
    length(v_definition)
      - length(replace(v_definition, 'pick_consumption_for_size', ''))
  ) / length('pick_consumption_for_size');
  IF v_count <> 10 THEN
    RAISE EXCEPTION
      'Self-test by_grade: esperadas 10 chamadas ao helper, obtidas %',
      v_count;
  END IF;

  v_definition := pg_get_functiondef(
    'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'::regprocedure
  );
  IF position('calculate_order_consumption_by_grade' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Self-test wrapper escalar: delegação ao motor por grade ausente';
  END IF;

  v_definition := pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft_pre_05500(jsonb)'::regprocedure
  );
  IF position(
       'pick_consumption_for_size' IN v_definition
     ) = 0 OR position(
       'coalesce(nullif(v_line ->> ''consumption'', '''')::numeric, 0) <= 0'
       IN regexp_replace(v_definition, E'\\s+', ' ', 'g')
     ) = 0 THEN
    RAISE EXCEPTION
      'Self-test preview: fallback escalar/matching por numeração incompleto';
  END IF;

  IF to_regprocedure(
       'public.calculate_order_consumption_by_grade(uuid,jsonb,text)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.calculate_order_consumption(uuid,numeric,text,integer)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.check_stock_availability(uuid,integer,text,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Self-test: overload de consumo legado sobreviveu';
  END IF;
END
$selftest$;

NOTIFY pgrst, 'reload schema';

COMMIT;
