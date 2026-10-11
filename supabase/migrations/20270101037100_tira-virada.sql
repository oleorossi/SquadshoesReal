-- tira_virada_20270101037100
--
-- VIRADA de specs/tira-material-de-estoque.md: a tira passa a ser material de
-- estoque como o solado. A partir daqui:
--   • salvar o PV nunca exige variante/receita/perfil/SKU oficial do Hub (R6): o
--     writer público delega para private.prepare_sale_order_item_straps_v2, que
--     resolve o SKU pela chave grupo + napa + cor e cria o que faltar (R2/R7/R7a);
--   • a tira entra no motor genérico de empenho/falta (R11): demanda do PV, adoção
--     pela OP (hybrid_debit_stock_for_order), separação e finalização (R12);
--   • a falta de tira "Comprar pronto" entra na compra genérica (R15) — só ela; a de
--     Fábrica/Prestador vai para o Ateliê (R16/R17, 20270101037000);
--   • custo da tira no par = metros × custo médio do SKU (R20);
--   • o motor antigo (demandas, fila, guards de produto/OC/estoque) para.
--     As tabelas/funções dele saem no DROP (migration própria, depois dos CSVs).
--
-- Também: R34 (metros marcados "comprado" na tela interina descontam da compra) e
-- R23 (migração dos PVs abertos — conferida pelo dono: PV-00195 e PV-00196; o
-- pv_origem gravado é padrão antigo e é descartado, a falta segue o grupo).
--
-- Funções com corpo de outras frentes (calculate_order_cost_item,
-- hybrid_debit_stock_for_order, compute_materials_per_pv) são PATCHEADAS sobre o
-- corpo vivo, com verificação de âncora — a etapa 2 de compras
-- (20270101036500) reescreve process_sale_order_purchase_shortages e não é tocada.

SELECT set_config('app.artisanal_strap_catalog_write', '1', true);

-- ═══ 1. O motor antigo para ════════════════════════════════════════════════

-- Fila e notificações do Hub.
DO $cron$
BEGIN
  PERFORM cron.unschedule(j.jobid)
     FROM cron.job j
    WHERE j.jobname IN ('artisanal-strap-demand-worker', 'artisanal-strap-purchase-order-notifications');
END
$cron$;

-- Guards que tratam produto de tira como "só pelo motor".
DROP TRIGGER IF EXISTS trg_guard_legacy_artisanal_product_insert_delete ON public.products;
DROP TRIGGER IF EXISTS trg_guard_legacy_artisanal_product_update ON public.products;
DROP TRIGGER IF EXISTS trg_guard_artisanal_strap_finished_product ON public.products;
DROP TRIGGER IF EXISTS trg_enforce_buy_ready_strass_product ON public.products;
DROP TRIGGER IF EXISTS trg_enqueue_strap_product_commercial_change ON public.products;
DROP TRIGGER IF EXISTS trg_enqueue_strap_product_stock_change ON public.products;
DROP TRIGGER IF EXISTS trg_audit_artisanal_strap_finished_product ON public.products;
DROP TRIGGER IF EXISTS trg_enqueue_strap_supplier_commercial_change ON public.suppliers;
DROP TRIGGER IF EXISTS trg_enrich_strap_finished_stock_movement ON public.stock_movements;
DROP TRIGGER IF EXISTS trg_z_guard_canonical_strap_stock_movement ON public.stock_movements;
DROP TRIGGER IF EXISTS trg_a_attach_strap_finished_movement ON public.material_reservations;
DROP TRIGGER IF EXISTS trg_settle_strap_finished_demand ON public.material_reservations;
DROP TRIGGER IF EXISTS trg_z_guard_strap_engine_reservation ON public.material_reservations;
DROP TRIGGER IF EXISTS trg_a_bind_strap_finished_before_finalize ON public.orders;
DROP TRIGGER IF EXISTS trg_bind_strap_finished_on_order_insert ON public.orders;
DROP TRIGGER IF EXISTS trg_guard_strap_purchase_order_item ON public.purchase_order_items;
DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_sale_order_confirm ON public.sale_orders;
DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_schedule_change ON public.production_schedule;
DROP TRIGGER IF EXISTS trg_aa_release_strap_demands_before_item_delete ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_enqueue_strap_catalog_color_change ON public.canonical_colors;

-- Gatilho de demanda por item: é CONSTRAINT TRIGGER citado por nome em
-- SET CONSTRAINTS (create_sale_order_atomic_pre_09100); fica até o DROP, vazio.
CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_item_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- tira_material_virada_20270101037100: motor de demandas de tira desligado.
  RETURN NULL;
