-- Regra de empacotamento em caixas — lado SQL (decisão do dono, 05/08/2026).
--
-- A ficha rende mais pares do que a colmeia comporta. O excedente NÃO viaja
-- solto: sai das numerações do MENOR para o MAIOR e é consolidado, no item
-- inteiro do PV, em caixas de UMA numeração só.
--
-- PV-00151 (curva 28:2 29:2 30:2 31:2 32:3 33:2 34:2 = 15, colmeia 12), por cor:
--     sobra da ficha  = 28:2 · 29:1
--     colmeia da ficha = 29:1 30:2 31:2 32:3 33:2 34:2 = 12
--   × 12 fichas → 28: 24 pares = 2 caixas cheias · 29: 12 pares = 1 caixa cheia
--   ⇒ 12 colmeias + 3 caixas de numeração única = 15 volumes por cor, 45 no PV.
--
-- ⚠ "do menor pro maior" descreve quem vai para a SOBRA, não quem fica na
-- colmeia. Inverter produz um resultado plausível e errado (sairia o nº 32).
--
-- ⚠ A caixa de numeração única NÃO nasce na ficha — a ficha sobra DUAS
-- numerações (28 e 29). Ela nasce na CONSOLIDAÇÃO do item. Um cálculo por ficha
-- isolada nunca chega ao resultado que o dono descreveu.
--
-- POR QUE ISSO IMPORTA ALÉM DA ETIQUETA
-- O caminho anterior contava volumes como CEIL(total_de_pares / capacidade),
-- tratando os pares como fungíveis. Isso acerta por acidente quando a sobra
-- fecha caixas cheias (é o caso do PV-00151: 45 dos dois jeitos) e ERRA sempre
-- que a sobra deixa caixa parcial. Exemplo com a mesma curva e 2 fichas:
--     CEIL(30/12)                 = 3 caixas
--     empacotamento real           = 2 colmeias + 28:4 + 29:2 = 4 caixas
-- Uma caixa a menos no débito é uma caixa que a fábrica usa e o estoque não vê.
--
-- Espelho TS: `src/lib/boxPacking.ts` (58 testes). A paridade entre os dois
-- lados é travada pelo MESMO fixture nos dois: o bloco DO no fim desta migration
-- prende o lado SQL à curva do PV-00151, e `boxPacking.test.ts` prende o lado TS
-- aos mesmos números (15 volumes, 2 caixas do 28, 1 do 29, 180 pares). Mudar um
-- lado sem o outro quebra um dos dois.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A REGRA, pura: grade de UMA ficha + nº de fichas + capacidade → caixas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.packing_boxes_for_grade(
  p_grade    jsonb,
  p_fichas   integer,
  p_capacity integer
)
RETURNS TABLE(kind text, single_size text, pairs integer, contents jsonb)
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_cap           integer := GREATEST(COALESCE(p_capacity, 0), 1);
  v_fichas        integer := COALESCE(p_fichas, 0);
  v_total         integer;
  v_left          integer;
  v_take          integer;
  v_colmeia       jsonb   := '{}'::jsonb;
  v_colmeia_pairs integer := 0;
  v_sobra_map     jsonb   := '{}'::jsonb;
  r               record;
  i               integer;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' OR v_fichas <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(t.v), 0)::integer INTO v_total
    FROM (SELECT (value)::numeric AS v FROM jsonb_each_text(p_grade)) t
   WHERE t.v > 0;

  IF v_total <= 0 THEN RETURN; END IF;

  -- GUARDA: a regra só vale quando a grade É uma ficha.
  --
  -- Ficha é 12/15/18 pares (constante do projeto, `worksheet/fichaSize.ts`) e a
  -- sobra é o excedente PEQUENO sobre a caixa. PVs antigos gravaram `fichas = 1`
  -- com a grade somando o pedido inteiro — o PV-2026-00013 tem 120 pares numa
  -- única "ficha". Ali a sobra seria maior que uma caixa inteira e a regra
  -- FABRICARIA caixa quase vazia: o PV-2026-00097 (24 pares, caixa de 12)
  -- viraria 1 colmeia + 3 caixas de 4 pares, em vez de 2 caixas cheias.
  --
  -- Devolver 0 linhas faz cada chamador cair no cálculo legado — o
  -- `COALESCE(NULLIF(count,0), CEIL(...))` que já existe em todos eles. Medido
  -- antes de fixar a guarda: sem ela, 3 PVs mudavam de contagem (00013 60→72,
  -- 00097 12→24, 00139 7→8); com ela, ZERO PVs mudam além do 00151.
  IF v_total >= v_cap * 2 THEN
    RETURN;
  END IF;

  -- Reparte a ficha: a sobra sai das numerações do menor para o maior, e pode
  -- partir uma numeração ao meio (no PV-00151 leva os 2 do nº 28 e 1 dos 2 do 29).
  v_left := GREATEST(0, v_total - v_cap);
  FOR r IN
    SELECT key AS k, (value)::numeric AS q
      FROM jsonb_each_text(p_grade)
     WHERE (value)::numeric > 0
     ORDER BY NULLIF(regexp_replace(key, '[^0-9.]', '', 'g'), '')::numeric NULLS LAST, key
  LOOP
    v_take := LEAST(v_left, r.q::integer);
    v_left := v_left - v_take;
    IF v_take > 0 THEN
      v_sobra_map := v_sobra_map || jsonb_build_object(r.k, v_take);
    END IF;
    IF (r.q::integer - v_take) > 0 THEN
      v_colmeia       := v_colmeia || jsonb_build_object(r.k, r.q::integer - v_take);
      v_colmeia_pairs := v_colmeia_pairs + (r.q::integer - v_take);
    END IF;
  END LOOP;

  -- Uma colmeia por ficha — conteúdo idêntico, porque a grade da ficha é a mesma.
  IF v_colmeia_pairs > 0 THEN
    FOR i IN 1..v_fichas LOOP
      kind := 'grade'; single_size := NULL; pairs := v_colmeia_pairs; contents := v_colmeia;
      RETURN NEXT;
    END LOOP;
  END IF;

  -- Sobra: consolida no item inteiro e quebra em caixas de uma numeração só.
  -- Caixa parcial é caixa — conta como volume, com células vazias.
  FOR r IN
    SELECT key AS k, (value)::numeric AS q
      FROM jsonb_each_text(v_sobra_map)
     ORDER BY NULLIF(regexp_replace(key, '[^0-9.]', '', 'g'), '')::numeric NULLS LAST, key
  LOOP
    v_left := (r.q::integer) * v_fichas;
    WHILE v_left > 0 LOOP
      v_take := LEAST(v_left, v_cap);
      kind := 'single'; single_size := r.k; pairs := v_take;
      contents := jsonb_build_object(r.k, v_take);
      RETURN NEXT;
      v_left := v_left - v_take;
    END LOOP;
  END LOOP;
