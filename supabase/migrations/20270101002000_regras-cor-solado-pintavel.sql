-- =============================================================================
-- Solados: cor fixa, mesma cor do cabedal (pintável) e Preto → Preto
-- =============================================================================
-- `palmilha_color` é um nome histórico: nesta tabela ele representa a cor
-- física alvo do SOLADO. O modo pintável não grava sentinela nesse campo; a
-- decisão fica explícita em resolution_mode e é compartilhada por consumo,
-- disponibilidade, compra automática e baixa de estoque.

ALTER TABLE public.sole_color_conjugations
  ADD COLUMN IF NOT EXISTS resolution_mode text NOT NULL DEFAULT 'fixed';

ALTER TABLE public.sole_color_conjugations
  ALTER COLUMN palmilha_color DROP NOT NULL;

ALTER TABLE public.sole_color_conjugations
  DROP CONSTRAINT IF EXISTS sole_color_conjugations_resolution_mode_check;
ALTER TABLE public.sole_color_conjugations
  ADD CONSTRAINT sole_color_conjugations_resolution_mode_check
  CHECK (resolution_mode IN ('fixed', 'same_as_upper'));

ALTER TABLE public.sole_color_conjugations
  DROP CONSTRAINT IF EXISTS sole_color_conjugations_target_check;
ALTER TABLE public.sole_color_conjugations
  ADD CONSTRAINT sole_color_conjugations_target_check
  CHECK (
    (resolution_mode = 'fixed' AND NULLIF(btrim(palmilha_color), '') IS NOT NULL)
    OR (resolution_mode = 'same_as_upper' AND palmilha_color IS NULL)
  );

-- Remove duplicatas históricas de Preto que diferiam só em caixa/acento antes
-- de padronizar a linha protegida.
WITH ranked_black AS (
  SELECT id,
         row_number() OVER (PARTITION BY sole_group_id ORDER BY active DESC, updated_at DESC, id) AS rn
    FROM public.sole_color_conjugations
   WHERE lower(btrim(extensions.unaccent(cabedal_color))) = 'preto'
)
DELETE FROM public.sole_color_conjugations c
 USING ranked_black r
 WHERE c.id = r.id AND r.rn > 1;

UPDATE public.sole_color_conjugations
   SET cabedal_color = 'Preto',
       palmilha_color = 'Preto',
       resolution_mode = 'fixed',
       is_default = false,
       active = true,
       updated_at = now()
 WHERE lower(btrim(extensions.unaccent(cabedal_color))) = 'preto';

-- Materializa a regra protegida nos grupos atuais que já possuem a variante
-- física preta. A resolução abaixo também a força quando não houver linha.
INSERT INTO public.sole_color_conjugations (
  sole_group_id, cabedal_color, palmilha_color, resolution_mode, is_default, active
)
SELECT DISTINCT p.group_id, 'Preto', 'Preto', 'fixed', false, true
  FROM public.products p
 WHERE p.active = true
   AND p.group_id IS NOT NULL
   AND (
     lower(btrim(COALESCE(p.category, ''))) = 'sola'
     OR lower(btrim(COALESCE(p.category, ''))) LIKE 'solado%'
   )
   AND lower(btrim(extensions.unaccent(COALESCE(p.color, '')))) = 'preto'
   AND NOT EXISTS (
     SELECT 1
       FROM public.sole_color_conjugations c
      WHERE c.sole_group_id = p.group_id
        AND lower(btrim(extensions.unaccent(c.cabedal_color))) = 'preto'
   );

CREATE OR REPLACE FUNCTION public.enforce_sole_color_conjugation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_new_color text;
  v_old_color text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_color := lower(btrim(unaccent(COALESCE(OLD.cabedal_color, ''))));
    IF v_old_color = 'preto' AND EXISTS (
      SELECT 1 FROM public.product_groups pg WHERE pg.id = OLD.sole_group_id
    ) THEN
      RAISE EXCEPTION 'A regra Cabedal Preto → Solado Preto é obrigatória e não pode ser removida';
    END IF;
    RETURN OLD;
  END IF;

  v_new_color := lower(btrim(unaccent(COALESCE(NEW.cabedal_color, ''))));
  IF TG_OP = 'UPDATE' THEN
    v_old_color := lower(btrim(unaccent(COALESCE(OLD.cabedal_color, ''))));
    IF v_old_color = 'preto' AND v_new_color <> 'preto' THEN
      RAISE EXCEPTION 'A regra Cabedal Preto → Solado Preto não pode ser convertida em outra regra';
    END IF;
  END IF;

  IF v_new_color = 'preto' THEN
    NEW.cabedal_color := 'Preto';
    NEW.palmilha_color := 'Preto';
    NEW.resolution_mode := 'fixed';
    NEW.is_default := false;
    NEW.active := true;
  ELSIF NEW.is_default THEN
    NEW.cabedal_color := '*';
  ELSE
    NEW.cabedal_color := btrim(NEW.cabedal_color);
  END IF;

  IF NEW.resolution_mode = 'same_as_upper' THEN
    NEW.palmilha_color := NULL;
  ELSE
    NEW.palmilha_color := NULLIF(btrim(NEW.palmilha_color), '');
    IF NEW.palmilha_color IS NULL THEN
      RAISE EXCEPTION 'A regra de cor fixa exige uma cor de solado';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_sole_color_conjugation ON public.sole_color_conjugations;
