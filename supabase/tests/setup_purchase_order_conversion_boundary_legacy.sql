-- =============================================================================
-- Setup PRE-migration para o E2E da fronteira de conversao da OC.
--
-- Deve rodar na mesma transacao, imediatamente ANTES da migration 15700.
-- Cria apenas fixtures sinteticas que representam duas linhas historicas:
--   * snapshot integralmente NULL (fallback legado permitido);
--   * snapshot parcial (fail-closed).
-- O workflow de dry-run encerra tudo com ROLLBACK.
-- =============================================================================

SET LOCAL plpgsql.check_asserts = on;

CREATE TEMP TABLE e2e_po157_legacy_fixture (
  fixture_kind text PRIMARY KEY,
  supplier_id uuid NOT NULL,
  product_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  purchase_order_item_id uuid NOT NULL
) ON COMMIT DROP;

DO $setup_purchase_order_conversion_boundary_legacy$
DECLARE
  v_suffix text := pg_catalog.gen_random_uuid()::text;
  v_supplier_id uuid;
  v_legacy_product_id uuid;
  v_partial_product_id uuid;
  v_legacy_po_id uuid;
  v_partial_po_id uuid;
  v_legacy_item_id uuid;
  v_partial_item_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns column_info
     WHERE column_info.table_schema = 'public'
       AND column_info.table_name = 'purchase_order_items'
       AND column_info.column_name = 'generic_conversion_snapshot_version'
  ) THEN
    RAISE EXCEPTION
      'Setup legado 15700 deve rodar antes da migration de snapshot';
  END IF;

  INSERT INTO public.suppliers (name, active)
  VALUES ('E2E OC pre157 fornecedor ' || v_suffix, true)
  RETURNING id INTO v_supplier_id;

  INSERT INTO public.products (
    name, sku, category, quantity, current_stock, unit, unit_price,
    location, active, color, supplier_id, purchase_unit,
    purchase_order_unit, conversion_rate, dimensions_width, dimensions_unit
  ) VALUES (
    'E2E OC PRE157 LEGACY ' || v_suffix,
    'E2E-OC-PRE157-LEGACY-' || v_suffix,
    'Materia-Prima',
    0, 0, 'dm²', 0,
    'E2E', true, '', v_supplier_id, 'm', 'm', 100, 1000, 'mm'
  ) RETURNING id INTO v_legacy_product_id;

  INSERT INTO public.products (
    name, sku, category, quantity, current_stock, unit, unit_price,
    location, active, color, supplier_id, purchase_unit,
    purchase_order_unit, conversion_rate
  ) VALUES (
    'E2E OC PRE157 PARCIAL ' || v_suffix,
    'E2E-OC-PRE157-PARCIAL-' || v_suffix,
    'Materia-Prima',
    0, 0, 'un', 1,
    'E2E', true, '', v_supplier_id, 'un', 'un', 1
  ) RETURNING id INTO v_partial_product_id;

  INSERT INTO public.purchase_orders (
    order_number, supplier_id, supplier_name, status, total_value,
    source_type, idempotency_key
  ) VALUES (
    'E2E-PRE157-LEGACY-' || pg_catalog.left(v_suffix, 8),
    v_supplier_id, 'E2E OC pre157 fornecedor ' || v_suffix,
    'approved', 240, 'manual', 'e2e-pre157-legacy-' || v_suffix
  ) RETURNING id INTO v_legacy_po_id;

  INSERT INTO public.purchase_order_items (
    purchase_order_id, product_id, current_stock, min_stock, max_stock,
    suggested_quantity, quantity, unit_price, unit,
    stock_unit_snapshot, purchase_unit_snapshot, conversion_rate_snapshot
  ) VALUES (
    v_legacy_po_id, v_legacy_product_id, 0, 0, 0,
    1, 1, 240, 'm', NULL, NULL, NULL
  ) RETURNING id INTO v_legacy_item_id;

  INSERT INTO public.purchase_orders (
    order_number, supplier_id, supplier_name, status, total_value,
    source_type, idempotency_key
  ) VALUES (
    'E2E-PRE157-PARTIAL-' || pg_catalog.left(v_suffix, 8),
    v_supplier_id, 'E2E OC pre157 fornecedor ' || v_suffix,
    'approved', 1, 'manual', 'e2e-pre157-partial-' || v_suffix
  ) RETURNING id INTO v_partial_po_id;

  INSERT INTO public.purchase_order_items (
    purchase_order_id, product_id, current_stock, min_stock, max_stock,
    suggested_quantity, quantity, unit_price, unit,
    stock_unit_snapshot, purchase_unit_snapshot, conversion_rate_snapshot
  ) VALUES (
    v_partial_po_id, v_partial_product_id, 0, 0, 0,
    1, 1, 1, 'un', 'un', NULL, NULL
  ) RETURNING id INTO v_partial_item_id;

  INSERT INTO pg_temp.e2e_po157_legacy_fixture (
    fixture_kind, supplier_id, product_id,
    purchase_order_id, purchase_order_item_id
  ) VALUES
    ('all_null', v_supplier_id, v_legacy_product_id,
      v_legacy_po_id, v_legacy_item_id),
    ('partial', v_supplier_id, v_partial_product_id,
      v_partial_po_id, v_partial_item_id);

  ASSERT pg_catalog.num_nonnulls(
    (SELECT item.stock_unit_snapshot FROM public.purchase_order_items item
      WHERE item.id = v_legacy_item_id),
    (SELECT item.purchase_unit_snapshot FROM public.purchase_order_items item
      WHERE item.id = v_legacy_item_id),
    (SELECT item.conversion_rate_snapshot FROM public.purchase_order_items item
      WHERE item.id = v_legacy_item_id)
  ) = 0, 'Setup pre157 nao criou linha integralmente legada';
  ASSERT pg_catalog.num_nonnulls(
    (SELECT item.stock_unit_snapshot FROM public.purchase_order_items item
      WHERE item.id = v_partial_item_id),
    (SELECT item.purchase_unit_snapshot FROM public.purchase_order_items item
      WHERE item.id = v_partial_item_id),
    (SELECT item.conversion_rate_snapshot FROM public.purchase_order_items item
      WHERE item.id = v_partial_item_id)
  ) = 1, 'Setup pre157 nao criou snapshot parcial';
END;
$setup_purchase_order_conversion_boundary_legacy$;

-- O constraint trigger abaixo e o unico INITIALLY DEFERRED da tabela de itens.
-- Drenar seus eventos permite que a migration altere a tabela na mesma
-- transacao; em seguida restauramos o modo original para o restante do E2E.
SET CONSTRAINTS public.trg_assert_strap_purchase_order_item_origin IMMEDIATE;
SET CONSTRAINTS public.trg_assert_strap_purchase_order_item_origin DEFERRED;
