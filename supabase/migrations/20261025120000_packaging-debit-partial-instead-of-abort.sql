-- =============================================================================
-- Embalagem em falta AVISA, não trava o pedido
-- =============================================================================
--
-- PROBLEMA (31/07/2026, em produção): a caixa colmeia foi vinculada aos 4 grupos
-- de solado (`product_groups.box_type_colmeia_id`, `pairs_per_box_colmeia = 12`).
-- Isso LIGOU `debit_packaging_for_order`, que até então nunca tinha rodado — zero
-- `stock_movements` com `description LIKE 'Débito embalagem%'` em toda a história
-- do banco. A caixa (CAIXA COLMEIA 11) está com estoque 0 e a função levantava
-- `RAISE EXCEPTION 'Estoque insuficiente para embalagem ...'` em DOIS pontos: o
-- loop de `technical_sheet_box_types` e o fallback de `product_groups`.
--
-- Consequência viva — aprovar Pedido de Venda quebrou por completo:
--   * `src/hooks/useSaleOrders.ts` trata o erro como "débito secundário falhou",
--     libera as reservas (`release_order_reservations`, `restore_*`) e CANCELA a
--     OP recém-criada;
--   * `promote_sale_order_to_production` (RPC atômica, Rascunho/Pendente → Em
--     Produção) chama a função sem bloco de exceção — a promoção inteira aborta.
--
-- DECISÃO DO DONO: "deve permitir que eu lance o pedido, mesmo sem embalagem
-- cadastrada, porém deve ficar o aviso". Embalagem é insumo de EXPEDIÇÃO, não de
-- produção: a falta dela não pode impedir a ENTRADA do pedido nem destruir a OP.
--
-- COMO — padrão da casa, o mesmo de `tg_debit_service_order_base` (fix DEB-6 da
-- auditoria 2026-07-19): debita `LEAST(necessário, disponível)`, emite
-- `RAISE WARNING`, e o movimento em `stock_movements` sai com o valor CLAMPADO
-- (senão o ledger diverge de `box_types.quantity`). O que faltou volta no JSON de
-- retorno para o frontend avisar (`warnPackagingDebit`).
--
-- STATUS NOVOS no JSON:
--   * 'partial'            — debitou parte; `debited_qty` < `needed_qty`, movimento gerado
--   * 'insufficient_stock' — disponível 0; NENHUM movimento gerado, só reporta
-- STATUS PRESERVADOS (consumidos por `src/lib/packagingDebitWarnings.ts`):
--   'debited_box_types', 'already_debited', 'skipped_no_box_linked',
--   'no_packaging_configured', 'soft_projected'.
--
-- IDEMPOTÊNCIA PRESERVADA (e melhorada): a checagem continua sendo
-- `stock_movements` com `description LIKE 'Débito embalagem%'` para o mesmo
-- `order_id`, e o débito parcial ENTRA nessa soma. Logo, uma 2ª chamada calcula
-- `v_net = total_necessário − já_debitado` e só completa o que falta — nunca
-- debita 2×, e passa a "cicatrizar" o parcial sozinha quando a caixa chega.
--
-- BÔNUS (corrige uma corrida pré-existente): no loop de
-- `technical_sheet_box_types` o estoque era lido no cursor e só DEPOIS travado
-- com `PERFORM 1 ... FOR UPDATE`, então o valor usado na comparação podia estar
-- velho. Agora o `SELECT ... FOR UPDATE` trava E relê a quantidade.
--
-- ⚠ `SET search_path TO 'public', 'extensions'` são DOIS literais separados.
--   `TO 'public, extensions'` (aspas em volta de tudo) cria um schema de nome
--   literal inexistente e derruba `unaccent` em runtime — bug real de hoje, que
--   passou verde na migration porque plpgsql não valida chamada de função na
--   criação.
-- =============================================================================

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
  v_box              RECORD;
  v_amarrados_needed integer;
  v_debit_qty        numeric;
  v_already          numeric;
  v_net              numeric;
  v_unit_label       text;
  v_metros           numeric;
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

  -- ---------------------------------------------------------------------------
  -- Caminho 1: caixas amarradas à FICHA TÉCNICA (technical_sheet_box_types)
  -- ---------------------------------------------------------------------------
  FOR v_box IN
    SELECT bt.id, bt.nome, bt.tipo::text AS tipo,
           COALESCE(bt.pairs_per_box_default, 12) AS pairs_per_box,
           COALESCE(bt.metros_per_amarrado_default, 1.0) AS metros_per_amarrado,
           bt.quantity
      FROM public.technical_sheet_box_types tsbt
      JOIN public.box_types bt ON bt.id = tsbt.box_type_id AND bt.active = true
     WHERE tsbt.sheet_id = p_reference_id
       AND bt.tipo::text = ANY(v_types_to_debit)
  LOOP
    v_handled := true;
    v_amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(v_box.pairs_per_box, 1));
    IF v_box.tipo = 'fitilho' THEN
      v_debit_qty := v_amarrados_needed * v_box.metros_per_amarrado;
      v_unit_label := 'metros';
    ELSE
      v_debit_qty := v_amarrados_needed;
      v_unit_label := 'caixas';
    END IF;

    IF p_force_soft THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box.id, 'box_name', v_box.nome, 'packaging_type', v_box.tipo,
        'amarrados_needed', v_amarrados_needed, 'projected_qty', v_debit_qty, 'unit', v_unit_label,
        'source', 'technical_sheet_box_types', 'status', 'soft_projected');
      CONTINUE;
    END IF;

    -- Trava E relê o estoque na mesma ida (antes: PERFORM ... FOR UPDATE e o
    -- valor comparado vinha do snapshot do cursor).
    SELECT quantity INTO v_stock FROM public.box_types WHERE id = v_box.id FOR UPDATE;

    v_already := CASE WHEN p_order_id IS NULL THEN 0 ELSE COALESCE((
      SELECT SUM(sm.quantity) FROM public.stock_movements sm
       WHERE sm.order_id = p_order_id AND sm.product_id = v_box.id
         AND sm.movement_type = 'out' AND sm.description LIKE 'Débito embalagem%'), 0) END;
    v_net := v_debit_qty - v_already;

    IF v_net <= 0 THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box.id, 'box_name', v_box.nome, 'packaging_type', v_box.tipo,
        'needed_qty', v_debit_qty, 'already_debited', v_already, 'unit', v_unit_label,
        'source', 'technical_sheet_box_types', 'status', 'already_debited');
      CONTINUE;
    END IF;

    v_avail := GREATEST(0, COALESCE(v_stock, 0));
    v_debit := LEAST(v_net, v_avail);

    IF v_debit < v_net THEN
      RAISE WARNING 'Embalagem "%": estoque insuficiente — disponível % %, necessário % % (debitando %)',
        v_box.nome, v_avail, v_unit_label, v_net, v_unit_label, v_debit;
    END IF;

    -- Nada disponível: NÃO gera movimento, só reporta a falta.
    IF v_debit <= 0 THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box.id, 'box_name', v_box.nome, 'packaging_type', v_box.tipo,
        'amarrados_needed', v_amarrados_needed,
        'needed_qty', v_net, 'total_needed_qty', v_debit_qty, 'already_debited', v_already,
        'available_qty', v_avail, 'debited_qty', 0, 'shortfall', v_net, 'unit', v_unit_label,
        'source', 'technical_sheet_box_types', 'status', 'insufficient_stock');
      CONTINUE;
    END IF;

    UPDATE public.box_types
       SET quantity = GREATEST(0, quantity - v_debit), updated_at = now()
     WHERE id = v_box.id;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (v_box.id, 'out', v_debit, v_avail, GREATEST(0, v_avail - v_debit),
      'Débito embalagem ' || v_box.nome || ' (' || v_box.tipo ||
      CASE WHEN v_box.tipo = 'fitilho' THEN ', ' || v_amarrados_needed || ' amarrados x ' || v_box.metros_per_amarrado || ' m' ELSE '' END || ')' ||
      CASE WHEN v_debit < v_net THEN ' — parcial ' || round(v_debit, 2) || ' de ' || round(v_net, 2) ELSE '' END,
      p_order_id);

    v_result := v_result || jsonb_build_object(
      'box_type_id', v_box.id, 'box_name', v_box.nome, 'packaging_type', v_box.tipo,
      'amarrados_needed', v_amarrados_needed,
      'needed_qty', v_net, 'total_needed_qty', v_debit_qty, 'already_debited', v_already,
      'available_qty', v_avail, 'debited_qty', v_debit, 'shortfall', GREATEST(0, v_net - v_debit),
      'unit', v_unit_label, 'source', 'technical_sheet_box_types',
      'status', CASE WHEN v_debit < v_net THEN 'partial' ELSE 'debited_box_types' END);
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- Caminho 2 (fallback): caixas do GRUPO DE SOLADO (product_groups)
  -- ---------------------------------------------------------------------------
  IF NOT v_handled THEN
    DECLARE
      v_pg RECORD; v_box_id uuid; v_pairs_per_box integer; v_box_default integer;
      v_box_name text; v_pkg_type text;
    BEGIN
      SELECT sole_group_id INTO v_sole_group_id FROM public.technical_sheets WHERE id = p_reference_id;
      IF v_sole_group_id IS NOT NULL THEN
        SELECT * INTO v_pg FROM public.product_groups WHERE id = v_sole_group_id;
        v_metros := COALESCE(v_pg.metros_fitilho_per_amarrado, 1.0);
        FOREACH v_pkg_type IN ARRAY v_types_to_debit
        LOOP
          v_box_id := NULL;
          IF v_pkg_type = 'individual' THEN v_box_id := v_pg.box_type_id;
          ELSIF v_pkg_type = 'master' THEN v_box_id := v_pg.box_type_master_id;
          ELSIF v_pkg_type = 'colmeia' THEN v_box_id := v_pg.box_type_colmeia_id;
          ELSIF v_pkg_type = 'fitilho' THEN v_box_id := v_pg.box_type_fitilho_id;
          END IF;
          IF v_box_id IS NULL THEN
            v_result := v_result || jsonb_build_object('packaging_type', v_pkg_type, 'source', 'product_groups', 'status', 'skipped_no_box_linked');
            CONTINUE;
          END IF;
          v_handled := true;

          SELECT quantity, nome, COALESCE(pairs_per_box_default, 12) INTO v_stock, v_box_name, v_box_default
            FROM public.box_types WHERE id = v_box_id FOR UPDATE;

          IF v_pkg_type = 'individual' THEN v_pairs_per_box := COALESCE(v_pg.pairs_per_box_individual, v_box_default, 12);
          ELSIF v_pkg_type = 'master' THEN v_pairs_per_box := COALESCE(v_pg.pairs_per_box_master, v_box_default, 12);
          ELSIF v_pkg_type = 'colmeia' THEN v_pairs_per_box := COALESCE(v_pg.pairs_per_box_colmeia, v_box_default, 12);
          ELSE v_pairs_per_box := COALESCE(v_pg.pairs_per_box_fitilho, v_box_default, 12);
          END IF;
          v_amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(v_pairs_per_box, 1));
          IF v_pkg_type = 'fitilho' THEN v_debit_qty := v_amarrados_needed * v_metros; v_unit_label := 'metros';
          ELSE v_debit_qty := v_amarrados_needed; v_unit_label := 'caixas';
          END IF;

          IF p_force_soft THEN
            v_result := v_result || jsonb_build_object(
              'box_type_id', v_box_id, 'box_name', v_box_name, 'packaging_type', v_pkg_type,
              'amarrados_needed', v_amarrados_needed, 'projected_qty', v_debit_qty, 'unit', v_unit_label,
              'source', 'product_groups', 'status', 'soft_projected');
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
              'source', 'product_groups', 'status', 'already_debited');
            CONTINUE;
          END IF;

          v_avail := GREATEST(0, COALESCE(v_stock, 0));
          v_debit := LEAST(v_net, v_avail);

          IF v_debit < v_net THEN
            RAISE WARNING 'Embalagem "%": estoque insuficiente — disponível % %, necessário % % (debitando %)',
              COALESCE(v_box_name, v_box_id::text), v_avail, v_unit_label, v_net, v_unit_label, v_debit;
          END IF;

          IF v_debit <= 0 THEN
            v_result := v_result || jsonb_build_object(
              'box_type_id', v_box_id, 'box_name', v_box_name, 'packaging_type', v_pkg_type,
              'amarrados_needed', v_amarrados_needed,
              'needed_qty', v_net, 'total_needed_qty', v_debit_qty, 'already_debited', v_already,
              'available_qty', v_avail, 'debited_qty', 0, 'shortfall', v_net, 'unit', v_unit_label,
              'source', 'product_groups', 'status', 'insufficient_stock');
            CONTINUE;
          END IF;

          UPDATE public.box_types
             SET quantity = GREATEST(0, quantity - v_debit), updated_at = now()
           WHERE id = v_box_id;

          INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
          VALUES (v_box_id, 'out', v_debit, v_avail, GREATEST(0, v_avail - v_debit),
            'Débito embalagem ' || v_box_name || ' (' || v_pkg_type || ')' ||
            CASE WHEN v_debit < v_net THEN ' — parcial ' || round(v_debit, 2) || ' de ' || round(v_net, 2) ELSE '' END,
            p_order_id);

          v_result := v_result || jsonb_build_object(
            'box_type_id', v_box_id, 'box_name', v_box_name, 'packaging_type', v_pkg_type,
            'amarrados_needed', v_amarrados_needed,
            'needed_qty', v_net, 'total_needed_qty', v_debit_qty, 'already_debited', v_already,
            'available_qty', v_avail, 'debited_qty', v_debit, 'shortfall', GREATEST(0, v_net - v_debit),
            'unit', v_unit_label, 'source', 'product_groups',
            'status', CASE WHEN v_debit < v_net THEN 'partial' ELSE 'debited_box_types' END);
        END LOOP;
      END IF;
    END;
  END IF;

  IF NOT v_handled THEN
    v_result := v_result || jsonb_build_object('status', 'no_packaging_configured', 'reference_id', p_reference_id, 'packaging_mode', p_packaging_mode);
  END IF;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text, boolean) IS
'Debita embalagem (box_types) do PV/OP. Falta de estoque NÃO levanta exceção: debita LEAST(necessário, disponível), emite RAISE WARNING e devolve o buraco no JSON (status ''partial'' ou ''insufficient_stock'', campos needed_qty/debited_qty/shortfall) para o frontend avisar. Decisão do dono em 31/07/2026: embalagem em falta não pode travar o lançamento do pedido nem cancelar a OP. Idempotente por order_id via stock_movements com description LIKE ''Débito embalagem%'' — reruns só completam o que faltou.';