CREATE TRIGGER trg_enforce_sole_color_conjugation
BEFORE INSERT OR UPDATE OR DELETE ON public.sole_color_conjugations
FOR EACH ROW EXECUTE FUNCTION public.enforce_sole_color_conjugation();

-- Uma única decisão para qualquer grupo de solado. Sempre devolve uma linha:
-- rule_applied=true + product_id NULL significa configuração obrigatória sem
-- variante física correspondente e deve falhar fechada.
CREATE OR REPLACE FUNCTION public.resolve_sole_in_group_by_color(
  p_sole_group_id uuid,
  p_product_color text,
  p_fallback_product_id uuid DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  sole_color text,
  available_qty numeric,
  resolution_source text,
  rule_applied boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_input_key text;
  v_target_color text;
  v_mode text;
  v_source text := 'none';
  v_rule_applied boolean := false;
BEGIN
  v_input_key := lower(btrim(unaccent(COALESCE(p_product_color, ''))));

  IF p_sole_group_id IS NOT NULL AND v_input_key <> '' THEN
    IF v_input_key = 'preto' THEN
      v_target_color := 'Preto';
      v_mode := 'fixed';
      v_source := 'black';
      v_rule_applied := true;
    ELSE
      SELECT c.palmilha_color,
             COALESCE(c.resolution_mode, 'fixed'),
             CASE
               WHEN lower(btrim(unaccent(c.cabedal_color))) = v_input_key THEN 'exact'
               ELSE 'default'
             END
        INTO v_target_color, v_mode, v_source
        FROM public.sole_color_conjugations c
       WHERE c.sole_group_id = p_sole_group_id
         AND c.active = true
         AND (
           lower(btrim(unaccent(c.cabedal_color))) = v_input_key
           OR c.is_default = true
         )
       ORDER BY (lower(btrim(unaccent(c.cabedal_color))) = v_input_key) DESC,
                c.is_default DESC,
                c.updated_at DESC,
                c.id
       LIMIT 1;
      v_rule_applied := FOUND;
      IF v_rule_applied AND v_mode = 'same_as_upper' THEN
        v_target_color := btrim(p_product_color);
      END IF;
    END IF;
  END IF;

  IF v_rule_applied THEN
    RETURN QUERY
      SELECT p.id, p.name, p.color, p.quantity, v_source, true
        FROM public.products p
       WHERE p.group_id = p_sole_group_id
         AND p.active = true
         AND lower(btrim(unaccent(COALESCE(p.color, '')))) = lower(btrim(unaccent(COALESCE(v_target_color, ''))))
       ORDER BY p.quantity DESC NULLS LAST, p.id
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    RETURN QUERY SELECT NULL::uuid, NULL::text, v_target_color, 0::numeric, v_source, true;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT p.id, p.name, p.color, p.quantity, 'fallback'::text, false
      FROM public.products p
     WHERE p.id = p_fallback_product_id
       AND p.active = true
     LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, 0::numeric, 'none'::text, false;
END;
$function$;

-- Cascata da ficha. Se Preto/regra fixa/pintável se aplica mas a variante não
-- existe, encerra sem P1/P2/P3: outra cor nunca pode substituir silenciosamente.
CREATE OR REPLACE FUNCTION public.resolve_sole_color(p_sheet_id uuid, p_product_color text)
RETURNS TABLE(sole_product_id uuid, sole_color text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_primary_sole_id uuid;
  v_sole_group_id uuid;
  v_group_resolution record;
BEGIN
  SELECT ts.sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id;

  IF v_sole_group_id IS NOT NULL AND btrim(COALESCE(p_product_color, '')) <> '' THEN
    SELECT * INTO v_group_resolution
      FROM public.resolve_sole_in_group_by_color(v_sole_group_id, p_product_color, NULL)
     LIMIT 1;
    IF COALESCE(v_group_resolution.rule_applied, false) THEN
      IF v_group_resolution.product_id IS NOT NULL THEN
        RETURN QUERY SELECT v_group_resolution.product_id, v_group_resolution.sole_color;
      END IF;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
    SELECT p.id, p.color
      FROM public.technical_sheet_sole_colors tsc
      JOIN public.products p ON p.id = tsc.sole_product_id
     WHERE tsc.sheet_id = p_sheet_id
       AND lower(unaccent(tsc.product_color)) = lower(unaccent(p_product_color))
       AND p.active = true
       AND tsc.sole_product_id IS NOT NULL
     LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    SELECT p.id, p.color
      FROM public.technical_sheet_sole_colors tsc
      JOIN public.products p ON p.group_id = tsc.sole_group_id AND p.active = true
     WHERE tsc.sheet_id = p_sheet_id
       AND lower(unaccent(tsc.product_color)) = lower(unaccent(p_product_color))
       AND tsc.sole_product_id IS NULL
     ORDER BY p.quantity DESC NULLS LAST, p.id
     LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  SELECT ts.primary_sole_id INTO v_primary_sole_id
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id;
  IF v_primary_sole_id IS NOT NULL THEN
    RETURN QUERY SELECT p.id, p.color
      FROM public.products p
     WHERE p.id = v_primary_sole_id AND p.active = true;
  END IF;
END;
$function$;

-- O pin da variante escolhe o modelo/grupo. A cor do PV continua mandando.
CREATE OR REPLACE FUNCTION public.resolve_sole_for_variant_color(
  p_variant_id uuid,
  p_product_color text
)
RETURNS TABLE(product_id uuid, product_name text, available_qty numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pinned_id uuid;
  v_group_id uuid;
  v_resolution record;
BEGIN
  IF p_variant_id IS NULL THEN RETURN; END IF;
  SELECT v.sole_material_product_id INTO v_pinned_id
    FROM public.reference_material_variants v
   WHERE v.id = p_variant_id;
  IF v_pinned_id IS NULL THEN RETURN; END IF;

  SELECT p.group_id INTO v_group_id
    FROM public.products p
   WHERE p.id = v_pinned_id AND p.active = true;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_group_id IS NULL THEN
    RETURN QUERY SELECT p.id, p.name, p.quantity
      FROM public.products p WHERE p.id = v_pinned_id AND p.active = true;
    RETURN;
  END IF;

  SELECT * INTO v_resolution
    FROM public.resolve_sole_in_group_by_color(v_group_id, p_product_color, v_pinned_id)
   LIMIT 1;
  IF v_resolution.product_id IS NOT NULL THEN
    RETURN QUERY SELECT v_resolution.product_id, v_resolution.product_name, v_resolution.available_qty;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_sole_in_group_by_color(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_sole_in_group_by_color(uuid, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_sole_for_variant_color(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_sole_for_variant_color(uuid, text) TO authenticated, service_role;

-- Atualiza os motores críticos a partir da definição viva anterior. O uso de
-- pg_get_functiondef evita copiar centenas de linhas de cálculo e perder fixes
-- independentes; as substituições são assertivas e abortam se a base divergir.
DO $patch_consumption$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_definition;
  IF position('public.resolve_sole_for_variant(p_material_variant_id)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Contrato inesperado em calculate_order_consumption_by_grade: resolver de variante não encontrado';
  END IF;
  v_definition := replace(
    v_definition,
    'public.resolve_sole_for_variant(p_material_variant_id)',
    'public.resolve_sole_for_variant_color(p_material_variant_id, p_color)'
  );
  IF position('IF v_variant_sole_pid IS NOT NULL THEN v_sole_product_id := v_variant_sole_pid; END IF;' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Contrato inesperado em calculate_order_consumption_by_grade: atribuição condicional não encontrada';
  END IF;
  v_definition := replace(
    v_definition,
    'IF v_variant_sole_pid IS NOT NULL THEN v_sole_product_id := v_variant_sole_pid; END IF;',
    'v_sole_product_id := v_variant_sole_pid;'
  );
  EXECUTE v_definition;
END;
$patch_consumption$;

DO $patch_debit$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)'::regprocedure
  ) INTO v_definition;
  IF position('public.resolve_sole_for_variant(v_variant_id)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Contrato inesperado em debit_sole_stock_by_grade: resolver de variante não encontrado';
  END IF;
  v_definition := replace(
    v_definition,
    'public.resolve_sole_for_variant(v_variant_id)',
    'public.resolve_sole_for_variant_color(v_variant_id, p_color)'
  );
  IF position(E'IF v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Contrato inesperado em debit_sole_stock_by_grade: fallback não encontrado';
  END IF;
  v_definition := replace(
    v_definition,
    E'IF v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id',
    E'IF v_variant_id IS NULL AND v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id'
  );
  EXECUTE v_definition;
END;
$patch_debit$;

-- Diagnóstico acionável por grupo/cor, incluindo demanda real de PV para as
-- regras pintáveis default.
CREATE OR REPLACE FUNCTION public.sole_color_integrity_report()
RETURNS TABLE(
  sole_group_id uuid,
  group_name text,
  cabedal_color text,
  expected_sole_color text,
  severity text,
  issue text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH sole_groups AS (
    SELECT DISTINCT p.group_id
      FROM public.products p
     WHERE p.active = true
       AND p.group_id IS NOT NULL
       AND (
         lower(btrim(COALESCE(p.category, ''))) = 'sola'
         OR lower(btrim(COALESCE(p.category, ''))) LIKE 'solado%'
       )
  ), demand_colors AS (
    SELECT DISTINCT ts.sole_group_id, btrim(soi.color) AS cabedal_color
      FROM public.sale_order_items soi
      JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE ts.sole_group_id IS NOT NULL
       AND NULLIF(btrim(soi.color), '') IS NOT NULL
  ), effective_paintable AS (
    SELECT d.sole_group_id, d.cabedal_color
      FROM demand_colors d
      CROSS JOIN LATERAL (
        SELECT c.resolution_mode
          FROM public.sole_color_conjugations c
         WHERE c.sole_group_id = d.sole_group_id
           AND c.active = true
           AND (
             lower(btrim(unaccent(c.cabedal_color))) = lower(btrim(unaccent(d.cabedal_color)))
             OR c.is_default = true
           )
         ORDER BY (lower(btrim(unaccent(c.cabedal_color))) = lower(btrim(unaccent(d.cabedal_color)))) DESC,
                  c.is_default DESC,
                  c.updated_at DESC
         LIMIT 1
      ) rule
     WHERE rule.resolution_mode = 'same_as_upper'
       AND lower(btrim(unaccent(d.cabedal_color))) <> 'preto'
  )
  SELECT sg.group_id, pg.name, 'Preto', 'Preto', 'critical', 'grupo sem variante física ativa de solado Preto'
    FROM sole_groups sg
    JOIN public.product_groups pg ON pg.id = sg.group_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.products p
      WHERE p.group_id = sg.group_id AND p.active = true
        AND lower(btrim(unaccent(COALESCE(p.color, '')))) = 'preto'
   )
  UNION ALL
  SELECT c.sole_group_id, pg.name, c.cabedal_color, c.palmilha_color, 'critical', 'regra fixa aponta para uma cor de solado sem variante física ativa'
    FROM public.sole_color_conjugations c
    JOIN public.product_groups pg ON pg.id = c.sole_group_id
   WHERE c.active = true AND c.resolution_mode = 'fixed'
     AND NOT EXISTS (
       SELECT 1 FROM public.products p
        WHERE p.group_id = c.sole_group_id AND p.active = true
          AND lower(btrim(unaccent(COALESCE(p.color, '')))) = lower(btrim(unaccent(COALESCE(c.palmilha_color, ''))))
     )
  UNION ALL
  SELECT ep.sole_group_id, pg.name, ep.cabedal_color, ep.cabedal_color, 'critical', 'regra pintável usada em PV sem variante física ativa na mesma cor do cabedal'
    FROM effective_paintable ep
    JOIN public.product_groups pg ON pg.id = ep.sole_group_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.products p
      WHERE p.group_id = ep.sole_group_id AND p.active = true
        AND lower(btrim(unaccent(COALESCE(p.color, '')))) = lower(btrim(unaccent(ep.cabedal_color)))
   )
  ORDER BY 2, 3, 6;
$function$;

REVOKE ALL ON FUNCTION public.sole_color_integrity_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sole_color_integrity_report() TO authenticated, service_role;

COMMENT ON FUNCTION public.sole_color_integrity_report() IS
  'Audita Preto obrigatório, alvos fixos e variantes físicas exigidas por regras pintáveis com demanda de PV.';
