-- Auditoria de motores Fase 2 — Pacote P5 (F4-1 + F6-2, mesma malha)
--
-- CAUSA RAIZ
-- ----------
-- A invalidação tripla (sale_orders.costs_dirty_at + technical_sheet_snapshots.
-- outdated_at + sale_orders.reservations_outdated_at) existia SÓ em dois pontos:
-- tg_mark_so_costs_dirty_from_sheet (technical_sheets, 15 colunas) e
-- tg_mark_so_costs_dirty_from_bom (sheet_materials). Todas as fontes satélites
-- que o motor de consumo/custeio realmente lê ficaram FORA do grafo:
--
--   (F4-1) 5 tabelas de lista POR COR (technical_sheet_component_colors,
--          _insole_colors, _lining_colors, _palmilha_colors, _sole_colors),
--          sole_technical_specs (área de forro/palmilha por numeração),
--          sole_standard_items_consumption (colas do solado),
--          component_sheets (largura da conversão dm²->m),
--          reference_material_variants — ZERO triggers de invalidação.
--          Efeito vivo: OP debita snapshot de ficha ANTIGA com badge verde
--          (PV-00146 ABS MARROM; PV-00140 NAPA SOFT-COGUMELO).
--
--   (F6-2) trg_mark_so_costs_dirty_from_product_price só alcançava PVs via
--          sheet_materials/direct_components — materiais resolvidos por GRUPO
--          (upper/lining/insole/fachete), pins, tiras (strap_colors), solado e
--          itens-padrão nunca marcavam dirty (NAPA SUDANI/EVA 3MM/Tira chata no
--          PV-00146). O UPDATE OF do trigger da ficha não incluía
--          upper_material_product_id, lining_material_product_id, sole_group_id,
--          insole_ready_made, sole_drives_consumption; o self não cobria
--          packaging_mode; cost_policies não tinha trigger nenhum.
--
-- Além disso, hybrid_debit_stock_for_order seleciona o snapshot SEM olhar
-- outdated_at — o congelamento é por design, mas o débito de snapshot
-- desatualizado era 100% silencioso. Passa a emitir WARNING + flag no retorno
-- (não bloqueia).
--
-- FK-safe: os helpers só atualizam sale_orders e technical_sheet_snapshots
-- (nunca technical_sheets), então rows com shoe_category_id órfão não abortam.
-- ⚠ NÃO mexe em products.reserved_stock (tg de material_reservations cuida).
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Sem backfill de dados.

-- ============================================================================
-- 1. Helpers de invalidação (corpo espelha tg_mark_so_costs_dirty_from_sheet)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_pv_costs_dirty_for_sheet(p_sheet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_sheet_id IS NULL THEN
    RETURN;
  END IF;

  -- recalcula custo dos PVs ativos que usam essa ficha (process_dirty_order_costs
  -- pula terminais, preservando o snapshot congelado).
  UPDATE public.sale_orders so
     SET costs_dirty_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
      WHERE soi.reference_id = p_sheet_id
   )
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho');

  -- snapshot congelado fica desatualizado (alimenta o PvOutdatedBadge e o
  -- aviso do hybrid_debit abaixo).
  UPDATE public.technical_sheet_snapshots
     SET outdated_at = now()
   WHERE sheet_id = p_sheet_id
     AND outdated_at IS NULL;

  -- reservas de material também precisam reavaliar.
  UPDATE public.sale_orders so
     SET reservations_outdated_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
      WHERE soi.reference_id = p_sheet_id
   )
     AND so.status IN ('Pendente', 'Aprovado', 'Em Produção');
END;
$function$;

