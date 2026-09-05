-- =============================================================================
-- E2E transacional — snapshot de conversao e fronteira financeira da OC
--
-- Pre-requisitos, na mesma transacao: primeiro
-- setup_purchase_order_conversion_boundary_legacy.sql, depois a migration
-- 20270101015700_congelar_conversao_e_estado_oc.
-- Todas as fixtures e efeitos sao descartados pelo ROLLBACK final.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '15s';
SET LOCAL plpgsql.check_asserts = on;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config(
  'request.jwt.claim.sub',
  (
    SELECT user_role.user_id::text
      FROM public.user_roles user_role
      JOIN public.profiles profile
        ON profile.id = user_role.user_id
       AND profile.approved = true
     WHERE user_role.role::text = 'admin'
     ORDER BY user_role.user_id
     LIMIT 1
  ),
  true
);
SELECT set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'service_role',
    'sub', pg_catalog.current_setting('request.jwt.claim.sub', true)
  )::text,
  true
);

DO $test_purchase_order_conversion_boundary$
DECLARE
  v_actor_id uuid := auth.uid();
  v_suffix text := pg_catalog.gen_random_uuid()::text;
  v_supplier_id uuid;
  v_other_supplier_id uuid;
  v_area_product_id uuid;
  v_rate_product_id uuid;
  v_legacy_product_id uuid;
  v_state_product_id uuid;
  v_ap_product_id uuid;
  v_guard_product_id uuid;
  v_po_id uuid;
  v_area_item_id uuid;
  v_rate_item_id uuid;
  v_legacy_po_id uuid;
  v_legacy_item_id uuid;
  v_state_po_id uuid;
  v_state_item_id uuid;
  v_ap_po_id uuid;
  v_ap_item_id uuid;
  v_legacy_ap_po_id uuid;
  v_legacy_ap_item_id uuid;
  v_guard_po_id uuid;
  v_guard_item_id uuid;
  v_partial_product_id uuid;
  v_partial_po_id uuid;
  v_partial_item_id uuid;
  v_deduplicate_sale_order_id uuid := pg_catalog.gen_random_uuid();
  v_result jsonb;
  v_payload jsonb;
  v_request_id uuid;
  v_rejected boolean;
  v_before_total numeric;
  v_after_quantity numeric;
  v_after_price numeric;
  v_status text;
  v_notes text;
  v_promised_date date;
  v_movement_count integer;
  v_receipt_count integer;
