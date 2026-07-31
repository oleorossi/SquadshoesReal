-- Religa os DOIS consumidores da familia da tira na versao variant-aware
-- (strap_base_family_for_sheet de 2 args, migration 20261026120000).
--
-- debit_strap_stock         -> reserva/debito da OP
-- resolve_strap_stock_lines -> compras (compute_materials_per_pv chama esta,
--                              ja passando soi.id, entao compras vem de brinde)
--
-- POR QUE substituicao verificada e nao um CREATE OR REPLACE do corpo inteiro:
-- debit_strap_stock tem ~10.600 chars no banco e o arquivo que a define
-- (20261021130000) e menor -- ou seja, o objeto vivo recebeu alteracoes que o
-- arquivo nao tem. Colar um corpo "completo" aqui REGREDIRIA essas alteracoes
-- em silencio. Cada ancora e conferida e a migration ABORTA se nao encontrar,
-- entao nao existe no-op silencioso; e o replace e idempotente (rodar 2x nao
-- duplica nada, so falha na ancora ja consumida -- ver o guard no fim).
--
-- Vale a regra do CLAUDE.md: a verdade e o BANCO. Conferir com
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='debit_strap_stock';

DO $migration$
DECLARE
  v_src text;
  v_new text;
BEGIN
  -- ── 1) debit_strap_stock ────────────────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'debit_strap_stock';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'debit_strap_stock nao existe no banco';
  END IF;

  -- Ja religada (replay/re-execucao): nada a fazer nesta funcao.
  IF v_src ~ 'strap_base_family_for_sheet\(v_ref_id, v_variant_id\)' THEN
    RAISE NOTICE 'debit_strap_stock ja usa a familia da variante - pulando';
  ELSE
    -- 1a) variavel pra guardar a variante do item do PV
    v_new := replace(v_src,
      'v_soi_id uuid; v_ref_id uuid; v_family text; v_pv_created date;',
      'v_soi_id uuid; v_ref_id uuid; v_family text; v_pv_created date; v_variant_id uuid;');
    IF v_new = v_src THEN
      RAISE EXCEPTION 'ancora DECLARE nao encontrada em debit_strap_stock';
    END IF;
    v_src := v_new;

    -- 1b) a familia passa a sair da variante do item (NULL => cai na ficha,
    --     que e o comportamento de hoje e cobre as OPs sem sale_order_item_id)
    v_new := replace(v_src,
      'IF v_use_engine THEN v_family := public.strap_base_family_for_sheet(v_ref_id); END IF;',
      'IF v_use_engine THEN' || chr(10) ||
      '      SELECT soi.material_variant_id INTO v_variant_id' || chr(10) ||
      '        FROM public.sale_order_items soi WHERE soi.id = v_soi_id;' || chr(10) ||
      '      v_family := public.strap_base_family_for_sheet(v_ref_id, v_variant_id);' || chr(10) ||
      '    END IF;');
    IF v_new = v_src THEN
      RAISE EXCEPTION 'ancora da chamada nao encontrada em debit_strap_stock';
    END IF;
    v_src := v_new;

    -- 1c) rastro no metadata da reserva: qual familia saiu e de ONDE ela veio
    v_new := replace(v_src,
      '''sourcing'', COALESCE(v_sourcing, ''legacy''))',
      '''sourcing'', COALESCE(v_sourcing, ''legacy''), ''base_family'', v_family, ' ||
      '''family_source'', CASE WHEN v_variant_id IS NOT NULL THEN ''variant'' ELSE ''sheet'' END)');
    IF v_new = v_src THEN
      RAISE EXCEPTION 'ancora do metadata nao encontrada em debit_strap_stock';
    END IF;

    EXECUTE v_new;
  END IF;

  -- ── 2) resolve_strap_stock_lines ────────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'resolve_strap_stock_lines';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'resolve_strap_stock_lines nao existe no banco';
  END IF;

  IF v_src ~ 'strap_base_family_for_sheet\(p_reference_id,' THEN
    RAISE NOTICE 'resolve_strap_stock_lines ja usa a familia da variante - pulando';
  ELSE
    v_new := replace(v_src,
      'v_family := public.strap_base_family_for_sheet(p_reference_id);',
      'v_family := public.strap_base_family_for_sheet(p_reference_id,' || chr(10) ||
      '                (SELECT soi.material_variant_id FROM public.sale_order_items soi' || chr(10) ||
      '                  WHERE soi.id = p_sale_order_item_id));');
    IF v_new = v_src THEN
      RAISE EXCEPTION 'ancora da chamada nao encontrada em resolve_strap_stock_lines';
    END IF;

    EXECUTE v_new;
  END IF;
END $migration$;

-- Guarda: as duas funcoes TEM que estar chamando a versao de 2 argumentos.
-- Se uma reescrita futura de RLS/motor apagar isso, esta migration nao volta
-- sozinha -- mas o teste falha e alguem ve. (Mesma licao do trigger de
-- profiles: guarda que vive so num lugar e apagada por reescrita.)
DO $check$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('debit_strap_stock', 'resolve_strap_stock_lines')
     AND pg_get_functiondef(p.oid) !~ 'strap_base_family_for_sheet\([^)]*,';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ainda chamam a versao variant-blind: %', v_bad;
  END IF;
END $check$;