END;
$function$;

-- Chamada por create/update/recompute_production_schedule: vira no-op.
DO $enqueue$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'enqueue_sale_order_strap_demands'
  LOOP
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION %s
       RETURNS uuid
       LANGUAGE plpgsql
       SECURITY DEFINER
       SET search_path TO 'public'
      AS $body$
      BEGIN
        -- tira_material_virada_20270101037100: motor de demandas de tira desligado.
        RETURN NULL;
      END;
      $body$;
    $f$, v_fn);
  END LOOP;
END
$enqueue$;

-- Produto de tira deixa de ser "só pelo motor": alocação, saldo reservado,
-- finalização e ajuste tratam a tira como qualquer material.
CREATE OR REPLACE FUNCTION public.product_requires_strap_engine_write(p_product_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- tira_material_virada_20270101037100: tira é material de estoque comum.
  SELECT false;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_stock_batch(p_items jsonb, p_enforce_reserved boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin','almoxarifado']) THEN
    RAISE EXCEPTION 'Somente Administrador/Almoxarifado pode ajustar estoque';
  END IF;
  IF jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'p_items deve ser array'; END IF;
  -- tira_material_virada_20270101037100: ajuste/inventário de tira é genérico e
  -- quita falta pelo caminho comum (R13).
  RETURN public.adjust_stock_batch_legacy_non_strap_202701(
    p_items,coalesce(p_enforce_reserved,false));
END;
$function$;

-- SKUs de tira deixam de ser "artesanais" (a compra genérica recusava is_artisanal).
UPDATE public.products p
   SET is_artisanal = false, updated_at = now()
  FROM public.product_groups g
 WHERE g.id = p.group_id
   AND coalesce(g.is_artisanal_strap, false)
   AND coalesce(p.is_artisanal, false);

-- ═══ 2. Writer, gatilhos e validação da ficha ══════════════════════════════

CREATE OR REPLACE FUNCTION public.prepare_sale_order_item_internal_straps(p_item jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- tira_material_virada_20270101037100: delega ao writer sem Hub.
  IF current_setting('app.strap_source_rpc', true) IS DISTINCT FROM '1'
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode preparar as tiras do PV';
  END IF;
  IF jsonb_typeof(p_item) <> 'object' THEN RAISE EXCEPTION 'Item do PV deve ser objeto'; END IF;
  RETURN private.prepare_sale_order_item_straps_v2(p_item, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line jsonb;
  v_lid text;
  v_src jsonb;
  v_pid uuid;
  v_gid uuid;
  v_ids text[] := ARRAY[]::text[];
BEGIN
  -- tira_material_virada_20270101037100: valida o snapshot do modelo novo
  -- (linha da ficha + SKU resolvido). A estrutura vem do writer.
  IF TG_OP = 'UPDATE'
     AND NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id THEN
    RAISE EXCEPTION
      'Item do PV nao pode ser movido para outro pedido; remova e recrie pelo writer atomico'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.material_variant_id IS NOT DISTINCT FROM OLD.material_variant_id
     AND NEW.color IS NOT DISTINCT FROM OLD.color
     AND NEW.strap_colors IS NOT DISTINCT FROM OLD.strap_colors
     AND NEW.strap_sourcing IS NOT DISTINCT FROM OLD.strap_sourcing THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(coalesce(NEW.strap_colors, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(NEW.strap_sourcing, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Snapshot de tiras do PV possui formato invalido';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(NEW.strap_colors, '[]'::jsonb))
  LOOP
    v_lid := coalesce(nullif(v_line ->> 'technical_strap_line_id', ''), '');
    IF v_lid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Tira "%" do item sem identificador estavel; salve o item pelo PV',
        coalesce(v_line ->> 'label', 'TIRA');
    END IF;
    IF v_lid = ANY(v_ids) THEN
      RAISE EXCEPTION 'Tira repetida no item do PV';
    END IF;
    v_ids := array_append(v_ids, v_lid);
    v_src := coalesce(NEW.strap_sourcing, '{}'::jsonb) -> v_lid;
    IF v_src IS NULL OR coalesce(v_src ->> 'product_id', '') = '' THEN
      RAISE EXCEPTION 'Tira "%" sem SKU de estoque resolvido; salve o item pelo PV',
        coalesce(v_line ->> 'label', 'TIRA');
    END IF;
    v_pid := (v_src ->> 'product_id')::uuid;
    v_gid := nullif(v_line ->> 'group_id', '')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.id = v_pid AND (v_gid IS NULL OR p.group_id = v_gid)
    ) THEN
      RAISE EXCEPTION 'SKU da tira "%" nao pertence ao grupo de estoque da ficha',
        coalesce(v_line ->> 'label', 'TIRA');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_version_and_guard_sale_order_item_strap_sourcing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_key text; v_value jsonb;
BEGIN
  -- tira_material_virada_20270101037100: versão + forma do snapshot novo
  -- (origem + SKU). Sem log/compromisso do motor antigo.
  IF TG_OP='UPDATE' AND NEW.strap_sourcing IS NOT DISTINCT FROM OLD.strap_sourcing THEN
    NEW.strap_sourcing_revision:=OLD.strap_sourcing_revision;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' AND coalesce(NEW.strap_sourcing, '{}'::jsonb)='{}'::jsonb THEN
    NEW.strap_sourcing_revision:=0;
    RETURN NEW;
  END IF;
  IF auth.role()<>'service_role'
     AND session_user NOT IN ('postgres','supabase_admin')
     AND current_setting('app.strap_source_rpc',true) IS DISTINCT FROM '1'
     AND NOT public.user_has_any_role(ARRAY['admin','gerente','comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode definir a tira do PV';
  END IF;
  IF TG_OP='UPDATE'
     AND current_setting('app.strap_source_rpc',true) IS DISTINCT FROM '1'
     AND current_setting('app.strap_source_admin_override',true) IS DISTINCT FROM '1'
     AND session_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'Atualizacao direta de strap_sourcing bloqueada; salve pelo PV';
  END IF;
  IF jsonb_typeof(NEW.strap_sourcing)<>'object' THEN
    RAISE EXCEPTION 'strap_sourcing deve ser objeto por UUID tecnico';
  END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(NEW.strap_sourcing) LOOP
    BEGIN PERFORM v_key::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Chave de linha tecnica invalida: %',v_key; END;
    IF jsonb_typeof(v_value)<>'object'
       OR coalesce(v_value->>'origin','') NOT IN ('comprar_pronto','fabrica','prestador')
       OR coalesce(v_value->>'product_id','') !~* '^[0-9a-f-]{36}$' THEN
      RAISE EXCEPTION 'Tira sem origem/SKU valido na linha %',v_key;
    END IF;
  END LOOP;
  NEW.strap_sourcing_revision := CASE WHEN TG_OP='INSERT' THEN 1
                                      ELSE coalesce(OLD.strap_sourcing_revision, 0) + 1 END;
  RETURN NEW;
END;
$function$;

-- Ficha: a linha de tira aponta o grupo de estoque; medida/família/identidade do
-- Hub deixam de ser exigidas (R4).
CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line jsonb;
  v_mode text;
  v_gid uuid;
  v_ids text[] := ARRAY[]::text[];
  v_lid text;
BEGIN
  -- tira_material_virada_20270101037100
  IF NEW.strap_colors IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.strap_colors) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array JSON';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    PERFORM private.validate_strap_material_policy(v_line - 'identity_basis');
    v_mode := nullif(v_line ->> 'color_mode', '');
    IF v_mode IS NOT NULL AND v_mode NOT IN ('follow_main', 'select_on_order') THEN
      RAISE EXCEPTION 'Linha de tira possui politica de cor invalida';
    END IF;
    v_lid := nullif(v_line ->> 'technical_strap_line_id', '');
    IF v_lid IS NOT NULL THEN
      IF v_lid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Linha de tira possui identificador invalido';
      END IF;
      IF v_lid = ANY(v_ids) THEN
        RAISE EXCEPTION 'Identificador de linha de tira repetido na ficha';
      END IF;
      v_ids := array_append(v_ids, v_lid);
    END IF;
    BEGIN
      v_gid := nullif(v_line ->> 'group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Grupo de estoque da tira invalido';
    END;
    IF v_gid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_groups g WHERE g.id = v_gid
    ) THEN
      RAISE EXCEPTION 'Grupo de estoque da tira nao existe';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ═══ 3. Tira no motor genérico de empenho/falta ════════════════════════════

-- Linhas de consumo de tira de um item (ou da parte de uma OP) no formato que o
-- hybrid_debit_stock_for_order consome.
CREATE OR REPLACE FUNCTION private.order_strap_consumption_items(
  p_item_id uuid,
  p_grade jsonb,
  p_quantity numeric
) RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id', n.product_id,
           'product_name', p.name,
           'required', n.required_m,
           'unit', 'm',
           'debit_mode', 'soft',
           'component', 'Tira',
           'source', 'strap',
           'matched_by', 'strap_sku'
         ) ORDER BY p.name), '[]'::jsonb)
    FROM (
      SELECT sn.product_id, sum(sn.required_m) AS required_m
        FROM public.sale_order_item_strap_needs(p_item_id, p_grade, p_quantity) sn
       GROUP BY sn.product_id
    ) n
    JOIN public.products p ON p.id = n.product_id
   WHERE p_item_id IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION private.order_strap_consumption_items(uuid, jsonb, numeric) FROM PUBLIC;

-- Só a tira "Comprar pronto" entra na necessidade de COMPRA (R15). Fábrica e
-- Prestador vão para o Ateliê. R34: metros marcados "comprado" na tela interina
-- (strap_buy_ready_purchases, se existir) descontam da compra.
CREATE OR REPLACE FUNCTION private.purchasable_strap_consumption_lines(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_out jsonb;
  v_has_interim boolean := to_regclass('public.strap_buy_ready_purchases') IS NOT NULL;
BEGIN
  IF p_item_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _strap_purchased_by_line (line_id uuid, purchased_m numeric) ON COMMIT DROP;
  TRUNCATE _strap_purchased_by_line;
  IF v_has_interim THEN
    EXECUTE 'INSERT INTO _strap_purchased_by_line
               SELECT technical_strap_line_id, sum(purchased_m)
                 FROM public.strap_buy_ready_purchases
                WHERE sale_order_item_id = $1
                GROUP BY 1'
      USING p_item_id;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id', x.product_id,
           'product_name', p.name,
           'color', coalesce(p.color, ''),
           'required', x.required_m,
           'unit', 'm',
           'component', 'Tira',
           'matched_by', 'strap_sku'
         )), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT sn.product_id,
             sum(greatest(sn.required_m - coalesce(b.purchased_m, 0), 0)) AS required_m
        FROM public.sale_order_item_strap_needs(p_item_id) sn
        LEFT JOIN _strap_purchased_by_line b ON b.line_id = sn.technical_strap_line_id
       WHERE sn.origin = 'comprar_pronto'
       GROUP BY sn.product_id
    ) x
    JOIN public.products p ON p.id = x.product_id
   WHERE x.required_m > 0;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION private.purchasable_strap_consumption_lines(uuid) FROM PUBLIC;

-- Demanda do PV (empenho na aprovação): consumo da ficha + tira do snapshot.
CREATE OR REPLACE FUNCTION public.sale_order_material_demand_lines(p_sale_order_id uuid)
 RETURNS TABLE(product_id uuid, required numeric, component text, source text, sale_order_item_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_grade jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_pid uuid;
  v_req numeric;
  v_comp text;
  v_src text;
  v_strap record;
BEGIN
  -- tira_material_virada_20270101037100: a tira entra pelo snapshot do item
  -- (sale_order_item_strap_needs), não mais pelo ledger do Hub.
  FOR v_item IN
    SELECT *
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
       AND soi.production_excluded_at IS NULL
  LOOP
    SELECT COALESCE(
             jsonb_object_agg(
               g.key,
               (
                 COALESCE(NULLIF(g.value, '')::numeric, 0)
                 * GREATEST(COALESCE(v_item.fichas, 1), 1)
               )::numeric
             ),
             '{}'::jsonb
           )
      INTO v_grade
      FROM jsonb_each_text(COALESCE(v_item.grade, '{}'::jsonb)) g
     WHERE COALESCE(NULLIF(g.value, '')::numeric, 0) > 0;

    IF v_grade IS NULL OR v_grade = '{}'::jsonb THEN
      v_grade := COALESCE(v_item.grade, '{}'::jsonb);
    END IF;

    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_lines := public.calculate_order_consumption_by_grade(
        v_item.reference_id,
        v_grade,
        v_item.color,
        v_item.material_variant_id
      );
    ELSE
      v_lines := public.calculate_order_consumption(
        v_item.reference_id,
        COALESCE(v_item.quantity, 0),
        v_item.color,
        NULL,
        v_item.material_variant_id
      );
    END IF;

    IF v_lines IS NOT NULL AND jsonb_typeof(v_lines) = 'array' THEN
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
      LOOP
        IF (v_line ->> 'matched_by') = 'color_mismatch' THEN
          CONTINUE;
        END IF;
        v_pid := NULLIF(v_line ->> 'product_id', '')::uuid;
        IF v_pid IS NULL THEN
          CONTINUE;
        END IF;
        v_comp := COALESCE(v_line ->> 'component', '');
        v_src := COALESCE(v_line ->> 'source', '');
        IF v_comp = 'Solado' OR v_src IN ('primary_sole', 'variant_sole') THEN
          CONTINUE;
        END IF;
        v_req := COALESCE(NULLIF(v_line ->> 'required', '')::numeric, 0);
        IF v_req <= 0 THEN
          CONTINUE;
        END IF;

        product_id := v_pid;
        required := v_req;
        component := v_comp;
        source := v_src;
        sale_order_item_id := v_item.id;
        RETURN NEXT;
      END LOOP;
    END IF;

    FOR v_strap IN
      SELECT sn.product_id, sum(sn.required_m) AS required_m
        FROM public.sale_order_item_strap_needs(v_item.id) sn
       GROUP BY sn.product_id
    LOOP
      product_id := v_strap.product_id;
      required := v_strap.required_m;
      component := 'Tira';
      source := 'strap';
      sale_order_item_id := v_item.id;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$function$;

-- OP adota a tira do PV junto com os outros materiais.
DO $patch_hybrid$
DECLARE
  v_fn regprocedure := 'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure;
  v_def text := pg_get_functiondef('public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure);
  v_old text := $old$  v_items := public.filter_caixa_by_packaging_mode(v_items, v_packaging_mode);$old$;
  v_new text := $new$  v_items := public.filter_caixa_by_packaging_mode(v_items, v_packaging_mode);
  -- tira_material_virada_20270101037100: a tira do item entra como material soft
  -- (adota o empenho do PV como os demais).
  v_items := coalesce(v_items, '[]'::jsonb)
    || private.order_strap_consumption_items(v_soi_id, v_eff_grade, p_order_quantity);$new$;
  v_hits integer;
BEGIN
  IF position('tira_material_virada_20270101037100' IN v_def) > 0 THEN RETURN; END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'hybrid_debit_stock_for_order: ancora de packaging nao encontrada (hits=%)', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_hybrid$;

-- Necessidade de compra por PV: tira "Comprar pronto" entra junto do consumo.
DO $patch_cmpv$
DECLARE
  v_def text := pg_get_functiondef('public.compute_materials_per_pv(uuid[])'::regprocedure);
  v_old text := $old$),so.packaging_mode),'[]'::jsonb) AS cons$old$;
  v_new text := $new$),so.packaging_mode),'[]'::jsonb)
        -- tira_material_virada_20270101037100: tira Comprar pronto (R15).
        || private.purchasable_strap_consumption_lines(soi.id) AS cons$new$;
  v_hits integer;
