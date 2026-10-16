-- =============================================================================
-- Aviso de pre-demanda: falar do que existe NAQUELA origem de tira
-- =============================================================================
-- Reportado pelo dono (14/10/2026), olhando o bloco "Tiras · comprar pronto" do
-- relatorio de consumo: o ▲ dizia
--
--   "A versao, O RENDIMENTO e A NECESSIDADE DE BASE serao congelados na
--    primeira demanda; antes disso, apenas os IDs e o consumo tecnico do item
--    estao preservados."
--
-- Em tira COMPRADA PRONTA nao existe rendimento nem necessidade de napa-base:
-- a tira chega acabada, nao se converte de napa nenhuma. O proprio engine diz
-- isso -- `process_strap_demand_job` grava
-- `CASE WHEN v_source_mode='internal' THEN v_yield ELSE NULL END`, e medido em
-- 14/10/2026: das 1.502 demandas `buy_ready` do banco, ZERO carregam
-- `confirmed_yield_snapshot`. O aviso nomeava dois campos que naquelas linhas
-- nunca serao preenchidos, mandando o operador procurar cadastro que nao falta.
--
-- A condicao NAO muda: o ramo continua sendo "esta linha ainda nao tem demanda
-- corrente em sale_order_strap_demands". Muda so o texto, por origem.
--
-- ⚠ As duas redacoes mantem "congelad" + "primeira demanda" de proposito.
-- `isSoftStrapPrebaselineNoise` (src/lib/strapRollCut.ts) casa exatamente esses
-- dois tokens para classificar o aviso como SOFT; um texto sem eles faria
-- `isArtisanalStrapCutBlocked` tratar a linha como cadastro incompleto e ZERAR
-- a napa -- que foi o bug dos PV-00222…227. Ao mexer aqui, mexa la junto.
--
-- ⚠ A redacao de `internal` fica BYTE A BYTE igual: ela esta travada em
-- canonicalStrapDemandPreview.test.ts, materialConsumptionReport.test.ts e
-- aggregateStrapNapaSector.test.ts.
--
-- Corpo copiado da definicao VIVA (pg_get_functiondef em 14/10/2026), nao do
-- arquivo da migration 20270101015500 -- entre as duas houve a
-- 20270101031900 (strap_pv_sku_acabado_sem_variante), cujo ramo de SKU acabado
-- sem variante seria perdido numa copia do arquivo antigo.

BEGIN;

