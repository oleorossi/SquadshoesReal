-- PV Comprar pronto (sku_acabado): NÃO cria SKU pela porta do prepare.
--
-- Sintoma (29/10/2026): "Escritor legado de produto de tira congelado; use o
-- catalogo canonico" ao salvar PV com ORIGEM=Comprar pronto em tira cujo grupo
-- só tem SKU de produção interna (reference_base). A 31900 fazia find-or-INSERT
-- sem app.artisanal_strap_catalog_write; a 35300 excluiu os SKUs internos e
-- empurrou cores sem candidato (ex.: ELÁSTICO FORRADO 7MM ROCHA/OFF WHITE) para
-- o INSERT — o gatilho tg_guard_legacy_artisanal_product_writer barra.
--
-- Decisão do dono: o operador cadastra no Hub (ArtisanalStrapEditor,
-- finished_product_group); o prepare só ACHA o SKU. Sem candidato → RAISE
-- claro pedindo o Hub (a UI bloqueia antes com o mesmo critério).
--
-- Marcador: strap_pv_sku_acabado_exige_cadastro_hub_20270101045200
--
-- ⚠ Superada para tira de NAPA (reference_base + sku_acabado) pela
-- 20270101045300_tira-comprar-pronto-so-registra (spec so-registra):
-- Comprar pronto só registra cor + metros, sem exigir SKU do Hub.
-- STRASS (finished_product_group) continua no contrato Hub desta 45200.

DO $$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_src text;
  v_old text;
  v_new text;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;

  v_src := pg_get_functiondef(v_fn);

  IF position('strap_pv_sku_acabado_exige_cadastro_hub_20270101045200' IN v_src) > 0 THEN
    RETURN;
  END IF;

  v_old := $old$IF NOT FOUND OR nullif(v_catalog ->> 'finished_product_id', '') IS NULL THEN
        INSERT INTO public.products (
          id, name, sku, category, group_id, color,
          quantity, min_stock, unit, unit_price, location, active, is_artisanal,
          purchase_unit, conversion_rate, purchase_price,
          min_order_quantity, purchase_multiple, material_preparation_days
        )
        SELECT
          gen_random_uuid(),
          concat_ws(
            ' · ',
            coalesce(nullif(g.name, ''), 'TIRA'),
            nullif(v_line ->> 'base_group_name', ''),
            v_line_color_name
          ),
          'TP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)),
          coalesce(nullif(g.sector, ''), 'Tiras Artesanais'),
          v_identity_group_id,
          v_line_color_name,
          0, 0, 'm', 0, '', true, true,
          'm', 1, NULL, 1, 1, 2
        FROM public.product_groups g
        WHERE g.id = v_identity_group_id
        RETURNING jsonb_build_object('finished_product_id', id) INTO v_catalog;
        IF v_catalog IS NULL OR nullif(v_catalog ->> 'finished_product_id', '') IS NULL THEN
          RAISE EXCEPTION 'Grupo acabado da tira pronta nao existe';
        END IF;
      END IF;$old$;

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION
      'prepare_sale_order_item_internal_straps: bloco INSERT sku_acabado nao encontrado; recuse 45200';
  END IF;

  v_new := $new$IF NOT FOUND OR nullif(v_catalog ->> 'finished_product_id', '') IS NULL THEN
        -- strap_pv_sku_acabado_exige_cadastro_hub_20270101045200
        RAISE EXCEPTION
          'Modelo % / %, %: nao ha SKU de compra pronta da cor % no grupo %. Cadastre a tira no Hub (identidade acabada / Comprar pronto) antes de salvar o pedido',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA'),
          coalesce(nullif(v_line_color_name, ''), 'sem cor'),
          coalesce(
            (SELECT nullif(g.name, '') FROM public.product_groups g WHERE g.id = v_identity_group_id),
            v_identity_group_id::text
          );
      END IF;$new$;

  v_src := replace(v_src, v_old, v_new);

  IF position('strap_pv_sku_acabado_exige_cadastro_hub_20270101045200' IN v_src) = 0 THEN
    RAISE EXCEPTION 'prepare: marcador 45200 nao gravado apos replace';
  END IF;

  IF position(v_old IN v_src) > 0 THEN
    RAISE EXCEPTION 'prepare: bloco INSERT sku_acabado ainda presente apos replace';
  END IF;

  EXECUTE v_src;
END
$$;