BEGIN
  IF position('tira_material_virada_20270101037100' IN v_def) > 0 THEN RETURN; END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'compute_materials_per_pv: ancora de consumo nao encontrada (hits=%)', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_cmpv$;

-- ═══ 4. Custo: metros × custo médio do SKU (R20) ═══════════════════════════
DO $patch_cost$
DECLARE
  v_def text := pg_get_functiondef('public.calculate_order_cost_item(uuid,boolean)'::regprocedure);
  v_start_marker text := $m$  FOR v_strap IN
    SELECT sn.product_id, sn.required_m
      FROM public.order_strap_needs(v_strap_colors, v_qty, v_grade) sn$m$;
  v_end_marker text := $m$    v_warnings := array_append(v_warnings, 'strap_color_not_registered:' || COALESCE(v_strap.color, '?'));
  END LOOP;
$m$;
  v_new text := $new$  -- tira_material_virada_20270101037100: item com SKU de tira resolvido no
  -- snapshot custa metros × custo médio do SKU (R20). Item antigo (sem SKU no
  -- snapshot) mantém o cálculo por grupo + cor, sem o custo planejado do Hub.
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_items si
      CROSS JOIN LATERAL jsonb_each(coalesce(si.strap_sourcing, '{}'::jsonb)) src
     WHERE si.id = v_item.id
       AND coalesce(src.value ->> 'product_id', '') <> ''
  ) THEN
    FOR v_strap IN
      SELECT sn.product_id, sum(sn.required_m) AS required_m
        FROM public.sale_order_item_strap_needs(v_item.id) sn
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_cons) c
          WHERE (c ->> 'product_id') IS NOT NULL
            AND (c ->> 'product_id')::uuid = sn.product_id)
       GROUP BY sn.product_id
    LOOP
      SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = v_strap.product_id;
      v_required_in_product_unit := public.convert_to_product_unit(
        v_strap.required_m, 'm', COALESCE(v_prod.unit, ''));
      IF v_required_in_product_unit IS NULL THEN
        v_warnings := array_append(v_warnings, 'unit_mismatch:' || COALESCE(v_prod.name, '?'));
        v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
          'product_id', v_strap.product_id,
          'product_name', v_prod.name,
          'component', 'Tira',
          'required', v_strap.required_m,
          'consumption_unit', 'm',
          'product_unit', v_prod.unit,
          'unit_price', COALESCE(v_prod.unit_price, 0),
          'subtotal', 0,
          'conversion_warning', 'unit_mismatch',
          'strap_price_source', 'average_cost');
        CONTINUE;
      END IF;
      v_subtotal := COALESCE(v_prod.unit_price, 0) * v_required_in_product_unit;
      v_material := v_material + v_subtotal;
      v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
        'product_id', v_strap.product_id,
        'product_name', v_prod.name,
        'component', 'Tira',
        'required', v_required_in_product_unit,
        'consumption_unit', 'm',
        'product_unit', v_prod.unit,
        'unit_price', COALESCE(v_prod.unit_price, 0),
        'subtotal', v_subtotal,
        'strap_price_source', 'average_cost');
    END LOOP;
  ELSE
    FOR v_strap IN
      SELECT sn.product_id, sn.required_m
        FROM public.order_strap_needs(v_strap_colors, v_qty, v_grade) sn
       WHERE sn.product_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_cons) c
            WHERE (c ->> 'product_id') IS NOT NULL
              AND (c ->> 'product_id')::uuid = sn.product_id)
    LOOP
      SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = v_strap.product_id;
      v_required_in_product_unit := public.convert_to_product_unit(
        v_strap.required_m, 'm', COALESCE(v_prod.unit, ''));
      IF v_required_in_product_unit IS NULL THEN
        v_warnings := array_append(v_warnings, 'unit_mismatch:' || COALESCE(v_prod.name, '?'));
        CONTINUE;
      END IF;
      v_subtotal := COALESCE(v_prod.unit_price, 0) * v_required_in_product_unit;
      v_material := v_material + v_subtotal;
      v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
        'product_id', v_strap.product_id,
        'product_name', v_prod.name,
        'component', 'Tira',
        'required', v_required_in_product_unit,
        'consumption_unit', 'm',
        'product_unit', v_prod.unit,
        'unit_price', COALESCE(v_prod.unit_price, 0),
        'subtotal', v_subtotal,
        'strap_price_source', 'catalog_unit_price');
    END LOOP;

    FOR v_strap IN
      SELECT DISTINCT sn.color AS color
        FROM public.order_strap_needs(v_strap_colors, v_qty, v_grade) sn
       WHERE sn.product_id IS NULL AND sn.required_m > 0
    LOOP
      v_warnings := array_append(v_warnings, 'strap_color_not_registered:' || COALESCE(v_strap.color, '?'));
    END LOOP;
  END IF;
