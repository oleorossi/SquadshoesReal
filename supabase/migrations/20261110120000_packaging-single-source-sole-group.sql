-- =============================================================================
-- Embalagem: FONTE ÚNICA = MODELO DE SOLADO (product_groups)
-- =============================================================================
--
-- DECISÃO DO DONO (02/08/2026): "A parte de cadastro de embalagem também deve
-- ser definida nesta tela, através do solado" + "eu tenho que ter as duas opções
-- em qualquer solado: caixa individual + master, caixa individual + amarrado, e
-- caixa colmeia" + "a definição do tipo de embalagem será definida no pedido de
-- venda, e dependendo do que for selecionado o sistema irá debitar a correta".
--
-- Traduzindo pro banco: os TRÊS modos ficam montados por MODELO DE SOLADO
-- (`product_groups.box_type_*_id` + `pairs_per_box_*`); o PV escolhe o modo
-- (`sale_orders.packaging_mode`) e o servidor debita o slot correspondente.
--
-- O QUE MUDA: o caminho por FICHA TÉCNICA (`technical_sheet_box_types`) sai de
-- TODAS as três funções que o liam. Antes ele tinha PRECEDÊNCIA sobre o solado,
-- então configurar pelo solado seria silenciosamente ignorado por qualquer ficha
-- com vínculo antigo.
--
-- POR QUE ELE PRECISA MORRER (não é só arrumação):
--   `technical_sheet_box_types` é N:N sem restrição de tipo, e em produção as
--   fichas i40 e SP130 têm DUAS caixas 'individual' vinculadas cada (Caixa 11 e
--   Caixa 18). `debit_packaging_for_order` itera o resultado com FOR..LOOP, então
--   debitaria AS DUAS pelos mesmos pares — cobrando caixa a mais e furando o
--   estoque. Nunca estourou porque a função nunca rodou de verdade: em 02/08/2026
--   havia ZERO movimentos 'Débito embalagem%' em toda a história do banco. Um
--   slot por tipo no solado torna a ambiguidade impossível por construção.
--
-- AS TRÊS FUNÇÕES (têm que trocar JUNTAS, senão nota e MRP divergem do débito):
--   1. debit_packaging_for_order      — baixa de estoque
--   2. compute_sale_order_box_breakdown — volumes e peso bruto da NF-e
--   3. fn_projected_packaging_demand  — demanda projetada do MRP
--
-- FICHA SEM SOLADO: 17 fichas (8 delas vendidas — STX, I132, BT01, EC111, EC12,
-- SP130, SP135, BT02) não têm `sole_group_id` nem `primary_sole_id`. Decisão
-- explícita do dono: tratar como LACUNA DE CADASTRO, com aviso — SEM caixa
-- padrão global mascarando o buraco. Elas passam a não debitar embalagem (o que
-- já era o efeito prático hoje) e a view `v_fichas_sem_solado_embalagem` abaixo
-- lista quem precisa ser corrigido.
--
-- METROS DE FITILHO: passam a vir SEMPRE de `box_types.metros_per_amarrado_default`
-- (editável em Gestão de Embalagens e na aba do solado). A coluna
-- `product_groups.metros_fitilho_per_amarrado` não é lida por ninguém depois
-- desta migration — fica marcada como DEPRECATED em vez de dropada, porque
-- dropar coluna é irreversível e ela não faz mal parada.
--
-- NADA É DELETADO: `technical_sheet_box_types` continua existindo com suas 4
-- linhas (histórico), só deixa de ser lida. Se algum dia precisar voltar, o dado
-- está lá.
--
-- ⚠ `SET search_path TO 'public', 'extensions'` são DOIS literais separados.
--   `TO 'public, extensions'` cria um schema de nome literal inexistente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DÉBITO — só o caminho do solado
-- -----------------------------------------------------------------------------
-- Preserva integralmente a semântica ganha em 20261025120000:
--   * débito PARCIAL (LEAST(necessário, disponível)) com RAISE WARNING — falta de
--     caixa NÃO derruba o lançamento do PV nem cancela a OP;
--   * idempotência por `order_id` via stock_movements 'Débito embalagem%',
--     com cicatrização do parcial numa 2ª chamada;
--   * SELECT ... FOR UPDATE que TRAVA E RELÊ o estoque (mata a corrida);
--   * statuses consumidos por src/lib/packagingDebitWarnings.ts.
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_master'::text,
  p_force_soft boolean DEFAULT false
)
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
  v_stock            numeric;  -- estoque relido SOB LOCK
  v_avail            numeric;  -- GREATEST(0, COALESCE(v_stock, 0))
  v_debit            numeric;  -- LEAST(v_net, v_avail)
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

    -- Trava E relê na mesma ida.
    SELECT quantity, nome, tipo::text, COALESCE(pairs_per_box_default, 12),
           COALESCE(metros_per_amarrado_default, 1.0)
      INTO v_stock, v_box_name, v_box_tipo, v_box_default, v_metros
      FROM public.box_types
     WHERE id = v_box_id AND active = true
     FOR UPDATE;

    -- Caixa apagada/inativada mas ainda apontada pelo slot: reporta em vez de
    -- debitar silenciosamente nada.
    IF v_box_name IS NULL THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box_id, 'packaging_type', v_pkg_type, 'source', 'sole_group',
        'status', 'skipped_no_box_linked', 'reason', 'box_inactive_or_missing');
      CONTINUE;
    END IF;

    v_handled := true;

    -- Pares/caixa: valor do solado > padrão da caixa > 12 (canônico, alinhado
    -- com compute_sale_order_nfe_volumes).
    v_pairs_per_box := COALESCE(
      NULLIF(CASE v_pkg_type
        WHEN 'individual' THEN v_pg.pairs_per_box_individual
        WHEN 'master'     THEN v_pg.pairs_per_box_master
        WHEN 'colmeia'    THEN v_pg.pairs_per_box_colmeia
        WHEN 'fitilho'    THEN v_pg.pairs_per_box_fitilho
      END, 0),
      v_box_default, 12);

    v_amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(v_pairs_per_box, 1));

    IF v_pkg_type = 'fitilho' THEN
      -- Metros/amarrado vêm SÓ da caixa agora (product_groups.metros_fitilho_per_amarrado
      -- foi aposentada — nenhuma tela a editava).
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

