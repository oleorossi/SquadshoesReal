-- Tira artesanal: UM motor só entre compra e reserva
-- Spec: specs/tira-artesanal-fonte-unica-e-os-cabedal.md
--
-- PROBLEMA (medido no PV-00148 em 31/07/2026): `is_artisanal` vive em 9 funções
-- de compras/MRP/ondas e em NENHUMA de reserva/débito. Resultado: compras
-- converte a tira em napa e não compra a tira; produção reserva A TIRA (estoque
-- 0). 8 de 24 materiais divergem — falta permanente que a compra nunca resolve.
--
-- ESTA MIGRATION é a FUNDAÇÃO: extrai a resolução "tira artesanal → napa", que
-- hoje só existe embutida dentro de compute_materials_per_pv, para funções
-- COMPARTILHADAS que os dois lados vão chamar.
--   ⚠ Nada de comportamento muda aqui. Os consumidores (debit_strap_stock e
--   compute_materials_per_pv) são religados numa migration seguinte, DEPOIS
--   que o teste de paridade provar que o resolvedor reproduz os números atuais.
--
-- Decisões (grill 31/07 com o dono):
--   • "faço aqui" × "compro pronta" → POR LINHA DE TIRA DO PV, default do produto
--   • "faço aqui" → sai NAPA do estoque, nunca a tira
--   • napa-base = FAMÍLIA + COR; família da ficha (cabedal → fallback FORRAÇÃO)
--   • sem napa naquela família+cor → BLOQUEIA dizendo o que cadastrar

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Override por linha de tira do PV
-- ─────────────────────────────────────────────────────────────────────────────
-- Mapa { "<group_id>|<COR NORMALIZADA>": "in_house" | "purchased" }.
-- A chave espelha o par (group_id, color) das entradas de
-- sale_order_items.strap_colors, que é o que a UI do PV manipula.
-- NULL / chave ausente = herda products.is_artisanal (comportamento atual).
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS strap_sourcing jsonb;

COMMENT ON COLUMN public.sale_order_items.strap_sourcing IS
  'Override por linha de tira: {"<group_id>|<COR>": "in_house"|"purchased"}. '
  'Ausente = herda products.is_artisanal. in_house faz sair NAPA do estoque; '
  'purchased faz sair a própria tira. Lido por resolve_strap_sourcing().';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Família da napa da ficha: cabedal, caindo pra forração
-- ─────────────────────────────────────────────────────────────────────────────
-- Regra do dono: a tira sai da mesma família de napa do CABEDAL do modelo; se o
-- modelo não tem cabedal cadastrado e é só de tiras, sai da FORRAÇÃO.
-- (Verificado: NL02/NL03/NL04 do PV-00148 têm upper_material vazio e
-- lining_material = NAPA SOFT / NAPA MADRID — o fallback é o caso REAL aqui,
-- não uma exceção rara.)
CREATE OR REPLACE FUNCTION public.strap_base_family_for_sheet(p_reference_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public, extensions'
AS $function$
  SELECT COALESCE(
           NULLIF(btrim(ts.upper_material), ''),
           NULLIF(btrim(ts.lining_material), '')
         )
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.strap_base_family_for_sheet(uuid) IS
  'Família de napa de que as tiras artesanais deste modelo são cortadas: '
  'upper_material (cabedal); se vazio (modelo só de tiras), lining_material '
  '(forração). Decidido com o dono em 31/07/2026.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Decisão de origem da tira (in_house × purchased)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_strap_sourcing(
  p_sale_order_item_id uuid,
  p_strap_product_id   uuid,
  p_group_id           uuid,
  p_color              text
)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public, extensions'
AS $function$
DECLARE
  v_map      jsonb;
  v_key      text;
  v_override text;
  v_artisanal boolean;
BEGIN
  -- Override explícito do PV vence sempre.
  IF p_sale_order_item_id IS NOT NULL AND p_group_id IS NOT NULL THEN
    SELECT soi.strap_sourcing INTO v_map
      FROM public.sale_order_items soi WHERE soi.id = p_sale_order_item_id;
    IF v_map IS NOT NULL AND jsonb_typeof(v_map) = 'object' THEN
      v_key := p_group_id::text || '|' || upper(btrim(unaccent(COALESCE(p_color, ''))));
      v_override := v_map ->> v_key;
      IF v_override IN ('in_house', 'purchased') THEN
        RETURN v_override;
      END IF;
    END IF;
  END IF;

  -- Sem override: o cadastro do produto decide (comportamento atual).
  SELECT COALESCE(p.is_artisanal, false) INTO v_artisanal
    FROM public.products p WHERE p.id = p_strap_product_id;

  RETURN CASE WHEN COALESCE(v_artisanal, false) THEN 'in_house' ELSE 'purchased' END;