BEGIN
  ASSERT v_actor_id IS NOT NULL,
    'Pre-condicao: nenhum usuario Admin aprovado disponivel';
  ASSERT pg_catalog.to_regclass(
    'pg_temp.e2e_po157_legacy_fixture'
  ) IS NOT NULL, 'Setup pre157 das linhas legadas nao foi executado';

  SELECT fixture.product_id, fixture.purchase_order_id,
         fixture.purchase_order_item_id
    INTO v_legacy_product_id, v_legacy_po_id, v_legacy_item_id
    FROM pg_temp.e2e_po157_legacy_fixture fixture
   WHERE fixture.fixture_kind = 'all_null';
  SELECT fixture.product_id, fixture.purchase_order_id,
         fixture.purchase_order_item_id
    INTO v_partial_product_id, v_partial_po_id, v_partial_item_id
    FROM pg_temp.e2e_po157_legacy_fixture fixture
   WHERE fixture.fixture_kind = 'partial';
  ASSERT v_legacy_item_id IS NOT NULL AND v_partial_item_id IS NOT NULL,
    'Setup pre157 nao forneceu as duas fixtures legadas';
  ASSERT EXISTS (
    SELECT 1
      FROM public.purchase_order_items item
     WHERE item.id = v_legacy_item_id
       AND item.generic_conversion_snapshot_version IS NULL
       AND pg_catalog.num_nonnulls(
         item.stock_unit_snapshot,
         item.purchase_unit_snapshot,
         item.conversion_rate_snapshot
       ) = 0
  ), 'Migration preencheu indevidamente a fixture legada';
  ASSERT EXISTS (
    SELECT 1
      FROM public.purchase_order_items item
     WHERE item.id = v_partial_item_id
       AND item.generic_conversion_snapshot_version IS NULL
       AND pg_catalog.num_nonnulls(
         item.stock_unit_snapshot,
         item.purchase_unit_snapshot,
         item.conversion_rate_snapshot
       ) = 1
  ), 'Migration alterou indevidamente a fixture parcial';

  INSERT INTO public.suppliers (name, active)
  VALUES ('E2E OC snapshot fornecedor ' || v_suffix, true)
  RETURNING id INTO v_supplier_id;

  INSERT INTO public.suppliers (name, active)
  VALUES ('E2E OC snapshot fornecedor alternativo ' || v_suffix, true)
  RETURNING id INTO v_other_supplier_id;

  INSERT INTO public.products (
    name, sku, category, quantity, current_stock, unit, unit_price,
    location, active, color, supplier_id, purchase_unit,
    purchase_order_unit, conversion_rate, dimensions_width, dimensions_unit
  ) VALUES (
    'E2E OC AREA ' || v_suffix,
    'E2E-OC-AREA-' || v_suffix,
    'Materia-Prima',
    100, 100, 'dm²', 5,
    'E2E', true, '', v_supplier_id, 'm', 'm', 137, 1370, 'mm'
  ) RETURNING id INTO v_area_product_id;

  INSERT INTO public.products (
    name, sku, category, quantity, current_stock, unit, unit_price,
    location, active, color, supplier_id, purchase_unit,
    purchase_order_unit, conversion_rate
  ) VALUES (
    'E2E OC RATE ' || v_suffix,
    'E2E-OC-RATE-' || v_suffix,
    'Materia-Prima',
    10, 10, 'un', 2,
    'E2E', true, '', v_supplier_id, 'cx', 'cx', 12
  ) RETURNING id INTO v_rate_product_id;

  INSERT INTO public.products (
    name, sku, category, quantity, current_stock, unit, unit_price,
    location, active, color, supplier_id, purchase_unit,
    purchase_order_unit, conversion_rate
  ) VALUES (
    'E2E OC STATE ' || v_suffix,
    'E2E-OC-STATE-' || v_suffix,
    'Materia-Prima',
    0, 0, 'un', 1,
    'E2E', true, '', v_supplier_id, 'un', 'un', 1
  ) RETURNING id INTO v_state_product_id;

  INSERT INTO public.products (
    name, sku, category, quantity, current_stock, unit, unit_price,
    location, active, color, supplier_id, purchase_unit,
    purchase_order_unit, conversion_rate
  ) VALUES (
    'E2E OC AP ' || v_suffix,
    'E2E-OC-AP-' || v_suffix,
    'Materia-Prima',
    0, 0, 'un', 1,
    'E2E', true, '', v_supplier_id, 'un', 'un', 1
  ) RETURNING id INTO v_ap_product_id;

  INSERT INTO public.products (
    name, sku, category, quantity, current_stock, unit, unit_price,
    location, active, color, supplier_id, purchase_unit,
    purchase_order_unit, conversion_rate
  ) VALUES (
    'E2E OC GUARD ' || v_suffix,
    'E2E-OC-GUARD-' || v_suffix,
    'Materia-Prima',
    0, 0, 'un', 1,
    'E2E', true, '', v_supplier_id, 'un', 'un', 1
  ) RETURNING id INTO v_guard_product_id;

  -- CREATE congela o fator efetivo por largura: 1 m de bobina com 1370 mm
  -- corresponde a 137 dm2, independentemente do conversion_rate cru futuro.
  v_result := public.execute_purchase_order_command(
    'create',
    pg_catalog.jsonb_build_object(
      'header', pg_catalog.jsonb_build_object(
        'supplier_id', v_supplier_id,
        'supplier_name', 'E2E OC snapshot fornecedor ' || v_suffix,
        'status', 'approved',
        'source_type', 'manual',
        'idempotency_key', 'e2e-oc-snapshot-' || v_suffix
      ),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'product_id', v_area_product_id,
          'quantity', 2,
          'unit', 'm',
          'unit_price', 274
        )
      )
    ),
    pg_catalog.gen_random_uuid(),
    NULL,
    NULL
  );
  v_po_id := (v_result ->> 'purchase_order_id')::uuid;
  SELECT item.id
    INTO v_area_item_id
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = v_po_id
     AND item.product_id = v_area_product_id;

  ASSERT EXISTS (
    SELECT 1
      FROM public.purchase_order_items item
     WHERE item.id = v_area_item_id
       AND item.unit = 'm'
       AND item.generic_conversion_snapshot_version = 1
       AND public.po_norm_unit(item.stock_unit_snapshot) = 'dm²'
       AND public.po_norm_unit(item.purchase_unit_snapshot) = 'm'
       AND item.conversion_rate_snapshot = 137
  ), 'CREATE nao congelou a tupla fisica efetiva da linha';

  -- APPEND de produto novo passa pelo upsert legado; o trigger deve fechar a
  -- mesma garantia sem depender de o caller lembrar as colunas de snapshot.
  v_result := public.execute_purchase_order_command(
    'append',
    pg_catalog.jsonb_build_object(
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'product_id', v_rate_product_id,
          'quantity', 2,
          'unit', 'cx',
          'unit_price', 120
        )
      )
    ),
    pg_catalog.gen_random_uuid(),
    v_po_id,
    NULL
  );
  SELECT item.id
    INTO v_rate_item_id
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = v_po_id
     AND item.product_id = v_rate_product_id;
  ASSERT EXISTS (
    SELECT 1
      FROM public.purchase_order_items item
     WHERE item.id = v_rate_item_id
       AND item.generic_conversion_snapshot_version = 1
       AND public.po_norm_unit(item.stock_unit_snapshot) = 'un'
       AND public.po_norm_unit(item.purchase_unit_snapshot) = 'cx'
       AND item.conversion_rate_snapshot = 12
  ), 'APPEND nao congelou a conversao do produto novo';

  -- Cadastro divergente nao pode renormalizar/somar silenciosamente a uma
  -- linha que ja congelou outra unidade/fator.
  UPDATE public.products product
     SET purchase_unit = 'pct', purchase_order_unit = 'pct', conversion_rate = 20
   WHERE product.id = v_rate_product_id;
  v_rejected := false;
  v_request_id := pg_catalog.gen_random_uuid();
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'append',
      pg_catalog.jsonb_build_object(
        'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'product_id', v_rate_product_id,
            'quantity', 1,
            'unit', 'cx',
            'unit_price', 120
          )
        )
      ),
      v_request_id,
      v_po_id,
      NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected,
    'APPEND misturou cadastro vivo divergente com snapshot existente';
  ASSERT (SELECT item.quantity FROM public.purchase_order_items item
           WHERE item.id = v_rate_item_id) = 2,
    'APPEND rejeitado alterou a quantidade da linha';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.purchase_order_command_receipts receipt
     WHERE receipt.client_request_id = v_request_id
  ), 'APPEND rejeitado deixou receipt';

  -- O recebimento usa o snapshot mesmo apos mudarem largura, unidade de compra
  -- e taxa do cadastro. A unidade-base de estoque permanece dm2.
  UPDATE public.products product
     SET purchase_unit = 'rolo', purchase_order_unit = 'rolo',
         conversion_rate = 100, dimensions_width = 1000
   WHERE product.id = v_area_product_id;
  v_payload := pg_catalog.jsonb_build_object(
    'receipts', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_id', v_area_item_id,
        'quantity', 1,
        'expected_received_quantity', 0
      )
    ),
    'reason', 'E2E snapshot parcial 1'
  );
  v_result := public.execute_purchase_order_command(
    'receive', v_payload, pg_catalog.gen_random_uuid(), v_po_id, NULL
  );
  ASSERT v_result -> 'received_items' -> 0 ->> 'conversion_source' = 'item_snapshot',
    'Recebimento novo nao declarou item_snapshot';
  ASSERT (v_result -> 'received_items' -> 0 ->> 'conversion_factor')::numeric = 137,
    'Recebimento novo ignorou fator congelado';
  ASSERT (v_result -> 'received_items' -> 0 ->> 'stock_quantity')::numeric = 137,
    'Primeiro recebimento nao converteu 1 m em 137 dm2';
  ASSERT (v_result -> 'purchase_order' ->> 'status') = 'parcial',
    'Recebimento parcial nao moveu OC para parcial';

  UPDATE public.products product
     SET conversion_rate = 50, dimensions_width = 500
   WHERE product.id = v_area_product_id;
  v_result := public.execute_purchase_order_command(
    'receive',
    pg_catalog.jsonb_build_object(
      'receipts', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', v_area_item_id,
          'quantity', 1,
          'expected_received_quantity', 1
        )
      ),
      'reason', 'E2E snapshot parcial 2'
    ),
    pg_catalog.gen_random_uuid(),
    v_po_id,
    NULL
  );
  ASSERT (v_result -> 'received_items' -> 0 ->> 'stock_quantity')::numeric = 137,
    'Segundo recebimento recalculou pela largura viva';
  SELECT product.quantity, product.unit_price
    INTO v_after_quantity, v_after_price
    FROM public.products product
   WHERE product.id = v_area_product_id;
  ASSERT v_after_quantity = 374,
    'Saldo de area esperado 100 + 2*137';
  ASSERT pg_catalog.abs(v_after_price - ((100 * 5 + 274 * 2) / 374::numeric)) < 0.000001,
    'WAC da area nao preservou custo efetivo de R$2/dm2';
  ASSERT (
    SELECT pg_catalog.bool_and(
      movement.quantity = 137 AND movement.effective_unit_cost = 2
    )
      FROM public.stock_movements movement
     WHERE movement.product_id = v_area_product_id
       AND movement.movement_reason = 'compra'
  ), 'Ledger da area divergiu do fator/custo congelado';

  -- Taxa simples tambem e congelada: 2 caixas * 12 = 24 unidades, ainda que o
  -- cadastro agora diga pct/20.
  v_payload := pg_catalog.jsonb_build_object(
    'receipts', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_id', v_rate_item_id,
        'quantity', 2,
        'expected_received_quantity', 0
      )
    ),
    'reason', 'E2E snapshot rate'
  );
  v_request_id := pg_catalog.gen_random_uuid();
  v_result := public.execute_purchase_order_command(
    'receive', v_payload, v_request_id, v_po_id, NULL
  );
  ASSERT (v_result -> 'received_items' -> 0 ->> 'stock_quantity')::numeric = 24,
    'Recebimento por taxa nao usou 2*12 unidades';
  ASSERT (v_result -> 'purchase_order' ->> 'status') = 'received',
    'OC nao fechou depois de receber todas as linhas';
  SELECT product.quantity, product.unit_price
    INTO v_after_quantity, v_after_price
    FROM public.products product
   WHERE product.id = v_rate_product_id;
  ASSERT v_after_quantity = 34,
    'Saldo por taxa esperado 10 + 24';
  ASSERT pg_catalog.abs(v_after_price - ((10 * 2 + 24 * 10) / 34::numeric)) < 0.000001,
    'WAC por taxa nao preservou custo efetivo de R$10/un';

  -- Replay identico devolve o mesmo receipt e nao duplica estoque/ledger.
  v_result := public.execute_purchase_order_command(
    'receive', v_payload, v_request_id, v_po_id, NULL
  );
  ASSERT COALESCE((v_result ->> 'replayed')::boolean, false),
    'Replay de recebimento nao foi reconhecido';
  ASSERT (SELECT product.quantity FROM public.products product
           WHERE product.id = v_rate_product_id) = 34,
    'Replay duplicou saldo de estoque';
  ASSERT (SELECT pg_catalog.count(*) FROM public.stock_movements movement
           WHERE movement.correlation_id = v_request_id) = 1,
    'Replay duplicou movimento de estoque';

  -- Linha realmente historica, criada pelo setup antes da migration: versao e
  -- tupla integralmente NULL usam apenas a tupla viva e declaram a origem.
  v_request_id := pg_catalog.gen_random_uuid();
  v_rejected := false;
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'edit',
      pg_catalog.jsonb_build_object(
        'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_id', v_legacy_item_id,
            'quantity', 2
          )
        )
      ),
      v_request_id, v_legacy_po_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected,
    'EDIT misturou quantidade nova em linha legada sem snapshot';
  ASSERT (SELECT item.quantity FROM public.purchase_order_items item
           WHERE item.id = v_legacy_item_id) = 1,
    'EDIT legado rejeitado alterou quantidade';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.purchase_order_command_receipts receipt
     WHERE receipt.client_request_id = v_request_id
  ), 'EDIT legado rejeitado deixou receipt';

  v_request_id := pg_catalog.gen_random_uuid();
  v_rejected := false;
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'append',
      pg_catalog.jsonb_build_object(
        'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'product_id', v_legacy_product_id,
            'quantity', 1,
            'unit', 'm',
            'unit_price', 240
          )
        )
      ),
      v_request_id, v_legacy_po_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected,
    'APPEND misturou quantidade nova em linha legada sem snapshot';
  ASSERT (SELECT item.quantity FROM public.purchase_order_items item
           WHERE item.id = v_legacy_item_id) = 1,
    'APPEND legado rejeitado alterou quantidade';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.purchase_order_command_receipts receipt
     WHERE receipt.client_request_id = v_request_id
  ), 'APPEND legado rejeitado deixou receipt';

  UPDATE public.products product
     SET dimensions_width = 1200, conversion_rate = 120
   WHERE product.id = v_legacy_product_id;
  v_result := public.execute_purchase_order_command(
    'receive',
    pg_catalog.jsonb_build_object(
      'receive_all', true,
      'reason', 'E2E fallback legado'
    ),
    pg_catalog.gen_random_uuid(), v_legacy_po_id, NULL
  );
  ASSERT v_result -> 'received_items' -> 0 ->> 'conversion_source' =
    'legacy_live_product',
    'Fallback legado nao foi explicitado na resposta';
  ASSERT (v_result -> 'received_items' -> 0 ->> 'stock_quantity')::numeric = 120,
    'Fallback legado nao usou largura viva integral';

  -- Matriz de estados: draft/pending/suggested nunca iniciam efeitos; sent e o
  -- estado parcial ja exercitado acima sao recebiveis.
  v_result := public.execute_purchase_order_command(
    'create',
    pg_catalog.jsonb_build_object(
      'header', pg_catalog.jsonb_build_object(
        'supplier_id', v_supplier_id,
        'supplier_name', 'E2E OC snapshot fornecedor ' || v_suffix,
        'status', 'pending',
        'source_type', 'manual',
        'idempotency_key', 'e2e-oc-states-' || v_suffix
      ),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'product_id', v_state_product_id,
          'quantity', 3,
          'unit', 'un',
          'unit_price', 1
        )
      )
    ),
    pg_catalog.gen_random_uuid(), NULL, NULL
  );
  v_state_po_id := (v_result ->> 'purchase_order_id')::uuid;
  SELECT item.id INTO v_state_item_id
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = v_state_po_id;

  FOREACH v_status IN ARRAY ARRAY['pending', 'draft', 'suggested']::text[]
  LOOP
    UPDATE public.purchase_orders purchase_order
       SET status = v_status
     WHERE purchase_order.id = v_state_po_id;
    v_request_id := pg_catalog.gen_random_uuid();
    v_rejected := false;
    BEGIN
      PERFORM public.execute_purchase_order_command(
        'receive',
        pg_catalog.jsonb_build_object('receive_all', true),
        v_request_id, v_state_po_id, NULL
      );
    EXCEPTION WHEN SQLSTATE '55000' THEN
      v_rejected := true;
    END;
    ASSERT v_rejected,
      pg_catalog.format('Estado %s foi recebido fora da allow-list', v_status);
    ASSERT (SELECT product.quantity FROM public.products product
             WHERE product.id = v_state_product_id) = 0,
      pg_catalog.format('Estado %s alterou estoque', v_status);
    ASSERT (SELECT item.received_quantity FROM public.purchase_order_items item
             WHERE item.id = v_state_item_id) = 0,
      pg_catalog.format('Estado %s alterou received_quantity', v_status);
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.stock_movements movement
       WHERE movement.correlation_id = v_request_id
    ), pg_catalog.format('Estado %s deixou movimento', v_status);
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.purchase_order_command_receipts receipt
       WHERE receipt.client_request_id = v_request_id
    ), pg_catalog.format('Estado %s deixou receipt', v_status);
  END LOOP;

  UPDATE public.purchase_orders purchase_order
     SET status = 'sent'
   WHERE purchase_order.id = v_state_po_id;
  v_result := public.execute_purchase_order_command(
    'receive',
    pg_catalog.jsonb_build_object('receive_all', true),
    pg_catalog.gen_random_uuid(), v_state_po_id, NULL
  );
  ASSERT (v_result -> 'purchase_order' ->> 'status') = 'received',
    'Estado sent nao foi aceito pela allow-list';
  ASSERT (SELECT product.quantity FROM public.products product
           WHERE product.id = v_state_product_id) = 3,
    'Recebimento sent nao atualizou estoque';

  -- Snapshot finito: NaN/Infinity nunca podem chegar ao saldo/WAC.
  FOREACH v_status IN ARRAY ARRAY['NaN', 'Infinity', '-Infinity']::text[]
  LOOP
    v_rejected := false;
    BEGIN
      PERFORM private.purchase_order_snapshot_receipt_factor_157(
        'm', 'dm²', 'm', v_status::numeric, 'E2E fator nao finito'
      );
    EXCEPTION WHEN SQLSTATE '22023' THEN
      v_rejected := true;
    END;
    ASSERT v_rejected,
      pg_catalog.format('Fator %s foi aceito pelo snapshot', v_status);
  END LOOP;

  -- Unidade-base viva diferente nao pode receber quantidade na semantica
  -- antiga. Depois, uma tupla parcial simulada deve falhar sem efeitos.
  v_result := public.execute_purchase_order_command(
    'create',
    pg_catalog.jsonb_build_object(
      'header', pg_catalog.jsonb_build_object(
        'supplier_id', v_supplier_id,
        'supplier_name', 'E2E OC snapshot fornecedor ' || v_suffix,
        'status', 'approved',
        'source_type', 'manual',
        'idempotency_key', 'e2e-oc-guard-' || v_suffix
      ),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'product_id', v_guard_product_id,
          'quantity', 1,
          'unit', 'un',
          'unit_price', 1
        )
      )
    ),
    pg_catalog.gen_random_uuid(), NULL, NULL
  );
  v_guard_po_id := (v_result ->> 'purchase_order_id')::uuid;
  SELECT item.id INTO v_guard_item_id
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = v_guard_po_id;
  UPDATE public.products product
     SET unit = 'par', purchase_unit = 'par', purchase_order_unit = 'par'
   WHERE product.id = v_guard_product_id;
  v_request_id := pg_catalog.gen_random_uuid();
  v_rejected := false;
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'receive', pg_catalog.jsonb_build_object('receive_all', true),
      v_request_id, v_guard_po_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'Mudanca da unidade-base viva nao bloqueou recebimento';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.stock_movements movement
     WHERE movement.correlation_id = v_request_id
  ), 'Bloqueio de unidade-base deixou movimento';

  UPDATE public.products product
     SET unit = 'un', purchase_unit = 'un', purchase_order_unit = 'un'
   WHERE product.id = v_guard_product_id;

  -- A segunda fixture tambem nasceu antes da migration, com exatamente um
  -- campo da tupla. O recebimento deve falhar fechado, sem precisar desativar
  -- triggers ou elevar privilegios no teste.
  v_request_id := pg_catalog.gen_random_uuid();
  v_rejected := false;
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'receive', pg_catalog.jsonb_build_object('receive_all', true),
      v_request_id, v_partial_po_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'Tupla historica parcial foi misturada ao cadastro vivo';
  ASSERT (SELECT product.quantity FROM public.products product
           WHERE product.id = v_partial_product_id) = 0,
    'Tupla parcial alterou estoque';

  -- AP existente congela credor/valor, mas nao impede dados operacionais nem o
  -- recebimento. A busca cobre FK e o marcador legado em notes.
  v_result := public.execute_purchase_order_command(
    'create',
    pg_catalog.jsonb_build_object(
      'header', pg_catalog.jsonb_build_object(
        'supplier_id', v_supplier_id,
        'supplier_name', 'E2E OC snapshot fornecedor ' || v_suffix,
        'status', 'approved',
        'source_type', 'manual',
        'linked_sale_order_ids', pg_catalog.jsonb_build_array(
          v_deduplicate_sale_order_id
        ),
        'idempotency_key', 'e2e-oc-ap-' || v_suffix
      ),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'product_id', v_ap_product_id,
          'quantity', 10,
          'unit', 'un',
          'unit_price', 3
        )
      )
    ),
    pg_catalog.gen_random_uuid(), NULL, NULL
  );
  v_ap_po_id := (v_result ->> 'purchase_order_id')::uuid;
  SELECT item.id INTO v_ap_item_id
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = v_ap_po_id;
  INSERT INTO public.accounts_payable (
    description, supplier_id, due_date, amount, status, notes,
    purchase_order_id
  ) VALUES (
    'E2E AP OC ' || v_suffix, v_supplier_id, CURRENT_DATE + 30,
    30, 'pending', '[OC#' || v_ap_po_id::text || '] E2E', v_ap_po_id
  );

  -- O APPEND realmente financeiro fica bloqueado, mas a deduplicacao de uma
  -- alocacao de PV ja aplicada continua sendo um no-op idempotente.
  v_result := public.execute_purchase_order_command(
    'append',
    pg_catalog.jsonb_build_object(
      'deduplicate_sale_order_id', v_deduplicate_sale_order_id,
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'product_id', v_guard_product_id,
          'quantity', 1,
          'unit', 'un',
          'unit_price', 1
        )
      )
    ),
    pg_catalog.gen_random_uuid(), v_ap_po_id, NULL
  );
  ASSERT COALESCE((v_result ->> 'deduplicated')::boolean, false),
    'AP existente quebrou deduplicacao de APPEND ja aplicado';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.purchase_order_items item
     WHERE item.purchase_order_id = v_ap_po_id
       AND item.product_id = v_guard_product_id
  ), 'APPEND deduplicado criou item financeiro';

  v_result := public.execute_purchase_order_command(
    'edit',
    pg_catalog.jsonb_build_object(
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', v_ap_item_id,
          'quantity', 10,
          'unit_price', 3
        )
      )
    ),
    pg_catalog.gen_random_uuid(), v_ap_po_id, NULL
  );
  ASSERT (SELECT item.quantity = 10 AND item.unit_price = 3
            FROM public.purchase_order_items item
           WHERE item.id = v_ap_item_id),
    'AP bloqueou payload financeiro identico usado em edicao operacional';

  SELECT purchase_order.total_value INTO v_before_total
    FROM public.purchase_orders purchase_order WHERE purchase_order.id = v_ap_po_id;
  v_request_id := pg_catalog.gen_random_uuid();
  v_rejected := false;
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'edit',
      pg_catalog.jsonb_build_object(
        'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_id', v_ap_item_id,
            'quantity', 11,
            'unit_price', 4
          )
        )
      ),
      v_request_id, v_ap_po_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'AP existente permitiu mudar quantidade/preco';
  ASSERT (SELECT item.quantity FROM public.purchase_order_items item
           WHERE item.id = v_ap_item_id) = 10,
    'Edicao financeira rejeitada alterou item';
  ASSERT (SELECT purchase_order.total_value FROM public.purchase_orders purchase_order
           WHERE purchase_order.id = v_ap_po_id) = v_before_total,
    'Edicao financeira rejeitada alterou total da OC';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.purchase_order_command_receipts receipt
     WHERE receipt.client_request_id = v_request_id
  ), 'Edicao financeira rejeitada deixou receipt';

  v_rejected := false;
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'append',
      pg_catalog.jsonb_build_object(
        'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'product_id', v_guard_product_id,
            'quantity', 1,
            'unit', 'un',
            'unit_price', 1
          )
        )
      ),
      pg_catalog.gen_random_uuid(), v_ap_po_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'AP existente permitiu APPEND financeiro';

  v_rejected := false;
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'update',
      pg_catalog.jsonb_build_object(
        'header_patch', pg_catalog.jsonb_build_object(
          'supplier_id', v_other_supplier_id,
          'supplier_name', 'E2E fornecedor alterado ' || v_suffix
        )
      ),
      pg_catalog.gen_random_uuid(), v_ap_po_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'AP existente permitiu trocar credor';

  -- Chaves financeiras com o MESMO valor nao mascaram uma atualizacao apenas
  -- operacional; notas/datas seguem permitidas e nao recalculam a AP.
  v_result := public.execute_purchase_order_command(
    'update',
    pg_catalog.jsonb_build_object(
      'header_patch', pg_catalog.jsonb_build_object(
        'supplier_id', v_supplier_id,
        'supplier_name', 'E2E OC snapshot fornecedor ' || v_suffix,
        'notes_append', 'E2E dado operacional preservado',
        'promised_date', (CURRENT_DATE + 7)::text,
        'eta_days', 7,
        'expedite', true
      )
    ),
    pg_catalog.gen_random_uuid(), v_ap_po_id, NULL
  );
  SELECT purchase_order.notes, purchase_order.promised_date
    INTO v_notes, v_promised_date
    FROM public.purchase_orders purchase_order
   WHERE purchase_order.id = v_ap_po_id;
  ASSERT v_notes LIKE '%E2E dado operacional preservado%',
    'AP bloqueou notes_append nao financeiro';
  ASSERT v_promised_date = CURRENT_DATE + 7,
    'AP bloqueou promised_date nao financeira';
  ASSERT (SELECT payable.amount FROM public.accounts_payable payable
           WHERE payable.purchase_order_id = v_ap_po_id) = 30,
    'Update operacional alterou AP';

  v_result := public.execute_purchase_order_command(
    'receive',
    pg_catalog.jsonb_build_object('receive_all', true),
    pg_catalog.gen_random_uuid(), v_ap_po_id, NULL
  );
  ASSERT (SELECT product.quantity FROM public.products product
           WHERE product.id = v_ap_product_id) = 10,
    'AP existente bloqueou recebimento legitimo';
  ASSERT (SELECT payable.amount FROM public.accounts_payable payable
           WHERE payable.purchase_order_id = v_ap_po_id) = 30,
    'Recebimento alterou AP existente';

  -- Marker legado sem purchase_order_id tambem fecha a edicao financeira.
  v_result := public.execute_purchase_order_command(
    'create',
    pg_catalog.jsonb_build_object(
      'header', pg_catalog.jsonb_build_object(
        'supplier_id', v_supplier_id,
        'supplier_name', 'E2E OC snapshot fornecedor ' || v_suffix,
        'status', 'approved',
        'source_type', 'manual',
        'idempotency_key', 'e2e-oc-ap-legacy-' || v_suffix
      ),
      'items', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'product_id', v_state_product_id,
          'quantity', 2,
          'unit', 'un',
          'unit_price', 1
        )
      )
    ),
    pg_catalog.gen_random_uuid(), NULL, NULL
  );
  v_legacy_ap_po_id := (v_result ->> 'purchase_order_id')::uuid;
  SELECT item.id INTO v_legacy_ap_item_id
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = v_legacy_ap_po_id;
  INSERT INTO public.accounts_payable (
    description, supplier_id, due_date, amount, status, notes
  ) VALUES (
    'E2E AP OC LEGACY ' || v_suffix, v_supplier_id, CURRENT_DATE + 30,
    2, 'pending', '[OC#' || v_legacy_ap_po_id::text || '] E2E legado'
  );
  v_rejected := false;
  BEGIN
    PERFORM public.execute_purchase_order_command(
      'edit',
      pg_catalog.jsonb_build_object(
        'items', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_id', v_legacy_ap_item_id,
            'unit_price', 2
          )
        )
      ),
      pg_catalog.gen_random_uuid(), v_legacy_ap_po_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'Marker legado de AP permitiu editar preco';

  -- Contagens finais resumem as invariantes centrais do fixture.
  SELECT pg_catalog.count(*)::integer
    INTO v_movement_count
    FROM public.stock_movements movement
   WHERE movement.product_id IN (
     v_area_product_id, v_rate_product_id, v_legacy_product_id,
     v_state_product_id, v_ap_product_id, v_guard_product_id,
     v_partial_product_id
   )
     AND movement.movement_reason = 'compra';
  ASSERT v_movement_count = 6,
    pg_catalog.format('Esperados 6 movimentos de compra, obtidos %s', v_movement_count);
  SELECT pg_catalog.count(*)::integer
    INTO v_receipt_count
    FROM public.purchase_order_command_receipts receipt
   WHERE receipt.purchase_order_id IN (
     v_po_id, v_legacy_po_id, v_state_po_id, v_ap_po_id,
     v_legacy_ap_po_id, v_guard_po_id, v_partial_po_id
   );
  ASSERT v_receipt_count >= 12,
    'Receipts dos comandos bem-sucedidos nao foram preservados';
END;
$test_purchase_order_conversion_boundary$;

SELECT pg_catalog.jsonb_build_object(
  'ok', true,
  'proof',
    'snapshot_create+snapshot_append+append_guard+partial+replay+wac+'
    || 'legacy_fallback+legacy_quantity_guard+status_allowlist+'
    || 'finite_guard+base_unit_guard+'
    || 'partial_tuple_guard+ap_financial_lock+append_dedupe+'
    || 'nonfinancial_update',
  'rollback', true
) AS purchase_order_conversion_boundary_e2e;

ROLLBACK;
