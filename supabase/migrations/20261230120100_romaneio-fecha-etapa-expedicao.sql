-- Romaneio fecha a etapa Expedição (decisão do dono, 07/08/2026)
--
-- Contexto: a migration 20261230120000 tornou a Expedição obrigatória em toda
-- rota. Isso criava um risco: a OP só vira 'Finalizado' quando NENHUMA etapa
-- fica aberta, e `production_pointings` mostra ZERO lançamentos em Expedição —
-- ninguém nunca apontou lá pelo Kanban (os 168 'concluído' que existem são
-- legado migrado). Sem este arquivo, as OPs passariam a empacar na última
-- coluna e nunca chegariam a 'Finalizado', que é o filtro de PostOPAnalysis,
-- custeio e KPIs.
--
-- Decisão: DOIS caminhos de fecho. O Kanban continua permitindo apontar a
-- Expedição na mão, e o romaneio fecha automaticamente — a expedição já confere
-- a carga ali, apontar de novo seria trabalho dobrado.
--
-- `register_order_shipment` mexia só em `sale_orders` (status, shipped_at,
-- vínculo com o manifesto) e não encostava em `order_stages`.

CREATE OR REPLACE FUNCTION public.register_order_shipment(
  p_sale_order_ids uuid[],
  p_manifest_id uuid DEFAULT NULL::uuid,
  p_checked_by text DEFAULT NULL::text
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count        int := 0;
  v_ids_a        uuid[] := '{}';
  v_ids_b        uuid[] := '{}';
  v_ids_c        uuid[] := '{}';
  v_shipped      uuid[] := '{}';
  v_sid          uuid;
  v_nfe_ok       boolean;
  v_nfe_required boolean;
  v_nfe_external boolean;
  v_status       text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Validação: PVs formais (nfe_required=true E nfe_external=false) exigem
  -- NF-e autorizada no banco. Demais combinações passam direto.
  FOREACH v_sid IN ARRAY p_sale_order_ids LOOP
    SELECT nfe_required, nfe_external, status
      INTO v_nfe_required, v_nfe_external, v_status
      FROM public.sale_orders WHERE id = v_sid;

    IF v_nfe_required = true AND COALESCE(v_nfe_external, false) = false THEN
      SELECT EXISTS (
        SELECT 1 FROM public.nfe_emitidas
         WHERE sale_order_id = v_sid AND status = 'autorizada'
      ) INTO v_nfe_ok;
      IF NOT v_nfe_ok THEN
        RAISE EXCEPTION 'Pedido % não pode ser expedido: nenhuma NF-e autorizada encontrada. Se a NF for emitida por outra empresa, marque nfe_external=true no PV. Se for informal, marque nfe_required=false.', v_sid;
      END IF;
    END IF;
  END LOOP;

  -- Os 3 paths agora devolvem os IDs que de fato mudaram (RETURNING) em vez de
  -- só contar: é essa lista que diz quais OPs fechar. Um PV já expedido não
  -- entra em nenhum dos três e portanto não é refechado.

  -- Path A: PVs formais com NF no sistema — Faturado → Expedido
  WITH upd AS (
    UPDATE public.sale_orders
       SET shipped_at = now(), checked_by = p_checked_by, status = 'Expedido'
     WHERE id = ANY(p_sale_order_ids)
       AND nfe_required = true
       AND COALESCE(nfe_external, false) = false
       AND status = 'Faturado'
       AND shipped_at IS NULL
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_ids_a FROM upd;

  -- Path B: PVs informais — Em Produção → Finalizado s/ NF
  WITH upd AS (
    UPDATE public.sale_orders
       SET shipped_at = now(), checked_by = p_checked_by, status = 'Finalizado s/ NF'
     WHERE id = ANY(p_sale_order_ids)
       AND nfe_required = false
       AND status = 'Em Produção'
       AND shipped_at IS NULL
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_ids_b FROM upd;

  -- Path C: PVs com NF externa — Em Produção/Faturado → Expedido (sem checar NF interna)
  WITH upd AS (
    UPDATE public.sale_orders
       SET shipped_at = now(), checked_by = p_checked_by, status = 'Expedido'
     WHERE id = ANY(p_sale_order_ids)
       AND nfe_required = true
       AND COALESCE(nfe_external, false) = true
       AND status IN ('Em Produção', 'Faturado')
       AND shipped_at IS NULL
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_ids_c FROM upd;

  v_shipped := v_ids_a || v_ids_b || v_ids_c;
  v_count := COALESCE(array_length(v_shipped, 1), 0);

  IF v_count > 0 THEN
    -- FECHA A ROTA INTEIRA das OPs expedidas (decisão do dono, 07/08/2026).
    --
    -- A carga saiu: qualquer etapa ainda aberta é atraso de apontamento, não
    -- trabalho pendente. Fecha com `quantity_total` porque o romaneio conferiu
    -- o pedido inteiro — é o mesmo critério do gatilho
    -- `tg_close_stages_on_op_finalize`, que já faz isso quando a OP é
    -- finalizada por outro caminho.
    --
    -- ⚠ Aqui a condição é `status <> 'concluido'`, não `= 'pendente'` como no
    -- gatilho: etapa com apontamento PARCIAL fica 'em_andamento' e escapava
    -- dele, deixando a OP 'Finalizado' com etapa aberta — e o card seguia no
    -- Kanban, que deriva o card das ETAPAS, não do status da OP. O escopo mais
    -- largo fica contido nesta função, sem mudar o gatilho compartilhado.
    UPDATE public.order_stages s
       SET status = 'concluido',
           quantity_processed = COALESCE(s.quantity_total, s.quantity_processed),
           completed_by = COALESCE(s.completed_by, auth.uid()),
           started_at = COALESCE(s.started_at, now()),
           completed_at = COALESCE(s.completed_at, now()),
           updated_at = now()
     WHERE s.status <> 'concluido'
       AND s.order_id IN (
         SELECT o.id FROM public.orders o
          WHERE o.sale_order_id = ANY(v_shipped)
            AND o.status NOT IN ('Cancelado', 'Cancelada')
       );

    -- Redundante com `auto_finalize_order_on_all_stages_done` (que dispara no
    -- UPDATE acima), de propósito: OP sem NENHUMA etapa cadastrada não acorda
    -- aquele gatilho e ficaria eternamente 'Em Produção' com a carga na rua.
    UPDATE public.orders o
       SET status = 'Finalizado',
           last_sector_finished_at = now(),
           updated_at = now()
     WHERE o.sale_order_id = ANY(v_shipped)
       AND o.status NOT IN ('Finalizado', 'Cancelado', 'Cancelada');
  END IF;

  IF p_manifest_id IS NOT NULL AND v_count > 0 THEN
    WITH ordered_ids AS (
      SELECT id, row_number() OVER () AS rn
        FROM unnest(p_sale_order_ids) AS sub(id)
    ),
    ordered_items AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
        FROM public.loading_manifest_items
       WHERE manifest_id = p_manifest_id AND sale_order_id IS NULL
    )
    UPDATE public.loading_manifest_items lmi
       SET sale_order_id = oi.id
      FROM ordered_items oitm
      JOIN ordered_ids oi USING (rn)
     WHERE lmi.id = oitm.id;
  END IF;

  RETURN v_count;
END;
$function$;