END $function$;

COMMENT ON FUNCTION public.resolve_strap_sourcing(uuid, uuid, uuid, text) IS
  'Decide se a tira é cortada aqui (in_house → sai napa) ou comprada pronta '
  '(purchased → sai a tira). Precedência: override da linha do PV '
  '(sale_order_items.strap_sourcing) > products.is_artisanal.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Napa-base da tira: família + cor
-- ─────────────────────────────────────────────────────────────────────────────
-- Espelha EXATAMENTE a resolução que hoje vive embutida em
-- compute_materials_per_pv (join artisanal_recipes → product_groups → products),
-- para que os dois lados passem a usar esta função em vez de reimplementar.
-- Diferença deliberada: quando não acha, devolve `block_reason` preenchido em
-- vez de silenciosamente tratar a tira como comprada — foi esse silêncio que
-- deixou a Meia Cana TAN escapar (18 das 25 tiras não têm napa na mesma cor).
CREATE OR REPLACE FUNCTION public.resolve_strap_base_napa(
  p_strap_product_id uuid,
  p_family           text,
  p_color            text
)
 RETURNS TABLE(
   base_product_id  uuid,
   base_product_name text,
   yield_per_meter  numeric,
   recipe_id        uuid,
   block_reason     text
 )
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public, extensions'
AS $function$
DECLARE
  v_grp_name text;
  v_strap_name text;
  v_rec RECORD;
  v_bp  RECORD;
  v_color_norm text := lower(btrim(unaccent(COALESCE(p_color, ''))));
BEGIN
  SELECT pg.name, p.name INTO v_grp_name, v_strap_name
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id = p.group_id
   WHERE p.id = p_strap_product_id;

  IF v_grp_name IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::numeric, NULL::uuid,
      format('Tira "%s" não está em nenhum grupo — não dá pra achar a receita de corte.',
             COALESCE(v_strap_name, p_strap_product_id::text));
    RETURN;
  END IF;

  IF COALESCE(btrim(p_family), '') = '' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::numeric, NULL::uuid,
      format('Modelo sem material de cabedal nem de forração cadastrado — '
             || 'impossível saber de qual napa a tira "%s" é cortada.', v_grp_name);
    RETURN;
  END IF;

  -- Receita: grupo da tira × família da napa.
  SELECT ar.id, ar.base_product_name, ar.yield_per_meter
    INTO v_rec
    FROM public.artisanal_recipes ar
   WHERE ar.active = true
     AND lower(btrim(unaccent(ar.artisanal_product_name))) = lower(btrim(unaccent(v_grp_name)))
     AND lower(btrim(unaccent(ar.base_product_name)))      = lower(btrim(unaccent(p_family)))
   LIMIT 1;

  IF v_rec.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::numeric, NULL::uuid,
      format('Não existe receita de "%s" em %s — cadastre o rendimento (m de tira por m de napa).',
             v_grp_name, p_family);
    RETURN;
  END IF;

  IF COALESCE(v_rec.yield_per_meter, 0) <= 0 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::numeric, v_rec.id,
      format('Receita de "%s" em %s está com rendimento zerado — corrija o m/m.',
             v_grp_name, p_family);
    RETURN;
  END IF;

  -- Produto de napa: mesma família, MESMA COR da tira.
  SELECT bp2.id, bp2.name INTO v_bp
    FROM public.products bp2
    LEFT JOIN public.product_groups bpg ON bpg.id = bp2.group_id
   WHERE bp2.active = true
     AND (lower(btrim(unaccent(COALESCE(bpg.name, '')))) = lower(btrim(unaccent(v_rec.base_product_name)))
          OR lower(btrim(unaccent(bp2.name))) = lower(btrim(unaccent(v_rec.base_product_name))))
     AND (v_color_norm = '' OR lower(btrim(unaccent(COALESCE(bp2.color, '')))) = v_color_norm)
   ORDER BY (lower(btrim(unaccent(COALESCE(bp2.color, '')))) = v_color_norm) DESC,
            bp2.quantity DESC NULLS LAST
   LIMIT 1;

  IF v_bp.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, v_rec.yield_per_meter, v_rec.id,
      format('"%s" está marcada como cortada aqui, mas não existe %s na cor %s no estoque — '
             || 'cadastre a napa ou marque a tira como comprada pronta.',
             v_grp_name, v_rec.base_product_name, COALESCE(NULLIF(p_color, ''), '(sem cor)'));
    RETURN;
  END IF;

  RETURN QUERY SELECT v_bp.id, v_bp.name, v_rec.yield_per_meter, v_rec.id, NULL::text;
END $function$;

