-- ════════════════════════════════════════════════════════════════════════════
-- M6 — Débito de embalagem correto (debit_packaging_for_order)
--
-- Auditoria 2026-07-04 contra a função VIVA em produção (não os migration files):
--   #1 Produto não-solado / sem ficha vinculada não debita nada, EM SILÊNCIO.
--   #2 Slot de caixa NULL num modo que o exige é pulado (CONTINUE) sem sinal.
--   #3 individual_amarrado — JÁ CORRETO na função viva (mapeia individual+fitilho).
--      Nenhuma mudança necessária; o alarme vinha de overloads antigos que NÃO
--      existem mais no banco (só o overload de 6 args está presente).
--   #4 Default de pares/caixa no caminho FALLBACK (product_groups) é 1/12
--      hardcoded, divergindo da NF (compute_sale_order_nfe_volumes usa
--      COALESCE(box_types.pairs_per_box_default, 12)). Débito ≠ volume da NF.
--   #5 Sem idempotência: reaprovar PV / recriar OP debita 2× (só o picking path
--      guardava por order_id).
--
-- Correções (o caminho PRIMÁRIO por technical_sheet_box_types já usava
-- box_types.pairs_per_box_default, então só ajustamos seu fallback final 1→12):
--   #5 → guarda de idempotência no topo: se já existe stock_movement de débito
--        de embalagem para p_order_id e não é projeção (force_soft), retorna sem
--        debitar de novo.
--   #4 → no fallback por product_groups, pares/caixa =
--        COALESCE(product_groups.pairs_per_box_<tipo>, box_types.pairs_per_box_default, 12),
--        alinhando com a NF. (Se uma caixa "individual" realmente comporta 1 par,
--        cadastre pairs_per_box_individual=1 explicitamente na aba Embalagem do
--        grupo — o valor específico sempre vence.)
--   #2 → slot NULL vira entrada de aviso no JSON (status='skipped_no_box_linked'),
--        não some em silêncio.
--   #1 → se nada foi debitado/projetado, entrada de aviso
--        (status='no_packaging_configured') no JSON.
--
-- Aditivo/compatível: assinatura inalterada; os avisos entram só no JSONB de
-- retorno (callers que ignoram o retorno seguem iguais; os que inspecionam podem
-- alertar o usuário). Idempotente (CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

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
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id    uuid;
  v_types_to_debit   text[];
  v_result           jsonb := '[]'::jsonb;
  v_box              RECORD;
  v_amarrados_needed integer;
  v_debit_qty        numeric;
  v_unit_label       text;
  v_metros           numeric;
  v_handled          boolean := false;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- #5 IDEMPOTÊNCIA: um débito real (não-projeção) por order_id. Bloqueia
  -- double-debit de reaprovar PV / recriar OP. Projeções (force_soft) não
  -- gravam stock_movements, então não disparam nem são bloqueadas por esta guarda.
  IF NOT p_force_soft AND p_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.stock_movements
     WHERE order_id = p_order_id
       AND description LIKE 'Débito embalagem%'
  ) THEN
    RETURN jsonb_build_array(jsonb_build_object(
      'status', 'already_debited',
      'order_id', p_order_id
    ));
  END IF;

  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode IN ('individual_fitilho', 'individual_amarrado') THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];   -- #3 já correto
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  -- ── Caminho PRIMÁRIO: caixas vinculadas diretamente à ficha técnica ─────────
  FOR v_box IN
    SELECT bt.id, bt.nome, bt.tipo::text AS tipo,
           COALESCE(bt.pairs_per_box_default, 12) AS pairs_per_box,   -- #4 alinhado NF
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
        'box_type_id', v_box.id, 'box_name', v_box.nome,
        'packaging_type', v_box.tipo,
        'amarrados_needed', v_amarrados_needed,
        'projected_qty', v_debit_qty, 'unit', v_unit_label,
        'source', 'technical_sheet_box_types',
        'status', 'soft_projected'
      );
      CONTINUE;
    END IF;

    PERFORM 1 FROM public.box_types WHERE id = v_box.id FOR UPDATE;

    IF v_box.quantity IS NULL OR v_box.quantity < v_debit_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível % %, necessário % %',
        v_box.nome, COALESCE(v_box.quantity, 0), v_unit_label, v_debit_qty, v_unit_label;
    END IF;

    UPDATE public.box_types
       SET quantity = quantity - v_debit_qty, updated_at = now()
     WHERE id = v_box.id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock, description, order_id
    ) VALUES (
      v_box.id, 'out', v_debit_qty,
      v_box.quantity, v_box.quantity - v_debit_qty,
      'Débito embalagem ' || v_box.nome || ' (' || v_box.tipo ||
      CASE WHEN v_box.tipo = 'fitilho'
           THEN ', ' || v_amarrados_needed || ' amarrados x ' || v_box.metros_per_amarrado || ' m'
           ELSE ''
      END || ')',
      p_order_id
    );

    v_result := v_result || jsonb_build_object(
      'box_type_id', v_box.id, 'box_name', v_box.nome,
      'packaging_type', v_box.tipo,
      'amarrados_needed', v_amarrados_needed,
      'debited_qty', v_debit_qty, 'unit', v_unit_label,
      'source', 'technical_sheet_box_types',
      'status', 'debited_box_types'
    );
  END LOOP;

  -- ── Caminho FALLBACK: caixas vinculadas ao grupo do solado ──────────────────
  IF NOT v_handled THEN
    DECLARE
      v_pg            RECORD;
      v_box_id        uuid;
      v_pairs_per_box integer;
      v_box_default   integer;
      v_box_stock     numeric;
      v_box_name      text;
      v_pkg_type      text;
    BEGIN
      SELECT sole_group_id INTO v_sole_group_id
        FROM public.technical_sheets WHERE id = p_reference_id;

      IF v_sole_group_id IS NOT NULL THEN
        SELECT * INTO v_pg
          FROM public.product_groups WHERE id = v_sole_group_id;

        v_metros := COALESCE(v_pg.metros_fitilho_per_amarrado, 1.0);

        FOREACH v_pkg_type IN ARRAY v_types_to_debit
        LOOP
          v_box_id := NULL;

          IF v_pkg_type = 'individual' THEN
            v_box_id := v_pg.box_type_id;
          ELSIF v_pkg_type = 'master' THEN
            v_box_id := v_pg.box_type_master_id;
          ELSIF v_pkg_type = 'colmeia' THEN
            v_box_id := v_pg.box_type_colmeia_id;
          ELSIF v_pkg_type = 'fitilho' THEN
            v_box_id := v_pg.box_type_fitilho_id;
          END IF;

          -- #2 slot NULL: registra aviso em vez de sumir em silêncio.
          IF v_box_id IS NULL THEN
            v_result := v_result || jsonb_build_object(
              'packaging_type', v_pkg_type,
              'source', 'product_groups',
              'status', 'skipped_no_box_linked'
            );
            CONTINUE;
          END IF;

          v_handled := true;

          -- #4 pares/caixa = valor cadastrado no grupo, senão o default da caixa
          -- (mesmo que a NF usa), senão 12 — alinhando débito × volume da NF.
          SELECT quantity, nome, COALESCE(pairs_per_box_default, 12)
            INTO v_box_stock, v_box_name, v_box_default
            FROM public.box_types WHERE id = v_box_id FOR UPDATE;

          IF v_pkg_type = 'individual' THEN
            v_pairs_per_box := COALESCE(v_pg.pairs_per_box_individual, v_box_default, 12);
          ELSIF v_pkg_type = 'master' THEN
            v_pairs_per_box := COALESCE(v_pg.pairs_per_box_master, v_box_default, 12);
          ELSIF v_pkg_type = 'colmeia' THEN
            v_pairs_per_box := COALESCE(v_pg.pairs_per_box_colmeia, v_box_default, 12);
          ELSE
            v_pairs_per_box := COALESCE(v_pg.pairs_per_box_fitilho, v_box_default, 12);
          END IF;

          v_amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(v_pairs_per_box, 1));

          IF v_pkg_type = 'fitilho' THEN
            v_debit_qty := v_amarrados_needed * v_metros;
            v_unit_label := 'metros';
          ELSE
            v_debit_qty := v_amarrados_needed;
            v_unit_label := 'caixas';
          END IF;

          IF p_force_soft THEN
            v_result := v_result || jsonb_build_object(
              'box_type_id', v_box_id, 'box_name', v_box_name,
              'packaging_type', v_pkg_type,
              'amarrados_needed', v_amarrados_needed,
              'projected_qty', v_debit_qty, 'unit', v_unit_label,
              'source', 'product_groups', 'status', 'soft_projected'
            );
            CONTINUE;
          END IF;

          IF v_box_stock IS NULL OR v_box_stock < v_debit_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível % %, necessário % %',
              v_box_name, COALESCE(v_box_stock, 0), v_unit_label, v_debit_qty, v_unit_label;
          END IF;

          UPDATE public.box_types
             SET quantity = quantity - v_debit_qty, updated_at = now()
           WHERE id = v_box_id;

          INSERT INTO public.stock_movements (
            product_id, movement_type, quantity,
            previous_stock, new_stock, description, order_id
          ) VALUES (
            v_box_id, 'out', v_debit_qty,
            v_box_stock, v_box_stock - v_debit_qty,
            'Débito embalagem ' || v_box_name || ' (' || v_pkg_type || ')',
            p_order_id
          );

          v_result := v_result || jsonb_build_object(
            'box_type_id', v_box_id, 'box_name', v_box_name,
            'packaging_type', v_pkg_type,
            'amarrados_needed', v_amarrados_needed,
            'debited_qty', v_debit_qty, 'unit', v_unit_label,
            'source', 'product_groups', 'status', 'debited_box_types'
          );
        END LOOP;
      END IF;
    END;
  END IF;

  -- #1 nada configurado (sem ficha vinculada e sem grupo de solado com caixa):
  -- aviso explícito em vez de retorno vazio silencioso.
  IF NOT v_handled THEN
    v_result := v_result || jsonb_build_object(
      'status', 'no_packaging_configured',
      'reference_id', p_reference_id,
      'packaging_mode', p_packaging_mode
    );
  END IF;

  RETURN v_result;
END;
$function$;