END $function$;

COMMENT ON FUNCTION public.packing_boxes_for_grade(jsonb, integer, integer) IS
  'REGRA CANÔNICA de empacotamento: sobra = Σgrade − capacidade, retirada das '
  'numerações do MENOR para o MAIOR, consolidada por numeração no item inteiro. '
  'Espelhada em src/lib/boxPacking.ts. Chamar com a grade de UMA ficha '
  '(sale_order_items.grade) — a grade de orders já vem multiplicada.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Plano de caixas de um PV — é daqui que etiqueta, conferência e qualquer
--    persistência futura de volume devem ler.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_sale_order_packing(p_sale_order_id uuid)
RETURNS TABLE(
  volume_number      integer,
  sale_order_item_id uuid,
  reference_id       uuid,
  item_color         text,
  box_type_id        uuid,
  box_name           text,
  kind               text,
  single_size        text,
  pairs              integer,
  capacity           integer,
  is_partial         boolean,
  weight_kg          numeric,
  contents           jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mode        text;
  v_target_type text;
  v_seq         integer := 0;
  it            record;
  bx            record;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;
  v_target_type := CASE
    WHEN v_mode = 'colmeia'           THEN 'colmeia'
    WHEN v_mode = 'individual_master' THEN 'master'
    ELSE 'individual'
  END;

  FOR it IN
    SELECT soi.id            AS item_id,
           soi.reference_id  AS ref_id,
           soi.color         AS col,
           soi.grade         AS grd,
           COALESCE(soi.fichas, 0) AS fic,
           bt.id             AS box_id,
           bt.nome           AS box_nm,
           COALESCE(ts.weight_per_pair_kg, 0.238) AS pair_kg,
           COALESCE(bt.empty_weight_kg, 0)        AS tare_kg,
           COALESCE(NULLIF(CASE v_target_type
             WHEN 'individual' THEN pg.pairs_per_box_individual
             WHEN 'master'     THEN pg.pairs_per_box_master
             WHEN 'colmeia'    THEN pg.pairs_per_box_colmeia
           END, 0), bt.pairs_per_box_default, 12) AS cap
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
      LEFT JOIN public.product_groups   pg ON pg.id = ts.sole_group_id
      LEFT JOIN public.box_types        bt ON bt.id = CASE v_target_type
                     WHEN 'individual' THEN pg.box_type_id
                     WHEN 'master'     THEN pg.box_type_master_id
                     WHEN 'colmeia'    THEN pg.box_type_colmeia_id
                   END
                 AND bt.active = true
     WHERE soi.sale_order_id = p_sale_order_id
       AND COALESCE(soi.quantity, 0) > 0
     ORDER BY soi.created_at NULLS LAST, soi.id
  LOOP
    FOR bx IN
      SELECT * FROM public.packing_boxes_for_grade(it.grd, it.fic, it.cap)
    LOOP
      v_seq              := v_seq + 1;
      volume_number      := v_seq;
      sale_order_item_id := it.item_id;
      reference_id       := it.ref_id;
      item_color         := it.col;
      box_type_id        := it.box_id;
      box_name           := it.box_nm;
      kind               := bx.kind;
      single_size        := bx.single_size;
      pairs              := bx.pairs;
      capacity           := it.cap;
      is_partial         := bx.pairs < it.cap;
      -- Peso do par vem SEMPRE da ficha técnica; 238 g é só o default de quem
      -- ainda não tem o valor cadastrado.
      weight_kg          := ROUND(bx.pairs * it.pair_kg + it.tare_kg, 3);
      contents           := bx.contents;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END $function$;

COMMENT ON FUNCTION public.compute_sale_order_packing(uuid) IS
  'Plano de caixas de um PV: uma linha por VOLUME, numerado no PV inteiro (= NF, '
  'porque tudo do pedido sai em uma nota só). Fonte para etiqueta, conferência e '
  'para qualquer persistência futura em shipping_volumes.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Contagem de volumes passa a usar a regra (a NF segue junto, porque
--    compute_sale_order_nfe_volumes soma o `boxes` daqui).
--
--    Mudança em relação à versão anterior: o CTE `items` deixa de agregar por
--    reference_id e passa a ser POR ITEM — a regra precisa da grade da ficha,
--    que só existe no item. O agrupamento final por box_id não muda, então o
--    shape de saída é idêntico e nada a jusante precisa mudar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_sale_order_box_breakdown(p_sale_order_id uuid)
RETURNS TABLE(box_type_id uuid, box_name text, tipo text, total_pairs integer,
              pairs_per_box integer, boxes integer, empty_weight_kg numeric,
              legacy_box_weight_kg numeric, unconfigured boolean,
              pairs_per_box_source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mode           text;
  v_target_type    text;
  v_pair_as_volume boolean;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;

  v_pair_as_volume := COALESCE(v_mode, '') IN ('individual_fitilho', 'individual_amarrado');
  v_target_type := CASE
    WHEN v_mode = 'colmeia'           THEN 'colmeia'
    WHEN v_mode = 'individual_master' THEN 'master'
    ELSE 'individual'
  END;

  RETURN QUERY
  WITH items AS (
    SELECT soi.id AS item_id,
           soi.reference_id,
           soi.quantity::integer AS qty,
           soi.grade,
           COALESCE(soi.fichas, 0) AS fichas,
           ts.box_weight_kg,
           ts.sole_group_id
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id
       AND COALESCE(soi.quantity, 0) > 0
  ),
  resolved AS (
    SELECT i.item_id, i.reference_id, i.qty, i.grade, i.fichas, i.box_weight_kg,
           bt.id   AS box_id,
           bt.nome AS box_name,
           bt.tipo::text AS bt_tipo,
           bt.pairs_per_box_default AS ppb_cadastrado,
           NULLIF(CASE v_target_type
             WHEN 'individual' THEN pg.pairs_per_box_individual
             WHEN 'master'     THEN pg.pairs_per_box_master
             WHEN 'colmeia'    THEN pg.pairs_per_box_colmeia
           END, 0) AS ppb_solado,
           bt.empty_weight_kg
      FROM items i
      LEFT JOIN public.product_groups pg ON pg.id = i.sole_group_id
      LEFT JOIN public.box_types bt
             ON bt.id = CASE v_target_type
                  WHEN 'individual' THEN pg.box_type_id
                  WHEN 'master'     THEN pg.box_type_master_id
                  WHEN 'colmeia'    THEN pg.box_type_colmeia_id
                END
            AND bt.active = true
  ),
  per_item AS (
    SELECT r.*,
           CASE WHEN v_pair_as_volume THEN 1
                ELSE COALESCE(r.ppb_solado, r.ppb_cadastrado, 12) END AS ppb_efetivo
      FROM resolved r
  ),
  per_item_boxes AS (
    SELECT p.*,
           CASE
             WHEN v_pair_as_volume THEN p.qty
             -- Capacidade 1 (sapateira/fitilho) não tem sobra a consolidar:
             -- cada par já é uma caixa. A regra só vale pra caixa COLETIVA.
             WHEN p.ppb_efetivo <= 1 THEN p.qty
             ELSE COALESCE(
               NULLIF((SELECT count(*) FROM public.packing_boxes_for_grade(
                         p.grade, p.fichas, p.ppb_efetivo)), 0)::numeric,
               -- PV antigo sem grade/fichas utilizáveis mantém o cálculo legado.
               CEIL(p.qty::numeric / GREATEST(p.ppb_efetivo, 1))
             )::integer
           END AS ref_boxes
      FROM per_item p
  )
  SELECT
    b.box_id                                            AS box_type_id,
    MAX(b.box_name)                                     AS box_name,
    COALESCE(MAX(b.bt_tipo), v_target_type)             AS tipo,
    SUM(b.qty)::integer                                 AS total_pairs,
    MAX(b.ppb_efetivo)::integer                         AS pairs_per_box,
    SUM(b.ref_boxes)::integer                           AS boxes,
    MAX(b.empty_weight_kg)                              AS empty_weight_kg,
    COALESCE(SUM(b.qty * b.box_weight_kg), 0)::numeric  AS legacy_box_weight_kg,
    bool_or(b.box_id IS NULL AND NOT v_pair_as_volume)  AS unconfigured,
    CASE
      WHEN v_pair_as_volume                  THEN 'pair_as_volume'
      WHEN MAX(b.ppb_solado) IS NOT NULL     THEN 'sole_group'
      WHEN MAX(b.ppb_cadastrado) IS NOT NULL THEN 'box_type'
      ELSE 'fallback_default'
    END                                                 AS pairs_per_box_source
  FROM per_item_boxes b
  GROUP BY b.box_id;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Débito de embalagem passa a usar a regra.
--
--    O número de fichas é derivado da QUANTIDADE DA OP (não da coluna `fichas`
--    do item), porque uma OP pode ser um recorte do item do PV — usar as fichas
--    cheias do item debitaria caixa a mais.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid, p_order_id uuid, p_reference_id uuid,
  p_order_quantity integer, p_packaging_mode text DEFAULT 'individual_master'::text,
  p_force_soft boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sole_group_id    uuid;
  v_types_to_debit   text[];
  v_result           jsonb := '[]'::jsonb;
  v_pg               RECORD;
  v_pkg_type         text;
  v_box_id           uuid;
  v_box_name         text;
  v_box_tipo         text;
  v_box_default      integer;
  v_metros           numeric;
  v_pairs_per_box    integer;
  v_amarrados_needed integer;
  v_debit_qty        numeric;
  v_already          numeric;
  v_net              numeric;
  v_unit_label       text;
  v_handled          boolean := false;
  v_stock            numeric;
  v_avail            numeric;
  v_debit            numeric;
  v_grade            jsonb;
  v_pairs_per_ficha  numeric;
  v_fichas_eff       integer;
  v_packed           integer;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode IN ('individual_fitilho', 'individual_amarrado') THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  SELECT sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets WHERE id = p_reference_id;

  IF v_sole_group_id IS NULL THEN
    RETURN jsonb_build_array(jsonb_build_object(
      'source', 'sole_group', 'status', 'no_packaging_configured',
      'reason', 'sheet_without_sole_group'));
  END IF;

  SELECT * INTO v_pg FROM public.product_groups WHERE id = v_sole_group_id;

  -- Grade da FICHA (sale_order_items.grade). A grade de `orders` já vem
  -- multiplicada, então não serve pra regra. Preferimos o vínculo direto da OP;
  -- sem ele, casamos por PV + referência.
  v_grade := NULL;
  IF p_order_id IS NOT NULL THEN
    SELECT soi.grade INTO v_grade
      FROM public.orders o
      JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
     WHERE o.id = p_order_id;
  END IF;
  IF v_grade IS NULL THEN
    SELECT soi.grade INTO v_grade
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id  = p_reference_id
       AND COALESCE(soi.quantity, 0) > 0
     ORDER BY soi.created_at NULLS LAST
     LIMIT 1;
  END IF;

  v_pairs_per_ficha := NULL;
  IF v_grade IS NOT NULL AND jsonb_typeof(v_grade) = 'object' THEN
    SELECT COALESCE(SUM((value)::numeric), 0) INTO v_pairs_per_ficha
      FROM jsonb_each_text(v_grade) WHERE (value)::numeric > 0;
  END IF;

  FOREACH v_pkg_type IN ARRAY v_types_to_debit
  LOOP
    v_box_id := CASE v_pkg_type
      WHEN 'individual' THEN v_pg.box_type_id
      WHEN 'master'     THEN v_pg.box_type_master_id
      WHEN 'colmeia'    THEN v_pg.box_type_colmeia_id
      WHEN 'fitilho'    THEN v_pg.box_type_fitilho_id
    END;

    IF v_box_id IS NULL THEN
      v_result := v_result || jsonb_build_object(
        'packaging_type', v_pkg_type, 'source', 'sole_group',
        'status', 'skipped_no_box_linked');
      CONTINUE;
    END IF;

    v_box_name := NULL;
    SELECT quantity, nome, tipo::text, COALESCE(pairs_per_box_default, 12),
           COALESCE(metros_per_amarrado_default, 1.0)
      INTO v_stock, v_box_name, v_box_tipo, v_box_default, v_metros
      FROM public.box_types
     WHERE id = v_box_id AND active = true
     FOR UPDATE;

    IF v_box_name IS NULL THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box_id, 'packaging_type', v_pkg_type, 'source', 'sole_group',
        'status', 'skipped_no_box_linked', 'reason', 'box_inactive_or_missing');
      CONTINUE;
    END IF;

    v_handled := true;

    v_pairs_per_box := COALESCE(
      NULLIF(CASE v_pkg_type
        WHEN 'individual' THEN v_pg.pairs_per_box_individual
        WHEN 'master'     THEN v_pg.pairs_per_box_master
        WHEN 'colmeia'    THEN v_pg.pairs_per_box_colmeia
        WHEN 'fitilho'    THEN v_pg.pairs_per_box_fitilho
      END, 0),
      v_box_default, 12);

    -- Caixa COLETIVA com grade conhecida → regra de empacotamento.
    -- Fitilho e capacidade 1 seguem no cálculo legado: não há sobra a consolidar.
    v_packed := NULL;
    IF v_pkg_type <> 'fitilho' AND v_pairs_per_box > 1
       AND COALESCE(v_pairs_per_ficha, 0) > 0 THEN
      v_fichas_eff := CEIL(p_order_quantity::numeric / v_pairs_per_ficha)::integer;
      SELECT count(*)::integer INTO v_packed
        FROM public.packing_boxes_for_grade(v_grade, v_fichas_eff, v_pairs_per_box);
    END IF;

    v_amarrados_needed := COALESCE(
      NULLIF(v_packed, 0),
      CEIL(p_order_quantity::numeric / GREATEST(v_pairs_per_box, 1))::integer);

    IF v_pkg_type = 'fitilho' THEN
      v_debit_qty  := v_amarrados_needed * v_metros;
      v_unit_label := 'metros';
    ELSE
      v_debit_qty  := v_amarrados_needed;
      v_unit_label := 'caixas';
    END IF;

    IF p_force_soft THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box_id, 'box_name', v_box_name, 'packaging_type', v_pkg_type,
        'amarrados_needed', v_amarrados_needed, 'projected_qty', v_debit_qty,
        'unit', v_unit_label, 'source', 'sole_group', 'status', 'soft_projected');
      CONTINUE;
    END IF;

    v_already := CASE WHEN p_order_id IS NULL THEN 0 ELSE COALESCE((
      SELECT SUM(sm.quantity) FROM public.stock_movements sm
       WHERE sm.order_id = p_order_id AND sm.product_id = v_box_id
         AND sm.movement_type = 'out' AND sm.description LIKE 'Débito embalagem%'), 0) END;
    v_net := v_debit_qty - v_already;

    IF v_net <= 0 THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box_id, 'box_name', v_box_name, 'packaging_type', v_pkg_type,
        'needed_qty', v_debit_qty, 'already_debited', v_already, 'unit', v_unit_label,
        'source', 'sole_group', 'status', 'already_debited');
      CONTINUE;
    END IF;

    v_avail := GREATEST(0, COALESCE(v_stock, 0));
    v_debit := LEAST(v_net, v_avail);

    IF v_debit < v_net THEN
      RAISE WARNING 'Embalagem "%": estoque insuficiente — disponível % %, necessário % % (debitando %)',
        v_box_name, v_avail, v_unit_label, v_net, v_unit_label, v_debit;
    END IF;

    IF v_debit <= 0 THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box_id, 'box_name', v_box_name, 'packaging_type', v_pkg_type,
        'amarrados_needed', v_amarrados_needed,
        'needed_qty', v_net, 'total_needed_qty', v_debit_qty, 'already_debited', v_already,
        'available_qty', v_avail, 'debited_qty', 0, 'shortfall', v_net, 'unit', v_unit_label,
        'source', 'sole_group', 'status', 'insufficient_stock');
      CONTINUE;
    END IF;

    UPDATE public.box_types
       SET quantity = GREATEST(0, quantity - v_debit), updated_at = now()
     WHERE id = v_box_id;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (v_box_id, 'out', v_debit, v_avail, GREATEST(0, v_avail - v_debit),
      'Débito embalagem ' || v_box_name || ' (' || v_pkg_type ||
      CASE WHEN v_pkg_type = 'fitilho'
           THEN ', ' || v_amarrados_needed || ' amarrados x ' || v_metros || ' m'
           ELSE '' END || ')' ||
      CASE WHEN v_debit < v_net
           THEN ' — parcial ' || round(v_debit, 2) || ' de ' || round(v_net, 2)
           ELSE '' END,
      p_order_id);

    v_result := v_result || jsonb_build_object(
      'box_type_id', v_box_id, 'box_name', v_box_name, 'packaging_type', v_pkg_type,
      'amarrados_needed', v_amarrados_needed,
      'needed_qty', v_net, 'total_needed_qty', v_debit_qty, 'already_debited', v_already,
      'available_qty', v_avail, 'debited_qty', v_debit, 'shortfall', GREATEST(0, v_net - v_debit),
      'unit', v_unit_label, 'source', 'sole_group',
      'status', CASE WHEN v_debit < v_net THEN 'partial' ELSE 'debited_box_types' END);
  END LOOP;

  IF NOT v_handled AND jsonb_array_length(v_result) = 0 THEN
    v_result := jsonb_build_array(jsonb_build_object(
      'source', 'sole_group', 'status', 'no_packaging_configured'));
  END IF;

  RETURN v_result;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Cadastro da caixa (decisão do dono): custo R$ 6,90 e tara 100 g.
