-- =============================================================================
-- update_sole_profile: SECURITY DEFINER (boundary de estoque)
-- =============================================================================
-- Sintoma (2026-10-25): salvar em /solados → toast
--   "permission denied for table products".
--
-- Causa: a RPC nasceu SECURITY INVOKER (mig 01000) e sempre fazia
--   SET stock_grade = ..., updated_at = now()
-- Depois do stock_command_boundary (mig 12500), authenticated NÃO tem UPDATE
-- nessas colunas (nem table-level UPDATE). O UPDATE da RPC estoura 42501 em
-- todo save — inclusive só mudando sole_classification / fornecedor.
--
-- Correção: SECURITY DEFINER (dono postgres) + portão is_approved_user() que
-- já existia. stock_grade só entra no SET quando o range muda (único motivo
-- legítimo desta RPC tocar grade). updated_at fica a cargo do trigger
-- update_products_updated_at.
--
-- group_has_active_caramelo_sole: também DEFINER — a guarda unicolor lê
-- products; se algum dia for chamada fora de trigger DEFINER, não pode
-- depender do ACL do caller.

CREATE OR REPLACE FUNCTION public.group_has_active_caramelo_sole(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'private'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.products p
     WHERE p.group_id = p_group_id
       AND p.active IS TRUE
       AND (
         lower(btrim(COALESCE(p.category, ''))) = 'sola'
         OR lower(btrim(COALESCE(p.category, ''))) LIKE 'solado%'
       )
       AND private.is_caramelo_color(p.color)
  );
$function$;

REVOKE ALL ON FUNCTION public.group_has_active_caramelo_sole(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_has_active_caramelo_sole(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_sole_profile(
  p_product_id uuid,
  p_profile jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

      UPDATE public.products p
         SET name = CASE WHEN p_profile ? 'name' THEN v_name ELSE p.name END,
             unit = 'par',
             supplier_id = CASE
               WHEN p_profile ? 'supplier_id' THEN NULLIF(p_profile->>'supplier_id', '')::uuid
               ELSE p.supplier_id END,
             supplier_lead_time_days = CASE
               WHEN p_profile ? 'supplier_lead_time_days' THEN v_lead
               ELSE p.supplier_lead_time_days END,
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
             stock_grade = v_grade
       WHERE p.id = v_row.id;
    ELSE
      -- Sem mudança de range: NÃO tocar stock_grade (coluna do boundary).
      UPDATE public.products p
         SET name = CASE WHEN p_profile ? 'name' THEN v_name ELSE p.name END,
             unit = 'par',
             supplier_id = CASE
               WHEN p_profile ? 'supplier_id' THEN NULLIF(p_profile->>'supplier_id', '')::uuid
               ELSE p.supplier_id END,
             supplier_lead_time_days = CASE
               WHEN p_profile ? 'supplier_lead_time_days' THEN v_lead
               ELSE p.supplier_lead_time_days END,
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
               ELSE p.fachete_material_group_id END
       WHERE p.id = v_row.id;
    END IF;

    v_affected := v_affected + 1;
  END LOOP;

  -- SKU, cor e custo são da variante física; nunca propagam para as demais cores.
  UPDATE public.products p
     SET sku = CASE WHEN p_profile ? 'sku' THEN v_sku ELSE p.sku END,
         color = CASE WHEN p_profile ? 'color' THEN COALESCE(btrim(p_profile->>'color'), '') ELSE p.color END,
         unit_price = CASE WHEN p_profile ? 'unit_price' THEN v_price ELSE p.unit_price END
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
  'Atualiza cadastro do solado em uma transação (SECURITY DEFINER). '
  'Campos técnicos e range são compartilhados no grupo; SKU, cor e preço '
  'ficam por variante. stock_grade só muda com size_from/size_to.';

REVOKE ALL ON FUNCTION public.update_sole_profile(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_sole_profile(uuid, jsonb) TO authenticated, service_role;