-- Mapeia um PRODUTO-solado para as fichas que o usam (direto, por grupo ou via
-- lista por cor) e invalida cada uma.
CREATE OR REPLACE FUNCTION public.mark_pv_costs_dirty_for_sole(p_sole_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_sheet uuid;
BEGIN
  IF p_sole_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.group_id INTO v_group_id FROM public.products p WHERE p.id = p_sole_product_id;

  FOR v_sheet IN
    SELECT ts.id FROM public.technical_sheets ts
     WHERE ts.primary_sole_id = p_sole_product_id
        OR (v_group_id IS NOT NULL AND ts.sole_group_id = v_group_id)
    UNION
    SELECT tsc.sheet_id FROM public.technical_sheet_sole_colors tsc
     WHERE tsc.sole_product_id = p_sole_product_id
        OR (v_group_id IS NOT NULL AND tsc.sole_group_id = v_group_id)
  LOOP
    PERFORM public.mark_pv_costs_dirty_for_sheet(v_sheet);
  END LOOP;
END;
$function$;

-- ============================================================================
-- 2. Trigger functions das tabelas satélites
-- ============================================================================

-- 5 tabelas *_colors (todas têm sheet_id).
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_sheet_satellite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- UPDATE sem mudança real (re-save da UI) não invalida nada.
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;

  PERFORM public.mark_pv_costs_dirty_for_sheet(COALESCE(NEW.sheet_id, OLD.sheet_id));
  IF TG_OP = 'UPDATE' AND NEW.sheet_id IS DISTINCT FROM OLD.sheet_id THEN
    PERFORM public.mark_pv_costs_dirty_for_sheet(OLD.sheet_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- reference_material_variants (coluna reference_id).
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_variant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;

  PERFORM public.mark_pv_costs_dirty_for_sheet(COALESCE(NEW.reference_id, OLD.reference_id));
  IF TG_OP = 'UPDATE' AND NEW.reference_id IS DISTINCT FROM OLD.reference_id THEN
    PERFORM public.mark_pv_costs_dirty_for_sheet(OLD.reference_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- sole_technical_specs (área de forro/palmilha/fachete por numeração; sole_id).
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_sole_spec()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;

  PERFORM public.mark_pv_costs_dirty_for_sole(COALESCE(NEW.sole_id, OLD.sole_id));
  IF TG_OP = 'UPDATE' AND NEW.sole_id IS DISTINCT FROM OLD.sole_id THEN
    PERFORM public.mark_pv_costs_dirty_for_sole(OLD.sole_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- sole_standard_items_consumption (itens-padrão do solado: colas; sole_product_id).
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_sole_std_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;

  PERFORM public.mark_pv_costs_dirty_for_sole(COALESCE(NEW.sole_product_id, OLD.sole_product_id));
  IF TG_OP = 'UPDATE' AND NEW.sole_product_id IS DISTINCT FROM OLD.sole_product_id THEN
    PERFORM public.mark_pv_costs_dirty_for_sole(OLD.sole_product_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- component_sheets: largura/unidade/perda dirigem a conversão dm²->unidade
-- física (mudança de largura muda o consumo convertido ~100× no caso extremo).
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_component_sheet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
  v_group_id   uuid;
  v_group_name text;
  v_sheet      uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.dimensions_width  IS NOT DISTINCT FROM OLD.dimensions_width
     AND NEW.dimensions_length IS NOT DISTINCT FROM OLD.dimensions_length
     AND NEW.dimensions_unit   IS NOT DISTINCT FROM OLD.dimensions_unit
     AND NEW.waste_pct         IS NOT DISTINCT FROM OLD.waste_pct THEN
    RETURN NEW;
  END IF;

  v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  v_group_id   := COALESCE(NEW.group_id, OLD.group_id);
  IF v_group_id IS NULL AND v_product_id IS NOT NULL THEN
    SELECT p.group_id INTO v_group_id FROM public.products p WHERE p.id = v_product_id;
  END IF;
  IF v_group_id IS NOT NULL THEN
    SELECT pg.name INTO v_group_name FROM public.product_groups pg WHERE pg.id = v_group_id;
  END IF;

  FOR v_sheet IN
    -- BOM que referencia o produto da ficha de componente
    SELECT sm.sheet_id FROM public.sheet_materials sm
     WHERE v_product_id IS NOT NULL AND sm.product_id = v_product_id
    UNION
    -- pins de cabedal/forro
    SELECT ts.id FROM public.technical_sheets ts
     WHERE v_product_id IS NOT NULL
       AND (ts.upper_material_product_id = v_product_id
            OR ts.lining_material_product_id = v_product_id)
    UNION
    -- materiais resolvidos por GRUPO (nome exato, como resolve_material_product)
    SELECT ts.id FROM public.technical_sheets ts
     WHERE v_group_name IS NOT NULL
       AND v_group_name IN (ts.upper_material, ts.lining_material,
                            ts.insole_material, ts.fachete_material)
    UNION
    -- listas por cor que apontam o produto/grupo
    SELECT tcc.sheet_id FROM public.technical_sheet_component_colors tcc
     WHERE v_product_id IS NOT NULL AND tcc.product_id = v_product_id
    UNION
    SELECT tpc.sheet_id FROM public.technical_sheet_palmilha_colors tpc
     WHERE (v_product_id IS NOT NULL AND tpc.palmilha_product_id = v_product_id)
        OR (v_group_id IS NOT NULL AND tpc.palmilha_group_id = v_group_id)
  LOOP
    PERFORM public.mark_pv_costs_dirty_for_sheet(v_sheet);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- cost_policies: política é GLOBAL e afeta só o CUSTO (não a geometria de
-- consumo) → marca costs_dirty de todos os PVs não-terminais, sem invalidar
-- snapshot/reserva.
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_cost_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NEW;
  END IF;

  UPDATE public.sale_orders so
     SET costs_dirty_at = now()
   WHERE so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Faturado', 'Expedido',
                           'Concluído', 'Concluido', 'Finalizado sem NF', 'Finalizado s/ NF');

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ============================================================================
-- 3. Triggers nas tabelas satélites
-- ============================================================================

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_component_colors ON public.technical_sheet_component_colors;
CREATE TRIGGER trg_mark_so_costs_dirty_from_component_colors
AFTER INSERT OR UPDATE OR DELETE ON public.technical_sheet_component_colors
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet_satellite();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_insole_colors ON public.technical_sheet_insole_colors;
CREATE TRIGGER trg_mark_so_costs_dirty_from_insole_colors
AFTER INSERT OR UPDATE OR DELETE ON public.technical_sheet_insole_colors
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet_satellite();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_lining_colors ON public.technical_sheet_lining_colors;
CREATE TRIGGER trg_mark_so_costs_dirty_from_lining_colors
AFTER INSERT OR UPDATE OR DELETE ON public.technical_sheet_lining_colors
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet_satellite();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_palmilha_colors ON public.technical_sheet_palmilha_colors;
CREATE TRIGGER trg_mark_so_costs_dirty_from_palmilha_colors
AFTER INSERT OR UPDATE OR DELETE ON public.technical_sheet_palmilha_colors
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet_satellite();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sole_colors ON public.technical_sheet_sole_colors;
CREATE TRIGGER trg_mark_so_costs_dirty_from_sole_colors
AFTER INSERT OR UPDATE OR DELETE ON public.technical_sheet_sole_colors
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet_satellite();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_variant ON public.reference_material_variants;
CREATE TRIGGER trg_mark_so_costs_dirty_from_variant
AFTER INSERT OR UPDATE OR DELETE ON public.reference_material_variants
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_variant();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sole_spec ON public.sole_technical_specs;
CREATE TRIGGER trg_mark_so_costs_dirty_from_sole_spec
AFTER INSERT OR UPDATE OR DELETE ON public.sole_technical_specs
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sole_spec();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sole_std_item ON public.sole_standard_items_consumption;
CREATE TRIGGER trg_mark_so_costs_dirty_from_sole_std_item
AFTER INSERT OR UPDATE OR DELETE ON public.sole_standard_items_consumption
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sole_std_item();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_component_sheet ON public.component_sheets;
CREATE TRIGGER trg_mark_so_costs_dirty_from_component_sheet
AFTER INSERT OR DELETE OR UPDATE OF dimensions_width, dimensions_length, dimensions_unit, waste_pct
ON public.component_sheets
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_component_sheet();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_cost_policy ON public.cost_policies;
CREATE TRIGGER trg_mark_so_costs_dirty_from_cost_policy
AFTER INSERT OR UPDATE OR DELETE ON public.cost_policies
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_cost_policy();

-- ============================================================================
-- 4. Colunas faltantes no UPDATE OF do trigger da ficha (F6-2 iii)
--    upper_material_product_id / lining_material_product_id (pins),
--    sole_group_id, insole_ready_made, sole_drives_consumption — todas mudam a
--    explosão de consumo e não disparavam a invalidação.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sheet ON public.technical_sheets;
CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet
AFTER UPDATE OF upper_material, upper_consumption, upper_consumption_per_size,
  lining_material, lining_consumption, insole_material, insole_consumption,
  sole_material, sole_consumption, components_accessories, lining_accessories,
  direct_components, custom_overhead, has_straps, strap_colors, assembly_time_minutes,
  upper_material_product_id, lining_material_product_id, sole_group_id,
  insole_ready_made, sole_drives_consumption
ON public.technical_sheets
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet();

-- ============================================================================
-- 5. Self-trigger do PV: packaging_mode muda a linha de caixa do custeio
--    (filter_caixa_by_packaging_mode) e não marcava dirty (F6-2 iv).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_self()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('Cancelado', 'Cancelada', 'Rascunho') THEN
    RETURN NEW;
  END IF;
  IF (OLD.total IS DISTINCT FROM NEW.total)
     OR (OLD.packaging_mode IS DISTINCT FROM NEW.packaging_mode)
     OR (OLD.status IS DISTINCT FROM NEW.status
         AND OLD.status IN ('Cancelado', 'Cancelada', 'Rascunho')) THEN
    NEW.costs_dirty_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_self ON public.sale_orders;
CREATE TRIGGER trg_mark_so_costs_dirty_self
BEFORE UPDATE OF total, status, packaging_mode ON public.sale_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_self();

-- ============================================================================
-- 6. Trigger de preço de produto: alcançar PVs por TODOS os caminhos que o
--    motor de custo realmente resolve (F6-2 i) — grupos por nome, pins,
--    listas por cor, solado (ficha + lista + itens-padrão), tiras (ficha e
--    item do PV) e variantes. Preço é lido VIVO pelo custeio, então aqui é só
--    costs_dirty (sem invalidar snapshot de consumo/reserva).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_product_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_name text;
BEGIN
  IF NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price THEN RETURN NEW; END IF;

  SELECT pg.name INTO v_group_name FROM public.product_groups pg WHERE pg.id = NEW.group_id;

  UPDATE public.sale_orders so SET costs_dirty_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
      WHERE soi.reference_id IN (
        -- BOM (caminho pré-existente)
        SELECT sm.sheet_id FROM public.sheet_materials sm WHERE sm.product_id = NEW.id
        UNION
        -- direct_components (caminho pré-existente)
        SELECT ts.id FROM public.technical_sheets ts
         WHERE ts.direct_components IS NOT NULL AND jsonb_typeof(ts.direct_components) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(ts.direct_components) AS dc
                        WHERE COALESCE(dc ->> 'product_id', dc ->> 'id') = NEW.id::text)
        UNION
        -- pins de cabedal/forro
        SELECT ts.id FROM public.technical_sheets ts
         WHERE ts.upper_material_product_id = NEW.id
            OR ts.lining_material_product_id = NEW.id
        UNION
        -- materiais resolvidos por GRUPO (nome exato, como resolve_material_product)
        SELECT ts.id FROM public.technical_sheets ts
         WHERE v_group_name IS NOT NULL
           AND v_group_name IN (ts.upper_material, ts.lining_material,
                                ts.insole_material, ts.fachete_material)
        UNION
        -- solado direto na ficha (produto ou grupo)
        SELECT ts.id FROM public.technical_sheets ts
         WHERE ts.primary_sole_id = NEW.id
            OR (NEW.group_id IS NOT NULL AND ts.sole_group_id = NEW.group_id)
        UNION
        -- listas por cor
        SELECT tsc.sheet_id FROM public.technical_sheet_sole_colors tsc
         WHERE tsc.sole_product_id = NEW.id
            OR (NEW.group_id IS NOT NULL AND tsc.sole_group_id = NEW.group_id)
        UNION
        SELECT tcc.sheet_id FROM public.technical_sheet_component_colors tcc
         WHERE tcc.product_id = NEW.id
        UNION
        SELECT tpc.sheet_id FROM public.technical_sheet_palmilha_colors tpc
         WHERE tpc.palmilha_product_id = NEW.id
            OR (NEW.group_id IS NOT NULL AND tpc.palmilha_group_id = NEW.group_id)
        UNION
        -- tiras da ficha (group_id dentro do JSONB strap_colors)
        SELECT ts.id FROM public.technical_sheets ts
         WHERE NEW.group_id IS NOT NULL
           AND ts.strap_colors IS NOT NULL AND jsonb_typeof(ts.strap_colors) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(ts.strap_colors) s
                        WHERE s ->> 'group_id' = NEW.group_id::text)
        UNION
        -- itens-padrão do solado (colas): NEW é o ITEM -> solados -> fichas
        SELECT ts.id FROM public.technical_sheets ts
          JOIN public.products sole
            ON sole.id = ts.primary_sole_id
            OR (ts.sole_group_id IS NOT NULL AND sole.group_id = ts.sole_group_id)
         WHERE EXISTS (SELECT 1 FROM public.sole_standard_items_consumption ssic
                        WHERE ssic.standard_item_id = NEW.id
                          AND ssic.sole_product_id = sole.id)
        UNION
        SELECT tsc.sheet_id FROM public.technical_sheet_sole_colors tsc
          JOIN public.products sole
            ON sole.id = tsc.sole_product_id
            OR (tsc.sole_group_id IS NOT NULL AND sole.group_id = tsc.sole_group_id)
         WHERE EXISTS (SELECT 1 FROM public.sole_standard_items_consumption ssic
                        WHERE ssic.standard_item_id = NEW.id
                          AND ssic.sole_product_id = sole.id)
        UNION
        -- variantes de material que pinam o produto ou o grupo
        SELECT rmv.reference_id FROM public.reference_material_variants rmv
         WHERE rmv.upper_material_product_id = NEW.id
            OR rmv.lining_material_product_id = NEW.id
            OR rmv.insole_material_product_id = NEW.id
            OR rmv.sole_material_product_id = NEW.id
            OR (NEW.group_id IS NOT NULL
                AND (rmv.upper_material_group_id = NEW.group_id
                     OR rmv.lining_material_group_id = NEW.group_id
                     OR rmv.insole_material_group_id = NEW.group_id))
      )
   )
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Faturado', 'Expedido', 'Concluído', 'Concluido', 'Finalizado sem NF', 'Finalizado s/ NF');

  -- tiras escolhidas no ITEM do PV (strap_colors do sale_order_items)
  IF NEW.group_id IS NOT NULL THEN
    UPDATE public.sale_orders so SET costs_dirty_at = now()
     WHERE so.id IN (
       SELECT DISTINCT soi.sale_order_id
         FROM public.sale_order_items soi
        WHERE soi.strap_colors IS NOT NULL AND jsonb_typeof(soi.strap_colors) = 'array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(soi.strap_colors) s
                       WHERE s ->> 'group_id' = NEW.group_id::text)
     )
       AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Faturado', 'Expedido', 'Concluído', 'Concluido', 'Finalizado sem NF', 'Finalizado s/ NF');
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================================
-- 7. hybrid_debit_stock_for_order: débito de snapshot desatualizado deixa de
--    ser silencioso — WARNING no log + snapshot_outdated_at no retorno.
--    (Congelamento continua por design; NÃO bloqueia.)
--    Diff mínimo sobre a definição viva; resto do corpo inalterado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(p_reference_id uuid, p_order_quantity numeric, p_color text, p_order_id uuid, p_order_grade jsonb DEFAULT NULL::jsonb, p_force_soft boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_snap_outdated timestamptz;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
  v_already_debited boolean;
  v_eff_grade jsonb;
  v_packaging_mode text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
  ) INTO v_already_debited;

  IF v_already_debited THEN
    RETURN jsonb_build_object('snapshot_id', NULL, 'items', '[]'::jsonb, 'idempotent_skip', true);
  END IF;

  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');

  v_eff_grade := CASE WHEN v_sole_handled_by_grade THEN public.scale_grade_to_total(p_order_grade, p_order_quantity) ELSE p_order_grade END;

  v_size := NULL;
  IF v_sole_handled_by_grade THEN
    SELECT split_part(key, '/', 1)::integer INTO v_size
      FROM jsonb_each_text(v_eff_grade)
     WHERE key ~ '^[0-9]+(/[0-9]+)?$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  -- DEB-4 (auditoria 2026-07-19): o item do PV vem de orders.sale_order_item_id
  -- (vínculo canônico); o match por (reference_id, color) LIMIT 1 vira fallback
  -- — dois itens da mesma ref+cor no PV podiam trocar snapshot/variante.
  SELECT sale_order_id, sale_order_item_id INTO v_sale_order_id, v_soi_id
    FROM public.orders WHERE id = p_order_id;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT packaging_mode INTO v_packaging_mode
      FROM public.sale_orders
     WHERE id = v_sale_order_id;
  END IF;

  IF v_soi_id IS NULL AND v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id, outdated_at INTO v_items, v_snap_id, v_snap_outdated
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  -- F4-1 (auditoria 2026-07-21): congelamento continua por design, mas debitar
  -- snapshot DESATUALIZADO deixa de ser silencioso — aviso no log + flag no
  -- retorno (não bloqueia o faturamento).
  IF v_items IS NOT NULL AND v_snap_outdated IS NOT NULL THEN
    RAISE WARNING 'hybrid_debit_stock_for_order: OP % debita snapshot DESATUALIZADO (outdated_at=%) do PV % — ficha/listas mudaram após o congelamento; recalcule custos/reserva do PV se a mudança deve valer.',
      p_order_id, v_snap_outdated, v_sale_order_id;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, v_eff_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, v_eff_grade, p_color, NULL);
      ELSE
        v_items := public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size, NULL);
      END IF;
    END IF;
  END IF;

  -- snapshots antigos ainda contêm as DUAS caixas — filtrar na leitura
  v_items := public.filter_caixa_by_packaging_mode(v_items, v_packaging_mode);

  IF NOT p_force_soft THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_items) AS value
       ORDER BY value ->> 'product_id'
    LOOP
      IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
        CONTINUE;
      END IF;

      v_pid    := (v_item ->> 'product_id')::uuid;
      v_source := v_item ->> 'source';

      -- DEB-2: solado pinado na VARIANTE sai como 'variant_sole' — também é
      -- tratado pelo débito por grade (senão debitaria 2×).
      IF v_sole_handled_by_grade AND v_source IN ('primary_sole', 'variant_sole') THEN
        CONTINUE;
      END IF;

      SELECT id, quantity, name INTO v_product
        FROM public.products WHERE id = v_pid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
      END IF;

      v_required := (v_item ->> 'required')::numeric;
      IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
        RAISE EXCEPTION
          'Estoque insuficiente para % "%": disponível %, necessário %',
          v_item ->> 'component', v_product.name, v_product.quantity, v_required;
      END IF;
    END LOOP;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_name   := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode   := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';

    IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'required', v_required,
        'type', 'skipped_color_not_registered',
        'component', v_item ->> 'component', 'color', p_color);
      CONTINUE;
    END IF;

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    IF v_sole_handled_by_grade AND v_source IN ('primary_sole', 'variant_sole') THEN
      IF p_force_soft THEN
        v_result := v_result || jsonb_build_object(
          'product_id', v_pid, 'product_name', v_name,
          'required', v_required, 'type', 'sole_deferred_to_grade_soft'
        );
        CONTINUE;
      END IF;

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object('kind', 'sole_pending_grade', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;

    IF p_force_soft OR v_mode = 'soft' THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object(
                'kind', 'component',
                'component', v_item->>'component',
                'source', v_source,
                'color', p_color
              ));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    ELSE
      UPDATE public.products
         SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard',
              jsonb_build_object('kind', 'component', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('snapshot_id', v_snap_id, 'items', v_result, 'force_soft', p_force_soft, 'snapshot_outdated_at', v_snap_outdated);
END;
$function$;