COMMENT ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text, boolean) IS
  'Debita embalagem lendo APENAS os slots do modelo de solado (product_groups.box_type_*). '
  'O caminho por ficha (technical_sheet_box_types) foi aposentado em 20261110120000 — permitia '
  '2 caixas do mesmo tipo na mesma ficha e debitaria as duas. Falta de estoque avisa e debita '
  'parcial; nunca derruba o lançamento do PV.';

-- -----------------------------------------------------------------------------
-- 2. VOLUMES DA NF-e — mesma fonte do débito
-- -----------------------------------------------------------------------------
-- Se esta função continuasse lendo a ficha, a NF sairia com contagem de volumes
-- (e peso bruto, via tara) de uma caixa DIFERENTE da que saiu do estoque.
CREATE OR REPLACE FUNCTION public.compute_sale_order_box_breakdown(p_sale_order_id uuid)
RETURNS TABLE(box_type_id uuid, box_name text, tipo text, total_pairs integer,
              pairs_per_box integer, boxes integer, empty_weight_kg numeric,
              legacy_box_weight_kg numeric, unconfigured boolean, pairs_per_box_source text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
    SELECT soi.reference_id,
           SUM(soi.quantity)::integer AS qty,
           ts.box_weight_kg,
           ts.sole_group_id
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id
       AND COALESCE(soi.quantity, 0) > 0
     GROUP BY soi.reference_id, ts.box_weight_kg, ts.sole_group_id
  ),
  -- Slot do modelo de solado que corresponde ao modo do pedido. `pg_pairs` é o
  -- override do solado; o default da caixa entra depois no COALESCE.
  resolved AS (
    SELECT i.reference_id, i.qty, i.box_weight_kg,
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
  per_ref AS (
    SELECT r.*,
           CASE WHEN v_pair_as_volume THEN 1
                ELSE COALESCE(r.ppb_solado, r.ppb_cadastrado, 12) END AS ppb_efetivo
      FROM resolved r
  ),
  per_ref_boxes AS (
    SELECT p.*,
           CASE WHEN v_pair_as_volume
                THEN p.qty
                ELSE CEIL(p.qty::numeric / GREATEST(p.ppb_efetivo, 1))::integer
           END AS ref_boxes
      FROM per_ref p
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
      WHEN v_pair_as_volume               THEN 'pair_as_volume'
      WHEN MAX(b.ppb_solado) IS NOT NULL  THEN 'sole_group'
      WHEN MAX(b.ppb_cadastrado) IS NOT NULL THEN 'box_type'
      ELSE 'fallback_default'
    END                                                 AS pairs_per_box_source
  FROM per_ref_boxes b
  GROUP BY b.box_id;
END $function$;

COMMENT ON FUNCTION public.compute_sale_order_box_breakdown(uuid) IS
  'Volumes/peso bruto da NF-e a partir dos slots do modelo de solado — MESMA fonte '
  'que debit_packaging_for_order, pra nota e estoque nunca divergirem. '
  'pairs_per_box_source: sole_group > box_type > fallback_default.';

-- -----------------------------------------------------------------------------
-- 3. MRP — demanda projetada de embalagem
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_projected_packaging_demand()
RETURNS TABLE(box_type_id uuid, boxes_required numeric, earliest_deadline date, orders_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH open_items AS (
    SELECT so.id AS sale_order_id, so.delivery_deadline,
           ts.sole_group_id, soi.quantity::numeric AS qty,
           CASE
             WHEN so.packaging_mode = 'colmeia' THEN ARRAY['colmeia']
             WHEN so.packaging_mode = 'individual_master' THEN ARRAY['individual','master']
             WHEN so.packaging_mode IN ('individual_fitilho','individual_amarrado') THEN ARRAY['individual','fitilho']
             ELSE ARRAY['individual']
           END AS types
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
      JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE so.status NOT IN ('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado','Expedido','Concluído')
       AND ts.sole_group_id IS NOT NULL
       AND soi.quantity > 0
  ),
  typed AS (
    SELECT oi.*, t.pkg_type FROM open_items oi CROSS JOIN LATERAL unnest(oi.types) AS t(pkg_type)
  ),
  resolved AS (
    SELECT ty.sale_order_id, ty.delivery_deadline, ty.qty, ty.pkg_type,
      CASE ty.pkg_type
        WHEN 'individual' THEN pg.box_type_id
        WHEN 'master'     THEN pg.box_type_master_id
        WHEN 'colmeia'    THEN pg.box_type_colmeia_id
        WHEN 'fitilho'    THEN pg.box_type_fitilho_id
      END AS box_type_id,
      NULLIF(CASE ty.pkg_type
        WHEN 'individual' THEN pg.pairs_per_box_individual
        WHEN 'master'     THEN pg.pairs_per_box_master
        WHEN 'colmeia'    THEN pg.pairs_per_box_colmeia
        WHEN 'fitilho'    THEN pg.pairs_per_box_fitilho
      END, 0) AS pg_pairs
      FROM typed ty JOIN public.product_groups pg ON pg.id = ty.sole_group_id
  ),
  computed AS (
    SELECT r.box_type_id, r.sale_order_id, r.delivery_deadline,
      CEIL(r.qty / GREATEST(COALESCE(r.pg_pairs, bt.pairs_per_box_default, 12), 1))
        -- Fitilho é linear: cada amarrado gasta N metros, número que mora na caixa.
        * CASE WHEN r.pkg_type = 'fitilho'
               THEN COALESCE(bt.metros_per_amarrado_default, 1.0) ELSE 1 END AS boxes
      FROM resolved r JOIN public.box_types bt ON bt.id = r.box_type_id AND bt.active = true
     WHERE r.box_type_id IS NOT NULL
  )
  SELECT box_type_id, SUM(boxes) AS boxes_required, MIN(delivery_deadline) AS earliest_deadline,
         COUNT(DISTINCT sale_order_id)::integer AS orders_count
    FROM computed GROUP BY box_type_id;
$function$;

COMMENT ON FUNCTION public.fn_projected_packaging_demand() IS
  'Demanda projetada de embalagem a partir dos slots do modelo de solado. '
  'Metros de fitilho vêm de box_types.metros_per_amarrado_default.';

-- -----------------------------------------------------------------------------
-- 4. Diagnóstico das lacunas de cadastro (decisão: avisar, não mascarar)
-- -----------------------------------------------------------------------------
-- Duas coisas quebram o débito e são INVISÍVEIS até alguém procurar:
--   a) ficha sem solado  → nenhuma caixa a debitar (17 fichas em 02/08/2026);
--   b) solado sem caixa  → o modo escolhido no PV não tem slot preenchido.
CREATE OR REPLACE VIEW public.v_fichas_sem_solado_embalagem AS
SELECT
  ts.id            AS sheet_id,
  ts.name          AS ficha,
  COUNT(soi.id)::integer AS itens_pv,
  'ficha_sem_solado'::text AS motivo
FROM public.technical_sheets ts
LEFT JOIN public.sale_order_items soi ON soi.reference_id = ts.id
WHERE ts.sole_group_id IS NULL
GROUP BY ts.id, ts.name;

COMMENT ON VIEW public.v_fichas_sem_solado_embalagem IS
  'Fichas sem solado vinculado: não debitam embalagem e saem com custo de caixa zerado. '
  'Lacuna de CADASTRO — corrigir vinculando o solado na ficha.';

CREATE OR REPLACE VIEW public.v_solados_sem_embalagem AS
SELECT
  pg.id   AS sole_group_id,
  pg.name AS solado,
  (pg.box_type_id IS NOT NULL AND pg.box_type_master_id IS NOT NULL)  AS modo_tradicional_ok,
  (pg.box_type_id IS NOT NULL AND pg.box_type_fitilho_id IS NOT NULL) AS modo_amarrado_ok,
  (pg.box_type_colmeia_id IS NOT NULL)                                AS modo_colmeia_ok,
  (SELECT COUNT(*) FROM public.technical_sheets ts WHERE ts.sole_group_id = pg.id)::integer AS fichas_afetadas
FROM public.product_groups pg
WHERE pg.sector = 'Solado';

COMMENT ON VIEW public.v_solados_sem_embalagem IS
  'Prontidão dos 3 modos de embalagem por modelo de solado. Modo false = PV naquele modo '
  'entra mas NÃO debita caixa. Editar em Solados → Consumos → Embalagem.';

-- -----------------------------------------------------------------------------
-- 5. Aposentadorias (sem DROP — dado preservado, só deixa de ser lido)
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.technical_sheet_box_types IS
  'DEPRECATED (20261110120000). Vínculo caixa↔ficha aposentado: a embalagem é do MODELO DE '
  'SOLADO (product_groups.box_type_*). Nenhuma função ou tela lê esta tabela — mantida só '
  'como histórico. Permitia 2 caixas do mesmo tipo na mesma ficha, o que fazia o débito '
  'cobrar em dobro.';

COMMENT ON COLUMN public.product_groups.metros_fitilho_per_amarrado IS
  'DEPRECATED (20261110120000). Metros de fitilho por amarrado vêm de '
  'box_types.metros_per_amarrado_default. Esta coluna nunca teve tela que a editasse.';
