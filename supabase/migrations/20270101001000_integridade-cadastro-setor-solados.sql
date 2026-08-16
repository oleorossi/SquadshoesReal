-- =============================================================================
-- Setor de solados: cadastro atômico, unidade canônica e range sem corrida
-- =============================================================================
-- O menu /solados editava o preço e os dados técnicos em chamadas separadas e
-- regravava products.stock_grade a partir de um JSON lido anteriormente. Além
-- de permitir salvamento parcial, uma baixa concorrente podia fazer o range
-- falhar por coerência de grade. Esta RPC trava todas as variantes do modelo e
-- altera somente os metadados _size_from/_size_to do JSON vivo no banco.

CREATE OR REPLACE FUNCTION public.update_sole_profile(
  p_product_id uuid,
  p_profile jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target             public.products%ROWTYPE;
  v_row                record;
  v_grade              jsonb;
  v_key                text;
  v_value              jsonb;
  v_size_part          text;
  v_size               integer;
  v_from               integer;
  v_to                 integer;
  v_range_changed      boolean := false;
  v_affected           integer := 0;
  v_siblings           integer := 0;
  v_name               text;
  v_sku                text;
  v_price              numeric;
  v_lead               integer;
  v_moq                integer;
  v_heel               numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Solado não informado';
  END IF;
  IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN
    RAISE EXCEPTION 'Perfil do solado deve ser um objeto JSON';
  END IF;

  SELECT * INTO v_target
    FROM public.products
   WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solado não encontrado';
  END IF;
  IF NOT (
    lower(btrim(COALESCE(v_target.category, ''))) = 'sola'
    OR lower(btrim(COALESCE(v_target.category, ''))) LIKE 'solado%'
  ) THEN
    RAISE EXCEPTION 'Produto % não pertence ao setor de solados', p_product_id;
  END IF;

  IF p_profile ? 'name' THEN
    v_name := NULLIF(btrim(p_profile->>'name'), '');
    IF v_name IS NULL THEN RAISE EXCEPTION 'Nome do solado é obrigatório'; END IF;
  END IF;
  IF p_profile ? 'sku' THEN
    v_sku := NULLIF(btrim(p_profile->>'sku'), '');
  END IF;
  IF p_profile ? 'unit_price' THEN
    v_price := (p_profile->>'unit_price')::numeric;
    IF v_price < 0 THEN RAISE EXCEPTION 'Preço do solado não pode ser negativo'; END IF;
  END IF;
  IF p_profile ? 'supplier_lead_time_days' THEN
    v_lead := COALESCE((p_profile->>'supplier_lead_time_days')::integer, 0);
    IF v_lead < 0 THEN RAISE EXCEPTION 'Lead time não pode ser negativo'; END IF;
  END IF;
  IF p_profile ? 'sole_moq' THEN
    v_moq := COALESCE((p_profile->>'sole_moq')::integer, 0);
    IF v_moq < 0 THEN RAISE EXCEPTION 'Lote mínimo não pode ser negativo'; END IF;
  END IF;
  IF p_profile ? 'heel_height' THEN
    v_heel := NULLIF(p_profile->>'heel_height', '')::numeric;
    IF v_heel < 0 THEN RAISE EXCEPTION 'Altura do salto não pode ser negativa'; END IF;
  END IF;

  IF (p_profile ? 'size_from') OR (p_profile ? 'size_to') THEN
    IF NOT ((p_profile ? 'size_from') AND (p_profile ? 'size_to')) THEN
      RAISE EXCEPTION 'Informe o início e o fim do range de numeração';
    END IF;
    v_from := (p_profile->>'size_from')::integer;
    v_to := (p_profile->>'size_to')::integer;
    IF v_from < 10 OR v_to > 60 OR v_from > v_to THEN
      RAISE EXCEPTION 'Range de numeração inválido: % até %', v_from, v_to;
    END IF;
    v_range_changed := true;
  END IF;

  -- Trava todas as cores do modelo em ordem estável. O mesmo save atualiza os
  -- campos compartilhados de uma vez e evita perfil divergente entre variantes.
  FOR v_row IN
    SELECT p.id, p.stock_grade
     FROM public.products p
     WHERE p.id = p_product_id
        OR (
          v_target.group_id IS NOT NULL
          AND p.group_id = v_target.group_id
          AND (
            lower(btrim(COALESCE(p.category, ''))) = 'sola'
            OR lower(btrim(COALESCE(p.category, ''))) LIKE 'solado%'
          )
        )
     ORDER BY p.id
     FOR UPDATE
  LOOP
    v_grade := COALESCE(v_row.stock_grade, '{}'::jsonb);

    IF v_range_changed THEN
      -- Ao encolher a régua, nunca esconda saldo. Chaves zeradas fora do novo
      -- range são removidas; qualquer quantidade positiva bloqueia o save com
      -- mensagem acionável. Funciona também para chaves conjugadas 33/34.
      FOR v_key, v_value IN SELECT key, value FROM jsonb_each(v_grade)
      LOOP
        IF left(v_key, 1) = '_' OR v_key !~ '^[0-9]+(/[0-9]+)*$' THEN
          CONTINUE;
        END IF;
        FOR v_size_part IN SELECT regexp_split_to_table(v_key, '/')
        LOOP
          v_size := v_size_part::integer;
          IF v_size < v_from OR v_size > v_to THEN
            IF COALESCE((v_value #>> '{}')::numeric, 0) <> 0 THEN
              RAISE EXCEPTION
                'Não é possível retirar a numeração %: há % par(es) em estoque na variante %',
                v_key, (v_value #>> '{}')::numeric, v_row.id;
            END IF;
            v_grade := v_grade - v_key;
            EXIT;
          END IF;
        END LOOP;
      END LOOP;

      v_grade := jsonb_set(v_grade, '{_size_from}', to_jsonb(v_from), true);
      v_grade := jsonb_set(v_grade, '{_size_to}', to_jsonb(v_to), true);
    END IF;

    UPDATE public.products p
       SET name = CASE WHEN p_profile ? 'name' THEN v_name ELSE p.name END,
           unit = 'par',
           supplier_id = CASE
             WHEN p_profile ? 'supplier_id' THEN NULLIF(p_profile->>'supplier_id', '')::uuid
             ELSE p.supplier_id END,
           supplier_lead_time_days = CASE
             WHEN p_profile ? 'supplier_lead_time_days' THEN v_lead
             ELSE p.supplier_lead_time_days END,
           -- Mantém o legado alinhado enquanto v_mrp_needs ainda usa esta
           -- coluna como último fallback sem wave.
           lead_time_days = CASE
             WHEN p_profile ? 'supplier_lead_time_days' THEN v_lead
             ELSE p.lead_time_days END,
           sole_material = CASE
             WHEN p_profile ? 'sole_material' THEN NULLIF(btrim(p_profile->>'sole_material'), '')
             ELSE p.sole_material END,
           heel_height = CASE
             WHEN p_profile ? 'heel_height' THEN v_heel
             ELSE p.heel_height END,
           sole_moq = CASE
             WHEN p_profile ? 'sole_moq' THEN v_moq
             ELSE p.sole_moq END,
           sole_technical_notes = CASE
             WHEN p_profile ? 'sole_technical_notes' THEN NULLIF(btrim(p_profile->>'sole_technical_notes'), '')
             ELSE p.sole_technical_notes END,
           is_standard_sole_item = CASE
             WHEN p_profile ? 'is_standard_sole_item' THEN COALESCE((p_profile->>'is_standard_sole_item')::boolean, false)
             ELSE p.is_standard_sole_item END,
           is_fachetado = CASE
             WHEN p_profile ? 'is_fachetado' THEN COALESCE((p_profile->>'is_fachetado')::boolean, false)
             ELSE p.is_fachetado END,
           insole_mode = CASE
             WHEN p_profile ? 'insole_mode' THEN (p_profile->>'insole_mode')::public.insole_mode_enum
             ELSE p.insole_mode END,
           sole_classification = CASE
             WHEN p_profile ? 'sole_classification' THEN (p_profile->>'sole_classification')::public.sole_classification_enum
             ELSE p.sole_classification END,
           fachete_material_group_id = CASE
             WHEN p_profile ? 'fachete_material_group_id' THEN NULLIF(p_profile->>'fachete_material_group_id', '')::uuid
             ELSE p.fachete_material_group_id END,
           stock_grade = CASE WHEN v_range_changed THEN v_grade ELSE p.stock_grade END,
           updated_at = now()
     WHERE p.id = v_row.id;

    v_affected := v_affected + 1;
  END LOOP;

  -- SKU, cor e custo são da variante física; nunca propagam para as demais cores.
  UPDATE public.products p
     SET sku = CASE WHEN p_profile ? 'sku' THEN v_sku ELSE p.sku END,
         color = CASE WHEN p_profile ? 'color' THEN COALESCE(btrim(p_profile->>'color'), '') ELSE p.color END,
         unit_price = CASE WHEN p_profile ? 'unit_price' THEN v_price ELSE p.unit_price END,
         updated_at = now()
   WHERE p.id = p_product_id;

  v_siblings := GREATEST(v_affected - 1, 0);
  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'updated', true,
    'siblings_updated', v_siblings
  );
END;
$function$;

COMMENT ON FUNCTION public.update_sole_profile(uuid, jsonb) IS
  'Atualiza cadastro do solado em uma transação. Campos técnicos e range são '
  'compartilhados no grupo; SKU, cor e preço ficam por variante. O range altera '
  'somente metadados do stock_grade vivo e bloqueia ocultação de saldo.';

REVOKE ALL ON FUNCTION public.update_sole_profile(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_sole_profile(uuid, jsonb) TO authenticated, service_role;

-- Relatório operacional: deixa os gaps acionáveis sem depender de comparar
-- manualmente dezenas de colunas no cadastro ou na ficha técnica.
CREATE OR REPLACE FUNCTION public.sole_sector_integrity_report()
RETURNS TABLE(
  product_id uuid,
  group_id uuid,
  sole_name text,
  sole_color text,
  severity text,
  issues text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH soles AS (
    SELECT p.*
      FROM public.products p
     WHERE p.active = true
       AND (
         lower(btrim(COALESCE(p.category, ''))) = 'sola'
         OR lower(btrim(COALESCE(p.category, ''))) LIKE 'solado%'
       )
  ), per_product AS (
    SELECT
      s.id AS product_id,
      s.group_id,
      s.name AS sole_name,
      s.color AS sole_color,
      CASE
        WHEN lower(btrim(COALESCE(s.unit, ''))) <> 'par'
          OR s.stock_grade IS NULL
          OR s.stock_grade->'_size_from' IS NULL
          OR s.stock_grade->'_size_to' IS NULL
        THEN 'critical'
        ELSE 'warning'
      END AS severity,
      array_remove(ARRAY[
        CASE WHEN lower(btrim(COALESCE(s.unit, ''))) <> 'par' THEN 'unidade diferente de par' END,
        CASE WHEN s.group_id IS NULL THEN 'família não vinculada' END,
        CASE WHEN COALESCE(s.unit_price, 0) <= 0 THEN 'preço unitário ausente' END,
        CASE WHEN s.supplier_id IS NULL THEN 'fornecedor ausente' END,
        CASE WHEN COALESCE(s.supplier_lead_time_days, s.lead_time_days, 0) <= 0 THEN 'lead time ausente' END,
        CASE WHEN NULLIF(btrim(COALESCE(s.sole_material, '')), '') IS NULL THEN 'material/composto ausente' END,
        CASE WHEN s.sole_classification IS NULL THEN 'classificação ausente' END,
        CASE WHEN s.stock_grade IS NULL OR s.stock_grade->'_size_from' IS NULL OR s.stock_grade->'_size_to' IS NULL
          THEN 'range de numeração ausente' END
      ], NULL)::text[] AS issues
    FROM soles s
  ), per_group AS (
    SELECT
      s.group_id,
      min(s.name) AS sole_name,
      array_remove(ARRAY[
        CASE WHEN count(DISTINCT COALESCE(s.name, '∅')) > 1 THEN 'nome divergente entre cores' END,
        CASE WHEN count(DISTINCT COALESCE(s.supplier_id::text, '∅')) > 1 THEN 'fornecedor divergente entre cores' END,
        CASE WHEN count(DISTINCT COALESCE(s.supplier_lead_time_days::text, s.lead_time_days::text, '∅')) > 1 THEN 'lead time divergente entre cores' END,
        CASE WHEN count(DISTINCT COALESCE(s.sole_material, '∅')) > 1 THEN 'material divergente entre cores' END,
        CASE WHEN count(DISTINCT COALESCE(s.heel_height::text, '∅')) > 1 THEN 'altura do salto divergente entre cores' END,
        CASE WHEN count(DISTINCT COALESCE(s.sole_moq::text, '∅')) > 1 THEN 'MOQ divergente entre cores' END,
        CASE WHEN count(DISTINCT COALESCE(s.sole_classification::text, '∅')) > 1 THEN 'classificação divergente entre cores' END,
        CASE WHEN count(DISTINCT COALESCE(s.stock_grade->>'_size_from', '∅')) > 1
               OR count(DISTINCT COALESCE(s.stock_grade->>'_size_to', '∅')) > 1
          THEN 'range divergente entre cores' END
      ], NULL)::text[] AS issues
    FROM soles s
    WHERE s.group_id IS NOT NULL
    GROUP BY s.group_id
  )
  SELECT p.product_id, p.group_id, p.sole_name, p.sole_color, p.severity, p.issues
    FROM per_product p
   WHERE public.is_approved_user() AND cardinality(p.issues) > 0
  UNION ALL
  SELECT NULL::uuid, g.group_id, g.sole_name, NULL::text, 'warning'::text, g.issues
    FROM per_group g
   WHERE public.is_approved_user() AND cardinality(g.issues) > 0
  ORDER BY severity, sole_name, sole_color NULLS FIRST;
$function$;

COMMENT ON FUNCTION public.sole_sector_integrity_report() IS
  'Auditoria acionável do setor de solados: unidade, preço, fornecedor, prazo, '
  'material, classificação, range e divergências de dados compartilhados entre cores.';

REVOKE ALL ON FUNCTION public.sole_sector_integrity_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sole_sector_integrity_report() TO authenticated, service_role;
