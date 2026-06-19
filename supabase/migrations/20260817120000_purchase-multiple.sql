-- =============================================================================
-- MÚLTIPLO DE COMPRA (embalagem) — arredonda a quantidade da OC pra cima
-- =============================================================================
-- Pedido do usuário: alguns itens só vendem em pacote fechado (de 10 em 10, 50
-- em 50, 100 em 100, 1000 em 1000). Ex.: "Caixa Colmeia" só vende de 50 em 50 —
-- se o pedido der 187, a Ordem de Compra deve gerar 200 (ceil(187/50)*50).
--
-- Modelo: 1 campo "múltiplo de compra" no ITEM (products) e no GRUPO
-- (product_groups, como padrão). O item tem prioridade; o grupo é fallback. O
-- form do grupo aplica o valor em massa aos itens (igual faz com preço unitário),
-- então os motores de geração de OC só precisam ler products.purchase_multiple —
-- a RPC ainda faz COALESCE com o grupo por robustez.
--
-- Valor 0/NULL/1 = sem arredondamento (comportamento atual preservado).
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_multiple numeric;
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS purchase_multiple numeric;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_purchase_multiple_nonneg;
ALTER TABLE public.products
  ADD CONSTRAINT chk_products_purchase_multiple_nonneg
  CHECK (purchase_multiple IS NULL OR purchase_multiple >= 0);

ALTER TABLE public.product_groups
  DROP CONSTRAINT IF EXISTS chk_groups_purchase_multiple_nonneg;
ALTER TABLE public.product_groups
  ADD CONSTRAINT chk_groups_purchase_multiple_nonneg
  CHECK (purchase_multiple IS NULL OR purchase_multiple >= 0);

COMMENT ON COLUMN public.products.purchase_multiple IS
  'Múltiplo de compra (embalagem) na unidade de COMPRA. Ao gerar OC, a quantidade arredonda pra cima pro próximo múltiplo (ex.: 50 → 187 vira 200). NULL/0/1 = sem arredondamento. Tem prioridade sobre product_groups.purchase_multiple.';
COMMENT ON COLUMN public.product_groups.purchase_multiple IS
  'Múltiplo de compra padrão do grupo (embalagem). Usado como fallback quando o item não tem múltiplo próprio. O form do grupo também aplica em massa aos itens.';

-- ----------------------------------------------------------------------------
-- generate_purchase_orders_from_mrp: aplica o múltiplo de compra após o
-- arredondamento por unidade discreta. Resolve item→grupo (COALESCE).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(p_product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_supplier uuid;
  v_po_id uuid;
  v_po_number text;
  v_qty_to_order numeric;
  v_unit_price_po numeric;
  v_unit_po text;
  v_linked uuid[];
  v_lock_key bigint;
  v_multiple numeric;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_mrp_needs
     WHERE suggested_qty > 0
       AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
     ORDER BY preferred_supplier_id NULLS LAST, product_name
  LOOP
    v_supplier := v_row.preferred_supplier_id;
    v_qty_to_order := v_row.suggested_qty / COALESCE(v_row.conversion_rate, 1);
    v_unit_price_po := COALESCE(v_row.unit_price, 0) * COALESCE(v_row.conversion_rate, 1);
    v_unit_po := COALESCE(v_row.purchase_order_unit, v_row.unit);
    v_qty_to_order := GREATEST(v_qty_to_order, COALESCE(v_row.min_order_quantity, 0));

    IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'unidade', 'par') THEN
      v_qty_to_order := CEIL(v_qty_to_order);
    END IF;

    -- Múltiplo de compra (embalagem): item tem prioridade, grupo é fallback.
    SELECT COALESCE(NULLIF(pr.purchase_multiple, 0), NULLIF(pg.purchase_multiple, 0), 0)
      INTO v_multiple
      FROM public.products pr
      LEFT JOIN public.product_groups pg ON pg.id = pr.group_id
     WHERE pr.id = v_row.product_id;
    IF v_multiple IS NOT NULL AND v_multiple > 1 THEN
      v_qty_to_order := CEIL(v_qty_to_order / v_multiple) * v_multiple;
    END IF;

    v_lock_key := hashtextextended(COALESCE(v_supplier::text, 'no-supplier'), 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT ARRAY_AGG(DISTINCT so.id)
    INTO v_linked
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    WHERE sm.product_id = v_row.product_id
      AND so.deleted_at IS NULL
      AND so.status IN ('Aprovado', 'Em Produção');

    SELECT id INTO v_po_id
      FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier
       AND status = 'pending'
       AND auto_generated = true
       AND created_at > now() - interval '2 minutes'
     LIMIT 1;

    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') ||
                     '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders
        (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated, linked_sale_order_ids)
      VALUES (
        v_po_number, 'pending', v_supplier,
        COALESCE(v_row.supplier_name, ''),
        0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'),
        true,
        COALESCE(v_linked, ARRAY[]::uuid[])
      ) RETURNING id INTO v_po_id;
    ELSE
      UPDATE public.purchase_orders
      SET linked_sale_order_ids = (
        SELECT ARRAY_AGG(DISTINCT x)
        FROM unnest(COALESCE(linked_sale_order_ids, ARRAY[]::uuid[]) || COALESCE(v_linked, ARRAY[]::uuid[])) AS x
      )
      WHERE id = v_po_id;
    END IF;

    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, quantity, unit_price, unit, current_stock, min_stock, suggested_quantity)
    VALUES (
      v_po_id, v_row.product_id,
      v_qty_to_order, v_unit_price_po, v_unit_po,
      v_row.on_hand, v_row.min_stock, v_row.suggested_qty
    );

    UPDATE public.purchase_orders
       SET total_value = (
         SELECT COALESCE(SUM(quantity * unit_price), 0)
           FROM public.purchase_order_items
          WHERE purchase_order_id = v_po_id
       ),
       updated_at = now()
     WHERE id = v_po_id;

    RETURN NEXT v_po_id;
  END LOOP;
END;
$function$;
