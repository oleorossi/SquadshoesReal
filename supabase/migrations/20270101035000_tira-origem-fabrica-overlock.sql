-- =============================================================================
-- Tiras — Fatia 2, parte 1 (specs/tiras-fluxos-por-origem.md, Revisão 3, Q28)
-- Três origens: Fábrica (Overlock) | Prestador | Comprar pronto.
-- =============================================================================
-- A Fatia 1 (32300) fez o valor gravado 'fabrica' SIGNIFICAR Prestador, porque
-- a Revisão 2 dizia que a fábrica nunca corta tira. A Revisão 3 desfaz isso só
-- para a TIRA OVERLOCK 5MM: a fábrica faz a Overlock (napa sai do estoque pelo
-- botão "Debitar napa" do Ateliê). Mudança mínima:
--
--   sale_order_items.strap_colors[].pv_origem
--     'fabrica'     → Fábrica           (volta ao sentido literal)
--     'prestador'   → Prestador
--     'sku_acabado' → Comprar pronto
--   artisanal_strap_measures.origem_padrao
--     'sempre_fabrica'     → padrão Fábrica   (só a Overlock 5 mm)
--     'sempre_prestador'   → padrão Prestador (NOVO valor)
--     'sempre_sku_acabado' → padrão Comprar pronto
--     'escolhe_no_pv'      → legado = padrão Prestador
--   strap_sourcing.source_mode continua 'internal' para Fábrica E Prestador
--   (os dois têm napa-base); quem distingue é o pv_origem da linha.
--
-- O que este arquivo faz:
--   1. CHECK de origem_padrao aceita 'sempre_prestador'.
--   2. save_artisanal_strap_measure_hub_fields aceita 'sempre_prestador'.
--   3. Catálogo: Overlock 5 mm → sempre_fabrica; demais medidas que não são
--      Comprar pronto → sempre_prestador (contado, RAISE se divergir).
--   4. prepare_sale_order_item_internal_straps: o padrão de pv_origem ausente
--      passa a ser fabrica|prestador|sku_acabado pelo catálogo, e a coerção da
--      28600 (Comprar pronto sem group_id) cai no padrão da medida em vez de
--      sempre 'fabrica'.
-- A conversão dos PVs abertos ('fabrica' gravado como Prestador em medida que
-- não é Overlock) fica na migration seguinte (33300).
-- Marcador: strap_pv_origem_tres_origens_20270101033200
-- =============================================================================

-- 1. CHECK ---------------------------------------------------------------------
ALTER TABLE public.artisanal_strap_measures
  DROP CONSTRAINT IF EXISTS artisanal_strap_measures_origem_padrao_ck;
ALTER TABLE public.artisanal_strap_measures
  ADD CONSTRAINT artisanal_strap_measures_origem_padrao_ck
  CHECK (origem_padrao = ANY (ARRAY[
    'sempre_fabrica'::text,
    'sempre_prestador'::text,
    'sempre_sku_acabado'::text,
    'escolhe_no_pv'::text
  ]));

-- 2. RPC do Hub ----------------------------------------------------------------
DO $patch_hub$
DECLARE
  v_fn regprocedure := 'public.save_artisanal_strap_measure_hub_fields(uuid,jsonb,text)'::regprocedure;
  v_def text;
  v_old text := $old_hub$v_origem NOT IN ('sempre_fabrica', 'sempre_sku_acabado', 'escolhe_no_pv') THEN$old_hub$;
  v_new text := $new_hub$v_origem NOT IN ('sempre_fabrica', 'sempre_prestador', 'sempre_sku_acabado', 'escolhe_no_pv') THEN
      -- strap_pv_origem_tres_origens_20270101033200$new_hub$;
  v_hits integer;
BEGIN
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_origem_tres_origens_20270101033200' IN v_def) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'save_artisanal_strap_measure_hub_fields: trecho de validacao de origem nao encontrado (hits=%); revise 33200', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_hub$;

-- 3. Catálogo --------------------------------------------------------------------
DO $catalog$
DECLARE
  v_overlock integer;
  v_prestador integer;
  v_updated integer;