--    O estoque NÃO é tocado aqui — quantidade de papelão é contagem física.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.box_types
   SET unit_price      = 6.90,
       empty_weight_kg = 0.100,
       updated_at      = now()
 WHERE nome = 'CAIXA COLMEIA 11'
   AND tipo::text = 'colmeia';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Verificação — falha a migration se a regra não reproduzir o PV-00151
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_grade   jsonb := '{"28":2,"29":2,"30":2,"31":2,"32":3,"33":2,"34":2}'::jsonb;
  v_grades  integer;
  v_singles integer;
  v_28      integer;
  v_29      integer;
  v_pairs   integer;
  v_price   numeric;
  v_tare    numeric;
BEGIN
  SELECT count(*) FILTER (WHERE kind = 'grade'),
         count(*) FILTER (WHERE kind = 'single'),
         count(*) FILTER (WHERE single_size = '28'),
         count(*) FILTER (WHERE single_size = '29'),
         COALESCE(SUM(pairs), 0)
    INTO v_grades, v_singles, v_28, v_29, v_pairs
    FROM public.packing_boxes_for_grade(v_grade, 12, 12);

  IF v_grades <> 12 THEN
    RAISE EXCEPTION 'PV-00151: esperava 12 colmeias, veio %', v_grades;
  END IF;
  IF v_singles <> 3 OR v_28 <> 2 OR v_29 <> 1 THEN
    RAISE EXCEPTION 'PV-00151: esperava 2 caixas do nº 28 e 1 do nº 29, veio % single (28=%, 29=%)',
      v_singles, v_28, v_29;
  END IF;
  IF v_pairs <> 180 THEN
    RAISE EXCEPTION 'PV-00151: par sumiu ou apareceu — esperava 180, veio %', v_pairs;
  END IF;

  -- Caixa parcial continua sendo 1 volume: 2 fichas → 2 colmeias + 28:4 + 29:2
  SELECT count(*) INTO v_singles
    FROM public.packing_boxes_for_grade(v_grade, 2, 12) WHERE kind = 'single';
  IF v_singles <> 2 THEN
    RAISE EXCEPTION 'Caixa parcial: esperava 2 caixas de sobra com 2 fichas, veio %', v_singles;
  END IF;

  -- A guarda tem que declinar em grade que não é ficha, senão volta a fabricar
  -- caixa quase vazia nos PVs antigos com fichas=1.
  IF EXISTS (SELECT 1 FROM public.packing_boxes_for_grade(
               '{"25":4,"26":4,"27":4,"28":4,"29":2,"30":2,"31":2,"32":2}'::jsonb, 1, 12)) THEN
    RAISE EXCEPTION 'Guarda falhou: grade de 24 pares (2× a caixa) deveria declinar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.packing_boxes_for_grade(v_grade, 1, 12)) THEN
    RAISE EXCEPTION 'Guarda apertada demais: a ficha de 15 do PV-00151 tem que passar';
  END IF;

  SELECT unit_price, empty_weight_kg INTO v_price, v_tare
    FROM public.box_types WHERE nome = 'CAIXA COLMEIA 11';
  IF v_price IS DISTINCT FROM 6.90 OR v_tare IS DISTINCT FROM 0.100 THEN
    RAISE EXCEPTION 'CAIXA COLMEIA 11 não ficou com custo 6,90 / tara 0,100 (veio %, %)', v_price, v_tare;
  END IF;
END $$;

COMMIT;
