-- =============================================================================
-- REGRA: cor da tira (output) == cor da NAPA base. Aplicada em todo o fluxo.
-- =============================================================================
-- Definição do usuário: a tira é cortada da NAPA da MESMA cor (tira preta vem de
-- napa preta). Logo, ao resolver/debitar o material base de uma OS artesanal,
-- casa-se a NAPA pela COR EXATA da tira.
--
-- Identificação do material base: os produtos NAPA usam nome puro ("NAPA SOFT").
-- Alguns estão mal-agrupados (ex.: "NAPA SOFT" cor BEGE/PRETO no grupo NAPA SUDANI),
-- mas SÃO o mesmo material. Por isso casamos por (group_id do grupo base OU
-- products.name = base_product_name) — preferindo o do grupo certo — sempre com
-- COR EXATA. Sem fallback de cor frouxo (nada de "cor nula serve").
--
-- Pontos cobertos: tg_debit_service_order_base (débito na criação),
-- tg_revert_service_order_base_on_cancel (estorno), get_wave_material_needs (MRP).
-- =============================================================================

-- ─── Débito da base na criação ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_debit_service_order_base()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_recipe      RECORD;
  v_group_id    uuid;
  v_base_color  text;
  v_product_id  uuid;
  v_product_qty numeric;
  v_required    numeric;
BEGIN
  IF NEW.artisanal_recipe_id IS NULL OR COALESCE(NEW.artisanal_output_meters, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF lower(COALESCE(NEW.status, '')) IN ('cancelado','cancelled','rejeitada') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_movements
     WHERE movement_type = 'out'
       AND description LIKE 'OS Artesanal ' || COALESCE(NEW.order_number, '?') || ' — base%'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
  IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN
    RETURN NEW;
  END IF;

  v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;
  -- Cor base = cor da tira (regra). Usa base_color informado; senão a cor de output.
  v_base_color := COALESCE(NULLIF(trim(NEW.artisanal_base_color), ''), NEW.artisanal_output_color, '');

  SELECT id INTO v_group_id
    FROM public.product_groups
   WHERE lower(trim(unaccent(name))) = lower(trim(unaccent(v_recipe.base_product_name)))
   LIMIT 1;

  -- Material base = produto do grupo base OU com nome = base_product_name, na COR EXATA
  -- da tira. Prefere o do grupo certo; entre iguais, o de maior estoque.
  SELECT p.id, p.quantity INTO v_product_id, v_product_qty
    FROM public.products p
   WHERE p.active = true
     AND (p.group_id = v_group_id
          OR lower(trim(unaccent(p.name))) = lower(trim(unaccent(v_recipe.base_product_name))))
     AND (v_base_color = ''
          OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(v_base_color))))
   ORDER BY (p.group_id = v_group_id) DESC NULLS LAST, p.quantity DESC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  IF v_product_id IS NULL THEN
    RAISE WARNING 'OS %: base "%" na cor "%" não encontrada — não debitando (cadastre a NAPA nessa cor).',
      NEW.order_number, v_recipe.base_product_name, v_base_color;
    RETURN NEW;
  END IF;

  IF v_product_qty < v_required THEN
    RAISE WARNING 'OS %: estoque insuficiente de "%" (%) — disponível %, necessário %',
      NEW.order_number, v_recipe.base_product_name, v_base_color, v_product_qty, v_required;
  END IF;

  UPDATE public.products
     SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
   WHERE id = v_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
  ) VALUES (
    v_product_id, 'out', v_required, v_product_qty, GREATEST(0, v_product_qty - v_required),
    'OS Artesanal ' || COALESCE(NEW.order_number, '?') ||
      ' — base "' || v_recipe.base_product_name || '"' ||
      CASE WHEN v_base_color <> '' THEN ' (' || v_base_color || ')' ELSE '' END,
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debit_service_order_base ON public.service_orders;
CREATE TRIGGER trg_debit_service_order_base
  AFTER INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_debit_service_order_base();


-- ─── Estorno da base ao cancelar ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_revert_service_order_base_on_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_recipe     RECORD;
  v_group_id   uuid;
  v_base_color text;
  v_product_id uuid;
  v_required   numeric;
BEGIN
  IF lower(COALESCE(NEW.status, '')) IN ('cancelado','cancelled','rejeitada')
     AND lower(COALESCE(OLD.status, '')) NOT IN ('cancelado','cancelled','rejeitada')
     AND NEW.artisanal_recipe_id IS NOT NULL
     AND COALESCE(NEW.artisanal_output_meters, 0) > 0 THEN

    SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
    IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN RETURN NEW; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements WHERE movement_type = 'out'
         AND description LIKE 'OS Artesanal ' || COALESCE(NEW.order_number, '?') || ' — base%'
    ) THEN RETURN NEW; END IF;
    IF EXISTS (
      SELECT 1 FROM public.stock_movements WHERE movement_type = 'in'
         AND description LIKE 'Estorno OS ' || COALESCE(NEW.order_number, '?') || ' cancelada — base%'
    ) THEN RETURN NEW; END IF;

    v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;
    v_base_color := COALESCE(NULLIF(trim(NEW.artisanal_base_color), ''), NEW.artisanal_output_color, '');

    SELECT id INTO v_group_id FROM public.product_groups
     WHERE lower(trim(unaccent(name))) = lower(trim(unaccent(v_recipe.base_product_name))) LIMIT 1;

    SELECT p.id INTO v_product_id
      FROM public.products p
     WHERE p.active = true
       AND (p.group_id = v_group_id
            OR lower(trim(unaccent(p.name))) = lower(trim(unaccent(v_recipe.base_product_name))))
       AND (v_base_color = ''
            OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(v_base_color))))
     ORDER BY (p.group_id = v_group_id) DESC NULLS LAST, p.quantity DESC NULLS LAST
     LIMIT 1;

    IF v_product_id IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + v_required, updated_at = now()
       WHERE id = v_product_id;
      INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
      )
      SELECT id, 'in', v_required, quantity - v_required, quantity,
             'Estorno OS ' || COALESCE(NEW.order_number, '?') || ' cancelada — base', NULL
        FROM public.products WHERE id = v_product_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revert_service_order_base_on_cancel ON public.service_orders;