BEGIN
  PERFORM set_config('app.strap_change_reason',
    'Revisao 3 (Q28): Overlock 5 mm = Fabrica; demais tiras de napa = Prestador', true);

  SELECT count(*) INTO v_overlock
    FROM public.artisanal_strap_measures m
    JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
   WHERE t.name_norm = 'tira overlock'
     AND m.finished_width_mm = 5;
  -- Medido em 10/10/2026: exatamente 1 (06500a23…, TIRA OVERLOCK 5 mm).
  IF v_overlock <> 1 THEN
    RAISE EXCEPTION 'Esperava 1 medida TIRA OVERLOCK 5 mm, achei %', v_overlock;
  END IF;

  UPDATE public.artisanal_strap_measures m
     SET origem_padrao = 'sempre_fabrica'
    FROM public.artisanal_strap_types t
   WHERE t.id = m.strap_type_id
     AND t.name_norm = 'tira overlock'
     AND m.finished_width_mm = 5
     AND m.origem_padrao IS DISTINCT FROM 'sempre_fabrica';

  SELECT count(*) INTO v_prestador
    FROM public.artisanal_strap_measures m
    JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
   WHERE NOT (t.name_norm = 'tira overlock' AND m.finished_width_mm = 5)
     AND m.origem_padrao IN ('escolhe_no_pv', 'sempre_fabrica');
  -- Medido em 10/10/2026: 7 (TIRA CHATA 8/25, TIRA CHATA COSTURADA 11,
  -- MEIA CANA 10, ELÁSTICO FORRADO 7, Overlock Redonda 6, TRANÇA 3) — todas
  -- escolhe_no_pv. Strass (2) já é sempre_sku_acabado e não muda.
  -- Tolerância pequena para medida cadastrada entre a medição e o deploy.
  IF v_prestador > 12 THEN
    RAISE EXCEPTION 'Esperava ~7 medidas de napa para Prestador, achei %; revise 33200', v_prestador;
  END IF;

  UPDATE public.artisanal_strap_measures m
     SET origem_padrao = 'sempre_prestador'
    FROM public.artisanal_strap_types t
   WHERE t.id = m.strap_type_id
     AND NOT (t.name_norm = 'tira overlock' AND m.finished_width_mm = 5)
     AND m.origem_padrao IN ('escolhe_no_pv', 'sempre_fabrica');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '33200: 1 medida Overlock -> sempre_fabrica; % medidas -> sempre_prestador', v_updated;
END;
$catalog$;

COMMENT ON COLUMN public.artisanal_strap_measures.origem_padrao IS
  'PADRAO de origem da tira no PV (Revisao 3, Q28): sempre_fabrica = Fabrica (so TIRA OVERLOCK 5MM; napa sai pelo botao Debitar napa do Atelie); sempre_prestador e escolhe_no_pv (legado) = Prestador; sempre_sku_acabado = Comprar pronto. O PV troca na excecao via strap_colors[].pv_origem (fabrica|prestador|sku_acabado).';

-- 4. Writer do PV ----------------------------------------------------------------
DO $patch_prepare$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old_default text := $old_default$          ) THEN 'sku_acabado'
          ELSE 'fabrica'
        END$old_default$;
  v_new_default text := $new_default$          ) THEN 'sku_acabado'
          -- strap_pv_origem_tres_origens_20270101033200
          WHEN EXISTS (
            SELECT 1
              FROM public.artisanal_strap_measures measure
             WHERE measure.id = v_measure_id
               AND measure.origem_padrao = 'sempre_fabrica'
          ) THEN 'fabrica'
          ELSE 'prestador'
        END$new_default$;
  v_old_coerce text := $old_coerce$      v_line := v_line || jsonb_build_object('pv_origem', 'fabrica');$old_coerce$;
  v_new_coerce text := $new_coerce$      -- Comprar pronto impossivel cai no padrao interno da medida (33200).
      v_line := v_line || jsonb_build_object(
        'pv_origem',
        CASE
          WHEN EXISTS (
            SELECT 1
              FROM public.artisanal_strap_measures measure
             WHERE measure.id = v_measure_id
               AND measure.origem_padrao = 'sempre_fabrica'
          ) THEN 'fabrica'
          ELSE 'prestador'
        END
      );$new_coerce$;
  v_hits integer;
BEGIN
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_origem_tres_origens_20270101033200' IN v_def) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position('strap_pv_origem_padrao_catalogo_20270101032300' IN v_def) = 0 THEN
    RAISE EXCEPTION 'prepare sem o marcador da 32300; aplique a Fatia 1 antes da 33200';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old_default, ''))) / length(v_old_default);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Padrao 32300 do prepare nao encontrado (hits=%); revise 33200', v_hits;
  END IF;
  v_def := replace(v_def, v_old_default, v_new_default);

  v_hits := (length(v_def) - length(replace(v_def, v_old_coerce, ''))) / length(v_old_coerce);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Coercao 28600 do prepare nao encontrada (hits=%); revise 33200', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old_coerce, v_new_coerce);
END;
$patch_prepare$;

-- 5. Origem efetiva de uma linha (fonte única SQL p/ Ateliê e conversões) --------
CREATE OR REPLACE FUNCTION public.strap_line_effective_origem(p_line jsonb)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  -- 'fabrica' | 'prestador' | 'sku_acabado'. Escolha explícita do PV vence o
  -- catálogo; tira de identidade acabada (Strass da ficha) é sempre Comprar
  -- pronto; sem escolha vale o padrão da medida (escolhe_no_pv = Prestador).
  SELECT CASE
    WHEN coalesce(nullif(p_line ->> 'identity_basis', ''), 'reference_base')
         = 'finished_product_group' THEN 'sku_acabado'
    WHEN p_line ->> 'pv_origem' IN ('fabrica', 'prestador', 'sku_acabado')
      THEN p_line ->> 'pv_origem'
    ELSE coalesce((
      SELECT CASE m.origem_padrao
               WHEN 'sempre_fabrica' THEN 'fabrica'
               WHEN 'sempre_sku_acabado' THEN 'sku_acabado'
               ELSE 'prestador'
             END
        FROM public.artisanal_strap_measures m
       WHERE m.id::text = nullif(p_line ->> 'measure_id', '')
    ), 'prestador')
  END;
$fn$;

REVOKE ALL ON FUNCTION public.strap_line_effective_origem(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strap_line_effective_origem(jsonb) TO authenticated, service_role;