CREATE OR REPLACE FUNCTION private.resolve_committed_strap_identity(
  p_sale_order_item_id uuid,
  p_technical_strap_line_id uuid,
  p_strap_sourcing jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_demand_count integer := 0;
  v_selection jsonb;
  v_source_mode text;
  v_variant_id uuid;
  v_recipe_id uuid;
  v_base_product_id uuid;
  v_finished_product_id uuid;
  v_variant_measure_id uuid;
  v_variant_base_group_id uuid;
  v_variant_color_id uuid;
  v_variant_identity_basis text;
BEGIN
  IF p_sale_order_item_id IS NULL OR p_technical_strap_line_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'missing',
      'reason', 'Linha comprometida sem UUID tecnico'
    );
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_demand_count
    FROM public.sale_order_strap_demands demand
   WHERE demand.sale_order_item_id = p_sale_order_item_id
     AND demand.technical_strap_line_id = p_technical_strap_line_id
     AND demand.is_current;
  IF v_demand_count > 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'demand',
      'reason', 'Mais de uma demanda corrente para o mesmo UUID de tira'
    );
  ELSIF v_demand_count = 1 THEN
    SELECT demand.*
      INTO v_demand
      FROM public.sale_order_strap_demands demand
     WHERE demand.sale_order_item_id = p_sale_order_item_id
       AND demand.technical_strap_line_id = p_technical_strap_line_id
       AND demand.is_current;
    RETURN pg_catalog.jsonb_build_object(
      'valid', true,
      'snapshot_source', 'demand',
      'source_mode', v_demand.source_mode,
      'strap_variant_id', v_demand.strap_variant_id,
      'recipe_id', v_demand.recipe_id,
      'recipe_version', v_demand.recipe_version_snapshot,
      'base_product_id', v_demand.base_product_id,
      'finished_product_id', v_demand.finished_product_id,
      'confirmed_yield_m_per_m', v_demand.confirmed_yield_snapshot,
      'base_required_m', v_demand.base_required_m,
      'physical_snapshot_complete', true,
      'resolved_snapshot', COALESCE(
        v_demand.identity_snapshot -> 'resolved', '{}'::jsonb
      )
    );
  END IF;

  v_selection := COALESCE(
    p_strap_sourcing -> p_technical_strap_line_id::text,
    '{}'::jsonb
  );
  IF pg_catalog.jsonb_typeof(v_selection) IS DISTINCT FROM 'object' THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Origem congelada da linha nao e objeto JSON'
    );
  END IF;
  v_source_mode := NULLIF(pg_catalog.btrim(
    v_selection ->> 'source_mode'
  ), '');
  v_variant_id := public.try_parse_uuid(
    v_selection ->> 'strap_variant_id'
  );
  v_recipe_id := public.try_parse_uuid(v_selection ->> 'recipe_id');
  v_base_product_id := public.try_parse_uuid(
    v_selection ->> 'base_product_id'
  );

  -- strap_pv_sku_acabado_sem_variante_20270101031900
  IF COALESCE(v_source_mode, '') NOT IN ('internal', 'buy_ready') THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Origem/variante congelada ausente ou invalida'
    );
  END IF;
  IF v_source_mode = 'buy_ready'
     AND v_variant_id IS NULL
     AND public.try_parse_uuid(v_selection ->> 'finished_product_id') IS NOT NULL THEN
    SELECT product.id,
           public.try_parse_uuid(v_selection ->> 'color_id'),
           product.group_id,
           'finished_product_group'
      INTO v_finished_product_id,
           v_variant_color_id,
           v_variant_base_group_id,
           v_variant_identity_basis
      FROM public.products product
     WHERE product.id = public.try_parse_uuid(v_selection ->> 'finished_product_id')
       AND product.active
       AND product.unit = 'm';
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'valid', false,
        'snapshot_source', 'sale_order_item_pre_demand',
        'reason', 'SKU acabado congelado da tira pronta nao existe mais'
      );
    END IF;
    v_variant_measure_id := NULL;
  ELSIF v_variant_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Origem/variante congelada ausente ou invalida'
    );
  ELSE
    SELECT variant.finished_product_id,
           variant.measure_id,
           variant.base_group_id,
           variant.color_id,
           variant.identity_basis
      INTO v_finished_product_id,
           v_variant_measure_id,
           v_variant_base_group_id,
           v_variant_color_id,
           v_variant_identity_basis
      FROM public.artisanal_strap_variants variant
     WHERE variant.id = v_variant_id;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'valid', false,
        'snapshot_source', 'sale_order_item_pre_demand',
        'reason', 'Variante congelada da tira nao existe mais'
      );
    END IF;
  END IF;

  IF v_source_mode = 'internal' THEN
    IF v_recipe_id IS NULL OR v_base_product_id IS NULL THEN
      RETURN pg_catalog.jsonb_build_object(
        'valid', false,
        'snapshot_source', 'sale_order_item_pre_demand',
        'reason', 'Receita/produto-base congelado ausente na tira interna'
      );
    END IF;
  ELSIF v_recipe_id IS NOT NULL OR v_base_product_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Tira comprada pronta carrega receita/produto-base indevido'
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'valid', true,
    'snapshot_source', 'sale_order_item_pre_demand',
    'source_mode', v_source_mode,
    'strap_variant_id', v_variant_id,
    'recipe_id', v_recipe_id,
    'recipe_version', NULL,
    'measure_id', v_variant_measure_id,
    'base_group_id', v_variant_base_group_id,
    'color_id', v_variant_color_id,
    'identity_basis', v_variant_identity_basis,
    'base_product_id', v_base_product_id,
    'finished_product_id', v_finished_product_id,
    'confirmed_yield_m_per_m', NULL,
    'base_required_m', NULL,
    'physical_snapshot_complete', false,
    'snapshot_warning',
      CASE WHEN v_source_mode = 'buy_ready'
        THEN 'A versao e o consumo desta tira comprada pronta serao congelados na primeira demanda; antes disso, apenas os IDs e o consumo tecnico do item estao preservados.'
        ELSE 'A versao, o rendimento e a necessidade de base serao congelados na primeira demanda; antes disso, apenas os IDs e o consumo tecnico do item estao preservados.'
      END,
    'resolved_snapshot', '{}'::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.resolve_committed_strap_identity(
  uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
