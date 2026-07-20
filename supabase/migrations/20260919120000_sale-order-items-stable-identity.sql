-- ════════════════════════════════════════════════════════════════════════════
-- IDENTIDADE ESTÁVEL DO ITEM DO PEDIDO DE VENDA
-- ════════════════════════════════════════════════════════════════════════════
-- Incidente (20/07/2026, PV-00146): a lista de etiquetas mostrou o DOBRO de
-- pares em cada cor. Havia 2 OPs por (referência+cor), criadas com 18 ms de
-- diferença — não foi duplo-clique humano.
--
-- Cadeia real:
--   1. `update_sale_order_atomic` (RPC de TODA edição de PV) fazia
--      `DELETE FROM sale_order_items WHERE sale_order_id = ...` e reinseria
--      tudo com ids NOVOS. A linha do pedido era descartável.
--   2. A FK `orders.sale_order_item_id` é ON DELETE SET NULL → as OPs não
--      morriam, viravam ÓRFÃS VIVAS, ainda segurando reserva de material.
--   3. A trava do gatilho `tg_sync_orders_from_sale_order_item` procura OP por
--      `sale_order_item_id`. Órfã está com NULL → a trava não enxerga → cria
--      OP nova.
--   O disparo foi uma segunda chamada concorrente do salvamento: ela leu a
--   lista de OPs ANTES da primeira criar as dela, não desmontou nada, e o
--   DELETE de itens orfanou as recém-criadas.
--
-- O estrago não era só de OP. TRÊS tabelas apontam para sale_order_items e o
-- DELETE atingia as três a cada salvamento:
--   • orders                     SET NULL → OP órfã + reserva dobrada
--   • service_orders             SET NULL → 78 de 78 OS de PV estão sem vínculo
--   • sale_order_lot_allocations CASCADE  → linha apagada em SILÊNCIO
--
-- Remendar tabela por tabela não escala (e para CASCADE não existe remendo).
-- Esta migration ataca a causa: o item passa a MANTER IDENTIDADE entre
-- salvamentos. Com id estável, nenhum vínculo se rompe e a trava que já existe
-- volta a funcionar sozinha, sem heurística.
--
-- 5 partes:
--   1. update_sale_order_atomic vira UPSERT por id (apaga só o que sumiu)
--   2. gatilho de sync passa a acompanhar troca de reference_id
--   3. BEFORE DELETE recusa apagar item com OP ativa (o banco para de colaborar)
--   4. índice único parcial: 1 OP ativa por item (0 violações históricas)
--   5. relatório de vínculos quebrados pro /diagnostics
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. UPSERT por id ────────────────────────────────────────────────────────
-- Compatível com chamador antigo: item sem `id` (ou com id de outro pedido) é
-- tratado como INSERT, exatamente como antes. O retorno mantém a chave
-- `inserted_item_ids` com TODOS os ids na ORDEM do payload — o frontend
-- reidrata terceirização por índice e continua funcionando sem mudança.
CREATE OR REPLACE FUNCTION public.update_sale_order_atomic(
  p_order_id uuid,
  p_header   jsonb,
  p_items    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so       sale_orders%ROWTYPE;
  v_merged   sale_orders%ROWTYPE;
  v_item     jsonb;
  v_item_id  uuid;
  v_new_id   uuid;
  v_kept_ids uuid[] := '{}';
  v_removed  int := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % não encontrado', p_order_id;
  END IF;

  v_merged := jsonb_populate_record(v_so, p_header);
  v_merged.id         := v_so.id;
  v_merged.status     := v_so.status;
  v_merged.created_at := v_so.created_at;
  v_merged.updated_at := now();

  UPDATE public.sale_orders SET
    order_number       = v_merged.order_number,
    client_name        = v_merged.client_name,
    client_cnpj        = v_merged.client_cnpj,
    client_contact     = v_merged.client_contact,
    client_id          = v_merged.client_id,
    representative     = v_merged.representative,
    representative_id  = v_merged.representative_id,
    payment_condition  = v_merged.payment_condition,
    delivery_deadline  = v_merged.delivery_deadline,
    notes              = v_merged.notes,
    total              = v_merged.total,
    commission_value   = v_merged.commission_value,
    client_order_number = v_merged.client_order_number,
    nfe                = v_merged.nfe,
    company_id         = v_merged.company_id,
    informacoes_complementares_nf = v_merged.informacoes_complementares_nf,
    brand              = v_merged.brand,
    transporter_id     = v_merged.transporter_id,
    nfe_external       = v_merged.nfe_external,
    remessa            = v_merged.remessa,
    packaging_product_id = v_merged.packaging_product_id,
    packaging_quantity = v_merged.packaging_quantity,
    is_factoring       = v_merged.is_factoring,
    factoring_config_id = v_merged.factoring_config_id,
    packaging_mode     = v_merged.packaging_mode,
    delivery_week      = v_merged.delivery_week,
    delivery_month     = v_merged.delivery_month,
    billing_week       = v_merged.billing_week,
    manual_billing_override = v_merged.manual_billing_override,
    original_min_billing_date = v_merged.original_min_billing_date,
    manual_override_reason = v_merged.manual_override_reason,
    scheduled_dispatch_at = v_merged.scheduled_dispatch_at,
    modalidade_frete   = v_merged.modalidade_frete,
    transport_company_id = v_merged.transport_company_id,
    valor_frete        = v_merged.valor_frete,
    checked_by         = v_merged.checked_by,
    order_type         = v_merged.order_type,
    parent_order_id    = v_merged.parent_order_id,
    export_currency    = v_merged.export_currency,
    export_exchange_rate = v_merged.export_exchange_rate,
    export_incoterm    = v_merged.export_incoterm,
    shipping_rate_per_pair = v_merged.shipping_rate_per_pair,
    nfe_required       = v_merged.nfe_required,
    own_delivery       = v_merged.own_delivery,
    updated_at         = v_merged.updated_at
  WHERE id = p_order_id;

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      v_item_id := NULLIF(v_item->>'id', '')::uuid;

      -- Só atualiza se o id existe E pertence a ESTE pedido (id de outro PV
      -- vindo por engano vira insert, nunca sequestra a linha alheia).
      IF v_item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.sale_order_items
         WHERE id = v_item_id AND sale_order_id = p_order_id
      ) THEN
        UPDATE public.sale_order_items SET
          reference_id        = (v_item->>'reference_id')::uuid,
          color               = COALESCE(v_item->>'color', ''),
          quantity            = COALESCE((v_item->>'quantity')::integer, 0),
          unit_price          = COALESCE((v_item->>'unit_price')::numeric, 0),
          grade               = COALESCE(v_item->'grade', '{}'::jsonb),
          fichas              = COALESCE((v_item->>'fichas')::integer, 1),
          observation         = NULLIF(v_item->>'observation', ''),
          material_variant_id = NULLIF(v_item->>'material_variant_id', '')::uuid,
          strap_colors        = CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array'
                                     THEN v_item->'strap_colors'
                                     ELSE '[]'::jsonb END
        WHERE id = v_item_id;
        v_kept_ids := v_kept_ids || v_item_id;
      ELSE
        INSERT INTO public.sale_order_items (
          sale_order_id, reference_id, color, quantity, unit_price,
          grade, fichas, observation, material_variant_id, strap_colors
        ) VALUES (
          p_order_id,
          (v_item->>'reference_id')::uuid,
          COALESCE(v_item->>'color', ''),
          COALESCE((v_item->>'quantity')::integer, 0),
          COALESCE((v_item->>'unit_price')::numeric, 0),
          COALESCE(v_item->'grade', '{}'::jsonb),
          COALESCE((v_item->>'fichas')::integer, 1),
          NULLIF(v_item->>'observation', ''),
          NULLIF(v_item->>'material_variant_id', '')::uuid,
          CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array'
               THEN v_item->'strap_colors'
               ELSE '[]'::jsonb END
        )
        RETURNING id INTO v_new_id;
        v_kept_ids := v_kept_ids || v_new_id;
      END IF;
    END LOOP;
  END IF;

  -- Apaga APENAS o que sumiu do payload. Se algum deles ainda tiver OP ativa,
  -- o gatilho da parte 3 estoura aqui — de propósito: é o app que tem que
  -- desmontar a OP antes, não o banco que deve orfanar em silêncio.
  DELETE FROM public.sale_order_items
   WHERE sale_order_id = p_order_id
     AND NOT (id = ANY(v_kept_ids));
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object(
    'inserted_item_ids', to_jsonb(v_kept_ids),  -- nome legado; hoje = TODOS, na ordem do payload
    'item_ids',          to_jsonb(v_kept_ids),
    'removed_items',     v_removed,
    'order_id',          p_order_id
  );