CREATE TRIGGER trg_revert_service_order_base_on_cancel
  AFTER UPDATE OF status ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_revert_service_order_base_on_cancel();


-- ─── MRP: get_wave_material_needs — base por (grupo OU nome) + COR EXATA ─────
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date)
LANGUAGE plpgsql STABLE SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  WITH
  sole_product_ids AS (
    SELECT DISTINCT rsc.sole_product_id
      FROM public.sale_order_items soi
      CROSS JOIN LATERAL (SELECT sole_product_id FROM public.resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) rsc
     WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND rsc.sole_product_id IS NOT NULL
  ),
  sheet_needed AS (
    SELECT sm.product_id,
           COALESCE(NULLIF(sm.color,''), soi.color, '') AS effective_color,
           SUM(sm.quantity_per_unit * soi.quantity) AS needed_qty
      FROM public.sale_order_items soi
      JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
      JOIN public.products sp ON sp.id = sm.product_id
     WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       AND sm.product_id NOT IN (SELECT sole_product_id FROM sole_product_ids)
     GROUP BY sm.product_id, COALESCE(NULLIF(sm.color,''), soi.color, '')
  ),
  sole_needed AS (
    SELECT rsc.sole_product_id AS product_id,
           COALESCE(NULLIF(rsc.sole_color,''), soi.color, '') AS effective_color,
           SUM(soi.quantity) AS needed_qty
      FROM public.sale_order_items soi
      CROSS JOIN LATERAL (SELECT sole_product_id, sole_color FROM public.resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) rsc
     WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND rsc.sole_product_id IS NOT NULL
     GROUP BY rsc.sole_product_id, COALESCE(NULLIF(rsc.sole_color,''), soi.color, '')
  ),
  all_needed AS (
    SELECT product_id, effective_color, needed_qty FROM sheet_needed
    UNION ALL
    SELECT product_id, effective_color, needed_qty FROM sole_needed
  ),
  needed AS (
    SELECT product_id, effective_color, SUM(needed_qty) AS needed_qty
      FROM all_needed GROUP BY product_id, effective_color
  ),
  enriched AS (
    SELECT n.product_id, p.name AS product_name, p.group_id AS group_id, COALESCE(p.unit,'un') AS unit,
           n.effective_color AS color, n.needed_qty,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
           GREATEST(0, n.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal
      FROM needed n
      JOIN public.products p ON p.id = n.product_id
      LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  )
  SELECT e.product_id, e.product_name, e.unit, e.color, e.needed_qty, e.stock_qty,
         e.shortage, e.supplier_id, e.supplier_name, e.supplier_lead_time_days,
         e.is_artisanal,
         ar.id AS artisanal_recipe_id, ar.name AS artisanal_recipe_name,
         bp.id AS base_product_id, ar.base_product_name,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
              THEN ROUND(e.needed_qty / ar.yield_per_meter, 3) ELSE NULL END AS base_needed_qty,
         bp.quantity AS base_stock_qty,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
              THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
              ELSE NULL END AS base_shortage,
         CASE WHEN e.is_artisanal AND v_corte_start IS NOT NULL
              THEN (v_corte_start - 7)::date ELSE NULL END AS os_send_date
    FROM enriched e
    LEFT JOIN public.product_groups epg ON epg.id = e.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND epg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(epg.name)))
    LEFT JOIN public.product_groups bpg
           ON ar.id IS NOT NULL
          AND lower(trim(unaccent(bpg.name))) = lower(trim(unaccent(ar.base_product_name)))
    -- 1 produto base por (grupo OU nome) + COR EXATA da tira (regra cor=cor)
    LEFT JOIN LATERAL (
      SELECT bp2.id, bp2.quantity
        FROM public.products bp2
       WHERE ar.id IS NOT NULL AND bp2.active = true
         AND (bp2.group_id = bpg.id
              OR lower(trim(unaccent(bp2.name))) = lower(trim(unaccent(ar.base_product_name))))
         AND (e.color = ''
              OR lower(unaccent(COALESCE(bp2.color,''))) = lower(unaccent(e.color)))
       ORDER BY (bp2.group_id = bpg.id) DESC NULLS LAST, bp2.quantity DESC NULLS LAST
       LIMIT 1
    ) bp ON true
   ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$function$;
