-- Expedição obrigatória na rota de produção (decisão do dono, 07/08/2026)
--
-- SINTOMA: arrastar BT01/BT02 pra Expedição no Kanban devolvia
-- "Esta OP não passa por Expedição (ou o setor já está concluído)".
-- O toast estava certo: OP-2026-00968/00969/01146 têm 10 etapas terminando em
-- ACABAMENTO — não existe linha de Expedição em `order_stages`.
--
-- CAUSA RAIZ: a rota da OP nasce de `technical_sheets.production_sectors`
-- (`promote_sale_order_item`). O default do SQL inclui Expedição, mas a ficha
-- sobrescreve — e as 6 listas canônicas do painel React
-- (`ConstructionConfigPanel.tsx`) terminavam todas em Acabamento. Escolher o
-- modelo de produção da ficha ARRANCAVA a Expedição. Medido: 16 de 53 fichas
-- sem a etapa, gerando 29 OPs sem ela (9 já finalizadas, 20 abertas).
--
-- Efeito além do arrasto: a OP finalizava no Acabamento
-- (`finalize_production_sector` marca 'Finalizado' quando nenhuma etapa fica
-- pendente) e nunca entrava no romaneio de Expedição — o filtro em
-- `PrintWorkSheetsPage.tsx` já excluía BT01 por isso.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TRAVA: nenhuma ficha grava rota sem Expedição, por porta nenhuma
-- ─────────────────────────────────────────────────────────────────────────────
-- O trigger já reordenava `production_sectors` pela lista canônica de 11
-- setores (que sempre incluiu Expedição) — só não a ACRESCENTAVA: filtrava pelo
-- que veio. Corrigir só as 6 listas do React protegeria uma tela; aqui fecha
-- para SQL Editor, import e qualquer caminho futuro.
--
-- ⚠ Rota VAZIA continua vazia de propósito: `production_sectors` null/[] quer
-- dizer "sem restrição de roteiro" (é assim que PrintWorkSheetsPage lê). Injetar
-- Expedição numa lista vazia criaria ficha cuja rota inteira é a expedição.
CREATE OR REPLACE FUNCTION public.tg_normalize_production_sectors()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal',
    'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_input text[];
  v_normalized text[];
  v_clean jsonb;
  v_had_corte boolean := false;
BEGIN
  IF NEW.production_sectors IS NULL OR jsonb_typeof(NEW.production_sectors) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(value) INTO v_input
  FROM jsonb_array_elements_text(NEW.production_sectors);

  IF v_input IS NULL THEN RETURN NEW; END IF;

  v_had_corte := 'Corte' = ANY(v_input);

  SELECT array_agg(DISTINCT
    CASE
      WHEN x = 'Corte' THEN 'Corte Palmilha'
      WHEN x = 'Forração' THEN 'Corte Forração'
      WHEN x = 'Mesa' THEN 'Aviamento'
      WHEN x = 'Costura' THEN 'Costura Palmilha'
      ELSE x
    END
  )
  INTO v_normalized
  FROM unnest(v_input) x;

  IF v_had_corte THEN
    v_normalized := v_normalized || ARRAY['Corte Forração'];
  END IF;

  -- Toda rota termina na expedição. Fica por último sozinho: o SELECT abaixo
  -- ordena pela posição na lista canônica, onde Expedição é a 11ª.
  IF NOT ('Expedição' = ANY(v_normalized)) THEN
    v_normalized := v_normalized || ARRAY['Expedição'];
  END IF;

  SELECT jsonb_agg(s.value)
  INTO v_clean
  FROM (
    SELECT c.value, c.ord
    FROM unnest(v_canonical) WITH ORDINALITY AS c(value, ord)
    WHERE c.value = ANY(v_normalized)
    ORDER BY c.ord
  ) s;

  NEW.production_sectors := COALESCE(v_clean, '[]'::jsonb);
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BACKFILL das 16 fichas sem Expedição
-- ─────────────────────────────────────────────────────────────────────────────
-- Acrescenta ao FIM da rota de cada ficha, preservando o roteiro custom de cada
-- uma (BT01 tem Costura Cabedal + Aviamento juntos; CONFORTO começa no
-- Aviamento). O trigger acima reordena pro canônico depois.
UPDATE public.technical_sheets
   SET production_sectors = production_sectors || '["Expedição"]'::jsonb,
       updated_at = now()
 WHERE production_sectors IS NOT NULL
   AND jsonb_typeof(production_sectors) = 'array'
   AND jsonb_array_length(production_sectors) > 0
   AND NOT (production_sectors ? 'Expedição');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL das 20 OPs ABERTAS (as 9 finalizadas ficam de fora)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ Decisão do dono: NÃO tocar em OP já 'Finalizado'. Dar etapa pendente a ela