END;
$function$;

-- ── 2. Gatilho de sync acompanha troca de referência ────────────────────────
-- Antes, o UPDATE só reagia a quantity/color/grade. Como os itens eram
-- recriados a cada salvamento, trocar a REFERÊNCIA de um item funcionava por
-- acidente (nascia OP nova). Com identidade estável isso deixaria a OP com a
-- referência velha — some com o acidente e trata explicitamente.
CREATE OR REPLACE FUNCTION public.tg_sync_orders_from_sale_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so_status text;
  v_sale_order_id uuid;
  v_existing_op_id uuid;
  v_op_id uuid;
  v_op_status text;
  v_packaging_mode text;
  v_grade jsonb;
  v_do_reserve boolean := false;
  v_release_first boolean := false;
  v_fail_msgs text[] := ARRAY[]::text[];
BEGIN
  v_sale_order_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_sale_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF current_setting('app.suppress_item_op_sync', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status, COALESCE(packaging_mode, 'individual_amarrado')
    INTO v_so_status, v_packaging_mode
    FROM public.sale_orders WHERE id = v_sale_order_id;
  IF v_so_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_existing_op_id
      FROM public.orders
     WHERE sale_order_item_id = NEW.id
       AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')
     LIMIT 1;
    IF v_existing_op_id IS NOT NULL THEN RETURN NEW; END IF;

    INSERT INTO public.orders (
      reference_id, quantity, color, grade,
      sale_order_id, sale_order_item_id, status, notes
    )
    VALUES (
      NEW.reference_id, NEW.quantity, COALESCE(NEW.color,''),
      public.scale_grade_to_total(COALESCE(NEW.grade,'{}'::jsonb), NEW.quantity),
      v_sale_order_id, NEW.id, 'Reservado',
      'Auto-criada por alteração em PV (item adicionado)'
    )
    RETURNING id INTO v_op_id;
    v_do_reserve := true;
    v_release_first := false;

  ELSIF TG_OP = 'UPDATE' THEN
    SELECT id, status INTO v_op_id, v_op_status
      FROM public.orders
     WHERE sale_order_item_id = NEW.id
       AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')
     LIMIT 1;
    IF v_op_id IS NOT NULL
       AND (NEW.quantity IS DISTINCT FROM OLD.quantity
            OR NEW.color IS DISTINCT FROM OLD.color
            OR NEW.grade IS DISTINCT FROM OLD.grade
            OR NEW.reference_id IS DISTINCT FROM OLD.reference_id)
    THEN
      UPDATE public.orders
         SET reference_id = NEW.reference_id,
             quantity = NEW.quantity,
             color = COALESCE(NEW.color,''),
             grade = public.scale_grade_to_total(COALESCE(NEW.grade,'{}'::jsonb), NEW.quantity),
             updated_at = now(),
             notes = COALESCE(notes,'') || E'\n' || 'Atualizada por alteração em PV — qty=' || NEW.quantity::text
       WHERE id = v_op_id;
      IF v_op_status IN ('Pendente', 'Reservado', 'Rascunho') THEN
        v_do_reserve := true;
        v_release_first := true;
      END IF;
    END IF;
  END IF;

  IF v_do_reserve AND v_op_id IS NOT NULL THEN
    v_grade := CASE
      WHEN NEW.grade IS NOT NULL AND NEW.grade <> '{}'::jsonb THEN NEW.grade
      ELSE NULL
    END;

    IF v_release_first THEN
      BEGIN
        PERFORM public.release_order_reservations(v_op_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_sync_item] release falhou pra OP %: %', v_op_id, SQLERRM;
        v_fail_msgs := array_append(v_fail_msgs, 'release: ' || SQLERRM);
      END;
    END IF;

    BEGIN
      PERFORM public.hybrid_debit_stock_for_order(
        p_reference_id   => NEW.reference_id,
        p_order_quantity => NEW.quantity::numeric,
        p_color          => COALESCE(NEW.color, ''),
        p_order_id       => v_op_id,
        p_order_grade    => v_grade,
        p_force_soft     => true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[tg_sync_item] hybrid_debit falhou pra OP %: %', v_op_id, SQLERRM;
      v_fail_msgs := array_append(v_fail_msgs, 'materiais: ' || SQLERRM);
    END;

    IF v_grade IS NOT NULL THEN
      BEGIN
        PERFORM public.debit_sole_stock_by_grade(
          p_reference_id => NEW.reference_id,
          p_order_id     => v_op_id,
          p_color        => COALESCE(NEW.color, ''),
          p_order_grade  => v_grade,
          p_force_soft   => true
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_sync_item] debit_sole falhou pra OP %: %', v_op_id, SQLERRM;
        v_fail_msgs := array_append(v_fail_msgs, 'solado: ' || SQLERRM);
      END;
    END IF;

    IF NEW.strap_colors IS NOT NULL
       AND jsonb_typeof(NEW.strap_colors) = 'array'
       AND jsonb_array_length(NEW.strap_colors) > 0 THEN
      BEGIN
        PERFORM public.debit_strap_stock(
          p_strap_colors   => NEW.strap_colors,
          p_order_quantity => NEW.quantity,
          p_order_id       => v_op_id,
          p_order_grade    => v_grade,
          p_force_soft     => true
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_sync_item] debit_strap falhou pra OP %: %', v_op_id, SQLERRM;
        v_fail_msgs := array_append(v_fail_msgs, 'tiras: ' || SQLERRM);
      END;
    END IF;

    BEGIN
      PERFORM public.debit_packaging_for_order(
        p_sale_order_id  => v_sale_order_id,
        p_order_id       => v_op_id,
        p_reference_id   => NEW.reference_id,
        p_order_quantity => NEW.quantity,
        p_packaging_mode => v_packaging_mode,
        p_force_soft     => true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[tg_sync_item] debit_packaging falhou pra OP %: %', v_op_id, SQLERRM;
      v_fail_msgs := array_append(v_fail_msgs, 'embalagem: ' || SQLERRM);
    END;

    -- AUD-1 (auditoria 2026-07-19): falha nos débitos soft NÃO pode ser só
    -- RAISE WARNING (invisível) — OPs nasciam sem NENHUMA reserva e finalizavam
    -- sem débito. Marca a OP de forma visível; a reserva manual limpa o status.
    IF COALESCE(array_length(v_fail_msgs, 1), 0) > 0 THEN
      UPDATE public.orders
         SET material_status = 'erro_reserva',
             notes = COALESCE(NULLIF(notes, '') || E'\n', '')
               || '⚠ Reserva automática FALHOU — rodar reserva manual (MRP). Detalhe: '
               || array_to_string(v_fail_msgs, ' | ')
       WHERE id = v_op_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ── 3. O banco para de colaborar com a destruição ───────────────────────────
-- A FK é ON DELETE SET NULL: o banco aceitava, calado, apagar um item com OP
-- viva. Enquanto for assim, qualquer rotina futura repete o mesmo erro e a
-- gente só descobre meses depois (foi o que houve com as 78 OS).
-- FK não é condicional, então o bloqueio vai num BEFORE DELETE: recusa apenas
-- quando existe OP ATIVA. Item cujas OPs já foram canceladas/finalizadas
-- continua removível (segue caindo no SET NULL, que aí é correto).
CREATE OR REPLACE FUNCTION public.tg_block_item_delete_with_active_op()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ops text;
BEGIN
  SELECT string_agg(order_number, ', ' ORDER BY order_number) INTO v_ops
    FROM public.orders
   WHERE sale_order_item_id = OLD.id
     AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído');

  IF v_ops IS NOT NULL THEN
    RAISE EXCEPTION
      'Item do pedido não pode ser removido: tem OP ativa (%). Cancele ou desmonte a OP antes.', v_ops
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_item_delete_with_active_op ON public.sale_order_items;
CREATE TRIGGER trg_block_item_delete_with_active_op
  BEFORE DELETE ON public.sale_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_item_delete_with_active_op();

-- ── 4. Invariante: 1 OP ativa por item ──────────────────────────────────────
-- Verificado antes de criar: ZERO itens com mais de uma OP em toda a base.
-- Fecha a porta pras OUTRAS 6 rotas que criam OP (4 no frontend,
-- force_sale_order_production e o gatilho de aprovação), não só pra esta.
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_one_active_op_per_item
  ON public.orders (sale_order_item_id)
  WHERE sale_order_item_id IS NOT NULL
    AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído');

-- ── 5. Vínculos quebrados viram número no /diagnostics ──────────────────────
-- Pra enxergar acontecendo, em vez de descobrir por etiqueta duplicada.
CREATE OR REPLACE FUNCTION public.broken_sale_order_links_report()
RETURNS TABLE (
  check_name  text,
  severity    text,
  qtd         bigint,
  detalhe     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    'OP ativa sem item do PV'::text,
    'critico'::text,
    count(*),
    COALESCE(string_agg(o.order_number, ', ' ORDER BY o.order_number), '—')
  FROM public.orders o
  WHERE o.sale_order_id IS NOT NULL
    AND o.sale_order_item_id IS NULL
    AND o.status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')

  UNION ALL
  SELECT
    'OS de PV sem vínculo com o item'::text,
    'aviso'::text,
    count(*),
    'Perdem rastro de qual linha do pedido originou o serviço'::text
  FROM public.service_orders s
  WHERE s.sale_order_id IS NOT NULL
    AND s.source_sale_order_item_id IS NULL

  UNION ALL
  SELECT
    'Item do PV com mais de uma OP ativa'::text,
    'critico'::text,
    COALESCE(count(*), 0),
    'Deve ser sempre 0 — travado por ux_orders_one_active_op_per_item'::text
  FROM (
    SELECT sale_order_item_id
      FROM public.orders
     WHERE sale_order_item_id IS NOT NULL
       AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')
     GROUP BY sale_order_item_id
    HAVING count(*) > 1
  ) d;
$function$;

GRANT EXECUTE ON FUNCTION public.broken_sale_order_links_report() TO authenticated;