$new$;
  v_start integer;
  v_end integer;
BEGIN
  IF position('tira_material_virada_20270101037100' IN v_def) > 0 THEN RETURN; END IF;
  v_start := strpos(v_def, v_start_marker);
  v_end := strpos(v_def, v_end_marker);
  IF v_start = 0 OR v_end = 0 OR v_end < v_start THEN
    RAISE EXCEPTION 'calculate_order_cost_item: bloco de tira nao encontrado (start=%, end=%)', v_start, v_end;
  END IF;
  v_end := v_end + length(v_end_marker);
  EXECUTE substr(v_def, 1, v_start - 1) || v_new || substr(v_def, v_end);
END
$patch_cost$;

-- ═══ 5. Ateliê: origem da falta vem do PV (não de marca na reserva) ═══════
CREATE OR REPLACE FUNCTION private.sale_order_strap_product_origin(p_sale_order_id uuid, p_product_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Mesmo SKU em linhas de origens diferentes: Comprar pronto vence (a compra
  -- cobre), depois Fábrica, depois Prestador.
  SELECT min(src.value ->> 'origin')
    FROM public.sale_order_items i
    CROSS JOIN LATERAL jsonb_each(coalesce(i.strap_sourcing, '{}'::jsonb)) src
   WHERE i.sale_order_id = p_sale_order_id
     AND i.production_excluded_at IS NULL
     AND src.value ->> 'product_id' = p_product_id::text;
$function$;

REVOKE ALL ON FUNCTION private.sale_order_strap_product_origin(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.list_atelier_strap_shortages()
 RETURNS TABLE(
   sale_order_id uuid, order_number text, client_name text,
   product_id uuid, product_name text, group_id uuid, group_name text,
   origin text, color text, napa_group_id uuid, napa_group_name text,
   needed_m numeric, reserved_m numeric, shortage_m numeric, in_progress_m numeric, to_produce_m numeric,
   yield_m_per_m numeric, labor_cost_per_m numeric, default_contractor_id uuid, default_contractor_name text,
   napa_product_id uuid, napa_product_name text, napa_stock_m numeric, napa_unit_price numeric, napa_supplier_name text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- tira_material_virada_20270101037100
  WITH res AS (
    SELECT coalesce(mr.sale_order_id, o.sale_order_id) AS sale_order_id,
           mr.product_id,
           sum(greatest(coalesce(mr.quantity_reserved, 0) - coalesce(mr.quantity_consumed, 0), 0)) AS reserved_m,
           sum(coalesce(mr.quantity_short, 0)) AS shortage_m
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
      JOIN public.products p ON p.id = mr.product_id
      JOIN public.product_groups g ON g.id = p.group_id AND coalesce(g.is_artisanal_strap, false)
     WHERE mr.status IN ('reserved', 'partially_consumed')
       AND public.material_reservation_is_pv_managed(mr)
     GROUP BY 1, 2
  ), res_origin AS (
    SELECT r.*, private.sale_order_strap_product_origin(r.sale_order_id, r.product_id) AS origin
      FROM res r
  ), jobs AS (
    SELECT j.sale_order_id, j.product_id,
           sum(greatest(j.strap_m - j.received_m, 0)) AS in_progress_m
      FROM public.strap_atelier_jobs j
     WHERE j.status IN ('aberto', 'recebido_parcial')
     GROUP BY 1, 2
  ), base AS (
    SELECT r.*, coalesce(j.in_progress_m, 0) AS in_progress_m,
           private.strap_product_napa_group(r.product_id, r.sale_order_id) AS napa_group_id
      FROM res_origin r
      LEFT JOIN jobs j ON j.sale_order_id = r.sale_order_id AND j.product_id = r.product_id
     WHERE r.origin IN ('fabrica', 'prestador')
       AND (r.shortage_m > 0 OR coalesce(j.in_progress_m, 0) > 0)
  )
  SELECT b.sale_order_id, so.order_number, coalesce(nullif(c.nome_fantasia, ''), c.razao_social),
         b.product_id, p.name, g.id, g.name, b.origin, p.color, b.napa_group_id, ng.name,
         round(b.reserved_m + b.shortage_m, 4), round(b.reserved_m, 4), round(b.shortage_m, 4),
         round(b.in_progress_m, 4), round(greatest(b.shortage_m - b.in_progress_m, 0), 4),
         y.yield_m_per_m, g.strap_labor_cost_per_m, g.strap_default_contractor_id, ct.name,
         np.id, np.name, np.quantity, coalesce(nullif(np.purchase_price, 0), np.unit_price), sup.name
    FROM base b
    JOIN public.sale_orders so ON so.id = b.sale_order_id
    LEFT JOIN public.clients c ON c.id = so.client_id
    JOIN public.products p ON p.id = b.product_id
    JOIN public.product_groups g ON g.id = p.group_id
    LEFT JOIN public.product_groups ng ON ng.id = b.napa_group_id
    LEFT JOIN public.strap_group_napa_yields y ON y.strap_group_id = g.id AND y.napa_group_id = b.napa_group_id
    LEFT JOIN public.contractors ct ON ct.id = g.strap_default_contractor_id
    LEFT JOIN public.products np ON np.id = private.strap_napa_product_for(b.product_id, b.napa_group_id)
    LEFT JOIN public.suppliers sup ON sup.id = coalesce(np.supplier_id, np.preferred_supplier_id)
   WHERE public.is_approved_user()
     AND so.deleted_at IS NULL
   ORDER BY so.order_number, g.name, p.name;
$function$;

-- ═══ 6. Migração dos PVs abertos (R23, conferida pelo dono — R24) ═════════
CREATE OR REPLACE FUNCTION private.migrate_open_pv_straps_to_material()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pv record;
  v_item public.sale_order_items%ROWTYPE;
  v_clean jsonb;
  v_prep jsonb;
  v_report jsonb := '[]'::jsonb;
  v_items_done integer;
  v_cancelled integer;
  v_commit jsonb;
  v_adopted integer;
  v_created jsonb;
BEGIN
  PERFORM set_config('app.strap_source_rpc', '1', true);
  PERFORM set_config('app.strap_force_revalidate', '1', true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  FOR v_pv IN
    SELECT so.id, so.order_number, so.status
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Rascunho', 'Pendente', 'Aprovado', 'Em Produção')
       AND EXISTS (
         SELECT 1 FROM public.sale_order_items i
          WHERE i.sale_order_id = so.id
            AND jsonb_typeof(i.strap_colors) = 'array'
            AND jsonb_array_length(i.strap_colors) > 0
       )
     ORDER BY so.order_number
  LOOP
    v_items_done := 0;
    v_created := '[]'::jsonb;
    FOR v_item IN
      SELECT * FROM public.sale_order_items i
       WHERE i.sale_order_id = v_pv.id
         AND jsonb_typeof(i.strap_colors) = 'array'
         AND jsonb_array_length(i.strap_colors) > 0
       ORDER BY i.created_at, i.id
    LOOP
      -- pv_origem gravado é o padrão automático do writer antigo (decisão do dono).
      SELECT coalesce(jsonb_agg(l.value - 'pv_origem' ORDER BY l.ord), '[]'::jsonb)
        INTO v_clean
        FROM jsonb_array_elements(v_item.strap_colors) WITH ORDINALITY l(value, ord);
      v_prep := private.prepare_sale_order_item_straps_v2(
        jsonb_build_object(
          'id', v_item.id,
          'reference_id', v_item.reference_id,
          'material_variant_id', v_item.material_variant_id,
          'color', v_item.color,
          'quantity', v_item.quantity,
          'grade', v_item.grade,
          'strap_colors', v_clean,
          'strap_sourcing', '{}'::jsonb
        ),
        false
      );
      UPDATE public.sale_order_items
         SET strap_colors = v_prep -> 'item' -> 'strap_colors',
             strap_sourcing = v_prep -> 'item' -> 'strap_sourcing'
       WHERE id = v_item.id;
      v_created := v_created || coalesce(v_prep -> 'created_skus', '[]'::jsonb);
      v_items_done := v_items_done + 1;
    END LOOP;

    -- Demandas do Hub deixam de valer.
    v_cancelled := 0;
    BEGIN
      UPDATE public.sale_order_strap_demands d
         SET status = 'cancelled', is_current = false
       WHERE d.sale_order_id = v_pv.id
         AND coalesce(d.status, '') NOT IN ('cancelled', 'superseded');
      GET DIAGNOSTICS v_cancelled = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_cancelled := -1;
    END;

    v_commit := NULL;
    v_adopted := 0;
    IF v_pv.status IN ('Aprovado', 'Em Produção') THEN
      -- Empenho + falta da tira (motor genérico).
      v_commit := public.commit_sale_order_material_demand(v_pv.id);
      -- OPs já criadas não passaram pela tira: a reserva do PV vai para a 1ª OP
      -- do item que usa o SKU (separação e finalização enxergam a OP).
      UPDATE public.material_reservations mr
         SET order_id = target.order_id,
             metadata = coalesce(mr.metadata, '{}'::jsonb) || jsonb_build_object(
               'adopted_order_id', target.order_id, 'component', 'Tira', 'source', 'strap'),
             updated_at = now()
        FROM (
          SELECT DISTINCT ON (sn.product_id) sn.product_id, o.id AS order_id
            FROM public.sale_order_items i
            CROSS JOIN LATERAL public.sale_order_item_strap_needs(i.id) sn
            JOIN public.orders o ON o.sale_order_item_id = i.id AND o.deleted_at IS NULL
           WHERE i.sale_order_id = v_pv.id
           ORDER BY sn.product_id, o.created_at, o.id
        ) target
       WHERE mr.sale_order_id = v_pv.id
         AND mr.order_id IS NULL
         AND mr.product_id = target.product_id
         AND mr.status IN ('reserved', 'partially_consumed')
         AND coalesce(mr.metadata ->> 'kind', '') = 'pv_commitment';
      GET DIAGNOSTICS v_adopted = ROW_COUNT;
    END IF;

    v_report := v_report || jsonb_build_array(jsonb_build_object(
      'pv', v_pv.order_number,
      'status', v_pv.status,
      'items', v_items_done,
      'demands_cancelled', v_cancelled,
      'skus_created', v_created,
      'commit', v_commit,
      'adopted_reservations', v_adopted
    ));
  END LOOP;
  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION private.migrate_open_pv_straps_to_material() FROM PUBLIC;

DO $migrate$
DECLARE
  v_report jsonb;
BEGIN
  v_report := private.migrate_open_pv_straps_to_material();
  RAISE NOTICE 'tira_material_virada: %', v_report;
END
$migrate$;