COMMENT ON FUNCTION public.resolve_strap_base_napa(uuid, text, text) IS
  'Napa de que a tira artesanal é cortada: FAMÍLIA (da ficha: cabedal, fallback '
  'forração) + COR (a da tira). Devolve block_reason quando não resolve, em vez '
  'de tratar a tira como comprada em silêncio.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) MOTOR ÚNICO: o que realmente sai do estoque por causa das tiras de um item
-- ─────────────────────────────────────────────────────────────────────────────
-- Ponto de entrada que compras E reserva/débito devem usar. Combina:
--   order_strap_needs (demanda canônica de tira, já compartilhada)
--   + resolve_strap_sourcing (in_house × purchased)
--   + resolve_strap_base_napa (napa da família+cor)
--
-- Devolve SEMPRE as duas grandezas na mesma linha, que é o que o picking pede:
--   strap_* = o material PRONTO (o que o operador vai cortar/separar)
--   stock_* = o que efetivamente sai do estoque (napa quando in_house)
CREATE OR REPLACE FUNCTION public.resolve_strap_stock_lines(
  p_sale_order_item_id uuid,
  p_reference_id       uuid,
  p_strap_colors       jsonb,
  p_order_quantity     numeric,
  p_order_grade        jsonb
)
 RETURNS TABLE(
   strap_product_id   uuid,
   strap_product_name text,
   strap_color        text,
   strap_group_id     uuid,
   strap_required_m   numeric,
   sourcing           text,
   stock_product_id   uuid,
   stock_product_name text,
   stock_required     numeric,
   yield_per_meter    numeric,
   base_family        text,
   block_reason       text
 )
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public, extensions'
AS $function$
DECLARE
  v_family text;
  v_need   RECORD;
  v_src    text;
  v_base   RECORD;
BEGIN
  v_family := public.strap_base_family_for_sheet(p_reference_id);

  FOR v_need IN
    SELECT * FROM public.order_strap_needs(p_strap_colors, p_order_quantity, p_order_grade)
  LOOP
    -- Linha de warning do próprio order_strap_needs (tira sem cor/sem consumo):
    -- repassa intacta, sem tentar resolver napa.
    IF v_need.product_id IS NULL OR COALESCE(v_need.resolved, false) = false THEN
      RETURN QUERY SELECT
        v_need.product_id, v_need.product_name, v_need.color, v_need.group_id,
        v_need.required_m, 'unresolved'::text,
        NULL::uuid, NULL::text, NULL::numeric, NULL::numeric, v_family,
        format('Tira não resolvida no PV: %s', v_need.product_name);
      CONTINUE;
    END IF;

    v_src := public.resolve_strap_sourcing(
               p_sale_order_item_id, v_need.product_id, v_need.group_id, v_need.color);

    IF v_src = 'purchased' THEN
      -- Comprada pronta: sai a PRÓPRIA tira do estoque. Compra e reserva
      -- concordam trivialmente.
      RETURN QUERY SELECT
        v_need.product_id, v_need.product_name, v_need.color, v_need.group_id,
        v_need.required_m, 'purchased'::text,
        v_need.product_id, v_need.product_name, v_need.required_m,
        NULL::numeric, v_family, NULL::text;
      CONTINUE;
    END IF;

    -- Cortada aqui: sai NAPA.
    SELECT * INTO v_base
      FROM public.resolve_strap_base_napa(v_need.product_id, v_family, v_need.color);

    IF v_base.block_reason IS NOT NULL THEN
      RETURN QUERY SELECT
        v_need.product_id, v_need.product_name, v_need.color, v_need.group_id,
        v_need.required_m, 'in_house'::text,
        NULL::uuid, NULL::text, NULL::numeric, v_base.yield_per_meter, v_family,
        v_base.block_reason;
      CONTINUE;
    END IF;

    RETURN QUERY SELECT
      v_need.product_id, v_need.product_name, v_need.color, v_need.group_id,
      v_need.required_m, 'in_house'::text,
      v_base.base_product_id, v_base.base_product_name,
      round(v_need.required_m / v_base.yield_per_meter, 6),
      v_base.yield_per_meter, v_family, NULL::text;
  END LOOP;
END $function$;

COMMENT ON FUNCTION public.resolve_strap_stock_lines(uuid, uuid, jsonb, numeric, jsonb) IS
  'MOTOR ÚNICO das tiras: demanda (order_strap_needs) + origem (in_house x '
  'purchased) + napa-base (família+cor). Devolve o material PRONTO (strap_*) e '
  'o que sai do estoque (stock_*) na MESMA linha — é o que o picking mostra. '
  'Compras e reserva/débito DEVEM consumir esta função em vez de reimplementar.';