-- a ressuscita no quadro (`deriveCard` volta a devolver card) e desmente um
-- encerramento que já aconteceu.
--
-- `stage_order` = o maior entre o canônico (11) e último+1, porque as OPs não
-- concordam na numeração: as criadas por `promote_sale_order_item` usam
-- `canonical_stage_order` (Acabamento = 10) e as recriadas por
-- `resync_op_atomic` usavam posição (Acabamento = 9 em OP-2026-01245/46/47).
-- O GREATEST garante que a Expedição seja a última nas duas convenções.
INSERT INTO public.order_stages (
  order_id, stage_name, stage_order, status, quantity_total, quantity_processed
)
SELECT o.id,
       'Expedição',
       GREATEST(
         public.canonical_stage_order('Expedição'),
         COALESCE((SELECT MAX(s.stage_order) FROM public.order_stages s WHERE s.order_id = o.id), 0) + 1
       ),
       'pendente',
       o.quantity,
       0
  FROM public.orders o
 WHERE o.status NOT IN ('Finalizado', 'Cancelado', 'Cancelada')
   AND EXISTS (SELECT 1 FROM public.order_stages s WHERE s.order_id = o.id)
   AND NOT EXISTS (
     SELECT 1 FROM public.order_stages s
      WHERE s.order_id = o.id AND s.stage_name IN ('Expedição', 'Expedicao')
   );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `resync_op_atomic`: a rota de fallback estava podre
-- ─────────────────────────────────────────────────────────────────────────────
-- Esta função DELETA e recria `order_stages` a partir da ficha, então ela é a
-- porta que reintroduz qualquer erro de rota. Dois defeitos:
--
--   a) o fallback usava 'Costura' — grafia MORTA desde o split em Costura
--      Palmilha / Costura Cabedal (migration 20261001120000). A RPC de
--      apontamento não conhece esse nome (só o alias Mesa ⇄ Aviamento), então
--      uma OP resincronizada sem ficha ficava com um setor inapontável.
--   b) numerava por ORDINALITY (posição na lista) em vez de
--      `canonical_stage_order`. Daí OP-2026-01245/46/47 terem Acabamento em 9
--      enquanto o resto da fábrica tem 10 — duas convenções na mesma tabela.
--
-- Agora espelha `promote_sale_order_item`: canônico quando conhecido, posição
-- só como desempate pra setor fora da lista (que a função devolve como 99).
CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
  v_delta jsonb := NULL;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT id, reference_id, quantity, color, grade, sale_order_id, order_number, status
    INTO v_op
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  v_status := LOWER(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  FOR v_mov IN
    SELECT product_id, quantity
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
    SELECT quantity INTO v_prev_stock
      FROM public.products
     WHERE id = v_mov.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_errors := v_errors || ('Produto não encontrado: ' || v_mov.product_id::text);
      CONTINUE;
    END IF;

    v_new_stock := v_prev_stock + v_mov.quantity;
    UPDATE public.products SET quantity = v_new_stock, updated_at = now()
     WHERE id = v_mov.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_mov.product_id, 'in', v_mov.quantity, v_prev_stock, v_new_stock,
      'Estorno automático - resync_op_atomic', p_order_id
    );
  END LOOP;

  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT p_order_id,
         lat.stage_name,
         CASE WHEN public.canonical_stage_order(lat.stage_name) = 99
              THEN lat.ord::int
              ELSE public.canonical_stage_order(lat.stage_name) END,
         'pendente',
         v_op.quantity,
         0
    FROM (
      SELECT
        COALESCE(
          (SELECT array_agg(value::text ORDER BY ordinality)
             FROM technical_sheets ts,
                  jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY
            WHERE ts.id = v_op.reference_id
              AND ts.production_sectors IS NOT NULL
              AND jsonb_array_length(ts.production_sectors) > 0),
          ARRAY['Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal',
                'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
        ) AS names
    ) s,
    LATERAL (
      SELECT name AS stage_name, ord
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  -- NOVO (2026-07-25): fecha a causa-raiz do furo de baixa. hybrid_debit
  -- reconstrói a reserva a partir do snapshot; qualquer componente que a ficha
  -- ATUAL pede e ficou de fora entra aqui como reserva de delta.
  BEGIN
    v_delta := public.reserve_missing_materials_for_order(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || ('reserva de delta falhou: ' || SQLERRM);
    PERFORM public.record_op_reserve_failure_alert(p_order_id, 'resync_op_atomic: ' || SQLERRM);
  END;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'errors', v_errors,
    'delta_reservations', v_delta,
    'resynced_at', now()
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. DROP `advance_order_to_sector` — terceira cópia podre da rota, sem uso
-- ─────────────────────────────────────────────────────────────────────────────
-- `v_flow` trazia 'Costura' (grafia morta) e punha 'Aviamento' ANTES da costura
-- — ordem invertida em relação a `canonical_stage_order`, onde Costura é 3/4 e
-- Aviamento é 5. Como ela fecha como 'concluido' todo setor cuja posição é menor
-- que a do destino, essa inversão fecharia a costura ao avançar pro aviamento.
-- Zero chamadores em `src/` (só aparecia nos types gerados e na allow-list do
-- lockdown de anon), então some em vez de virar quarta rota pra manter em
-- sincronia.
DROP FUNCTION IF EXISTS public.advance_order_to_sector(uuid, text, uuid);
