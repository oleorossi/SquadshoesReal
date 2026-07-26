-- =============================================================================
-- 20260928121000 — Motor de consumo aplica os padrões globais por cor
-- =============================================================================
-- Depende da 20260928120000 (tabela component_color_defaults).
--
-- Muda o branch de fallback `direct_components` de
-- calculate_order_consumption_by_grade: pra cada componente declarado na ficha,
-- se o GRUPO do produto tiver regra ativa pra cor do PV (match exato
-- normalizado > is_default), o product_id é SUBSTITUÍDO pelo da regra, mantendo
-- a quantidade da ficha. Source novo: 'component_color_default' (whitelist Zod
-- em src/services/consumptionService.ts atualizada no mesmo commit).
--
-- Contrato (espelhado nos motores TS orderConsumption.ts/bomConsumption.ts):
--   • Lista por-cor da ficha (technical_sheet_component_colors) continua
--     VENCENDO (replace-all) — este branch só roda sem lista pra cor.
--   • A regra vale independente de component_colors_enabled (a flag governa só
--     as listas por-cor da ficha).
--   • Cor do PV vazia → sem substituição (nem default).
--   • Regra apontando produto inativo/apagado → ignora a regra, emite a linha
--     original + consumption_warning (e o item cai no consistency report).
--   • COLAPSO SOMA: entradas distintas da ficha que resolvem pro MESMO SKU
--     têm as quantidades SOMADAS (pré-agregação). Sem isso o dedup de
--     v_covered_product_ids descartaria a 2ª entrada em silêncio (consumo
--     cairia pela metade). Entrada DUPLICADA do mesmo product_id original
--     continua descartada (comportamento legado preservado via v_dc_seen).
--
-- Por que patch de texto e não CREATE OR REPLACE completo: mesma justificativa
-- da 20260918120000 — o corpo tem ~42 mil caracteres de regras críticas;
-- retranscrever tudo pra mudar 1 branch convida erro de transcrição. Cada
-- replace falha ALTO se a âncora não casar (âncoras conferidas contra o
-- pg_get_functiondef vivo em 2026-07-26). Idempotente.
--
-- Débito/reserva/custeio/compras/MRP herdam automaticamente: todos derivam de
-- calculate_order_consumption_by_grade (snapshot → hybrid_debit_stock_for_order;
-- try_reserve_materials; calculate_order_cost*; compute_materials_per_pv;
-- get_wave_material_needs). Tiras: mig 20260929120000.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. calculate_order_consumption_by_grade — regra global no branch
--    direct_components
-- ────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def    text;
  v_new    text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'calculate_order_consumption_by_grade';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade nao existe — migration fora de ordem';
  END IF;

  IF position('component_color_defaults' IN v_def) > 0 THEN
    RAISE NOTICE 'Padroes globais por cor ja aplicados no by_grade — nada a fazer.';
    RETURN;
  END IF;

  v_new := v_def;

  -- (1) DECLARE: variáveis do acumulador de agregação por SKU resolvido
  v_before := v_new;
  v_new := replace(v_new,
$a1$  v_warn text;
  v_dc_name text;
BEGIN$a1$,
$n1$  v_warn text;
  v_dc_name text;
  -- Padrões globais por cor (component_color_defaults, mig 20260928120000)
  v_rule_pid uuid;
  v_dc_qty numeric;
  v_dc_key text;
  v_dc_orig text;
  v_dc_warn text;
  v_dc_agg jsonb := '{}'::jsonb;
  v_dc_seen uuid[] := ARRAY[]::uuid[];
BEGIN$n1$);
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 1/2 (DECLARE acumulador) nao casou'; END IF;

  -- (2) branch direct_components inteiro → 2 passes (resolve regra + agrega,
  --     depois emite)
  v_before := v_new;
  v_new := replace(v_new,
$a2$IF NOT v_has_color_components
     AND v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          SELECT p.name AS name,
                 GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
                 p.category AS category, p.unit AS unit, p.color AS color
            INTO v_row FROM products p WHERE p.id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
              'color', COALESCE(v_row.color, ''),
              'consumption_per_unit', (v_item ->> 'quantity')::numeric, 'required', v_required,
              'available', v_row.available, 'stock_ok', v_row.available >= v_required,
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
                ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard' ELSE 'soft' END,
              'source', 'direct_components', 'unit', v_row.unit);
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          ELSE
            -- CONS-8 (caso a): o product_id do componente direto não existe mais
            -- em products (cadastro apagado). Antes o IF sem ELSE descartava a
            -- linha: a ficha pedia 8 binóculos/par e ninguém via nada.
            v_dc_name := COALESCE(NULLIF(btrim(v_item ->> 'product_name'), ''), 'Componente sem cadastro');
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', NULL, 'product_name', v_dc_name,
              'color', '', 'consumption_per_unit', 0, 'required', 0,
              'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
              -- sem 'unit': o Zod do frontend aceita unit ausente (optional),
              -- mas NÃO aceita null — e aqui não há produto pra dar a unidade.
              'consumption_warning', 'Componente direto "' || v_dc_name || '" ('
                || trim(to_char(COALESCE((v_item ->> 'quantity')::numeric, 0), 'FM999999990.####'))
                || '/par) não resolve produto no estoque — cadastro apagado. NÃO será reservado nem debitado. Recadastre o produto e refaça o vínculo em Ficha Técnica → Componentes.');
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;$a2$,
$n2$IF NOT v_has_color_components
     AND v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    -- Padrões globais por cor (component_color_defaults): 1º passe resolve a
    -- regra do GRUPO do componente pra cor do PV (exata > default) e agrega
    -- por SKU RESOLVIDO, SOMANDO colapsos. 2º passe emite (shape idêntico ao
    -- branch original). Regra só com cor não-vazia e produto-alvo ativo.
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NULL OR v_pid = ANY(v_covered_product_ids) OR v_pid = ANY(v_dc_seen) THEN
        CONTINUE;
      END IF;
      v_dc_qty := COALESCE((v_item ->> 'quantity')::numeric, 0);
      IF v_dc_qty <= 0 THEN CONTINUE; END IF;
      -- marca DEPOIS do check de qty: entrada zerada não esconde duplicata
      -- válida (paridade com o comportamento antigo, que só marcava ao emitir)
      v_dc_seen := array_append(v_dc_seen, v_pid);

      v_rule_pid := NULL; v_dc_warn := NULL;
      IF btrim(COALESCE(p_color, '')) <> '' THEN
        SELECT d.product_id INTO v_rule_pid
          FROM component_color_defaults d
          JOIN products pr ON pr.id = d.product_id AND pr.active = true
          JOIN products po ON po.id = v_pid
         WHERE d.active = true
           AND po.group_id IS NOT NULL
           AND d.group_id = po.group_id
           AND (d.is_default
                OR lower(btrim(extensions.unaccent(d.cabedal_color))) = lower(btrim(extensions.unaccent(p_color))))
         ORDER BY d.is_default ASC, d.id
         LIMIT 1;
        IF v_rule_pid IS NULL AND EXISTS (
             SELECT 1
               FROM component_color_defaults d
               JOIN products po ON po.id = v_pid
              WHERE d.active = true
                AND po.group_id IS NOT NULL
                AND d.group_id = po.group_id
                AND (d.is_default
                     OR lower(btrim(extensions.unaccent(d.cabedal_color))) = lower(btrim(extensions.unaccent(p_color))))
           ) THEN
          v_dc_warn := 'Regra global de cor do grupo aponta produto inativo/apagado — usando o componente original da ficha. Corrija em Fichas Técnicas → Padrões por Cor.';
        END IF;
      END IF;

      v_dc_key := COALESCE(v_rule_pid, v_pid)::text;
      v_dc_agg := jsonb_set(v_dc_agg, ARRAY[v_dc_key], jsonb_build_object(
        'qty', COALESCE((v_dc_agg #>> ARRAY[v_dc_key,'qty'])::numeric, 0) + v_dc_qty,
        'via_rule', COALESCE((v_dc_agg #>> ARRAY[v_dc_key,'via_rule'])::boolean, false) OR (v_rule_pid IS NOT NULL),
        'warn', COALESCE(v_dc_agg #>> ARRAY[v_dc_key,'warn'], v_dc_warn),
        'orig_name', COALESCE(v_dc_agg #>> ARRAY[v_dc_key,'orig_name'], NULLIF(btrim(v_item ->> 'product_name'), '')),
        -- pids ORIGINAIS que caíram nesta chave: entram no v_covered_product_ids
        -- na emissão, senão o loop de BOM re-emitiria o produto original que o
        -- dedup dc↔BOM sempre suprimiu.
        'orig_pids', COALESCE(v_dc_agg #> ARRAY[v_dc_key,'orig_pids'], '[]'::jsonb) || to_jsonb(v_pid::text)));
    END LOOP;

    FOR v_dc_key IN SELECT jsonb_object_keys(v_dc_agg) LOOP
      v_pid := v_dc_key::uuid;
      IF v_pid = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
      v_dc_qty := (v_dc_agg #>> ARRAY[v_dc_key,'qty'])::numeric;
      v_required := v_dc_qty * v_total_qty;
      IF v_required <= 0 THEN CONTINUE; END IF;
      SELECT p.name AS name,
             GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
             p.category AS category, p.unit AS unit, p.color AS color
        INTO v_row FROM products p WHERE p.id = v_pid;
      IF FOUND THEN
        v_result := v_result || jsonb_build_object(
          'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
          'color', COALESCE(v_row.color, ''),
          'consumption_per_unit', v_dc_qty, 'required', v_required,
          'available', v_row.available, 'stock_ok', v_row.available >= v_required,
          'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
            ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard' ELSE 'soft' END,
          'source', CASE WHEN COALESCE((v_dc_agg #>> ARRAY[v_dc_key,'via_rule'])::boolean, false)
                         THEN 'component_color_default' ELSE 'direct_components' END,
          'unit', v_row.unit,
          'consumption_warning', v_dc_agg #>> ARRAY[v_dc_key,'warn']);
        v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
        FOR v_dc_orig IN SELECT jsonb_array_elements_text(COALESCE(v_dc_agg #> ARRAY[v_dc_key,'orig_pids'], '[]'::jsonb)) LOOP
          v_covered_product_ids := array_append(v_covered_product_ids, v_dc_orig::uuid);
        END LOOP;
      ELSE
        -- CONS-8 (caso a): o product_id do componente direto não existe mais
        -- em products (cadastro apagado). A regra global NUNCA cai aqui (o
        -- lookup exige produto ativo) — só o pid original da ficha.
        v_dc_name := COALESCE(v_dc_agg #>> ARRAY[v_dc_key,'orig_name'], 'Componente sem cadastro');
        v_result := v_result || jsonb_build_object(
          'component', 'Componente Direto', 'product_id', NULL, 'product_name', v_dc_name,
          'color', '', 'consumption_per_unit', 0, 'required', 0,
          'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
          -- sem 'unit': o Zod do frontend aceita unit ausente (optional),
          -- mas NÃO aceita null — e aqui não há produto pra dar a unidade.
          'consumption_warning', 'Componente direto "' || v_dc_name || '" ('
            || trim(to_char(v_dc_qty, 'FM999999990.####'))
            || '/par) não resolve produto no estoque — cadastro apagado. NÃO será reservado nem debitado. Recadastre o produto e refaça o vínculo em Ficha Técnica → Componentes.');
      END IF;
    END LOOP;
  END IF;$n2$);
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 2/2 (branch direct_components) nao casou'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'calculate_order_consumption_by_grade: padroes globais por cor (component_color_defaults) aplicados no branch direct_components.';
END
$mig$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. component_colors_consistency_report — checks das regras globais (ccd_*)
--    Base: definição viva (20260910140000), 7 checks cpc_* preservados.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.component_colors_consistency_report()
 RETURNS TABLE(check_name text, severity text, item_count integer, sample text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT 'cpc_produto_inexistente'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(ts.name || ' · ' || c.cabedal_color, ' · ' ORDER BY ts.name), '—')
    FROM technical_sheet_component_colors c
    JOIN technical_sheets ts ON ts.id = c.sheet_id
    LEFT JOIN products p ON p.id = c.product_id
   WHERE p.id IS NULL;

  RETURN QUERY SELECT 'cpc_produto_inativo'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(ts.name || ' · ' || c.cabedal_color || ' → ' || p.name, ' · ' ORDER BY ts.name), '—')
    FROM technical_sheet_component_colors c
    JOIN technical_sheets ts ON ts.id = c.sheet_id
    JOIN products p ON p.id = c.product_id
   WHERE p.active = false;

  RETURN QUERY SELECT 'cpc_quantidade_invalida'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(ts.name || ' · ' || c.cabedal_color || ' (' || COALESCE(c.quantity_per_unit::text,'NULL') || ')', ' · ' ORDER BY ts.name), '—')
    FROM technical_sheet_component_colors c
    JOIN technical_sheets ts ON ts.id = c.sheet_id
   WHERE COALESCE(c.quantity_per_unit, 0) <= 0;

  RETURN QUERY SELECT 'cpc_linha_duplicada'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(nome || ' · ' || cor, ' · ' ORDER BY nome), '—')
    FROM (
      SELECT ts.name AS nome, c.cabedal_color AS cor
        FROM technical_sheet_component_colors c
        JOIN technical_sheets ts ON ts.id = c.sheet_id
       GROUP BY ts.name, c.cabedal_color, lower(btrim(extensions.unaccent(c.cabedal_color))), c.product_id
      HAVING count(*) > 1
    ) d;

  RETURN QUERY SELECT 'cpc_cor_orfa_grupo_predominante'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(ts.name || ' · "' || c.cabedal_color || '"', ' · ' ORDER BY ts.name), '—')
    FROM technical_sheet_component_colors c
    JOIN technical_sheets ts ON ts.id = c.sheet_id
   WHERE ts.cor_predominante_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM products p
        WHERE p.group_id = ts.cor_predominante_id
          AND COALESCE(p.color, '') <> ''
          AND lower(btrim(extensions.unaccent(p.color))) = lower(btrim(extensions.unaccent(c.cabedal_color))));

  RETURN QUERY SELECT 'cpc_flag_sem_mapeamento'::text, 'baixo'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM technical_sheets ts
   WHERE ts.component_colors_enabled = true
     AND NOT EXISTS (SELECT 1 FROM technical_sheet_component_colors c WHERE c.sheet_id = ts.id);

  RETURN QUERY SELECT 'cpc_flag_sem_grupo_predominante'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM technical_sheets ts
   WHERE ts.component_colors_enabled = true
     AND ts.cor_predominante_id IS NULL;

  -- ── Padrões GLOBAIS por cor (component_color_defaults, mig 20260928120000) ──

  -- Regra ativa apontando produto apagado/inativo: o motor IGNORA a regra
  -- (emite a linha original com warning) — corrigir a regra.
  RETURN QUERY SELECT 'ccd_produto_inexistente_inativo'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(g.name || ' · ' || d.cabedal_color, ' · ' ORDER BY g.name), '—')
    FROM component_color_defaults d
    JOIN product_groups g ON g.id = d.group_id
    LEFT JOIN products p ON p.id = d.product_id
   WHERE d.active = true
     AND (p.id IS NULL OR p.active = false);

  -- Regra apontando produto de OUTRO grupo: o lookup do motor exige
  -- p.group_id = d.group_id, então a regra nunca casa (no débito de tira
  -- viraria RAISE) — corrigir o produto da regra.
  RETURN QUERY SELECT 'ccd_produto_fora_do_grupo'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(g.name || ' · ' || d.cabedal_color || ' → ' || p.name, ' · ' ORDER BY g.name), '—')
    FROM component_color_defaults d
    JOIN product_groups g ON g.id = d.group_id
    JOIN products p ON p.id = d.product_id
   WHERE d.active = true
     AND p.group_id IS DISTINCT FROM d.group_id;

  -- Cor da regra que não existe (na normalização do motor) em NENHUMA paleta
  -- de grupo predominante vivo — provável typo; a regra nunca vai casar.
  RETURN QUERY SELECT 'ccd_cor_orfa'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(g.name || ' · "' || d.cabedal_color || '"', ' · ' ORDER BY g.name), '—')
    FROM component_color_defaults d
    JOIN product_groups g ON g.id = d.group_id
   WHERE d.active = true
     AND d.is_default = false
     AND NOT EXISTS (
       SELECT 1
         FROM products p
         JOIN technical_sheets ts ON ts.cor_predominante_id = p.group_id
        WHERE COALESCE(p.color, '') <> ''
          AND lower(btrim(extensions.unaccent(p.color))) = lower(btrim(extensions.unaccent(d.cabedal_color))));

  -- Ficha com 2+ direct_components no MESMO grupo com regra ativa: o motor
  -- COLAPSA somando as quantidades no SKU da regra — se as entradas eram
  -- ALTERNATIVAS (não aditivas), o consumo dobra. Configure a lista por-cor
  -- da ficha (Componentes por Cor) pra essas cores.
  RETURN QUERY SELECT 'ccd_duplicidade_variantes_na_ficha'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(nome || ' · ' || grupo || ' (' || n || ' variantes)', ' · ' ORDER BY nome), '—')
    FROM (
      SELECT ts.name AS nome, g.name AS grupo, count(DISTINCT p.id)::text AS n
        FROM technical_sheets ts
       CROSS JOIN LATERAL jsonb_array_elements(ts.direct_components) dc
        JOIN products p ON p.id::text = NULLIF(dc ->> 'product_id', '')
        JOIN product_groups g ON g.id = p.group_id
       WHERE jsonb_typeof(ts.direct_components) = 'array'
         AND EXISTS (SELECT 1 FROM component_color_defaults d
                      WHERE d.active = true AND d.group_id = p.group_id)
       GROUP BY ts.name, g.name
      HAVING count(DISTINCT p.id) > 1
    ) dup;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. run_consumption_parity_tests — +2 cases (18 → 20): regra global aplicada
--    e lookup normalizado. Patch de texto sobre o def vivo (mesma razão acima).
-- ────────────────────────────────────────────────────────────────────────────
DO $mig2$
DECLARE
  v_def    text;
  v_new    text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'run_consumption_parity_tests';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'run_consumption_parity_tests nao existe — migration fora de ordem';
  END IF;

  IF position('bygrade_padrao_global_por_cor' IN v_def) > 0 THEN
    RAISE NOTICE 'Cases de padrao global ja existem — nada a fazer.';
    RETURN;
  END IF;

  v_before := v_def;
  v_new := replace(v_def,
$a3$  case_name := 'reserva_gate_componentes_por_cor';$a3$,
$n3$  case_name := 'bygrade_padrao_global_por_cor';
  ok := v_bygrade ILIKE '%component_color_defaults%' AND v_bygrade ILIKE '%''component_color_default''%';
  message := 'by_grade deve aplicar a regra global grupo+cor (component_color_defaults, source component_color_default)'; RETURN NEXT;

  case_name := 'bygrade_padrao_global_normalizado';
  ok := v_bygrade ILIKE '%extensions.unaccent(d.cabedal_color)%';
  message := 'lookup da regra global deve ser accent/case-insensitive (extensions.unaccent)'; RETURN NEXT;

  case_name := 'reserva_gate_componentes_por_cor';$n3$);
  IF v_new = v_before THEN RAISE EXCEPTION 'patch parity (case reserva_gate) nao casou'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'run_consumption_parity_tests: +2 cases de padrao global por cor (total 20).';
END
$mig2$;
