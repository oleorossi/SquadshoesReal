-- Cartões do montador (Palmilha): 1 código único persistido por ficha (12/15/18)
-- e 1 cartão parcial da sobra. Reimpressão é idempotente — reutiliza os mesmos
-- códigos (unicidade em (order_id, setor, ficha_index)).
-- A tabela public.orders é a OP de produção (não existe production_orders).

CREATE SEQUENCE IF NOT EXISTS public.ficha_cartoes_codigo_seq;

CREATE TABLE IF NOT EXISTS public.ficha_cartoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  op_number text,
  sales_order_number text,
  ficha_index integer NOT NULL,
  total_fichas integer NOT NULL,
  ficha_size integer NOT NULL,
  pares integer NOT NULL,
  is_sobra boolean NOT NULL DEFAULT false,
  grade_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  setor text NOT NULL DEFAULT 'palmilha',
  status text NOT NULL DEFAULT 'emitido',
  montador_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  baixado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT ficha_cartoes_codigo_key UNIQUE (codigo),
  CONSTRAINT ficha_cartoes_order_setor_index_key UNIQUE (order_id, setor, ficha_index),
  CONSTRAINT ficha_cartoes_ficha_index_chk CHECK (ficha_index >= 1),
  CONSTRAINT ficha_cartoes_total_fichas_chk CHECK (total_fichas >= 1 AND total_fichas >= ficha_index),
  CONSTRAINT ficha_cartoes_ficha_size_chk CHECK (ficha_size IN (12, 15, 18)),
  CONSTRAINT ficha_cartoes_pares_chk CHECK (pares > 0),
  CONSTRAINT ficha_cartoes_setor_chk CHECK (btrim(setor) <> ''),
  CONSTRAINT ficha_cartoes_status_chk CHECK (status IN ('emitido', 'baixado', 'cancelado')),
  CONSTRAINT ficha_cartoes_baixa_consistencia_chk CHECK (
    (status = 'baixado' AND baixado_em IS NOT NULL)
    OR (status <> 'baixado' AND baixado_em IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS ficha_cartoes_order_id_idx
  ON public.ficha_cartoes (order_id, setor, ficha_index);
CREATE INDEX IF NOT EXISTS ficha_cartoes_status_idx
  ON public.ficha_cartoes (status);
CREATE INDEX IF NOT EXISTS ficha_cartoes_montador_id_idx
  ON public.ficha_cartoes (montador_id)
  WHERE montador_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ficha_cartoes_sales_order_number_idx
  ON public.ficha_cartoes (sales_order_number)
  WHERE sales_order_number IS NOT NULL;

COMMENT ON TABLE public.ficha_cartoes IS
  'Cartãozinho físico do montador: 1 linha por ficha (cheia ou sobra) de uma OP/setor. codigo é único e estável na reimpressão. status emitido|baixado|cancelado reserva a futura conferência em /fichas-montadores.';
COMMENT ON COLUMN public.ficha_cartoes.codigo IS
  'Código curto e único, formato PM-000001. Gerado uma vez; reimpressão reutiliza.';
COMMENT ON COLUMN public.ficha_cartoes.order_id IS
  'FK da OP de produção (public.orders).';
COMMENT ON COLUMN public.ficha_cartoes.ficha_size IS
  'Corrugado da OP (12, 15 ou 18). Na sobra continua sendo o corrugado de referência; pares guarda a quantidade real.';
COMMENT ON COLUMN public.ficha_cartoes.pares IS
  'Pares desta ficha: 12/15/18 nas cheias, ou o resto na sobra.';
COMMENT ON COLUMN public.ficha_cartoes.is_sobra IS
  'TRUE quando a ficha é o resto que não fecha um corrugado cheio.';
COMMENT ON COLUMN public.ficha_cartoes.status IS
  'emitido = impresso/aguardando acerto; baixado = conferido (futuro); cancelado = anulado.';

ALTER TABLE public.ficha_cartoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ficha_cartoes_select_auth ON public.ficha_cartoes;
CREATE POLICY ficha_cartoes_select_auth ON public.ficha_cartoes
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS ficha_cartoes_insert_approved ON public.ficha_cartoes;
CREATE POLICY ficha_cartoes_insert_approved ON public.ficha_cartoes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS ficha_cartoes_update_approved ON public.ficha_cartoes;
CREATE POLICY ficha_cartoes_update_approved ON public.ficha_cartoes
  FOR UPDATE TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS ficha_cartoes_delete_approved ON public.ficha_cartoes;
CREATE POLICY ficha_cartoes_delete_approved ON public.ficha_cartoes
  FOR DELETE TO authenticated
  USING (public.is_approved_user());

REVOKE ALL ON TABLE public.ficha_cartoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ficha_cartoes TO authenticated;
GRANT ALL ON TABLE public.ficha_cartoes TO service_role;

REVOKE ALL ON SEQUENCE public.ficha_cartoes_codigo_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ficha_cartoes_codigo_seq TO authenticated, service_role;

-- ── Limpa a grade (células numéricas > 0; ignora chaves internas _*) ────────
CREATE OR REPLACE FUNCTION public.clean_ficha_grade(p_grade jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(
    (
      SELECT jsonb_object_agg(e.key, to_jsonb(v))
      FROM jsonb_each_text(COALESCE(p_grade, '{}'::jsonb)) AS e
      CROSS JOIN LATERAL (SELECT CASE
        WHEN e.value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN trunc((e.value)::numeric)
        ELSE NULL
      END) AS q(v)
      WHERE e.key <> ''
        AND left(e.key, 1) <> '_'
        AND q.v IS NOT NULL
        AND q.v > 0
    ),
    '{}'::jsonb
  );
$fn$;

REVOKE ALL ON FUNCTION public.clean_ficha_grade(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clean_ficha_grade(jsonb) TO authenticated, service_role;

-- Espelha src/components/production/worksheet/fichaSize.ts (resolveFicha).
CREATE OR REPLACE FUNCTION public.resolve_ficha(p_total integer, p_grade jsonb)
RETURNS TABLE(
  corrugado integer,
  fichas numeric,
  base_curve jsonb,
  exact boolean
)
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_total integer := COALESCE(p_total, 0);
  v_grade jsonb := public.clean_ficha_grade(p_grade);
  v_sum numeric := 0;
  v_c integer;
  v_fichas numeric;
  v_k numeric;
  v_curve jsonb;
  v_divisible boolean;
BEGIN
  SELECT COALESCE(sum((value)::numeric), 0) INTO v_sum
  FROM jsonb_each(v_grade);

  IF v_total > 0 AND v_sum > 0 THEN
    -- 1. Grade já é a curva-base de 1 corrugado.
    IF v_sum IN (12, 15, 18) AND v_total % v_sum = 0 THEN
      corrugado := v_sum::integer;
      fichas := v_total / v_sum;
      base_curve := v_grade;
      exact := true;
      RETURN NEXT;
      RETURN;
    END IF;

    -- 2. Grade é o total do pedido.
    IF v_sum = v_total THEN
      FOREACH v_c IN ARRAY ARRAY[12, 15, 18] LOOP
        v_fichas := v_total::numeric / v_c;
        IF v_fichas = trunc(v_fichas) AND v_fichas >= 1 THEN
          SELECT bool_and((value)::numeric % v_fichas = 0) INTO v_divisible
          FROM jsonb_each(v_grade);
          IF v_divisible THEN
            SELECT jsonb_object_agg(key, to_jsonb(((value)::numeric / v_fichas))) INTO v_curve
            FROM jsonb_each(v_grade);
            corrugado := v_c;
            fichas := v_fichas;
            base_curve := COALESCE(v_curve, '{}'::jsonb);
            exact := true;
            RETURN NEXT;
            RETURN;
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 3. Curva multiplicada (total divisível pela soma da curva).
    IF v_sum <> v_total AND v_total % v_sum = 0 THEN
      FOREACH v_c IN ARRAY ARRAY[12, 15, 18] LOOP
        IF v_sum % v_c = 0 THEN
          v_k := v_sum / v_c;
          SELECT bool_and((value)::numeric % v_k = 0) INTO v_divisible
          FROM jsonb_each(v_grade);
          IF v_divisible THEN
            SELECT jsonb_object_agg(key, to_jsonb(((value)::numeric / v_k))) INTO v_curve
            FROM jsonb_each(v_grade);
            corrugado := v_c;
            fichas := (v_total / v_sum) * v_k;
            base_curve := COALESCE(v_curve, '{}'::jsonb);
            exact := true;
            RETURN NEXT;
            RETURN;
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 3.5. Total fecha em 12/15/18, mas a numeração não divide — sem curva.
    FOREACH v_c IN ARRAY ARRAY[12, 15, 18] LOOP
      v_fichas := v_total::numeric / v_c;
      IF v_fichas = trunc(v_fichas) AND v_fichas >= 1 THEN
        corrugado := v_c;
        fichas := v_fichas;
        base_curve := NULL;
        exact := false;
        RETURN NEXT;
        RETURN;
      END IF;
    END LOOP;
  END IF;

  -- 4. Fallback: corrugado 12, última ficha parcial.
  corrugado := 12;
  fichas := CASE WHEN v_total > 0 THEN ceil(v_total / 12.0) ELSE 0 END;
  base_curve := NULL;
  exact := false;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_ficha(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_ficha(integer, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_ficha(integer, jsonb) IS
  'Deriva corrugado (12/15/18), nº de fichas e curva-base. Espelha resolveFicha do frontend.';

-- Plano de cartões: fichas cheias + eventual sobra.
CREATE OR REPLACE FUNCTION public.plan_ficha_cartoes(p_total integer, p_grade jsonb)
RETURNS TABLE(
  ficha_index integer,
  total_fichas integer,
  ficha_size integer,
  pares integer,
  is_sobra boolean,
  grade_json jsonb
)
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_resolved record;
  v_total integer := COALESCE(p_total, 0);
  v_full integer;
  v_rem integer;
  v_total_fichas integer;
  v_i integer;
  v_grade jsonb;
BEGIN
  IF v_total <= 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_resolved FROM public.resolve_ficha(v_total, p_grade);
  v_full := floor(v_total::numeric / v_resolved.corrugado)::integer;
  v_rem := v_total % v_resolved.corrugado;
  v_total_fichas := v_full + CASE WHEN v_rem > 0 THEN 1 ELSE 0 END;
  IF v_total_fichas <= 0 THEN
    RETURN;
  END IF;
  v_grade := COALESCE(v_resolved.base_curve, '{}'::jsonb);

  FOR v_i IN 1..v_full LOOP
    ficha_index := v_i;
    total_fichas := v_total_fichas;
    ficha_size := v_resolved.corrugado;
    pares := v_resolved.corrugado;
    is_sobra := false;
    grade_json := v_grade;
    RETURN NEXT;
  END LOOP;

  IF v_rem > 0 THEN
    ficha_index := v_total_fichas;
    total_fichas := v_total_fichas;
    ficha_size := v_resolved.corrugado;
    pares := v_rem;
    is_sobra := true;
    grade_json := '{}'::jsonb;
    RETURN NEXT;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.plan_ficha_cartoes(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_ficha_cartoes(integer, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_ficha_cartoes_for_ops(
  p_order_ids uuid[],
  p_setor text DEFAULT 'palmilha'
)
RETURNS SETOF public.ficha_cartoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_setor text := lower(btrim(COALESCE(p_setor, 'palmilha')));
  v_order_id uuid;
  v_order record;
  v_pv text;
  v_plan record;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Sem permissão para gerar cartões do montador.'
      USING ERRCODE = '42501';
  END IF;

  IF v_setor = '' THEN
    RAISE EXCEPTION 'Setor é obrigatório.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RETURN;
  END IF;

  -- Locks em ordem UUID para dois maços da mesma OP não gerarem códigos paralelos.
  FOR v_order_id IN
    SELECT DISTINCT id
    FROM unnest(p_order_ids) AS id
    WHERE id IS NOT NULL
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(v_order_id::text), hashtext(v_setor));

    SELECT o.id, o.order_number, o.quantity, o.grade, o.sale_order_id
      INTO v_order
      FROM public.orders o
     WHERE o.id = v_order_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_pv := NULL;
    IF v_order.sale_order_id IS NOT NULL THEN
      SELECT so.order_number INTO v_pv
        FROM public.sale_orders so
       WHERE so.id = v_order.sale_order_id;
    END IF;

    FOR v_plan IN
      SELECT *
      FROM public.plan_ficha_cartoes(COALESCE(v_order.quantity, 0)::integer, v_order.grade)
    LOOP
      -- Só consome a sequence quando a ficha ainda não existe.
      -- ON CONFLICT DO NOTHING com nextval no VALUES queimaria códigos na reimpressão.
      INSERT INTO public.ficha_cartoes (
        codigo,
        order_id,
        op_number,
        sales_order_number,
        ficha_index,
        total_fichas,
        ficha_size,
        pares,
        is_sobra,
        grade_json,
        setor,
        status,
        created_by
      )
      SELECT
        'PM-' || lpad(nextval('public.ficha_cartoes_codigo_seq')::text, 6, '0'),
        v_order.id,
        v_order.order_number,
        v_pv,
        v_plan.ficha_index,
        v_plan.total_fichas,
        v_plan.ficha_size,
        v_plan.pares,
        v_plan.is_sobra,
        v_plan.grade_json,
        v_setor,
        'emitido',
        auth.uid()
      WHERE NOT EXISTS (
        SELECT 1
          FROM public.ficha_cartoes existing
         WHERE existing.order_id = v_order.id
           AND existing.setor = v_setor
           AND existing.ficha_index = v_plan.ficha_index
      )
      ON CONFLICT (order_id, setor, ficha_index) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN QUERY
    SELECT c.*
    FROM public.ficha_cartoes c
    WHERE c.order_id = ANY (p_order_ids)
      AND c.setor = v_setor
      AND c.status <> 'cancelado'
    ORDER BY c.op_number, c.ficha_index, c.codigo;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ensure_ficha_cartoes_for_ops(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_ficha_cartoes_for_ops(uuid[], text) TO authenticated, service_role;

COMMENT ON FUNCTION public.ensure_ficha_cartoes_for_ops(uuid[], text) IS
  'Garante cartões do montador (fichas cheias + sobra) para as OPs. Reimpressão reutiliza os mesmos códigos (ON CONFLICT DO NOTHING).';
